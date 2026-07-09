import { useState, useEffect, useRef } from 'react';
import { supabase, STORAGE } from '../../lib/supabase';
import { auditApi, getClientIP } from '../../services/api';
import { X, CheckCircle, XCircle, Download, FileText, Loader2, Signature, Printer } from 'lucide-react';
import { QRCodeCanvas } from 'qrcode.react';
import QRCode from 'qrcode';
import toast from 'react-hot-toast';
import jsPDF from 'jspdf';
import { getPageDimensions, type PageSizeName } from '../../lib/pageSizes';
import type { TemplateElement } from '../editor/TemplateCanvas';

interface CertificatePreviewProps {
  requestId: string;
  userId: string;
  userRole?: string;
  userInstitutionId?: string;
  onClose: () => void;
  onApproved: () => void;
}

// ── Date conversion: "20/06/2026" → "20 de junio de 2026" ──
const MONTHS = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

/**
 * Converts a date string to Spanish text format.
 * Supports:
 *   - DD/MM/AAAA  → "20 de junio de 2026"
 *   - AAAA-MM-DD  → "20 de junio de 2026"
 *   - Any other format → returned as-is
 */
function formatDateToSpanish(dateStr: string): string {
  // Try DD/MM/AAAA first
  let match = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (match) {
    const day = parseInt(match[1], 10);
    const month = parseInt(match[2], 10);
    const year = match[3];
    if (month >= 1 && month <= 12) {
      return `${day} de ${MONTHS[month - 1]} de ${year}`;
    }
  }

  // Try YYYY-MM-DD (from <input type="date">)
  match = dateStr.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (match) {
    const year = match[1];
    const month = parseInt(match[2], 10);
    const day = parseInt(match[3], 10);
    if (month >= 1 && month <= 12) {
      return `${day} de ${MONTHS[month - 1]} de ${year}`;
    }
  }

  return dateStr; // Not a recognizable date format
}

/** Converts all date-like strings in data to Spanish text */
export function convertDatesInData(data: Record<string, any>): Record<string, any> {
  const result: Record<string, any> = {};
  for (const [key, value] of Object.entries(data)) {
    if (typeof value === 'string') {
      // Check for DD/MM/AAAA or YYYY-MM-DD patterns
      if (/\d{1,2}\/\d{1,2}\/\d{4}/.test(value) || /^\d{4}-\d{1,2}-\d{1,2}$/.test(value)) {
        result[key] = formatDateToSpanish(value);
      } else {
        result[key] = value;
      }
    } else {
      result[key] = value;
    }
  }
  return result;
}

/** Replaces {{variable}} placeholders with actual data values */
export function fillTemplate(content: string, data: Record<string, any>): string {
  return content.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const value = data[key];
    if (value === null || value === undefined) return `{{${key}}}`;
    return String(value);
  });
}

// Safe JSON parse helper
export const safeJsonParse = (str: string) => { try { return JSON.parse(str); } catch { return {}; } };

// ── Direct PDF generation (no html2canvas) ──

/** Font family mapping from CSS to jsPDF built-in fonts */
const FONT_MAP: Record<string, string> = {
  serif: 'times',
  'times new roman': 'times',
  georgia: 'times',
  palatino: 'times',
  'book antiqua': 'times',
  sans: 'helvetica',
  'sans-serif': 'helvetica',
  arial: 'helvetica',
  helvetica: 'helvetica',
  verdana: 'helvetica',
  tahoma: 'helvetica',
  'trebuchet ms': 'helvetica',
  monospace: 'courier',
  'courier new': 'courier',
  consolas: 'courier',
};

function mapFont(fontFamily?: string): string {
  if (!fontFamily) return 'times';
  return FONT_MAP[fontFamily.toLowerCase().trim()] || 'times';
}

function mapFontStyle(bold?: boolean, italic?: boolean): string {
  if (bold && italic) return 'bolditalic';
  if (bold) return 'bold';
  if (italic) return 'italic';
  return 'normal';
}

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  return [
    parseInt(clean.substring(0, 2), 16),
    parseInt(clean.substring(2, 4), 16),
    parseInt(clean.substring(4, 6), 16),
  ];
}

/** Load a remote image and return a data URL (base64) */
async function loadImageToDataUrl(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, { mode: 'cors' });
    if (!response.ok) return null;
    const blob = await response.blob();
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

/**
 * Generates a PDF by rendering each template element to exactly match the preview.
 * Supports multi-page templates: elements are grouped by their `page` field.
 * Uses splitTextToSize for precise multi-line text, aspect-ratio-preserving images,
 * proper padding, line-height, backgrounds, and borders matching the preview CSS.
 */
