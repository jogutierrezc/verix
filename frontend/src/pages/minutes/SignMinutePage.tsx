import { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { Shield, CheckCircle, XCircle, Clock, Pen, Trash2, FileText, User, Mail, Loader2, Lock, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';

interface MinuteData {
  recipient: {
    id: string;
    full_name: string;
    email: string;
    status: string;
  };
  minute: {
    id: string;
    code: string;
    title: string;
    description: string;
    content: any;
    status: string;
    recipient_count: number;
    signed_count: number;
    require_all: boolean;
  };
  creator: {
    full_name: string;
  };
  signatures: Array<{
    recipient_name: string;
    signed_at: string;
    signature_image_url: string;
  }>;
}

const statusConfig: Record<string, { label: string; color: string; icon: any }> = {
  COMPLETED: { label: 'Acta Completada', color: 'text-emerald-600 bg-emerald-50 border-emerald-200', icon: CheckCircle },
  PENDING: { label: 'Pendiente de Firmas', color: 'text-blue-600 bg-blue-50 border-blue-200', icon: Clock },
  DRAFT: { label: 'Borrador', color: 'text-slate-500 bg-slate-50 border-slate-200', icon: FileText },
  CANCELLED: { label: 'Acta Cancelada', color: 'text-rose-600 bg-rose-50 border-rose-200', icon: XCircle },
};

export function SignMinutePage() {
  const { token } = useParams<{ token: string }>();

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<MinuteData | null>(null);
  const [signedSuccess, setSignedSuccess] = useState(false);

  // Signature drawing state
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasDrawing, setHasDrawing] = useState(false);

  useEffect(() => {
    if (token) loadMinute();
  }, [token]);

  const loadMinute = async () => {
    setLoading(true);
    setError(null);

    try {
      const { data: result, error: rpcError } = await supabase.rpc('get_minute_by_token', {
        p_token: token,
      });

      if (rpcError) {
        console.error('RPC error:', rpcError);
        setError('Error al cargar el acta. Intente nuevamente.');
        return;
      }

      if (result?.error) {
        setError(result.error);
        return;
      }

      if (result?.recipient?.status === 'SIGNED') {
        setSignedSuccess(true);
      }

      setData(result as MinuteData);
    } catch (err: any) {
      console.error('Error loading minute:', err);
      setError('Problema de conexión con los servicios de verificación.');
    } finally {
      setLoading(false);
    }
  };

  // ── Drawing handlers ──
  const startDrawing = (e: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    setIsDrawing(true);
    setHasDrawing(true);
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
    setHasDrawing(false);
  };

  const canvasToDataUrl = (): Promise<string | null> => {
    return new Promise((resolve) => {
      const canvas = canvasRef.current;
      if (!canvas) return resolve(null);
      canvas.toBlob((blob) => {
        if (!blob) return resolve(null);
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.readAsDataURL(blob);
      }, 'image/png');
    });
  };

  const handleSign = async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Verify there's actually a drawing
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const pixels = imageData.data;
    let hasActualDrawing = false;
    for (let i = 3; i < pixels.length; i += 4) {
      if (pixels[i] !== 0) { hasActualDrawing = true; break; }
    }
    if (!hasActualDrawing) {
      toast.error('Dibuja tu firma primero');
      return;
    }

    setSubmitting(true);
    try {
      const dataUrl = await canvasToDataUrl();
      if (!dataUrl) {
        toast.error('Error al generar la imagen de la firma');
        return;
      }

      const { data: result, error: rpcError } = await supabase.rpc('sign_minute', {
        p_token: token,
        p_signature_image_url: dataUrl,
        p_signature_type: 'drawn',
        p_ip_address: '',
        p_user_agent: navigator.userAgent,
        p_browser_info: {},
      });

      if (rpcError) {
        console.error('Sign RPC error:', rpcError);
        toast.error('Error al registrar la firma: ' + rpcError.message);
        return;
      }

      if (result?.error) {
        toast.error(result.error);
        return;
      }

      toast.success('✅ Firma registrada exitosamente');
      setSignedSuccess(true);
      // Reload to get updated status
      await loadMinute();
    } catch (err: any) {
      toast.error('Error al firmar: ' + (err.message || ''));
    } finally {
      setSubmitting(false);
    }
  };

  // ── Render helpers ──
  const status = data?.minute?.status
    ? statusConfig[data.minute.status] || { label: 'Desconocido', color: 'text-slate-500 bg-slate-50 border-slate-200', icon: FileText }
    : null;
  const StatusIcon = status?.icon || FileText;

  const isAlreadySigned = data?.recipient?.status === 'SIGNED';
  const isExpired = data?.recipient?.status === 'EXPIRED';
  const isDeclined = data?.recipient?.status === 'DECLINED';
  const canSign = !isAlreadySigned && !isExpired && !isDeclined && data?.minute?.status === 'PENDING';
  const isCompleted = data?.minute?.status === 'COMPLETED';

  return (
    <div className="min-h-screen bg-[#f8fafc] text-slate-800 selection:bg-emerald-500 selection:text-white antialiased">
      {/* Decorative grid background */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#e2e8f0_1px,transparent_1px),linear-gradient(to_bottom,#e2e8f0_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,#000_70%,transparent_100%)] pointer-events-none opacity-50" />
      <div className="absolute top-0 left-1/4 w-96 h-96 bg-emerald-100/40 rounded-full filter blur-3xl pointer-events-none" />
      <div className="absolute top-1/3 right-1/4 w-[30rem] h-[30rem] bg-sky-100/30 rounded-full filter blur-3xl pointer-events-none" />

      {/* Sticky Header */}
      <header className="sticky top-0 z-30 bg-white/70 backdrop-blur-md border-b border-slate-200/80 px-4 py-3">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src="/Logo%20Verix.png" alt="VERIX" className="h-10 w-auto" />
            <span className="text-xs font-semibold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-100 hidden sm:inline-block">FIRMA DIGITAL</span>
          </div>
          <div className="flex items-center gap-1 text-slate-500 text-xs font-semibold">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span>Plataforma Segura</span>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8 relative z-10">
        {/* Loading */}
        {loading && (
          <div className="min-h-[60vh] flex flex-col items-center justify-center p-8 bg-white/50 backdrop-blur rounded-3xl border border-slate-200 shadow-xl max-w-xl mx-auto">
            <div className="relative">
              <div className="w-16 h-16 border-4 border-slate-100 border-t-emerald-600 rounded-full animate-spin" />
              <Shield className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 text-emerald-600 w-5 h-5" />
            </div>
            <h3 className="text-lg font-bold text-slate-800 mt-6">Cargando documento</h3>
            <p className="text-sm text-slate-500 mt-2 text-center max-w-sm">
              Verificando el enlace de firma y obteniendo los datos del acta...
            </p>
          </div>
        )}

        {/* Error */}
        {error && !loading && (
          <div className="min-h-[50vh] flex flex-col items-center justify-center p-8 bg-white rounded-3xl border border-slate-200 shadow-xl max-w-xl mx-auto text-center">
            <div className="w-16 h-16 rounded-2xl bg-rose-50 flex items-center justify-center border border-rose-100 text-rose-500 mb-6 shadow-sm">
              <XCircle size={36} />
            </div>
            <h2 className="text-xl font-black text-slate-900 mb-2">Enlace no válido</h2>
            <p className="text-slate-600 mb-6 text-sm max-w-md">{error}</p>
            <button
              onClick={loadMinute}
              className="flex items-center justify-center gap-2 px-5 py-2.5 bg-slate-900 text-white rounded-xl text-sm font-bold hover:bg-slate-800 transition"
            >
              <RefreshCw size={16} /> Reintentar
            </button>
          </div>
        )}

        {/* Success screen after signing */}
        {signedSuccess && !loading && data && (
          <div className="max-w-2xl mx-auto space-y-6">
            <div className="bg-white rounded-3xl border border-emerald-200 shadow-xl shadow-emerald-100/20 overflow-hidden text-center p-10">
              <div className="w-20 h-20 rounded-full bg-emerald-50 flex items-center justify-center mx-auto mb-6 border-4 border-emerald-100">
                <CheckCircle size={48} className="text-emerald-600" />
              </div>
              <h2 className="text-2xl font-black text-slate-900 mb-2">¡Firma registrada exitosamente!</h2>
              <p className="text-slate-500 mb-6">
                Tu firma ha sido estampada en el acta <strong>{data.minute.code}</strong>.
              </p>
              {isCompleted && (
                <div className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-50 rounded-xl border border-emerald-200 text-emerald-700 text-sm font-semibold">
                  <CheckCircle size={18} />
                  Todas las firmas han sido recopiladas — el acta está completa
                </div>
              )}
            </div>
          </div>
        )}

        {/* Main content */}
        {data && !loading && !signedSuccess && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
            {/* LEFT: Minute details */}
            <div className="lg:col-span-5 space-y-6">
              {/* Status card */}
              <div className={`bg-white rounded-3xl border shadow-xl shadow-slate-100 overflow-hidden ${
                isCompleted || isAlreadySigned ? 'border-emerald-200/80' : 'border-slate-200'
              }`}>
                <div className={`h-2 w-full ${
                  isCompleted || isAlreadySigned
                    ? 'bg-gradient-to-r from-emerald-500 to-teal-400'
                    : isExpired ? 'bg-rose-400' : 'bg-blue-400'
                }`} />
                <div className="p-6">
                  <div className="flex items-start gap-4">
                    <div className={`p-3 rounded-2xl shrink-0 ${status?.color || 'text-slate-500 bg-slate-50 border-slate-200'}`}>
                      {StatusIcon && <StatusIcon size={28} />}
                    </div>
                    <div>
                      <span className="text-[10px] tracking-wider uppercase font-extrabold text-slate-400">Estado del Acta</span>
                      <h2 className="text-2xl font-black text-slate-900 tracking-tight leading-tight mt-0.5">{status?.label || 'Desconocido'}</h2>
                      <p className="text-xs text-slate-500 mt-1">Código: <span className="font-mono font-bold">{data.minute.code}</span></p>
                    </div>
                  </div>
                  <div className="mt-5 pt-4 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-400 font-medium">
                    <span className="flex items-center gap-1">
                      <Lock size={12} className="text-emerald-600" /> Plataforma Segura
                    </span>
                    <span>
                      Firmantes: {data.minute.signed_count}/{data.minute.recipient_count}
                    </span>
                  </div>
                </div>
              </div>

              {/* Minute info */}
              <div className="bg-white rounded-3xl border border-slate-200 shadow-xl shadow-slate-100 overflow-hidden">
                <div className="p-6 border-b border-slate-100 bg-slate-50/50">
                  <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                    <FileText size={14} className="text-slate-500" /> Acta
                  </h3>
                </div>
                <div className="p-6 space-y-4">
                  <div>
                    <span className="text-[10px] uppercase tracking-wider text-slate-400 font-bold block">Título</span>
                    <p className="font-bold text-slate-900 mt-1">{data.minute.title}</p>
                  </div>
                  {data.minute.description && (
                    <div>
                      <span className="text-[10px] uppercase tracking-wider text-slate-400 font-bold block">Descripción</span>
                      <p className="text-sm text-slate-600 mt-1">{data.minute.description}</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Creator */}
              <div className="bg-white rounded-3xl border border-slate-200 shadow-xl shadow-slate-100 overflow-hidden">
                <div className="p-6 border-b border-slate-100 bg-slate-50/50">
                  <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                    <User size={14} className="text-slate-500" /> Creado por
                  </h3>
                </div>
                <div className="p-6">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-500 flex items-center justify-center text-white font-bold text-sm">
                      {data.creator.full_name.charAt(0).toUpperCase()}
                    </div>
                    <p className="font-semibold text-slate-800">{data.creator.full_name}</p>
                  </div>
                </div>
              </div>

              {/* Your info */}
              <div className="bg-white rounded-3xl border border-slate-200 shadow-xl shadow-slate-100 overflow-hidden">
                <div className="p-6 border-b border-slate-100 bg-slate-50/50">
                  <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                    <User size={14} className="text-slate-500" /> Tu información
                  </h3>
                </div>
                <div className="p-6 space-y-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center shrink-0">
                      <User size={18} className="text-slate-500" />
                    </div>
                    <div>
                      <p className="text-xs text-slate-400">Nombre</p>
                      <p className="font-semibold text-slate-800">{data.recipient.full_name}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center shrink-0">
                      <Mail size={18} className="text-slate-500" />
                    </div>
                    <div>
                      <p className="text-xs text-slate-400">Email</p>
                      <p className="font-semibold text-slate-800">{data.recipient.email}</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* RIGHT: Content + Signature */}
            <div className="lg:col-span-7 space-y-6">
              {/* Content */}
              <div className="bg-white rounded-3xl border border-slate-200 shadow-xl shadow-slate-100 overflow-hidden">
                <div className="p-6 border-b border-slate-100 bg-slate-50/50">
                  <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest">Contenido del Acta</h3>
                </div>
                <div className="p-6">
                  {data.minute.content && typeof data.minute.content === 'object' ? (
                    <div className="prose prose-sm max-w-none">
                      {Object.entries(data.minute.content).map(([key, value]) => (
                        <div key={key} className="mb-3 pb-3 border-b border-slate-50 last:border-b-0">
                          <span className="text-[10px] uppercase tracking-wider text-slate-400 font-bold block">
                            {key.replace(/_/g, ' ')}
                          </span>
                          <p className="text-sm text-slate-700 mt-0.5">{String(value)}</p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-slate-500 italic">Sin contenido adicional</p>
                  )}
                </div>
              </div>

              {/* Existing signatures */}
              {data.signatures && data.signatures.length > 0 && (
                <div className="bg-white rounded-3xl border border-slate-200 shadow-xl shadow-slate-100 overflow-hidden">
                  <div className="p-6 border-b border-slate-100 bg-slate-50/50">
                    <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                      <Pen size={14} className="text-slate-500" /> Firmas registradas ({data.signatures.length}/{data.minute.recipient_count})
                    </h3>
                  </div>
                  <div className="p-6 space-y-4">
                    {data.signatures.map((sig, i) => (
                      <div key={i} className="flex items-start gap-4 bg-slate-50 rounded-2xl p-4 border border-slate-100">
                        <div className="w-10 h-10 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center justify-center shrink-0">
                          <Pen size={16} className="text-emerald-600" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-bold text-slate-900">{sig.recipient_name}</p>
                          <p className="text-xs text-slate-500">
                            Firmado el {new Date(sig.signed_at).toLocaleDateString('es-CO', {
                              day: 'numeric', month: 'long', year: 'numeric',
                              hour: '2-digit', minute: '2-digit'
                            })}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Signature pad section */}
              {isAlreadySigned ? (
                <div className="bg-emerald-50 rounded-3xl border border-emerald-200 p-8 text-center">
                  <CheckCircle size={48} className="text-emerald-600 mx-auto mb-4" />
                  <h3 className="text-lg font-bold text-emerald-800 mb-1">Ya has firmado este documento</h3>
                  <p className="text-sm text-emerald-600">Tu firma ya fue registrada exitosamente.</p>
                </div>
              ) : isExpired ? (
                <div className="bg-rose-50 rounded-3xl border border-rose-200 p-8 text-center">
                  <XCircle size={48} className="text-rose-500 mx-auto mb-4" />
                  <h3 className="text-lg font-bold text-rose-800 mb-1">Enlace expirado</h3>
                  <p className="text-sm text-rose-600">El período para firmar este documento ha expirado.</p>
                </div>
              ) : isDeclined ? (
                <div className="bg-amber-50 rounded-3xl border border-amber-200 p-8 text-center">
                  <XCircle size={48} className="text-amber-500 mx-auto mb-4" />
                  <h3 className="text-lg font-bold text-amber-800 mb-1">Has declinado firmar</h3>
                  <p className="text-sm text-amber-600">Este documento no requiere tu firma.</p>
                </div>
              ) : canSign ? (
                <div className="bg-white rounded-3xl border border-slate-200 shadow-xl shadow-slate-100 overflow-hidden">
                  <div className="p-6 border-b border-slate-100 bg-slate-50/50">
                    <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                      <Pen size={14} className="text-emerald-600" /> Firma el documento
                    </h3>
                  </div>
                  <div className="p-6 space-y-4">
                    <p className="text-sm text-slate-600">
                      Dibuja tu firma en el recuadro de abajo usando el mouse o tu dedo (en dispositivos táctiles).
                    </p>

                    {/* Canvas */}
                    <div
                      className="bg-white rounded-2xl border-2 border-dashed border-slate-300 p-4 signature-pad"
                      style={{
                        backgroundImage: 'linear-gradient(rgba(109,123,124,0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(109,123,124,0.08) 1px, transparent 1px)',
                        backgroundSize: '20px 20px',
                      }}
                    >
                      <canvas
                        ref={canvasRef}
                        width={600}
                        height={200}
                        className="w-full touch-none rounded-lg"
                        style={{ cursor: 'crosshair', minHeight: '140px' }}
                        onMouseDown={startDrawing}
                        onMouseMove={draw}
                        onMouseUp={stopDrawing}
                        onMouseLeave={stopDrawing}
                        onTouchStart={startDrawing}
                        onTouchMove={draw}
                        onTouchEnd={stopDrawing}
                      />
                    </div>
                    <p className="text-xs text-slate-400">
                      Al firmar, aceptas los términos y condiciones del documento.
                    </p>

                    {/* Actions */}
                    <div className="flex flex-col sm:flex-row gap-3">
                      <button
                        onClick={clearCanvas}
                        disabled={submitting}
                        className="flex items-center justify-center gap-2 px-5 py-3 border border-slate-200 rounded-xl text-slate-600 font-medium hover:bg-slate-50 transition text-sm"
                      >
                        <Trash2 size={16} /> Limpiar
                      </button>
                      <button
                        onClick={handleSign}
                        disabled={submitting || !hasDrawing}
                        className="flex-1 flex items-center justify-center gap-2 px-6 py-3 bg-gradient-to-r from-emerald-600 to-teal-500 hover:from-emerald-700 hover:to-teal-600 text-white font-bold rounded-xl transition-all shadow-lg shadow-emerald-950/20 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                      >
                        {submitting ? (
                          <>
                            <Loader2 size={18} className="animate-spin" />
                            Registrando firma...
                          </>
                        ) : (
                          <>
                            <Pen size={18} />
                            Firmar documento
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-200 bg-white py-8 mt-12 relative z-10 text-center">
        <div className="max-w-5xl mx-auto px-4 space-y-3">
          <p className="text-xs font-semibold text-slate-400">
            Plataforma de firma digital protegida mediante cifrado SSL de extremo a extremo.
          </p>
          <p className="text-[11px] text-slate-400">
            Powered by <span className="font-black tracking-tight text-slate-700">VERIX</span> · © {new Date().getFullYear()} Todos los derechos reservados.
          </p>
        </div>
      </footer>
    </div>
  );
}
