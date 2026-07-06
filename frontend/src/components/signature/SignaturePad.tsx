import { useState, useRef, useEffect } from 'react';
import { supabase, STORAGE } from '../../lib/supabase';
import { authorizedSignaturesApi } from '../../services/api';
import { Upload, Pen, Trash2, CloudUpload } from 'lucide-react';
import toast from 'react-hot-toast';

interface SignaturePadProps {
  userId: string;
  currentSignatureUrl?: string | null;
  onSave: (url: string) => void;
  /**
   * If 'authorized', saves to authorized_signatures table instead of users.signature_url.
   * Requires institutionId to be set.
   */
  signatureMode?: 'personal' | 'authorized';
  /** The authorized signature record ID (required in 'authorized' mode for updates) */
  authorizedSignatureId?: string;
  /** Institution ID for authorized signatures */
  institutionId?: string;
  /** Callback when authorized signature is saved (returns the full record) */
  onAuthorizedSave?: (record: any) => void;
  /** Title/position for authorized signature */
  title?: string;
  /** Full name for authorized signature */
  fullName?: string;
  /** Document ID for authorized signature */
  documentId?: string;
}

export function SignaturePad({ 
  userId, 
  currentSignatureUrl, 
  onSave,
  signatureMode = 'personal',
  authorizedSignatureId,
  institutionId,
  onAuthorizedSave,
  title,
  fullName,
  documentId,
}: SignaturePadProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [viewMode, setViewMode] = useState<'upload' | 'draw' | 'preview'>('preview');
  const [signatureUrl, setSignatureUrl] = useState(currentSignatureUrl || '');
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    setSignatureUrl(currentSignatureUrl || '');
  }, [currentSignatureUrl]);

  const startDrawing = (e: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    setIsDrawing(true);
    const pos = getPosition(e, canvas);
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
  };

  const draw = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawing) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const pos = getPosition(e, canvas);
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#006e2f';
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
  };

  const stopDrawing = () => {
    setIsDrawing(false);
  };

  const getPosition = (e: React.MouseEvent | React.TouchEvent, canvas: HTMLCanvasElement) => {
    const rect = canvas.getBoundingClientRect();
    if ('touches' in e) {
      return { x: (e.touches[0].clientX - rect.left) * (canvas.width / rect.width), y: (e.touches[0].clientY - rect.top) * (canvas.height / rect.height) };
    }
    return { x: (e.clientX - rect.left) * (canvas.width / rect.width), y: (e.clientY - rect.top) * (canvas.height / rect.height) };
  };

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  };

  const uploadAndSave = async (blobOrFile: Blob | File, fileName: string) => {
    if (signatureMode === 'personal') {
      // Save to users.signature_url (existing behavior)
      const path = `${STORAGE.PATHS.SIGNATURES(userId)}/${Date.now()}.png`;
      const file = blobOrFile instanceof File ? blobOrFile : new File([blobOrFile], fileName, { type: 'image/png' });

      const { error: uploadError } = await supabase.storage.from(STORAGE.BUCKET).upload(path, file);
      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage.from(STORAGE.BUCKET).getPublicUrl(path);

      const { error: updateError } = await supabase.from('users').update({ signature_url: publicUrl }).eq('id', userId);
      if (updateError) throw updateError;

      setSignatureUrl(publicUrl);
      onSave(publicUrl);
    } else if (signatureMode === 'authorized') {
      // Save to authorized_signatures table
      if (!institutionId) {
        throw new Error('institutionId es requerido para firmas autorizadas');
      }

      // 1. Create or get the authorized signature record
      let sigId = authorizedSignatureId;
      if (!sigId) {
        const newSig = await authorizedSignaturesApi.create({
          user_id: userId,
          institution_id: institutionId,
          title: title || 'Firmante Autorizado',
          full_name: fullName || '',
          document_id: documentId,
          is_primary: false,
        });
        sigId = newSig.id;
      }

      if (!sigId) {
        throw new Error('No se pudo crear la firma autorizada');
      }

      // 2. Upload the signature image
      const ext = blobOrFile instanceof File ? (blobOrFile.name.split('.').pop() || 'png') : 'png';
      const storagePath = `${STORAGE.PATHS.AUTHORIZED_SIGNATURES(sigId)}/${Date.now()}.${ext}`;
      const file = blobOrFile instanceof File ? blobOrFile : new File([blobOrFile], `signature.${ext}`, { type: `image/${ext}` });

      const { error: uploadError } = await supabase.storage.from(STORAGE.BUCKET).upload(storagePath, file);
      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage.from(STORAGE.BUCKET).getPublicUrl(storagePath);

      // 3. Update the record
      const updated = await authorizedSignaturesApi.update(sigId, {
        signature_image_url: publicUrl,
      });

      setSignatureUrl(publicUrl);
      onSave(publicUrl);
      if (onAuthorizedSave) onAuthorizedSave(updated);
    }
  };

  const saveDrawing = async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const pixels = imageData.data;
    let hasDrawing = false;
    for (let i = 3; i < pixels.length; i += 4) {
      if (pixels[i] !== 0) { hasDrawing = true; break; }
    }
    if (!hasDrawing) { toast.error('Dibuja tu firma primero'); return; }

    setUploading(true);
    canvas.toBlob(async (blob) => {
      if (!blob) {
        toast.error('Error al generar la imagen de la firma');
        setUploading(false);
        return;
      }
      try {
        await uploadAndSave(blob, `signature-${userId}.png`);
        toast.success(signatureMode === 'personal' ? 'Firma guardada' : 'Firma autorizada guardada');
        setViewMode('preview');
      } catch (err: any) {
        toast.error(err.message);
      } finally {
        setUploading(false);
      }
    }, 'image/png');
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { toast.error('Solo imágenes'); return; }

    setUploading(true);
    try {
      await uploadAndSave(file, file.name);
      toast.success(signatureMode === 'personal' ? 'Firma subida' : 'Firma autorizada subida');
      setViewMode('preview');
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-4">
      {viewMode === 'preview' && signatureUrl ? (
        <div className="glass-card p-4 rounded-xl border border-white/40">
          <div className="bg-white/40 rounded-lg border border-dashed border-outline-variant flex items-center justify-center h-32 relative overflow-hidden group">
            <img src={signatureUrl} alt="Firma" className="max-h-24 object-contain opacity-80 group-hover:scale-105 transition-transform duration-500" />
            <div className="absolute inset-0 bg-primary/5 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
              <Pen size={20} className="text-primary" />
            </div>
          </div>
          <div className="flex items-center justify-between mt-3">
            <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium">Verificada</span>
            <div className="flex gap-2">
              <button onClick={() => setViewMode('draw')} className="text-primary font-semibold text-label-sm hover:bg-primary/5 py-1 px-3 rounded-lg transition-colors">Actualizar</button>
              <button onClick={() => setViewMode('upload')} className="text-primary font-semibold text-label-sm hover:bg-primary/5 py-1 px-3 rounded-lg transition-colors">Subir</button>
            </div>
          </div>
        </div>
      ) : viewMode === 'draw' ? (
        <div className="glass-card p-4 rounded-xl border border-white/40">
          <h4 className="font-semibold text-on-surface mb-3">Firma Manuscrita</h4>
          <div className="bg-white/40 rounded-lg border-2 border-dashed border-outline-variant p-4 signature-pad"
            style={{
              backgroundImage: 'linear-gradient(rgba(109,123,124,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(109,123,124,0.1) 1px, transparent 1px)',
              backgroundSize: '20px 20px',
            }}>
            <canvas
              ref={canvasRef}
              width={500}
              height={200}
              className="w-full touch-none"
              style={{ cursor: 'crosshair' }}
              onMouseDown={startDrawing}
              onMouseMove={draw}
              onMouseUp={stopDrawing}
              onMouseLeave={stopDrawing}
              onTouchStart={startDrawing}
              onTouchMove={draw}
              onTouchEnd={stopDrawing}
            />
          </div>
          <p className="text-xs text-on-surface-variant mt-2">Dibuja tu firma con el mouse o dedo</p>
          <div className="flex gap-2 mt-4">
            <button onClick={clearCanvas} disabled={uploading} className="btn-ghost btn-sm"><Trash2 size={14} /> Limpiar</button>
            <button onClick={saveDrawing} disabled={uploading} className="btn-primary btn-sm">
              {uploading ? 'Guardando...' : <><Pen size={14} /> Guardar firma</>}
            </button>
            <button onClick={() => setViewMode(signatureUrl ? 'preview' : 'upload')} className="btn-secondary btn-sm">Cancelar</button>
          </div>
        </div>
      ) : (
        <div className="glass-card p-4 rounded-xl border border-white/40">
          <h4 className="font-semibold text-on-surface mb-3">Subir Firma</h4>
          <label className="flex flex-col items-center justify-center border-2 border-dashed border-outline-variant rounded-xl p-8 cursor-pointer hover:border-primary/50 transition-all group bg-white/30">
            <CloudUpload size={40} className="text-outline-variant group-hover:text-primary transition-colors mb-3" />
            <p className="text-body-md font-medium text-on-surface">Subir imagen de firma</p>
            <p className="text-xs text-on-surface-variant mt-1">PNG o SVG con fondo transparente</p>
            <input type="file" accept="image/*" onChange={handleFileUpload} className="hidden" disabled={uploading} />
          </label>
          <div className="flex items-center gap-3 mt-4">
            <div className="h-px bg-outline-variant flex-1" />
            <span className="text-xs font-bold text-on-surface-variant uppercase">o</span>
            <div className="h-px bg-outline-variant flex-1" />
          </div>
          <button onClick={() => setViewMode('draw')} className="w-full mt-4 py-2.5 rounded-lg border border-primary text-primary font-semibold hover:bg-primary/5 transition-colors flex items-center justify-center gap-2">
            <Pen size={18} /> Dibujar firma
          </button>
        </div>
      )}
    </div>
  );
}
