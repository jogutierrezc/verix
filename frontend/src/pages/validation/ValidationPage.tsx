import { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { QRCodeCanvas } from 'qrcode.react';
import { CheckCircle, XCircle, AlertTriangle, FileText, Shield, Clock, User, Download, Loader2 } from 'lucide-react';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';
import toast from 'react-hot-toast';

// ── Helpers (reused from CertificatePreview) ──
const MONTHS = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

function formatDateToSpanish(dateStr: string): string {
  let match = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (match) {
    const day = parseInt(match[1], 10);
    const month = parseInt(match[2], 10);
    const year = match[3];
    if (month >= 1 && month <= 12) {
      return `${day} de ${MONTHS[month - 1]} de ${year}`;
    }
  }
  match = dateStr.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (match) {
    const year = match[1];
    const month = parseInt(match[2], 10);
    const day = parseInt(match[3], 10);
    if (month >= 1 && month <= 12) {
      return `${day} de ${MONTHS[month - 1]} de ${year}`;
    }
  }
  return dateStr;
}

function convertDatesInData(data: Record<string, any>): Record<string, any> {
  const result: Record<string, any> = {};
  for (const [key, value] of Object.entries(data)) {
    if (typeof value === 'string') {
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

function fillTemplate(content: string, data: Record<string, any>): string {
  return content.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const value = data[key];
    if (value === null || value === undefined) return `{{${key}}}`;
    return String(value);
  });
}

const safeJsonParse = (str: string) => { try { return JSON.parse(str); } catch { return {}; } };

const statusConfig: Record<string, { label: string; color: string; icon: any }> = {
  APPROVED: { label: 'Documento Válido', color: 'text-green-600', icon: CheckCircle },
  SIGNED: { label: 'Documento Firmado', color: 'text-green-600', icon: CheckCircle },
  REJECTED: { label: 'Documento Rechazado', color: 'text-red-600', icon: XCircle },
  REVOKED: { label: 'Documento Revocado', color: 'text-red-600', icon: AlertTriangle },
  PENDING: { label: 'Pendiente de Aprobación', color: 'text-yellow-600', icon: Clock },
  DRAFT: { label: 'Borrador', color: 'text-gray-500', icon: FileText },
};

export function ValidationPage() {
  const { code } = useParams<{ code: string }>();
  const [request, setRequest] = useState<any>(null);
  const [template, setTemplate] = useState<any>(null);
  const [templateConfig, setTemplateConfig] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pdfLoading, setPdfLoading] = useState(false);
  const certificateRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!code) return;
    loadCertificate();
  }, [code]);

  const loadCertificate = async () => {
    setLoading(true);
    setError(null);
    try {
      let data: any = null;

      // ── Strategy 1: Try RPC functions (SECURITY DEFINER, bypasses RLS) ──
      const rpcFunctions = [
        { name: 'get_certificate_for_validation', params: { p_code: code } },
        { name: 'get_certificate_for_validation_by_radicado', params: { p_radicado: code } },
        { name: 'get_certificate_for_validation_by_code', params: { p_code: code } },
      ];

      for (const fn of rpcFunctions) {
        try {
          const { data: rpcData, error: rpcError } = await supabase.rpc(fn.name, fn.params);
          if (rpcData && !rpcError) {
            data = rpcData;
            break;
          }
        } catch {
          // Function not found — continue
        }
      }

      // ── Strategy 2: Direct query (works if user is authenticated) ──
      if (!data) {
        try {
          const { data: directData } = await supabase
            .from('certificate_requests')
            .select('*, user:users!certificate_requests_user_id_fkey(first_name, last_name, document_id)')
            .or(`code.eq.${code},consecutive_number.eq.${code},verification_code.eq.${code}`)
            .maybeSingle();

          if (directData) {
            data = {
              ...directData,
              user: directData.user || { first_name: '', last_name: '' },
            };
          }
        } catch {
          // Direct query failed — continue
        }
      }

      if (!data) {
        setError('Certificado no encontrado');
        return;
      }

      setRequest({
        ...data,
        user: data.user || { first_name: '', last_name: '' },
        data: typeof data.data === 'object' ? data.data : {},
      });

      // Load full template config (for certificate rendering)
      if (data.template_id) {
        const { data: tmpl } = await supabase
          .from('templates')
          .select('*')
          .eq('id', data.template_id)
          .single();
        setTemplate(tmpl);
        if (tmpl?.config) {
          const cfg = typeof tmpl.config === 'string' ? safeJsonParse(tmpl.config) : tmpl.config;
          setTemplateConfig(cfg);
        }
      }
    } catch (err: any) {
      console.error('Error loading certificate:', err);
      setError('Error al cargar la información del certificado');
    } finally {
      setLoading(false);
    }
  };

  const validationUrl = window.location.href;
  const status = statusConfig[request?.status] || { label: 'Desconocido', color: 'text-gray-500', icon: FileText };
  const StatusIcon = status.icon;

  // Parse reviewer notes if available
  let reviewerInfo: any = null;
  if (request?.reviewer_notes) {
    try {
      reviewerInfo = JSON.parse(request.reviewer_notes);
    } catch { /* ignore */ }
  }

  // ── Certificate rendering ──
  const rawConfig = templateConfig || {};
  const elements: any[] = rawConfig?.elements || [];
  const pageOrientation = rawConfig?.orientation || 'landscape';
  const pageWidth = pageOrientation === 'landscape' ? 842 : 595;
  const pageHeight = pageOrientation === 'landscape' ? 595 : 842;
  const certScale = 0.45;

  const rawRequestData = request?.data || {};
  const requestCode = request?.code || '';
  const verificationCode = request?.verification_code || requestCode;

  const requestData = {
    ...convertDatesInData(rawRequestData),
    codigo: verificationCode,
    codigo_certificado: verificationCode,
    codigo_solicitud: requestCode,
    id_solicitud: requestCode,
    codigo_verificacion: verificationCode,
    qr_content: validationUrl,
    ...(request?.consecutive_number ? {
      radicado: request.consecutive_number,
      consecutivo: request.consecutive_number,
    } : {}),
  };

  const handleDownloadPdf = async () => {
    if (!certificateRef.current) return;
    setPdfLoading(true);
    try {
      toast.loading('Generando PDF...', { id: 'validate-pdf' });
      const canvas = await html2canvas(certificateRef.current, {
        scale: 3,
        useCORS: true,
        backgroundColor: '#ffffff',
        logging: false,
      });
      const imgData = canvas.toDataURL('image/jpeg', 0.98);
      const orientation = pageOrientation === 'landscape' ? 'l' : 'p';
      const pdf = new jsPDF(orientation, 'px', [pageWidth, pageHeight]);
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = pdf.internal.pageSize.getHeight();
      pdf.addImage(imgData, 'JPEG', 0, 0, pdfWidth, pdfHeight);
      pdf.save(`certificado-${requestCode || verificationCode}.pdf`);
      toast.success('✅ PDF descargado', { id: 'validate-pdf' });
    } catch (err: any) {
      toast.error('Error al generar PDF: ' + (err.message || ''), { id: 'validate-pdf' });
    } finally {
      setPdfLoading(false);
    }
  };

  const renderElement = (el: any, index: number) => {
    const filledContent = fillTemplate(el.content, requestData);

    const renderContent = () => {
      if (el.type === 'image' && el.imageUrl) {
        return <img src={el.imageUrl} alt="" className="w-full h-full object-contain" />;
      }
      if (el.type === 'qr') {
        const qrSize = Math.min(el.width * certScale * 0.75, el.height * certScale * 0.75);
        return (
          <div className="w-full h-full flex items-center justify-center bg-white rounded relative">
            <div className="flex items-center justify-center" style={{ width: qrSize, height: qrSize }}>
              <QRCodeCanvas
                value={validationUrl}
                size={qrSize}
                bgColor="#ffffff"
                fgColor="#006e2f"
                level="M"
                style={{ width: '100%', height: '100%' }}
              />
            </div>
          </div>
        );
      }
      if (el.type === 'line') return <div className="w-full border-t border-gray-300" />;
      if (el.type === 'shape') return <div className="w-full h-full border border-gray-300 rounded" />;
      if (el.type === 'signature') {
        return (
          <div className="w-full h-full flex items-center justify-center">
            {reviewerInfo?.signature_url ? (
              <div
                className="w-full h-full bg-no-repeat bg-contain bg-center"
                style={{
                  backgroundImage: `url("${reviewerInfo.signature_url}")`,
                  pointerEvents: 'none' as React.CSSProperties['pointerEvents'],
                  userSelect: 'none' as React.CSSProperties['userSelect'],
                }}
              />
            ) : (
              <span className="text-gray-400 italic text-[10px]">
                {reviewerInfo?.signature_name || filledContent || '[Firma]'}
              </span>
            )}
          </div>
        );
      }
      return (
        <span className="w-full" style={{ whiteSpace: 'pre-wrap' }}>
          {filledContent}
        </span>
      );
    };

    return (
      <div
        key={el.id || index}
        className="absolute"
        style={{
          left: el.x * certScale,
          top: el.y * certScale,
          width: el.width * certScale,
          height: el.height * certScale,
        }}
      >
        <div
          className="w-full h-full flex items-center overflow-hidden"
          style={{
            fontSize: (el.fontSize || 14) * certScale,
            fontWeight: el.bold ? 'bold' : 'normal',
            fontStyle: el.italic ? 'italic' : 'normal',
            textAlign: el.align || 'left',
            color: el.color || '#191c1e',
            fontFamily: el.fontFamily || 'serif',
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

  const isApproved = request?.status === 'APPROVED' || request?.status === 'SIGNED';

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-green-50 flex items-center justify-center p-4">
      <div className="w-full max-w-2xl">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-white/80 backdrop-blur rounded-full shadow-sm border border-green-200 mb-4">
            <Shield size={16} className="text-green-600" />
            <span className="text-sm font-semibold text-green-800">VERIX · Validación de Documentos</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-800">Verificación de Certificado</h1>
          <p className="text-sm text-gray-500 mt-1">Sistema de Validación de Documentos Electrónicos</p>
        </div>

        {/* Loading */}
        {loading && (
          <div className="bg-white rounded-2xl shadow-lg p-12 text-center">
            <div className="w-12 h-12 border-4 border-green-200 border-t-green-600 rounded-full animate-spin mx-auto mb-4" />
            <p className="text-gray-500 font-medium">Verificando documento...</p>
          </div>
        )}

        {/* Error */}
        {error && !loading && (
          <div className="bg-white rounded-2xl shadow-lg p-12 text-center">
            <div className="w-20 h-20 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-4">
              <XCircle size={40} className="text-red-500" />
            </div>
            <h2 className="text-xl font-bold text-gray-800 mb-2">Documento no encontrado</h2>
            <p className="text-gray-500 mb-6">{error}</p>
            <p className="text-sm text-gray-400">
              El código ingresado no corresponde a ningún certificado registrado.
              Verifica que el enlace o código sea correcto.
            </p>
          </div>
        )}

        {/* Certificate Info */}
        {request && !loading && (
          <div className="space-y-4">
            {/* Status badge */}
            <div className={`bg-white rounded-2xl shadow-lg p-6 text-center border-l-8 ${
              request.status === 'APPROVED' || request.status === 'SIGNED'
                ? 'border-green-500'
                : request.status === 'REJECTED' || request.status === 'REVOKED'
                  ? 'border-red-500'
                  : 'border-yellow-500'
            }`}>
              <div className={`w-20 h-20 rounded-full bg-opacity-10 flex items-center justify-center mx-auto mb-3 ${
                request.status === 'APPROVED' || request.status === 'SIGNED'
                  ? 'bg-green-100'
                  : request.status === 'REJECTED' || request.status === 'REVOKED'
                    ? 'bg-red-100'
                    : 'bg-yellow-100'
              }`}>
                <StatusIcon size={40} className={status.color} />
              </div>
              <h2 className={`text-2xl font-bold ${status.color}`}>{status.label}</h2>
              <p className="text-sm text-gray-500 mt-1">
                verificado el {new Date().toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
              </p>
            </div>

            {/* Document details */}
            <div className="bg-white rounded-2xl shadow-lg p-6 space-y-4">
              <h3 className="text-sm font-bold text-gray-500 uppercase tracking-wider flex items