export async function renderTemplateToPdf(
  elements: TemplateElement[],
  pageOrientation: string,
  pageWidth: number,
  pageHeight: number,
  requestData: Record<string, any>,
  selectedSignature: { signature_image_url?: string } | null,
): Promise<jsPDF> {
  const orientation = pageOrientation === 'landscape' ? 'l' : 'p';
  const pdf = new jsPDF(orientation, 'pt', [pageWidth, pageHeight]);

  // ── Match preview CSS constants ──
  const PAD_X = 4;  // preview: padding '2px 4px' → horizontal 4px
  const PAD_Y = 2;  // preview: padding '2px 4px' → vertical 2px
  const LINE_HEIGHT = 1.2;  // preview: lineHeight 1.2

  // ── Group elements by page and sort by page number ──
  const pageMap = new Map<number, TemplateElement[]>();
  for (const el of elements) {
    const page = el.page ?? 0;
    if (!pageMap.has(page)) pageMap.set(page, []);
    pageMap.get(page)!.push(el);
  }
  const sortedPages = [...pageMap.keys()].sort((a, b) => a - b);

  if (sortedPages.length === 0) return pdf;

  // ── Render each page (using for...of to support async/await) ──
  for (const [idx, pageIndex] of sortedPages.entries()) {
    // First page is already created by the constructor; addPage for subsequent pages
    if (idx > 0) {
      pdf.addPage([pageWidth, pageHeight], orientation);
    }

    const pageElements = pageMap.get(pageIndex) || [];

    for (const el of pageElements) {
    const content = fillTemplate(el.content, requestData);
    const x = el.x;
    const y = el.y;
    const w = el.width;
    const h = el.height;
    const color = el.color || '#191c1e';
    const rgb = hexToRgb(color);
    const align = el.align || 'left';
    const fontSize = el.fontSize || 14;

    try {
      // ── 1. BACKGROUND: white background only for QR (matches preview bg-white)
      if (el.type === 'qr') {
        pdf.setFillColor(255, 255, 255);
        pdf.rect(x, y, w, h, 'F');
      }

      // ── 2. SHAPE / LINE BORDER ──
      if (el.type === 'shape') {
        pdf.setDrawColor(rgb[0], rgb[1], rgb[2]);
        pdf.setLineWidth(0.5);
        pdf.rect(x, y, w, h, 'S');
      } else if (el.type === 'line') {
        pdf.setDrawColor(rgb[0], rgb[1], rgb[2]);
        pdf.setLineWidth(0.5);
        pdf.line(x, y + h / 2, x + w, y + h / 2);
      }

      // ── 3. IMAGE (preserve aspect ratio like preview's object-contain) ──
      if (el.type === 'image' && el.imageUrl) {
        const imgData = await loadImageToDataUrl(el.imageUrl);
        if (imgData) {
          const fmt = imgData.startsWith('data:image/png') ? 'PNG' : 'JPEG';
          // Get actual image dimensions to preserve aspect ratio
          const imgDims = await getImageDimensions(imgData);
          if (imgDims) {
            const imgAspect = imgDims.width / imgDims.height;
            const boxAspect = w / h;
            let drawW: number, drawH: number;
            if (imgAspect > boxAspect) {
              // Image wider than box → fit to width
              drawW = w;
              drawH = w / imgAspect;
            } else {
              // Image taller than box → fit to height
              drawH = h;
              drawW = h * imgAspect;
            }
            // Center within element (matching preview's flex align-items/justify-content center)
            const drawX = x + (w - drawW) / 2;
            const drawY = y + (h - drawH) / 2;
            pdf.addImage(imgData, fmt, drawX, drawY, drawW, drawH);
          } else {
            // Fallback: stretch to fill
            pdf.addImage(imgData, fmt, x, y, w, h);
          }
        }
      }

      // ── 4. QR CODE (always uses validation URL, same as preview) ──
      if (el.type === 'qr') {
        try {
          // Build the validation URL from request data or from content
          const code = requestData['codigo_verificacion'] || requestData['verification_code'] || requestData['codigo'] || '';
          const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';
          const validationUrl = `${baseUrl}/validate/${code}`;
          // Always use full validation URL for QR, regardless of template content
          const qrValue = requestData['qr_content'] || validationUrl;

          const qrNativeSize = Math.round(Math.min(w, h) * 4);
          const qrDataUrl = await QRCode.toDataURL(qrValue, {
            width: Math.max(qrNativeSize, 200),
            margin: 1,
            color: { dark: '#006e2f', light: '#ffffff' },
          });
          // QR occupies 90% of the smaller dimension (matching preview's css sizing)
          const qrSize = Math.min(w, h) * 0.9;
          const qrX = x + (w - qrSize) / 2;
          const qrY = y + (h - qrSize) / 2;
          pdf.addImage(qrDataUrl, 'PNG', qrX, qrY, qrSize, qrSize);
        } catch {
          // QR generation failed — skip
        }
      }

      // ── 5. SIGNATURE IMAGE ──
      if (el.type === 'signature') {
        if (selectedSignature?.signature_image_url) {
          const imgData = await loadImageToDataUrl(selectedSignature.signature_image_url);
          if (imgData) {
            // Preserve aspect ratio like preview's bg-contain bg-center
            const imgDims = await getImageDimensions(imgData);
            if (imgDims) {
              const imgAspect = imgDims.width / imgDims.height;
              const boxAspect = w / h;
              let drawW: number, drawH: number;
              if (imgAspect > boxAspect) {
                drawW = w;
                drawH = w / imgAspect;
              } else {
                drawH = h;
                drawW = h * imgAspect;
              }
              const drawX = x + (w - drawW) / 2;
              const drawY = y + (h - drawH) / 2;
              pdf.addImage(imgData, 'PNG', drawX, drawY, drawW, drawH);
            } else {
              pdf.addImage(imgData, 'PNG', x, y, w, h);
            }
          }
        }
      }

      // ── 6. TEXT (text, date, consecutive) ──
      if ((el.type === 'text' || el.type === 'date' || el.type === 'consecutive') && content) {
        pdf.setFont(mapFont(el.fontFamily), mapFontStyle(el.bold, el.italic));
        pdf.setFontSize(fontSize);
        pdf.setTextColor(rgb[0], rgb[1], rgb[2]);

        const maxTextWidth = Math.max(1, w - PAD_X * 2);

        // Split text into lines respecting maxWidth (matching preview's wordBreak)
        const lines = pdf.splitTextToSize(content, maxTextWidth);

        // Calculate actual text block height (lineHeight * fontSize per line)
        const textBlockHeight = lines.length > 0 ? lines.length * fontSize * LINE_HEIGHT : 0;
        const availableHeight = h - PAD_Y * 2;

        // Vertical centering: Y = top padding + remaining space / 2
        // With baseline:'top', text TOP starts at Y
        let textY: number;
        if (textBlockHeight < availableHeight) {
          textY = y + PAD_Y + (availableHeight - textBlockHeight) / 2;
        } else {
          textY = y + PAD_Y;
        }

        // Determine X position based on alignment
        let textX: number;
        const textAlign: 'left' | 'center' | 'right' = align === 'justify' ? 'left' : align;
        if (align === 'center') {
          textX = x + w / 2;
        } else if (align === 'right') {
          textX = x + w - PAD_X;
        } else {
          // left / justify preview uses text-align: left + justifyContent flex-start
          textX = x + PAD_X;
        }

        // Render each line with proper spacing (matches preview's lineHeight: 1.2)
        if (lines.length > 0) {
          for (const line of lines) {
            pdf.text(line, textX, textY, {
              maxWidth: maxTextWidth,
              align: textAlign,
              baseline: 'top',
            });
            textY += fontSize * LINE_HEIGHT;
          }
        }
      }
    } catch (err) {
      console.warn(`⚠️ Error rendering element ${el.id || el.type}:`, err);
    }
    }
  }

  return pdf;
}

