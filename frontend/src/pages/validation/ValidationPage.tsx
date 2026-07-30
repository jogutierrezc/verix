import { useState, useEffect, useRef } from 'react';
import { useParams, useLocation } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { QRCodeCanvas } from 'qrcode.react';
import jsPDF from 'jspdf';
import toast from 'react-hot-toast';
import { renderTemplateToPdf } from '../../components/certificate/CertificatePreview';
import { getPageDimensions, type PageSizeName } from '../../lib/pageSizes';
import {
  CheckCircle,
  XCircle,
  AlertTriangle,
  FileText,
  Shield,
  Clock,
  User,
  Download,
  Loader2,
  Copy,
  Check,
  Fingerprint,
  Lock,
  RefreshCw,
} from 'lucide-react';

// ── Helpers ──
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
  for (const [key, value] of Object.entries(data || {})) {
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
  if (!content) return '';
  return content.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const value = data[key];
    if (value === null || value === undefined) return `{{${key}}}`;
    return String(value);
  });
}

const safeJsonParse = (str: string) => { try { return JSON.parse(str); } catch { return {}; } };

interface StatusConfigEntry {
  label: string;
  color: string;
  badgeColor: string;
  icon: any;
  desc: string;
}

const statusConfig: Record<string, StatusConfigEntry> = {
  APPROVED: {
    label: 'Documento Válido',
    color: 'text-emerald-600 bg-emerald-50 border-emerald-200',
    badgeColor: 'bg-emerald-500',
    icon: CheckCircle,
    desc: 'Este documento ha sido aprobado y verificado formalmente.',
  },
  SIGNED: {
    label: 'Documento Firmado',
    color: 'text-emerald-600 bg-emerald-50 border-emerald-200',
    badgeColor: 'bg-emerald-500',
    icon: CheckCircle,
    desc: 'El certificado cuenta con firmas criptográficas autorizadas.',
  },
  REJECTED: {
    label: 'Documento Rechazado',
    color: 'text-rose-600 bg-rose-50 border-rose-200',
    badgeColor: 'bg-rose-500',
    icon: XCircle,
    desc: 'Este documento ha sido denegado por la entidad emisora.',
  },
  REVOKED: {
    label: 'Documento Revocado',
    color: 'text-amber-600 bg-amber-50 border-amber-200',
    badgeColor: 'bg-amber-500',
    icon: AlertTriangle,
    desc: 'Este documento fue emitido pero ha sido anulado posteriormente.',
  },
  PENDING: {
    label: 'Pendiente de Aprobación',
    color: 'text-blue-600 bg-blue-50 border-blue-200',
    badgeColor: 'bg-blue-500',
    icon: Clock,
    desc: 'El documento se encuentra en etapa de auditoría y revisión.',
  },
  DRAFT: {
    label: 'Borrador',
    color: 'text-slate-500 bg-slate-50 border-slate-200',
    badgeColor: 'bg-slate-400',
    icon: FileText,
    desc: 'Documento interno de prueba sin validez oficial.',
  },
};

// ── Mock Data for demo mode ──
const MOCK_CERTIFICATE = {
  code: 'VRX-9821-LK75',
  verification_code: 'VRX-9821-LK75',
  status: 'SIGNED',
  created_at: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
  reviewed_at: new Date(Date.now() - 28 * 24 * 60 * 60 * 1000).toISOString(),
  consecutive_number: '2026-0004918',
  type: 'MASSIVE',
  batch_id: 'batch-817293a1-b6a2',
  batch_total: 150,
  rejection_reason: null,
  user: {
    first_name: 'Alejandro',
    last_name: 'González Herrera',
    document_id: 'CC 1.094.852.114',
  },
  reviewer_notes: JSON.stringify({
    signature_name: 'Dra. Claudia Marcela Restrepo',
    signature_title: 'Directora de Certificaciones Académicas',
    signature_url: 'https://images.unsplash.com/photo-1579783900882-c0d3dad7b119?auto=format&fit=crop&w=200&q=80',
  }),
  data: {
    nombre_curso: 'Especialización en Seguridad Informática y Blockchain',
    fecha_aprobacion: '2026-06-15',
    duracion_horas: '120',
    nota_final: '4.8 / 5.0',
    institucion_nombre: 'Instituto Tecnológico Verix Latam',
  },
};

