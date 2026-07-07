import { useState, useEffect, useRef } from 'react';
import { supabase } from '../../lib/supabase';
import { X, CheckCircle, XCircle, Download, FileText, Loader2, Signature, Printer } from 'lucide-react';
import { QRCodeCanvas } from 'qrcode.react';
import toast from 'react-hot-toast';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';
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
function convertDatesInData(data: Record<string, any>): Record<string, any> {
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
function fillTemplate(content: string, data: Record<string, any>): string {
  return content.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const value = data[key];
    if (value === null || value === undefined) return `{{${key}}}`;
    return String(value);
  });
}

// Safe JSON parse helper
const safeJsonParse = (str: string) => { try { return JSON.parse(str); } catch { return {}; } };

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
        const { data: sigs } = await supabase
          .from('authorized_signatures')
          .select('id, full_name, title, signature_image_url, document_id, is_primary')
          .eq('institution_id', userInstitutionId)
          .eq('is_active', true)
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
        await generateRadicado(req.template_id, req.user?.institution_id || userInstitutionId);
      }
    } catch (err: any) {
      console.error('Error loading preview:', err);
      setError(err.message || 'Error al cargar la vista previa');
    } finally {
      setLoading(false);
    }
  };

  const generateRadicado = async (templateId: string, institutionId: string) => {
    setRadicadoLoading(true);
    try {
      const { data, error } = await supabase.rpc('get_next_radicado_for_template', {
        p_template_id: templateId,
        p_institution_id: institutionId,
        p_dependency_id: null,
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

  const handleDownloadPdf = async () => {
    if (!certificateRef.current) return;

    try {
      toast.loading('Generando PDF...', { id: 'pdf-gen' });

      const canvas = await html2canvas(certificateRef.current, {
        scale: 4, // Ultra-high resolution for print
        useCORS: true,
        backgroundColor: '#ffffff',
        logging: false,
      });

      const imgData = canvas.toDataURL('image/png');
      const orientation = pageOrientation === 'landscape' ? 'l' : 'p';
      const pdf = new jsPDF(orientation, 'px', [pageWidth, pageHeight]);

      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = pdf.internal.pageSize.getHeight();

      pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight);
      pdf.save(`certificado-${requestCode || requestId.substring(0, 8)}.pdf`);

      toast.success('✅ PDF descargado', { id: 'pdf-gen' });
    } catch (err: any) {
      toast.error('Error al generar PDF: ' + (err.message || 'Error desconocido'), { id: 'pdf-gen' });
      console.error('PDF generation error:', err);
    }
  };

  /** Genera el PDF del certificado y devuelve la imagen como base64 */
  const generatePdfBase64 = async (): Promise<string | null> => {
    if (!certificateRef.current) return null;
    try {
      const canvas = await html2canvas(certificateRef.current, {
        scale: 3, // High resolution for digital signing (PNG + scale 3 to fit Edge Function payload limit)
        useCORS: true,
        backgroundColor: '#ffffff',
        logging: false,
      });
      const imgData = canvas.toDataURL('image/png');
      const orientation = pageOrientation === 'landscape' ? 'l' : 'p';
      const pdf = new jsPDF(orientation, 'px', [pageWidth, pageHeight]);
      pdf.addImage(imgData, 'PNG', 0, 0, pdf.internal.pageSize.getWidth(), pdf.internal.pageSize.getHeight());
      const pdfBytes = new Uint8Array(pdf.output('arraybuffer'));
      let binary = '';
      for (let i = 0; i < pdfBytes.length; i++) binary += String.fromCharCode(pdfBytes[i]);
      return btoa(binary);
    } catch (err) {
      console.error('Error generating PDF:', err);
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

      // 2. Generate PDF as base64
      const pdfBase64 = await generatePdfBase64();
      if (!pdfBase64) return false;

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

      // 4. Call sign-pdf Edge Function
      const { error: fnError, data: result } = await supabase.functions.invoke('sign-pdf', {
        body: {
          request_id: requestId,
          user_id: userId,
          pdf_base64: pdfBase64,
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

      if (selectedSignatureId) {
        const selectedSig = signatures.find(s => s.id === selectedSignatureId);
        if (selectedSig) {
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
  const pageWidth = pageOrientation === 'landscape' ? 842 : 595;
  const pageHeight = pageOrientation === 'landscape' ? 595 : 842;
  const scale = 0.55;

  // Build the data dictionary with all available variables for template substitution
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
        const qrSize = Math.min(el.width * scale * 0.75, el.height * scale * 0.75);
        return (
          <div className="w-full h-full flex items-center justify-center bg-white rounded relative">
            <div className="flex items-center justify-center" style={{ width: qrSize, height: qrSize }}>
              <QRCodeCanvas
                value={qrValue}
                size={qrSize}
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

              {/* Actions — read-only mode for already approved/signed certificates */}
              {isReadOnly ? (
                <div className="flex items-center justify-center gap-3 pt-2">
                  <div className="flex items-center gap-2 px-4 py-2 bg-primary/5 rounded-xl text-primary text-sm font-semibold">
                    <CheckCircle size={16} />
                    Documento emitido — solo lectura
                  </div>
                  <button onClick={handleDownloadPdf} className="btn-primary px-6 py-3" title="Descargar PDF">
                    <Download size={18} /> Descargar PDF
                  </button>
                  <button onClick={() => window.print()} className="btn-secondary px-4 py-3" title="Imprimir">
                    <Printer size={18} /> Imprimir
                  </button>
                  <button onClick={onClose} className="btn-secondary px-6 py-3">Cerrar</button>
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between gap-3 pt-2">
                    <button onClick={() => setShowReject(!showReject)} className="btn-danger px-6 py-3" disabled={approving}>
                      <XCircle size={18} /> Rechazar
                    </button>
                    <div className="flex items-center gap-3">
                      <button onClick={handleDownloadPdf} className="btn-secondary px-4 py-3" title="Descargar PDF">
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