/** Get intrinsic dimensions of an image from a data URL */
function getImageDimensions(dataUrl: string): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}

export function CertificatePreview({
  requestId,
  userId,
  userRole,
  userInstitutionId,
  onClose,
  onApproved,
}: CertificatePreviewProps) {
  const [request, setRequest] = useState<any>(null);
  const [templateConfig, setTemplateConfig] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [approving, setApproving] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [showReject, setShowReject] = useState(false);

  // Signatures
  const [signatures, setSignatures] = useState<any[]>([]);
  const [selectedSignatureId, setSelectedSignatureId] = useState<string | null>(null);

  // Refs
  const certificateRef = useRef<HTMLDivElement>(null);

  // Radicado
  const [generatedRadicado, setGeneratedRadicado] = useState<{ id: string; code: string; number: number } | null>(null);
  const [radicadoLoading, setRadicadoLoading] = useState(false);

  useEffect(() => {
    loadData();
  }, [requestId]);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      // 1. Fetch full request
      const { data: req, error: reqErr } = await supabase
        .from('certificate_requests')
        .select('*, user:users!certificate_requests_user_id_fkey(first_name, last_name, email)')
        .eq('id', requestId)
        .single();

      if (reqErr) throw reqErr;
      if (!req) throw new Error('Solicitud no encontrada');

      // 2. Fetch template
      const { data: tmpl, error: tmplErr } = await supabase
        .from('templates')
        .select('*')
        .eq('id', req.template_id)
        .single();

      if (tmplErr) throw tmplErr;

      setRequest(req);
      setTemplateConfig(tmpl?.config || tmpl);

      // 3. Load authorized signatures for this institution
      if (userInstitutionId) {
        let sigQuery = supabase
          .from('authorized_signatures')
          .select('id, full_name, title, signature_image_url, document_id, is_primary')
          .eq('institution_id', userInstitutionId)
          .eq('is_active', true);

        // 🔒 SIGNER users can ONLY see their own assigned signatures
        if (userRole === 'SIGNER') {
          sigQuery = sigQuery.eq('user_id', userId);
        }

        const { data: sigs } = await sigQuery
          .order('is_primary', { ascending: false })
          .order('full_name');

        const sigList = sigs || [];
        setSignatures(sigList);

        // Auto-select primary signature
        const primary = sigList.find(s => s.is_primary);
        setSelectedSignatureId(primary?.id || sigList[0]?.id || null);
      }

      // 4. Set radicado: use existing consecutive_number for already-approved requests,
      //    or generate the next one for pending requests
      if (req.consecutive_number) {
        setGeneratedRadicado({
          id: '',
          code: req.consecutive_number,
          number: 0,
        });
      } else {
        await generateRadicado(req.template_id, req.user?.institution_id || userInstitutionId, tmpl?.dependency_id);
      }
    } catch (err: any) {
      console.error('Error loading preview:', err);
      setError(err.message || 'Error al cargar la vista previa');
    } finally {
      setLoading(false);
    }
  };

  const generateRadicado = async (templateId: string, institutionId: string, dependencyId?: string | null) => {
    setRadicadoLoading(true);
    try {
      const { data, error } = await supabase.rpc('get_next_radicado_for_template', {
        p_template_id: templateId,
        p_institution_id: institutionId,
        p_dependency_id: dependencyId || null,
      });

      if (error) {
        console.log('⚠️ No se pudo generar radicado:', error.message);
        return;
      }

      if (data && data.length > 0) {
        setGeneratedRadicado({
          id: data[0].radicado_id,
          code: data[0].radicado_code,
          number: data[0].consecutive_number,
        });
      }
    } catch (err) {
      console.log('⚠️ Error generando radicado (puede no haber uno configurado):', err);
    } finally {
      setRadicadoLoading(false);
    }
  };



  /** Descarga el PDF almacenado en certificate_url (el del bucket) */
  const handleDownloadNormal = async () => {
    if (!request?.certificate_url) {
      toast.error('No hay PDF almacenado para descargar');
      return;
    }
    try {
      toast.loading('Descargando PDF...', { id: 'pdf-dl' });
      const response = await fetch(request.certificate_url);
      if (!response.ok) throw new Error('Error al descargar');
      const blob = await response.blob();
      const link = document.createElement('a');
      const url = URL.createObjectURL(blob);
      link.href = url;
      link.download = `certificado-${requestCode || requestId.substring(0, 8)}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      toast.success('✅ PDF descargado exitosamente', { id: 'pdf-dl' });
    } catch (err: any) {
      toast.error('Error al descargar PDF: ' + (err.message || ''), { id: 'pdf-dl' });
    }
  };

  /** Descarga el PDF regenerado con la firma electrónica (sobre la marcha) */
  const handleDownloadSigned = async () => {
    try {
      toast.loading('Generando PDF con firma electrónica...', { id: 'pdf-sign' });

      let selectedSig: { signature_image_url?: string } | null = null;

      // Try to use the stored signature from reviewer_notes first
      if (request?.reviewer_notes) {
        try {
          const parsed = typeof request.reviewer_notes === 'string'
            ? JSON.parse(request.reviewer_notes)
            : request.reviewer_notes;
          if (parsed?.signature_url) {
            selectedSig = { signature_image_url: parsed.signature_url };
          }
        } catch { /* not JSON */ }
      }

      // Fallback: use currently selected signature if pending
      if (!selectedSig && selectedSignatureId) {
        const sig = signatures.find(s => s.id === selectedSignatureId);
        if (sig?.signature_image_url) {
          selectedSig = { signature_image_url: sig.signature_image_url };
        }
      }

      const pdf = await renderTemplateToPdf(
        elements,
        pageOrientation,
        pageWidth,
        pageHeight,
        requestData,
        selectedSig,
      );

      pdf.save(`certificado-${requestCode || requestId.substring(0, 8)}-firmado.pdf`);
      toast.success('✅ PDF con firma electrónica descargado', { id: 'pdf-sign' });
    } catch (err: any) {
      toast.error('Error al generar PDF: ' + (err.message || 'Error desconocido'), { id: 'pdf-sign' });
      console.error('PDF signed generation error:', err);
    }
  };

  /** Genera el PDF y lo sube a Storage, devolviendo la ruta y URL pública */
  const uploadUnsignedPdf = async (): Promise<{ storagePath: string; publicUrl: string } | null> => {
    try {
      const selectedSig = selectedSignatureId
        ? signatures.find(s => s.id === selectedSignatureId) || null
        : null;

      const pdf = await renderTemplateToPdf(
        elements,
        pageOrientation,
        pageWidth,
        pageHeight,
        requestData,
        selectedSig,
      );

      const pdfBlob = pdf.output('blob');
      const fileName = `unsigned-${requestId}-${Date.now()}.pdf`;
      const storagePath = `${STORAGE.PATHS.CERTIFICATES(userId)}/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from(STORAGE.BUCKET)
        .upload(storagePath, pdfBlob, {
          contentType: 'application/pdf',
          upsert: true,
        });

      if (uploadError) {
        console.error('Error uploading unsigned PDF:', uploadError);
        return null;
      }

      const { data: { publicUrl } } = supabase.storage
        .from(STORAGE.BUCKET)
        .getPublicUrl(storagePath);

      return { storagePath, publicUrl };
    } catch (err) {
      console.error('Error generating/uploading PDF:', err);
      return null;
    }
  };

  /** Intenta la firma digital con sign-pdf Edge Function */
  const tryDigitalSigning = async (): Promise<boolean> => {
    try {
      // 1. Check if user has a P12 certificate
      const { data: p12Cert } = await supabase
        .from('user_certificates')
        .select('id')
        .eq('user_id', userId)
        .eq('is_active', true)
        .limit(1)
        .maybeSingle();

      if (!p12Cert) return false; // No P12 cert, skip digital signing

      // 2. Generate PDF and upload to Storage (evita base64 → ahorra memoria ~30%)
      const uploadResult = await uploadUnsignedPdf();
      if (!uploadResult) return false;

      // 3. Prepare reviewer notes
      let reviewerNotes: string | undefined;
      if (selectedSignatureId) {
        const selectedSig = signatures.find(s => s.id === selectedSignatureId);
        if (selectedSig) {
          reviewerNotes = JSON.stringify({
            signature_id: selectedSignatureId,
            signature_name: selectedSig.full_name,
            signature_title: selectedSig.title,
            signature_url: selectedSig.signature_image_url,
          });
        }
      }

      // 4. Call sign-pdf Edge Function (con ruta de Storage en vez de base64)
      const { error: fnError, data: result } = await supabase.functions.invoke('sign-pdf', {
        body: {
          request_id: requestId,
          user_id: userId,
          pdf_storage_path: uploadResult.storagePath,
          reviewed_by: userId,
          reviewer_notes: reviewerNotes,
          consecutive_number: generatedRadicado?.code,
        },
      });

      if (fnError) {
        console.warn('⚠️ Firma digital falló, usando flujo manual:', fnError);
        return false;
      }

      console.log('✅ PDF firmado digitalmente:', result);
      return true;
    } catch (err) {
      console.warn('⚠️ Error en firma digital, usando flujo manual:', err);
      return false;
    }
  };

  const handleApprove = async () => {
    if (!selectedSignatureId && signatures.length > 0) {
      toast.error('Selecciona una firma para aprobar');
      return;
    }

    setApproving(true);
    try {
      // Try digital signing first (P12 certificate)
      const signed = await tryDigitalSigning();

      if (signed) {
        // Digital signing handled everything (status, certificate_url, etc.)
        toast.success('✅ Solicitud aprobada y firmada digitalmente');
        onApproved();
        onClose();
        return;
      }

      // ── Fallback: manual approval flow ──
      const updateData: any = {
        status: 'APPROVED',
        reviewed_by: userId,
        reviewed_at: new Date().toISOString(),
      };

      if (generatedRadicado) {
        updateData.consecutive_number = generatedRadicado.code;
      }

      let selectedSigForAudit: any = null;
      if (selectedSignatureId) {
        const selectedSig = signatures.find(s => s.id === selectedSignatureId);
        if (selectedSig) {
          selectedSigForAudit = selectedSig;
          updateData.reviewer_notes = JSON.stringify({
            signature_id: selectedSignatureId,
            signature_name: selectedSig.full_name,
            signature_title: selectedSig.title,
            signature_url: selectedSig.signature_image_url,
          });
        }
      }

      const { error } = await supabase
        .from('certificate_requests')
        .update(updateData)
        .eq('id', requestId);

      if (error) throw error;

      // ── Generar PDF y subirlo a Storage (certificate_url) ──
      // Así todos los certificados aprobados tienen PDF descargable
      // aunque la firma digital no esté disponible
      try {
        const uploadResult = await uploadUnsignedPdf();
        if (uploadResult) {
          await supabase
            .from('certificate_requests')
            .update({ certificate_url: uploadResult.publicUrl })
            .eq('id', requestId);
        }
      } catch (uploadErr) {
        console.warn('⚠️ No se pudo generar el PDF automático:', uploadErr);
      }

      // ── Audit log: firma aprobada ──
      try {
        const ip = await getClientIP();
        await auditApi.log({
          user_id: userId,
          user_email: (await supabase.auth.getUser()).data.user?.email || undefined,
          module: 'signatures',
          action: 'sign',
          entity_id: requestId,
          entity_type: 'certificate_request',
          ip_address: ip,
          description: `Firma aprobada - ${selectedSigForAudit?.full_name || 'Firmante'} (${selectedSigForAudit?.title || ''}) - Solicitud: ${requestCode || requestId}`,
        });
      } catch { /* silent */ }

      toast.success('✅ Solicitud aprobada');

      if (userRole === 'SIGNER' || userRole === 'ADMIN') {
        toast('💡 ¿Tienes un certificado P12? Configúralo en Ajustes > Firma para firmar digitalmente.', { icon: '🔐' });
      }

      onApproved();
      onClose();
    } catch (err: any) {
      toast.error(err.message || 'Error al aprobar');
    } finally {
      setApproving(false);
    }
  };

  const handleReject = async () => {
    if (!rejectReason.trim()) {
      toast.error('Debes indicar un motivo de rechazo');
      return;
    }

    setApproving(true);
    try {
      const { error } = await supabase
        .from('certificate_requests')
        .update({
          status: 'REJECTED',
          reviewed_by: userId,
          reviewed_at: new Date().toISOString(),
          rejection_reason: rejectReason,
        })
        .eq('id', requestId);

      if (error) throw error;

      // ── Audit log: firma rechazada ──
      try {
        const ip = await getClientIP();
        await auditApi.log({
          user_id: userId,
          user_email: (await supabase.auth.getUser()).data.user?.email || undefined,
          module: 'signatures',
          action: 'reject',
          entity_id: requestId,
          entity_type: 'certificate_request',
          ip_address: ip,
          description: `Firma rechazada - Motivo: ${rejectReason} - Solicitud: ${requestCode || requestId}`,
        });
      } catch { /* silent */ }

      toast.success('Solicitud rechazada');
      onApproved();
      onClose();
    } catch (err: any) {
      toast.error(err.message || 'Error al rechazar');
    } finally {
      setApproving(false);
    }
  };

  // ── Config & data extraction ──
  const rawConfig = templateConfig?.elements
    ? templateConfig
    : templateConfig?.config
      ? (typeof templateConfig.config === 'string' ? safeJsonParse(templateConfig.config) : templateConfig.config)
      : (typeof templateConfig === 'string' ? safeJsonParse(templateConfig) : templateConfig || {});

  const elements: TemplateElement[] = rawConfig?.elements || [];
  const pageOrientation = rawConfig?.orientation || 'landscape';
  const pageSizeName: PageSizeName = rawConfig?.pageSize || 'A4';
  const { width: pageWidth, height: pageHeight } = getPageDimensions(pageSizeName, pageOrientation);
  const scale = 0.55;

  // Build data dictionary with variables for template substitution
  const rawRequestData = request?.data || {};
  const requestCode = request?.code || '';
  const verificationCode = request?.verification_code || requestCode;
  const validationUrl = `${window.location.origin}/validate/${verificationCode}`;

  const requestData = {
    ...convertDatesInData(rawRequestData),

    // System: codigo and codigo_certificado (used by seed templates)
    codigo: verificationCode,
    codigo_certificado: verificationCode,

    // Request identifiers
    codigo_solicitud: requestCode,
    id_solicitud: requestCode,

    // Verification / QR
    codigo_verificacion: verificationCode,
    qr_content: validationUrl,

    // Radicado (if generated)
    ...(generatedRadicado ? { radicado: generatedRadicado.code, consecutivo: generatedRadicado.code } : {}),

    // Batch info (if applicable)
    ...(request?.batch_id ? {
      lote_id: request.batch_id,
      lote_total: String(request.batch_total || ''),
      lote_indice: String((request.row_index ?? -1) + 1),
    } : {}),
  };

  // If the request is already approved/signed, show in read-only mode
  const isReadOnly = request?.status === 'APPROVED' || request?.status === 'SIGNED';

  // Debug logs
  console.log('🔍 [Preview] Request data (with dates converted):', requestData);
  console.log('🔍 [Preview] Elements:', elements.length);
  console.log('🔍 [Preview] Signatures:', signatures.length);
  console.log('🔍 [Preview] Radicado:', generatedRadicado);
  console.log('🔍 [Preview] Read-only mode:', isReadOnly);

  // ── Element renderer ──
  const renderPreviewElement = (el: TemplateElement, index: number) => {
    const filledContent = fillTemplate(el.content, requestData);

    const bgStyle = 'transparent';
    const borderStyle = 'none';

    const renderContent = () => {
      if (el.type === 'image' && el.imageUrl) {
        return <img src={el.imageUrl} alt="" className="w-full h-full object-contain" />;
      }

      if (el.type === 'qr') {
        // QR siempre contiene la URL de validación, sin importar el content del template
        const qrValue = validationUrl;
        // Render QR at high native resolution for crisp PDF output
        // The preview is at scale 0.55, but the PDF capture can be up to 8x
        // Using multiplier 3 + minimum 200px ensures enough pixels for the QR modules
        const qrPreviewSize = Math.min(el.width * scale * 0.75, el.height * scale * 0.75);
        const qrCanvasSize = Math.max(Math.round(qrPreviewSize * 4), 200);
        return (
          <div className="w-full h-full flex items-center justify-center bg-white rounded relative">
            <div className="flex items-center justify-center" style={{ width: qrPreviewSize, height: qrPreviewSize }}>
              <QRCodeCanvas
                value={qrValue}
                size={qrCanvasSize}
                bgColor="#ffffff"
                fgColor="#006e2f"
                level="M"
                style={{ width: '100%', height: '100%' }}
              />
            </div>
            <span className="absolute -bottom-4 text-[5px] text-on-surface-variant/30 truncate max-w-full px-1 leading-none">
              {validationUrl}
            </span>
          </div>
        );
      }

      if (el.type === 'line') return <div className="w-full border-t border-outline" />;
      if (el.type === 'shape') return <div className="w-full h-full border border-outline rounded" />;

      if (el.type === 'signature') {
        const selectedSig = signatures.find(s => s.id === selectedSignatureId);
        return (
          <div
            className="w-full h-full flex items-center justify-center select-none"
            onContextMenu={e => e.preventDefault()}
            draggable={false}
          >
            {selectedSig?.signature_image_url ? (
              <div
                className="w-full h-full bg-no-repeat bg-contain bg-center"
                style={{
                  backgroundImage: `url("${selectedSig.signature_image_url}")`,
                  pointerEvents: 'none' as React.CSSProperties['pointerEvents'],
                  userSelect: 'none' as React.CSSProperties['userSelect'],
                  WebkitTouchCallout: 'none',
                }}
                draggable={false}
              />
            ) : (
              <span className="text-on-surface-variant/40 italic text-[10px] select-none">
                {selectedSig ? `${selectedSig.full_name}` : filledContent || '[Firma]'}
              </span>
            )}
          </div>
        );
      }

      // Text, date, consecutive and any other type
      return (
        <span className="w-full" style={{ whiteSpace: 'pre-wrap' }}>
          {filledContent}
        </span>
      );
    };

    return (
      <div
        key={el.id || index}
        className="absolute pointer-events-none"
        style={{
          left: el.x * scale,
          top: el.y * scale,
          width: el.width * scale,
          height: el.height * scale,
        }}
      >
        <div
          className="w-full h-full flex items-center overflow-hidden"
          style={{
            fontSize: (el.fontSize || 14) * scale,
            fontWeight: el.bold ? 'bold' : 'normal',
            fontStyle: el.italic ? 'italic' : 'normal',
            textAlign: el.align || 'left',
            color: el.color || '#191c1e',
            fontFamily: el.fontFamily || 'serif',
            background: bgStyle,
            border: borderStyle,
            borderRadius: el.type === 'image' ? '4px' : '0',
            justifyContent: el.align === 'center' ? 'center' : el.align === 'right' ? 'flex-end' : 'flex-start',
            padding: '2px 4px',
            lineHeight: 1.2,
            wordBreak: 'break-word',
          }}
        >
          {renderContent()}
        </div>
      </div>
    );
  };

  // ── Render ──
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-fade-in">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-[1200px] max-h-[95vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-outline-variant/20">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
              <FileText size={20} className="text-primary" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-on-surface">Vista previa del certificado</h2>
              <p className="text-sm text-on-surface-variant">
                {request?.code ? `Solicitud: ${request.code}` : 'Cargando...'}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-surface-container-high rounded-xl text-on-surface-variant transition-colors">
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <Loader2 size={32} className="text-primary animate-spin" />
              <p className="text-sm text-on-surface-variant">Cargando vista previa...</p>
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <div className="w-16 h-16 rounded-2xl bg-error-container flex items-center justify-center">
                <XCircle size={32} className="text-error" />
              </div>
              <p className="text-sm font-semibold text-error">{error}</p>
              <button onClick={loadData} className="btn-secondary btn-sm">Reintentar</button>
            </div>
          ) : (
            <>
              {/* Request info */}
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                <div>
                  <span className="text-[11px] uppercase tracking-wider text-on-surface-variant/60 font-bold">Solicitante</span>
                  <p className="font-semibold text-sm mt-0.5">{request?.user?.first_name} {request?.user?.last_name}</p>
                </div>
                <div>
                  <span className="text-[11px] uppercase tracking-wider text-on-surface-variant/60 font-bold">ID Solicitud</span>
                  <p className="font-mono text-sm font-semibold text-primary mt-0.5">{request?.code}</p>
                </div>
                <div>
                  <span className="text-[11px] uppercase tracking-wider text-on-surface-variant/60 font-bold">Radicado</span>
                  <p className="font-mono text-sm font-semibold text-secondary mt-0.5">
                    {generatedRadicado ? generatedRadicado.code : (radicadoLoading ? '...' : '—')}
                  </p>
                </div>
                <div>
                  <span className="text-[11px] uppercase tracking-wider text-on-surface-variant/60 font-bold">Lote</span>
                  <p className="font-mono text-sm font-semibold text-tertiary mt-0.5">
                    {request?.batch_id
                      ? `#${request.batch_id.substring(0, 6).toUpperCase()} (${(request.row_index ?? 0) + 1}/${request.batch_total || '?'})`
                      : 'Individual'}
                  </p>
                </div>
                <div>
                  <span className="text-[11px] uppercase tracking-wider text-on-surface-variant/60 font-bold">Fecha</span>
                  <p className="text-sm text-on-surface-variant mt-0.5">
                    {request?.created_at ? new Date(request.created_at).toLocaleDateString('es-CO') : '—'}
                  </p>
                </div>
              </div>

              {/* Data summary */}
              <div className="bg-surface-container-low rounded-xl p-4">
                <h4 className="text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-2">Datos del certificado</h4>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-1.5">
                  {Object.entries(rawRequestData).map(([key, value]) => (
                    <div key={key} className="flex gap-1.5 text-sm">
                      <span className="text-on-surface-variant/60 capitalize shrink-0">{key.replace(/_/g, ' ')}:</span>
                      <span className="font-medium text-on-surface truncate">
                        {typeof value === 'string' && (/\d{1,2}\/\d{1,2}\/\d{4}/.test(value) || /^\d{4}-\d{1,2}-\d{1,2}$/.test(value))
                          ? formatDateToSpanish(value)
                          : String(value)
                        }
                      </span>
                    </div>
                  ))}
                  {/* Additional system variables shown in summary */}
                  <div className="flex gap-1.5 text-sm">
                    <span className="text-on-surface-variant/60 capitalize shrink-0">ID Solicitud:</span>
                    <span className="font-medium text-primary font-mono truncate">{requestCode}</span>
                  </div>
                  {generatedRadicado && (
                    <div className="flex gap-1.5 text-sm">
                      <span className="text-on-surface-variant/60 capitalize shrink-0">Radicado:</span>
                      <span className="font-medium text-secondary font-mono">{generatedRadicado.code}</span>
                    </div>
                  )}
                  {request?.batch_id && (
                    <div className="flex gap-1.5 text-sm">
                      <span className="text-on-surface-variant/60 capitalize shrink-0">Lote:</span>
                      <span className="font-medium text-tertiary">#{request.batch_id.substring(0, 8)} ({request.batch_total} solicitudes)</span>
                    </div>
                  )}
                  {Object.keys(rawRequestData).length === 0 && !generatedRadicado && (
                    <p className="text-sm text-on-surface-variant/60 col-span-3">Sin datos variables</p>
                  )}
                </div>
              </div>

              {/* Certificate preview */}
              <div className="flex justify-center">
                <div
                  ref={certificateRef}
                  className="bg-white shadow-xl rounded-sm overflow-hidden relative"
                  style={{
                    width: pageWidth * scale,
                    height: pageHeight * scale,
                    boxShadow: '0 4px 24px rgba(0,0,0,0.12)',
                  }}
                >
                  <div
                    className="absolute inset-0 opacity-[0.015] pointer-events-none"
                    style={{
                      backgroundImage: 'radial-gradient(circle, #006e2f 1px, transparent 1px)',
                      backgroundSize: '20px 20px',
                    }}
                  />
                  {elements.map((el, i) => renderPreviewElement(el, i))}
                  {elements.length === 0 && (
                    <div className="absolute inset-0 flex items-center justify-center text-on-surface-variant/40">
                      <div className="text-center">
                        <FileText size={48} className="mx-auto mb-2 opacity-40" />
                        <p className="text-sm font-medium">Sin elementos en la plantilla</p>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* SIGNATURE SELECTOR — only for PENDING (non read-only) */}
              {!isReadOnly && (userRole === 'SIGNER' || userRole === 'ADMIN') && signatures.length > 0 && (
                <div className="glass-card p-5 rounded-2xl border border-white/40">
                  <div className="flex items-center gap-2 mb-3">
                    <Signature size={18} className="text-primary" />
                    <h4 className="font-bold text-sm text-on-surface">Firma autorizada</h4>
                    <span className="text-xs text-on-surface-variant/60">
                      — Selecciona la firma que aparecerá en el certificado
                    </span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {signatures.map((sig) => (
                      <button
                        key={sig.id}
                        onClick={() => setSelectedSignatureId(sig.id)}
                        className={`flex items-center gap-3 p-3 rounded-xl border text-left transition-all ${
                          selectedSignatureId === sig.id
                            ? 'border-primary bg-primary/5 shadow-sm'
                            : 'border-outline-variant/30 hover:border-primary/30 hover:bg-surface-container-low'
                        }`}
                      >
                        <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${
                          selectedSignatureId === sig.id ? 'bg-primary/10' : 'bg-surface-container-high'
                        }`}>
                          {sig.signature_image_url ? (
                            <div
                              className="w-8 h-8 bg-no-repeat bg-contain bg-center"
                              style={{
                                backgroundImage: `url("${sig.signature_image_url}")`,
                                pointerEvents: 'none' as React.CSSProperties['pointerEvents'],
                                userSelect: 'none' as React.CSSProperties['userSelect'],
                              }}
                              onContextMenu={e => e.preventDefault()}
                            />
                          ) : (
                            <Signature size={18} className={selectedSignatureId === sig.id ? 'text-primary' : 'text-on-surface-variant/60'} />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-sm text-on-surface truncate">{sig.full_name}</p>
                          <p className="text-xs text-on-surface-variant/70 truncate">{sig.title}</p>
                        </div>
                        {sig.is_primary && (
                          <span className="text-[10px] font-bold text-primary bg-primary/10 px-2 py-0.5 rounded-full shrink-0">
                            Principal
                          </span>
                        )}
                        {selectedSignatureId === sig.id && (
                          <div className="w-5 h-5 rounded-full bg-primary flex items-center justify-center shrink-0">
                            <CheckCircle size={12} className="text-white" />
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {!isReadOnly && signatures.length === 0 && (userRole === 'SIGNER' || userRole === 'ADMIN') && (
                <div className="bg-warning-500/10 border border-warning-500/20 rounded-xl p-4 flex items-center gap-3">
                  <Signature size={18} className="text-warning-500 shrink-0" />
                  <div>
                    <p className="text-sm font-semibold text-warning-700">No hay firmas autorizadas</p>
                    <p className="text-xs text-warning-600/70">
                      Configura las firmas en la sección de Firmantes Autorizados antes de aprobar.
                    </p>
                  </div>
                </div>
              )}

              {/* Signature badge for signed documents */}
              {request?.status === 'SIGNED' && (
                <div className="flex items-center justify-center">
                  <div className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-700 text-sm font-semibold shadow-sm">
                    <CheckCircle size={18} className="text-emerald-600" />
                    <span>Documento con Firma Electrónica</span>
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  </div>
                </div>
              )}

              {/* Actions — read-only mode for already approved/signed certificates */}
              {isReadOnly ? (
                <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
                  <div className="flex items-center gap-2 px-4 py-2 bg-primary/5 rounded-xl text-primary text-sm font-semibold">
                    <CheckCircle size={16} />
                    Documento emitido — solo lectura
                  </div>
                  <div className="flex items-center gap-2">
                    {request?.certificate_url && (
                      <button onClick={handleDownloadNormal} className="btn-secondary px-4 py-3" title="Descargar PDF">
                        <Download size={18} /> Descargar PDF
                      </button>
                    )}
                    <button onClick={handleDownloadSigned} className="btn-primary px-6 py-3" title="Descargar PDF con Firma Electrónica">
                      <Signature size={18} /> PDF Firmado
                    </button>
                    <button onClick={() => window.print()} className="btn-secondary px-4 py-3" title="Imprimir">
                      <Printer size={18} /> Imprimir
                    </button>
                    <button onClick={onClose} className="btn-secondary px-6 py-3">Cerrar</button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between gap-3 pt-2">
                    <button onClick={() => setShowReject(!showReject)} className="btn-danger px-6 py-3" disabled={approving}>
                      <XCircle size={18} /> Rechazar
                    </button>
                    <div className="flex items-center gap-3">
                      <button onClick={handleDownloadSigned} className="btn-secondary px-4 py-3" title="Descargar PDF">
                        <Download size={18} /> PDF
                      </button>
                      <button onClick={() => window.print()} className="btn-secondary px-4 py-3" title="Imprimir">
                        <Printer size={18} /> Imprimir
                      </button>
                      <button onClick={onClose} className="btn-secondary px-6 py-3">Cerrar</button>
                      <button
                        onClick={handleApprove}
                        disabled={approving || (!selectedSignatureId && signatures.length > 0)}
                        className="btn-primary px-8 py-3"
                      >
                        {approving ? (
                          <span className="flex items-center gap-2">
                            <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                            Procesando...
                          </span>
                        ) : (
                          <><CheckCircle size={18} /> Aprobar solicitud</>
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Reject reason */}
                  {showReject && (
                    <div className="bg-error-container/30 rounded-2xl p-4 border border-error/20 animate-scale-in">
                      <p className="text-sm font-bold text-error mb-2">Motivo de rechazo</p>
                      <textarea
                        className="input w-full mb-3"
                        rows={3}
                        value={rejectReason}
                        onChange={e => setRejectReason(e.target.value)}
                        placeholder="Indica el motivo del rechazo..."
                        autoFocus
                      />
                      <div className="flex gap-2 justify-end">
                        <button onClick={() => { setShowReject(false); setRejectReason(''); }} className="btn-secondary btn-sm">
                          Cancelar
                        </button>
                        <button onClick={handleReject} disabled={approving || !rejectReason.trim()} className="btn-danger btn-sm">
                          {approving ? 'Rechazando...' : 'Confirmar rechazo'}
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