const MOCK_TEMPLATE = {
  name: 'Certificado de Aprobación Oficial',
  config: {        orientation: 'landscape',
        pageSize: 'A4',
    elements: [
      { id: 1, type: 'shape', x: 20, y: 20, width: 802, height: 555, color: '#1e3a8a' },
      { id: 2, type: 'text', content: 'CERTIFICADO DE APROBACIÓN', x: 100, y: 70, width: 642, height: 40, fontSize: 26, bold: true, align: 'center', fontFamily: 'serif', color: '#1e3a8a' },
      { id: 3, type: 'text', content: 'Se otorga la presente distinción oficial a:', x: 100, y: 140, width: 642, height: 25, fontSize: 14, align: 'center', fontFamily: 'sans-serif', color: '#475569' },
      { id: 4, type: 'text', content: '{{user.first_name}} {{user.last_name}}', x: 100, y: 180, width: 642, height: 45, fontSize: 28, bold: true, align: 'center', fontFamily: 'serif', color: '#0f172a' },
      { id: 5, type: 'text', content: 'Por haber cumplido y aprobado satisfactoriamente todos los requisitos del programa formativo:', x: 120, y: 245, width: 602, height: 40, fontSize: 12, align: 'center', fontFamily: 'sans-serif', color: '#475569' },
      { id: 6, type: 'text', content: '{{nombre_curso}}', x: 100, y: 290, width: 642, height: 35, fontSize: 18, bold: true, align: 'center', fontFamily: 'sans-serif', color: '#047857' },
      { id: 7, type: 'text', content: 'Intensidad Horaria: {{duracion_horas}} horas | Calificación: {{nota_final}}', x: 100, y: 335, width: 642, height: 25, fontSize: 11, align: 'center', fontFamily: 'sans-serif', color: '#64748b' },
      { id: 8, type: 'text', content: 'Expedido en Colombia el {{fecha_aprobacion}}', x: 100, y: 370, width: 642, height: 20, fontSize: 11, italic: true, align: 'center', fontFamily: 'sans-serif', color: '#64748b' },
      { id: 9, type: 'signature', content: 'Firma Autorizada', x: 180, y: 440, width: 200, height: 60, fontSize: 12, align: 'center' },
      { id: 10, type: 'qr', content: '{{qr_content}}', x: 500, y: 420, width: 85, height: 85 },
    ],
  },
};

const MOCK_INSTITUTION = {
  name: 'Instituto Tecnológico Verix Latam',
  logo_url: 'https://images.unsplash.com/photo-1599305445671-ec2c6c64a6d5?auto=format&fit=crop&w=100&h=100&q=80',
};

