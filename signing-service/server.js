// ============================================
// VERIX - Signing Service
// Servicio Node.js para firmar digitalmente
// certificados PDF con P12/PFX.
//
// Desplegar en Railway, Fly.io o Cloud Run.
// Recibe el PDF desde la Edge Function de Supabase,
// lo firma con node-signpdf y lo guarda en Storage.
// ============================================
import express from 'express';
import cors from 'cors';
import { createClient } from '@supabase/supabase-js';
import { SignPdf } from '@signpdf/signpdf';
import { P12Signer } from '@signpdf/signer-p12';
import { pdfLibSignAttachment } from '@signpdf/placeholder-pdf-lib';

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

const PORT = process.env.PORT || 3000;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const P12_ENCRYPTION_KEY = process.env.P12_ENCRYPTION_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !P12_ENCRYPTION_KEY) {
  console.error('❌ Faltan variables de entorno: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, P12_ENCRYPTION_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ── Health check ──
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ── Sign PDF endpoint ──
app.post('/sign-pdf', async (req, res) => {
  try {
    const { request_id, user_id, pdf_base64, reviewed_by, reviewer_notes, consecutive_number } = req.body;

    if (!request_id || !user_id || !pdf_base64) {
      return res.status(400).json({ error: 'request_id, user_id y pdf_base64 son requeridos' });
    }

    // 1. Get user's P12 certificate
    const { data: cert, error: certError } = await supabase
      .from('user_certificates')
      .select('*')
      .eq('user_id', user_id)
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (certError || !cert) {
      return res.status(404).json({ error: 'No se encontró un certificado P12 activo para este usuario' });
    }

    // 2. Download P12 from Storage
    const { data: p12Blob, error: p12Error } = await supabase.storage
      .from('verix')
      .download(cert.storage_path);

    if (p12Error || !p12Blob) {
      return res.status(500).json({ error: 'Error al descargar el certificado P12' });
    }

    // 3. Decrypt password
    if (!cert.encrypted_password || !cert.encryption_iv) {
      return res.status(400).json({
        error: 'El certificado no tiene contraseña almacenada. Debe subirse nuevamente desde Configuración.',
      });
    }

    const password = await decryptPassword(cert.encrypted_password, cert.encryption_iv, P12_ENCRYPTION_KEY);

    // 4. Sign the PDF using node-signpdf
    const p12Buffer = Buffer.from(await p12Blob.arrayBuffer());
    const pdfBuffer = Buffer.from(pdf_base64, 'base64');

    // Prepare signer and signing engine
    const signer = new P12Signer(p12Buffer, { passphrase: password });
    const signPdf = new SignPdf();

    // Prepare PDF with signature placeholder (v3 API)
    const pdfWithPlaceholder = await pdfLibSignAttachment({
      pdfBuffer,
      reason: 'Firmado digitalmente - VERIX',
      contactInfo: 'VERIX Platform',
      name: cert.original_filename?.replace(/\.(p12|pfx)$/i, '') || 'Firmante',
      location: 'Colombia',
    });

    // Sign the PDF
    const signedPdfBuffer = await signPdf.sign(pdfWithPlaceholder, signer);

    // 5. Upload signed PDF to Storage
    const signedFileName = `signed-${request_id}-${Date.now()}.pdf`;
    const signedStoragePath = `certificates/${user_id}/${signedFileName}`;

    const { error: uploadError } = await supabase.storage
      .from('verix')
      .upload(signedStoragePath, signedPdfBuffer, {
        contentType: 'application/pdf',
        upsert: true,
      });

    if (uploadError) {
      console.error('Error uploading signed PDF:', uploadError);
      return res.status(500).json({ error: 'Error al guardar el PDF firmado' });
    }

    const { data: { publicUrl } } = supabase.storage
      .from('verix')
      .getPublicUrl(signedStoragePath);

    // 6. Update certificate request
    const updatePayload = {
      certificate_url: publicUrl,
      status: 'APPROVED',
      reviewed_at: new Date().toISOString(),
    };
    if (reviewed_by) updatePayload.reviewed_by = reviewed_by;
    if (reviewer_notes) updatePayload.reviewer_notes = reviewer_notes;
    if (consecutive_number) updatePayload.consecutive_number = consecutive_number;

    const { error: updateError } = await supabase
      .from('certificate_requests')
      .update(updatePayload)
      .eq('id', request_id);

    if (updateError) {
      console.error('Error updating request:', updateError);
      return res.status(500).json({ error: 'Error al actualizar la solicitud' });
    }

    console.log(`✅ PDF firmado: ${request_id} → ${publicUrl}`);
    res.json({ success: true, certificate_url: publicUrl });

  } catch (err) {
    console.error('❌ Error signing PDF:', err);
    res.status(500).json({ error: 'Error interno: ' + (err.message || 'desconocido') });
  }
});

// ── Start server ──
app.listen(PORT, () => {
  console.log(`✅ VERIX Signing Service running on port ${PORT}`);
  console.log(`   Supabase URL: ${SUPABASE_URL}`);
});

// ── Decrypt AES-256-GCM ──
async function decryptPassword(encryptedB64, ivB64, keyStr) {
  const { createDecipheriv } = await import('crypto');
  const key = Buffer.from(keyStr.padEnd(32, '0').slice(0, 32), 'utf-8');
  const iv = Buffer.from(ivB64, 'base64');
  const encrypted = Buffer.from(encryptedB64, 'base64');

  // Web Crypto API (store-p12-password) appends the 16-byte GCM auth tag
  // at the end of the ciphertext. Split it off for Node.js crypto.
  const authTag = encrypted.subarray(encrypted.length - 16);
  const ciphertext = encrypted.subarray(0, encrypted.length - 16);

  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);

  return decrypted.toString('utf-8');
}