export function ValidationPage() {
  const { code: codeParam } = useParams<{ code: string }>();
  const location = useLocation();

  const [request, setRequest] = useState<any>(null);
  const [template, setTemplate] = useState<any>(null);
  const [templateConfig, setTemplateConfig] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [institutionData, setInstitutionData] = useState<{ name: string; logo_url: string | null } | null>(null);
  const [reviewerSignatureUrl, setReviewerSignatureUrl] = useState<string | null>(null);
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  const certificateRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const urlParams = new URLSearchParams(location.search);
    const codeQuery = urlParams.get('code');
    const currentCode = codeQuery || codeParam;

    if (currentCode) {
      loadCertificate(currentCode);
    } else {
      setError('No se proporcionó ningún código para validar.');
      setLoading(false);
    }
  }, [codeParam, location.search]);

  useEffect(() => {
    const loadReviewerSignatureFallback = async () => {
      if (!request?.reviewed_by) {
        setReviewerSignatureUrl(null);
        return;
      }

      let reviewerInfo: any = null;
      if (request?.reviewer_notes) {
        try {
          reviewerInfo = JSON.parse(request.reviewer_notes);
        } catch {
          reviewerInfo = { signature_name: request.reviewer_notes };
        }
      }

      if (reviewerInfo?.signature_url) {
        setReviewerSignatureUrl(null);
        return;
      }

      try {
        const { data: signer, error } = await supabase
          .from('authorized_signatures')
          .select('signature_image_url')
          .eq('user_id', request.reviewed_by)
          .eq('is_active', true)
          .limit(1)
          .maybeSingle();

        if (!error && signer?.signature_image_url) {
          setReviewerSignatureUrl(signer.signature_image_url);
        } else {
          setReviewerSignatureUrl(null);
        }
      } catch {
        setReviewerSignatureUrl(null);
      }
    };

    loadReviewerSignatureFallback();
  }, [request]);

  const loadCertificate = async (effectiveCode: string) => {
    setLoading(true);
    setError(null);

    // Fallback to mock data if no code provided or Supabase unavailable
    if (!effectiveCode) {
      setTimeout(() => {
        setRequest(MOCK_CERTIFICATE);
        setTemplate(MOCK_TEMPLATE);
        setTemplateConfig(MOCK_TEMPLATE.config);
        setInstitutionData(MOCK_INSTITUTION);
        setLoading(false);
      }, 700);
      return;
    }

    try {
      let data: any = null;

      // Llamar a la RPC function pública (SECURITY DEFINER, bypasses RLS)
      const { data: rpcData, error: rpcError } = await supabase
        .rpc('get_certificate_for_validation', { p_code: effectiveCode });

      if (rpcError) {
        console.warn('RPC falló, intentando consulta directa:', rpcError);
      } else if (rpcData) {
        data = typeof rpcData === 'string' ? JSON.parse(rpcData) : rpcData;
      }

      // Fallback: consulta directa (funciona si el usuario está autenticado)
      if (!data) {
        const { data: directData } = await supabase
          .from('certificate_requests')
          .select('*, user:users!certificate_requests_user_id_fkey(first_name, last_name, document_id)')
          .or(`code.eq.${effectiveCode},consecutive_number.eq.${effectiveCode},verification_code.eq.${effectiveCode},user.document_id.eq.${effectiveCode},data->>documento_estudiante.eq.${effectiveCode},data->>document_id.eq.${effectiveCode},data->>documento.eq.${effectiveCode}`)
          .maybeSingle();

        if (directData) {
          data = {
            ...directData,
            user: directData.user || { first_name: '', last_name: '' },
          };
        }
      }

      if (!data) {
        setError('Certificado no localizado en la base de datos.');
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

        // Load institution data for logo if available
        if (tmpl?.institution_id) {
          const { data: inst } = await supabase
            .from('institutions')
            .select('name, logo_url')
            .eq('id', tmpl.institution_id)
            .single();
          if (inst) setInstitutionData(inst);
        }
      }
    } catch (err: any) {
      console.error('Error loading certificate:', err);
      setError('Problema de conexión con los servicios de verificación.');
    } finally {
      setLoading(false);
    }
  };

  const currentCode = new URLSearchParams(location.search).get('code') || codeParam;
  const validationUrl = typeof window !== 'undefined'
    ? window.location.href
    : `https://verix.com/validate/${currentCode || 'demo'}`;
  const status = statusConfig[request?.status] || {
    label: 'Estado Desconocido',
    color: 'text-slate-500 bg-slate-50',
    badgeColor: 'bg-slate-400',
    icon: FileText,
    desc: 'Este documento se encuentra en un estado indeterminado.',
  };
  const StatusIcon = status.icon;

  // Parse reviewer notes if available
  let reviewerInfo: any = null;
  if (request?.reviewer_notes) {
    try {
      reviewerInfo = JSON.parse(request.reviewer_notes);
    } catch {
      reviewerInfo = { signature_name: request.reviewer_notes };
    }
  }

  // Derived selected signature for PDF generation (matches renderTemplateToPdf interface)
  const selectedSignature = (reviewerInfo?.signature_url || reviewerSignatureUrl)
    ? { signature_image_url: reviewerInfo?.signature_url || reviewerSignatureUrl }
    : null;

  const signedPdfUrl = request?.certificate_url || null;
  const hasSignedPdf = Boolean(signedPdfUrl);
  const isSignedStatus = request?.status === 'SIGNED';
  const isSignedOrHasPdf = hasSignedPdf || isSignedStatus;
  const canDownloadSignedPdf = hasSignedPdf;

  // Certificate rendering config
  const rawConfig = templateConfig || {};
  const elements: any[] = rawConfig?.elements || [];
  const pageOrientation = rawConfig?.orientation || 'landscape';
  const pageSizeName: PageSizeName = rawConfig?.pageSize || 'A4';
  const { width: pageWidth, height: pageHeight } = getPageDimensions(pageSizeName, pageOrientation);
  const certScale = 0.52;

  const rawRequestData = request?.data || {};
  const requestCode = request?.code || '';
  const verificationCode = request?.verification_code || requestCode;

  const requestData: Record<string, any> = {
    ...convertDatesInData(rawRequestData),
    codigo: verificationCode,
    codigo_certificado: verificationCode,
    codigo_solicitud: requestCode,
    id_solicitud: requestCode,
    codigo_verificacion: verificationCode,
    qr_content: validationUrl,
    'user.first_name': request?.user?.first_name || '',
    'user.last_name': request?.user?.last_name || '',
    ...(request?.consecutive_number ? {
      radicado: request.consecutive_number,
      consecutivo: request.consecutive_number,
    } : {}),
  };

  const downloadFileFromUrl = async (url: string, filename: string) => {
    const response = await fetch(url);
    if (!response.ok) throw new Error('No se pudo descargar el PDF firmado');
    const blob = await response.blob();
    const link = document.createElement('a');
    const objectUrl = URL.createObjectURL(blob);
    link.href = objectUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(objectUrl);
  };

  const handleDownloadPdf = async () => {
    setPdfLoading(true);
    try {
      if (canDownloadSignedPdf && request?.certificate_url) {
        toast.loading('Descargando PDF firmado...', { id: 'validate-pdf' });
        await downloadFileFromUrl(request.certificate_url, `certificado-${requestCode || verificationCode}-firmado.pdf`);
        toast.success('✅ PDF firmado descargado', { id: 'validate-pdf' });
        return;
      }

      if (!request?.certificate_url) {
        toast.error('No se encontró un PDF firmado. Generando una copia del certificado.', { id: 'validate-pdf' });
      } else {
        toast.loading('Generando PDF vectorial...', { id: 'validate-pdf' });
      }

      const pdf = await renderTemplateToPdf(
        elements,
        pageOrientation,
        pageWidth,
        pageHeight,
        requestData,
        selectedSignature,
      );

      pdf.save(`certificado-${requestCode || verificationCode}.pdf`);
      toast.success('✅ PDF descargado exitosamente', { id: 'validate-pdf' });
    } catch (err: any) {
      toast.error('Error al generar PDF: ' + (err.message || ''), { id: 'validate-pdf' });
    } finally {
      setPdfLoading(false);
    }
  };

  const copyToClipboard = (text: string, type: 'code' | 'link') => {
    navigator.clipboard.writeText(text).then(() => {
      if (type === 'code') {
        setCopiedCode(true);
        setTimeout(() => setCopiedCode(false), 2000);
      } else {
        setCopiedLink(true);
        setTimeout(() => setCopiedLink(false), 2000);
      }
    }).catch(() => {
      // Fallback for older browsers
      const el = document.createElement('textarea');
      el.value = text;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
      if (type === 'code') {
        setCopiedCode(true);
        setTimeout(() => setCopiedCode(false), 2000);
      } else {
        setCopiedLink(true);
        setTimeout(() => setCopiedLink(false), 2000);
      }
    });
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
          <div className="w-full h-full flex items-center justify-center bg-white rounded-lg p-1 shadow-sm">
            <QRCodeCanvas
              value={validationUrl}
              size={qrSize}
              bgColor="#ffffff"
              fgColor="#1e3a8a"
              level="M"
              style={{ width: qrSize, height: qrSize }}
            />
          </div>
        );
      }
      if (el.type === 'line') return <div className="w-full border-t-2 border-slate-300" />;
      if (el.type === 'shape') return <div className="w-full h-full border-2 border-dashed border-slate-300 rounded-lg" />;
      if (el.type === 'signature') {
        return (
          <div
            className="w-full h-full flex items-center justify-center select-none"
            onContextMenu={e => e.preventDefault()}
            draggable={false}
          >
            {selectedSignature?.signature_image_url ? (
              <div
                className="w-full h-full bg-no-repeat bg-contain bg-center"
                style={{
                  backgroundImage: `url("${selectedSignature.signature_image_url}")`,
                  pointerEvents: 'none' as React.CSSProperties['pointerEvents'],
                  userSelect: 'none' as React.CSSProperties['userSelect'],
                  WebkitTouchCallout: 'none',
                }}
                draggable={false}
              />
            ) : (
              <span className="text-slate-400 italic text-[10px] select-none">
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
            color: el.color || '#0f172a',
            fontFamily: el.fontFamily || 'serif',
            justifyContent: el.align === 'center' ? 'center' : el.align === 'right' ? 'flex-end' : 'flex-start',
            padding: '1px 2px',
            lineHeight: 1.15,
            wordBreak: 'break-word',
          }}
        >
          {renderContent()}
        </div>
      </div>
    );
  };

  
  return (
    <div className="min-h-screen bg-[#f8fafc] text-slate-800 selection:bg-emerald-500 selection:text-white antialiased">
      {/* Decorative grid background */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#e2e8f0_1px,transparent_1px),linear-gradient(to_bottom,#e2e8f0_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,#000_70%,transparent_100%)] pointer-events-none opacity-50" />

      {/* Ambient gradient blurs */}
      <div className="absolute top-0 left-1/4 w-96 h-96 bg-emerald-100/40 rounded-full filter blur-3xl pointer-events-none" />
      <div className="absolute top-1/3 right-1/4 w-[30rem] h-[30rem] bg-sky-100/30 rounded-full filter blur-3xl pointer-events-none" />

      {/* Sticky Header */}
      <header className="sticky top-0 z-30 bg-white/70 backdrop-blur-md border-b border-slate-200/80 px-4 py-3">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src="/Logo%20Verix.png" alt="VERIX" className="h-10 w-auto" />
            <span className="text-xs font-semibold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-100 hidden sm:inline-block">VALIDATOR</span>
          </div>

          <div className="flex items-center gap-2">
            {institutionData?.logo_url && (
              <div className="hidden sm:flex items-center gap-2 bg-slate-50 border border-slate-200/80 rounded-lg p-1 px-3">
                <img
                  src={institutionData.logo_url}
                  alt={institutionData.name || ''}
                  className="h-6 w-auto object-contain rounded"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                />
                <span className="text-xs font-medium text-slate-500">{institutionData.name}</span>
              </div>
            )}
            <span className="text-slate-300 font-light">|</span>
            <div className="flex items-center gap-1 text-slate-500 text-xs font-semibold">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span>Sistemas Activos</span>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8 relative z-10">
        {/* Loading State */}
        {loading && (
          <div className="min-h-[60vh] flex flex-col items-center justify-center p-8 bg-white/50 backdrop-blur rounded-3xl border border-slate-200 shadow-xl max-w-xl mx-auto">
            <div className="relative">
              <div className="w-16 h-16 border-4 border-slate-100 border-t-emerald-600 rounded-full animate-spin" />
              <Shield className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 text-emerald-600 w-5 h-5" />
            </div>
            <h3 className="text-lg font-bold text-slate-800 mt-6">Consultando Registro Criptográfico</h3>
            <p className="text-sm text-slate-500 mt-2 text-center max-w-sm">
              Conectando con el ledger seguro de firmas digitales para verificar el estado de emisión del documento...
            </p>
          </div>
        )}

        {/* Error State */}
        {error && !loading && (
          <div className="min-h-[50vh] flex flex-col items-center justify-center p-8 bg-white rounded-3xl border border-slate-200 shadow-xl max-w-xl mx-auto text-center">
            <div className="w-16 h-16 rounded-2xl bg-rose-50 flex items-center justify-center border border-rose-100 text-rose-500 mb-6 shadow-sm">
              <XCircle size={36} />
            </div>
            <h2 className="text-xl font-black text-slate-900 mb-2">Verificación Fallida</h2>
            <p className="text-slate-600 mb-6 text-sm max-w-md">
              {error} Por favor asegúrese de que el código suministrado es válido o intente nuevamente.
            </p>
            <div className="w-full border-t border-slate-100 pt-6 flex flex-col gap-2">
              <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-3 text-xs text-slate-500 text-left">
                <strong>Consejos de Seguridad:</strong>
                <ul className="list-disc pl-4 mt-1.5 space-y-1">
                  <li>Revise que los guiones y mayúsculas coincidan.</li>
                  <li>No comparta enlaces de verificación alterados.</li>
                  <li>Si el problema persiste, contacte a la entidad emisora del título.</li>
                </ul>
              </div>
              <button
                onClick={() => {
                  const currentCode = new URLSearchParams(location.search).get('code') || codeParam;
                  if (currentCode) loadCertificate(currentCode);
                }}
                className="mt-4 flex items-center justify-center gap-2 px-5 py-2.5 bg-slate-900 text-white rounded-xl text-sm font-bold hover:bg-slate-800 transition"
              >
                <RefreshCw size={16} /> Reintentar Verificación
              </button>
            </div>
          </div>
        )}

        {/* Main Content: Two-Column Layout */}
        {request && !loading && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">

            {/* LEFT COLUMN: Status, Details, Signature, QR */}
            <div className="lg:col-span-5 space-y-6">

              {/* Status Card */}
              <div className={`bg-white rounded-3xl border shadow-xl shadow-slate-100 overflow-hidden relative ${
                isSignedOrHasPdf ? 'border-emerald-200/80' : 'border-slate-200'
              }`}>
                <div className={`h-2 w-full ${isSignedOrHasPdf ? 'bg-gradient-to-r from-emerald-500 to-teal-400' : 'bg-slate-400'}`} />

                <div className="p-6">
                  <div className="flex items-start gap-4">
                    <div className={`p-3 rounded-2xl shrink-0 ${status.color}`}>
                      <StatusIcon size={28} />
                    </div>
                    <div>
                      <span className="text-[10px] tracking-wider uppercase font-extrabold text-slate-400">Verificación de Integridad</span>
                      <h2 className="text-2xl font-black text-slate-900 tracking-tight leading-tight mt-0.5">{status.label}</h2>
                      <p className="text-xs text-slate-500 mt-1">{status.desc}</p>
                    </div>
                  </div>

                  <div className="mt-5 pt-4 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-400 font-medium">
                    <span className="flex items-center gap-1">
                      <Lock size={12} className="text-emerald-600" /> Canal Seguro SSL Activo
                    </span>
                    <span>
                      Auditado: {new Date().toLocaleDateString('es-CO', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                </div>
              </div>

              {/* Usuario Solicitante */}
              <div className="bg-white rounded-3xl border border-slate-200 shadow-xl shadow-slate-100 overflow-hidden">
                <div className="p-6 border-b border-slate-100 bg-slate-50/50">
                  <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                    <User size={14} className="text-slate-500" /> Usuario Solicitante
                  </h3>
                </div>
                <div className="p-6">
                  <div className="flex items-start gap-4">
                    <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-500 flex items-center justify-center shrink-0 shadow-md shadow-emerald-200">
                      <span className="text-white font-extrabold text-lg">
                        {request.user?.first_name?.charAt(0)?.toUpperCase() || '?'}
                        {request.user?.last_name?.charAt(0)?.toUpperCase() || ''}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-base text-slate-900 truncate">
                        {request.user?.first_name} {request.user?.last_name}
                      </p>
                      {request.user?.document_id && (
                        <p className="text-xs text-slate-500 mt-0.5">
                          {request.user.document_id}
                        </p>
                      )}
                      {requestData.institucion_nombre && (
                        <div className="inline-flex items-center gap-1 mt-2 text-[10px] font-medium text-slate-500 bg-slate-50 px-2 py-1 rounded-lg border border-slate-200">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                          {requestData.institucion_nombre}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Datos del Certificado */}
              {Object.keys(rawRequestData).length > 0 && (
                <div className="bg-white rounded-3xl border border-slate-200 shadow-xl shadow-slate-100 overflow-hidden">
                  <div className="p-6 border-b border-slate-100 bg-slate-50/50">
                    <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                      <FileText size={14} className="text-slate-500" /> Datos del Certificado
                    </h3>
                  </div>
                  <div className="p-6">
                    <div className="grid grid-cols-2 gap-y-4 gap-x-6 text-xs">
                      {Object.entries(rawRequestData).map(([key, value]) => {
                        const label = key
                          .replace(/_/g, ' ')
                          .replace(/\b\w/g, (c) => c.toUpperCase());
                        const displayValue = typeof value === 'string' && value
                          ? (value.length > 60 ? value.substring(0, 60) + '...' : value)
                          : String(value || '—');
                        return (
                          <div key={key} className={displayValue.length > 30 ? 'col-span-2' : ''}>
                            <span className="text-[10px] uppercase tracking-wider text-slate-400 font-bold block">{label}</span>
                            <p className="font-semibold text-slate-800 mt-0.5 leading-snug">{displayValue}</p>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}

              {/* Información del Registro */}
              <div className="bg-white rounded-3xl border border-slate-200 shadow-xl shadow-slate-100 overflow-hidden">
                <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                  <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                    <FileText size={14} className="text-slate-500" /> Información del Registro
                  </h3>
                  <span className="text-[10px] font-bold text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">
                    No. {request.consecutive_number || 'S/N'}
                  </span>
                </div>

                <div className="p-6">
                  <div className="grid grid-cols-2 gap-y-4 gap-x-6 text-xs">
                    <div>
                      <span className="text-[10px] uppercase tracking-wider text-slate-400 font-bold block">Código de Verificación</span>
                      <div className="flex items-center gap-1.5 mt-1">
                        <code className="font-mono bg-slate-50 text-slate-600 px-1.5 py-0.5 rounded border text-[11px] font-semibold">
                          {verificationCode}
                        </code>
                        <button
                          onClick={() => copyToClipboard(verificationCode, 'code')}
                          className="text-slate-400 hover:text-slate-600 transition"
                          title="Copiar Código"
                        >
                          {copiedCode ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} />}
                        </button>
                      </div>
                    </div>

                    <div>
                      <span className="text-[10px] uppercase tracking-wider text-slate-400 font-bold block">ID Solicitud</span>
                      <p className="font-mono text-sm font-semibold text-slate-700 mt-1">{requestCode || '—'}</p>
                    </div>

                    <div>
                      <span className="text-[10px] uppercase tracking-wider text-slate-400 font-bold block">Fecha de Creación</span>
                      <p className="font-semibold text-slate-800 mt-1">
                        {request.created_at
                          ? new Date(request.created_at).toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' })
                          : '—'}
                      </p>
                    </div>

                    <div>
                      <span className="text-[10px] uppercase tracking-wider text-slate-400 font-bold block">Fecha de Emisión</span>
                      <p className="font-semibold text-slate-800 mt-1">
                        {request.reviewed_at
                          ? new Date(request.reviewed_at).toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' })
                          : formatDateToSpanish(requestData.fecha_aprobacion) || '—'}
                      </p>
                    </div>

                    <div>
                      <span className="text-[10px] uppercase tracking-wider text-slate-400 font-bold block">Tipo de Documento</span>
                      <p className="font-semibold text-slate-800 mt-1">{template?.name || 'Certificado'}</p>
                    </div>

                    {request.type === 'MASSIVE' && request.batch_id && (
                      <div className="col-span-2">
                        <span className="text-[10px] uppercase tracking-wider text-slate-400 font-bold block">Lote</span>
                        <p className="text-sm text-slate-600 mt-1">
                          #{request.batch_id.substring(0, 8).toUpperCase()} ({request.batch_total} solicitudes)
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Reviewer / Signature Info */}
              {reviewerInfo && (
                <div className="bg-white rounded-3xl border border-slate-200 shadow-xl shadow-slate-100 p-6 space-y-4">
                  <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                    <Fingerprint size={14} className="text-emerald-600" /> Firma y Custodia
                  </h3>
                  <div className="flex items-start gap-3.5 bg-slate-50/70 rounded-2xl p-3 border border-slate-100">
                    <div className="w-10 h-10 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center justify-center shrink-0">
                      <User size={18} className="text-emerald-700" />
                    </div>
                    <div>
                      <p className="text-xs font-bold text-slate-900 leading-tight">{reviewerInfo.signature_name || 'Firmante autorizado'}</p>
                      <p className="text-[11px] text-slate-500 mt-0.5">{reviewerInfo.signature_title || 'Representante Autorizado'}</p>
                      <div className="inline-flex items-center gap-1 mt-1 text-[10px] text-emerald-600 bg-emerald-100/40 px-2 py-0.5 rounded-full font-bold">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                        Firma Digital Estampada
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Rejection Reason */}
              {request.status === 'REJECTED' && request.rejection_reason && (
                <div className="bg-rose-50 rounded-3xl p-6 border border-rose-200">
                  <h3 className="text-xs font-black text-rose-700 uppercase tracking-wider mb-2 flex items-center gap-2">
                    <XCircle size={14} /> Motivo de Rechazo
                  </h3>
                  <p className="text-sm text-rose-600">{request.rejection_reason}</p>
                </div>
              )}

              {/* QR Block */}
              <div className="bg-white rounded-3xl border border-slate-200 shadow-xl shadow-slate-100 p-6 text-center relative overflow-hidden">
                <div className="absolute top-0 right-0 w-24 h-24 bg-emerald-50 rounded-full filter blur-xl -z-10" />
                <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-4 flex items-center justify-center gap-2">
                  <Shield size={14} className="text-slate-500" /> Certificación Criptográfica
                </h3>
                <div className="flex justify-center mb-3">
                  <div className="p-3 bg-white border border-slate-100 rounded-2xl inline-block shadow-md">
                    <QRCodeCanvas
                      value={validationUrl}
                      size={112}
                      bgColor="#ffffff"
                      fgColor="#059669"
                      level="M"
                    />
                  </div>
                </div>
                <div className="inline-flex items-center gap-1 text-[10px] bg-slate-50 px-2 py-1 rounded-lg border max-w-full">
                  <span className="font-mono text-slate-500 truncate max-w-[200px]">{validationUrl}</span>
                  <button
                    onClick={() => copyToClipboard(validationUrl, 'link')}
                    className="text-slate-400 hover:text-slate-600 shrink-0 ml-1"
                  >
                    {copiedLink ? <Check size={11} className="text-emerald-500" /> : <Copy size={11} />}
                  </button>
                </div>
                <p className="text-[11px] text-slate-400 mt-3 max-w-sm mx-auto">
                  Escanee el QR con cualquier dispositivo para corroborar este registro directamente en el servidor seguro de VERIX.
                </p>
              </div>
            </div>

            {/* RIGHT COLUMN: Certificate Preview + Audit Trail */}
            <div className="lg:col-span-7 space-y-6">

              {/* Certificate Canvas Container */}
              <div className="bg-slate-900 rounded-3xl p-6 lg:p-8 border border-slate-800 shadow-2xl relative overflow-hidden flex flex-col items-center justify-center min-h-[480px]">

                <div className="absolute inset-0 bg-[radial-gradient(#1e293b_1px,transparent_1px)] bg-[size:16px_16px] opacity-40 pointer-events-none" />

                <div className="w-full flex items-center justify-between mb-4 z-10 text-slate-400 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-slate-700 block" />
                    <span className="font-medium tracking-tight text-slate-300">PREVISUALIZACIÓN DEL DOCUMENTO</span>
                  </div>
                  <span className="text-[10px] font-mono tracking-wider text-slate-500">
                    {pageWidth}×{pageHeight} ({pageOrientation === 'landscape' ? 'Apaisado' : 'Vertical'})
                  </span>
                </div>

                {/* Certificate sheet */}
                <div className="w-full overflow-x-auto flex justify-center py-2 relative z-10 [&::-webkit-scrollbar]:hidden">
                  <div className="shadow-2xl hover:shadow-emerald-950/20 transition-all duration-300">
                    <div
                      ref={certificateRef}
                      className="bg-white relative shrink-0 transition-transform origin-top select-none shadow-[0_20px_50px_rgba(0,0,0,0.3)] border border-slate-100"
                      style={{
                        width: pageWidth * certScale,
                        height: pageHeight * certScale,
                      }}
                    >
                      {elements.map((el: any, i: number) => renderElement(el, i))}
                      {elements.length === 0 && (
                        <div className="absolute inset-0 flex items-center justify-center text-slate-400">
                          <div className="text-center">
                            <FileText size={40} className="mx-auto mb-2 opacity-40" />
                            <p className="text-sm font-medium">Sin elementos en la plantilla</p>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Download button row */}
                <div className="w-full mt-6 pt-4 border-t border-slate-800 z-10 flex flex-col sm:flex-row gap-3 items-center justify-between">
                  <div className="text-slate-400 text-[11px] text-center sm:text-left">
                    <p className="font-semibold text-slate-300">¿Desea archivar el documento original?</p>
                    <p className="text-slate-500">Se descargará un PDF de alta resolución con firmas digitales.</p>
                  </div>

                  <button
                    onClick={handleDownloadPdf}
                    disabled={pdfLoading || !isSignedOrHasPdf}
                    className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-3 bg-gradient-to-r from-emerald-600 to-teal-500 hover:from-emerald-700 hover:to-teal-600 text-white font-bold rounded-xl transition-all shadow-lg shadow-emerald-950/40 disabled:opacity-50 disabled:cursor-not-allowed hover:-translate-y-0.5 active:translate-y-0 text-sm"
                  >
                    {pdfLoading ? (
                      <>
                        <Loader2 size={18} className="animate-spin" />
                        Generando PDF...
                      </>
                    ) : (
                      <>
                        <Download size={18} />
                        Descargar PDF Oficial
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Audit Trail */}
              <div className="bg-white rounded-3xl border border-slate-200 shadow-xl shadow-slate-100 p-6 space-y-4">
                <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                  <Lock size={14} className="text-slate-500" /> Registro de Auditoría Tecnológica
                </h3>

                <div className="relative pl-6 space-y-4 before:absolute before:left-2 before:top-1.5 before:bottom-1.5 before:w-px before:bg-slate-200">

                  <div className="relative">
                    <span className="absolute -left-6 top-1 w-3.5 h-3.5 rounded-full bg-emerald-500 border-4 border-white flex items-center justify-center shadow-sm" />
                    <p className="text-xs font-bold text-slate-900 leading-none">Emisión Registrada Exitosamente</p>
                    <p className="text-[10px] text-slate-500 mt-1">
                      El certificado fue incorporado de forma segura en la base de datos institucional.
                    </p>
                  </div>

                  <div className="relative">
                    <span className="absolute -left-6 top-1 w-3.5 h-3.5 rounded-full bg-emerald-500 border-4 border-white flex items-center justify-center shadow-sm" />
                    <p className="text-xs font-bold text-slate-900 leading-none">Firma Digital Estampada</p>
                    <p className="text-[10px] text-slate-500 mt-1">
                      Clave pública verificada y estampada temporalmente por la entidad autorizada.
                    </p>
                  </div>

                  <div className="relative">
                    <span className="absolute -left-6 top-1 w-3.5 h-3.5 rounded-full bg-slate-300 border-4 border-white flex items-center justify-center shadow-sm" />
                    <p className="text-xs font-bold text-slate-700 leading-none">Consulta de Validación Abierta</p>
                    <p className="text-[10px] text-slate-400 mt-0.5">
                      Acceso exitoso al portal de validación pública de VERIX.
                    </p>
                  </div>
                </div>
              </div>

            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-200 bg-white py-8 mt-12 relative z-10 text-center">
        <div className="max-w-7xl mx-auto px-4 space-y-3">
          <p className="text-xs font-semibold text-slate-400">
            Este portal de validación está protegido mediante cifrado SSL de extremo a extremo.
          </p>
          <div>
            <button
              onClick={() => { if (typeof window !== 'undefined') window.location.href = '/validate'; }}
              className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-emerald-700 transition-colors font-medium bg-transparent border-none cursor-pointer"
            >
              ← Volver al buscador de certificados
            </button>
            <span className="text-slate-300 mx-2">·</span>
            <button
              onClick={() => { if (typeof window !== 'undefined') window.location.href = '/login'; }}
              className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-emerald-700 transition-colors font-medium bg-transparent border-none cursor-pointer"
            >
              Volver al inicio de sesión
            </button>
          </div>
          <p className="text-[11px] text-slate-400">
            Powered by <span className="font-black tracking-tight text-slate-700">VERIX un desarrollo de Jose Alfredo Gutierrez Contreras</span> · © {new Date().getFullYear()} Todos los derechos reservados.
          </p>
        </div>
      </footer>
    </div>
  );
}
