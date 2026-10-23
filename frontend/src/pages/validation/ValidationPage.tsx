import { Fragment, useState, useEffect, useLayoutEffect, useRef } from 'react';
import gsap from 'gsap';
import { useParams, useLocation } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { QRCodeCanvas } from 'qrcode.react';
import jsPDF from 'jspdf';
import toast from 'react-hot-toast';
import { renderTemplateToPdf } from '../../components/certificate/CertificatePreview';
import { getPageDimensions, normalizePageSize } from '../../lib/pageSizes';
import { RichText, templateTextStyle } from '../../lib/richText';
import { Seal, type SealTone } from './Seal';
import './portal.css';
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

function formatDateToSpanish(dateStr: string | null | undefined): string {
  // Defensa ante fechas vacías o indefinidas (p. ej. documentos revocados sin fecha de emisión)
  if (!dateStr || typeof dateStr !== 'string') return '';
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
        pageSize: 'LETTER',
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
  const pageRef = useRef<HTMLDivElement>(null);
  const sealRef = useRef<SVGSVGElement>(null);
  const deskRef = useRef<HTMLDivElement>(null);
  const [deskWidth, setDeskWidth] = useState(640);

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

  // Ancho disponible para la hoja: la escala sale del contenedor, no de un número fijo
  useEffect(() => {
    const el = deskRef.current;
    if (!el) return;
    const measure = () => setDeskWidth(Math.max(240, el.clientWidth - (window.innerWidth < 640 ? 32 : 56)));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [request, loading]);

  // Entrada: las secciones suben y el sello se estampa una sola vez
  useLayoutEffect(() => {
    if (!request || loading) return;
    const mm = gsap.matchMedia();
    mm.add('(prefers-reduced-motion: no-preference)', () => {
      gsap.from('[data-rise]', { y: 20, opacity: 0, duration: 0.8, stagger: 0.09, ease: 'expo.out', clearProps: 'transform,opacity' });
      if (sealRef.current) {
        gsap.from(sealRef.current, { scale: 1.8, rotate: -22, opacity: 0, duration: 0.3, delay: 0.25, ease: 'power3.in' });
      }
    }, pageRef);
    return () => mm.revert();
  }, [request, loading]);

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
          setTemplateConfig({
            ...cfg,
            pageSize: cfg.pageSize ?? tmpl.page_size,
            orientation: cfg.orientation ?? tmpl.orientation,
          });
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

  // Parse reviewer notes if available
  let reviewerInfo: any = null;
  if (request?.reviewer_notes) {
    try {
      reviewerInfo = JSON.parse(request.reviewer_notes);
    } catch {
      reviewerInfo = { signature_name: request.reviewer_notes };
    }
  }

  // Un documento se considera REVOCADO si el status lo indica o si trae señales de
  // revocación (revoked_at / reviewer_notes.revoked), aunque el status esté desactualizado.
  const isRevoked = request?.status === 'REVOKED'
    || Boolean(request?.revoked_at)
    || reviewerInfo?.revoked === true;

  const status = statusConfig[isRevoked ? 'REVOKED' : (request?.status || '')] || {
    label: 'Estado Desconocido',
    color: 'text-slate-500 bg-slate-50',
    badgeColor: 'bg-slate-400',
    icon: FileText,
    desc: 'Este documento se encuentra en un estado indeterminado.',
  };
  const StatusIcon = status.icon;

  // Derived selected signature for PDF generation (matches renderTemplateToPdf interface)
  const selectedSignature = isRevoked
    ? null
    : (reviewerInfo?.signature_url || reviewerSignatureUrl)
      ? { signature_image_url: reviewerInfo?.signature_url || reviewerSignatureUrl }
      : null;

  const signedPdfUrl = request?.certificate_url || null;
  const hasSignedPdf = Boolean(signedPdfUrl);
  const isSignedStatus = request?.status === 'SIGNED';

  // Certificate rendering config
  const rawConfig = templateConfig || {};
  const elements: any[] = rawConfig?.elements || [];
  const hasTemplateElements = elements.length > 0;
  // Solo los documentos aprobados o firmados pueden descargarse (revocado, pendiente, borrador, etc. no)
  const isDownloadableStatus = !isRevoked && ['APPROVED', 'SIGNED'].includes(request?.status);
  const canDownloadPdf = isDownloadableStatus && (hasTemplateElements || hasSignedPdf || isSignedStatus);
  const canDownloadSignedPdf = hasSignedPdf;
  const pageOrientation = rawConfig?.orientation || 'landscape';
  const { width: pageWidth, height: pageHeight } = getPageDimensions(normalizePageSize(rawConfig?.pageSize), pageOrientation);
  const pageNumbers = [...new Set(elements.map((el: any) => el.page ?? 0))].sort((a: any, b: any) => a - b) as number[];
  if (pageNumbers.length === 0) pageNumbers.push(0);
  const certScale = Math.min(1, deskWidth / pageWidth);

  const tone: SealTone = isRevoked
    ? 'revoked'
    : ['APPROVED', 'SIGNED'].includes(request?.status) ? 'valid'
    : ['PENDING', 'IN_REVIEW'].includes(request?.status) ? 'pending'
    : 'neutral';
  const sealRing = tone === 'valid' ? 'Registro verificado' : tone === 'revoked' ? 'Documento revocado' : tone === 'pending' ? 'En revisión' : 'Sin validez';

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
    radicado: request?.consecutive_number || '',
    consecutivo: request?.consecutive_number || '',
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
    if (!canDownloadPdf) {
      toast.error('Este documento no está disponible para descarga en su estado actual.');
      return;
    }
    setPdfLoading(true);
    const filename = `certificado-${requestCode || verificationCode}`;
    try {
      // 1. Archivo original ya firmado (el mismo que emitió la institución)
      if (hasSignedPdf && request?.certificate_url) {
        toast.loading('Descargando PDF firmado...', { id: 'validate-pdf' });
        try {
          await downloadFileFromUrl(request.certificate_url, `${filename}-firmado.pdf`);
          toast.success('PDF firmado descargado', { id: 'validate-pdf' });
          return;
        } catch (err) {
          console.warn('No se pudo bajar el PDF firmado, se regenera desde la plantilla:', err);
        }
      }

      // 2. Respaldo: regenerar desde la plantilla
      if (hasTemplateElements) {
        toast.loading('Generando PDF...', { id: 'validate-pdf' });
        const pdf = await renderTemplateToPdf(elements, pageOrientation, pageWidth, pageHeight, requestData, selectedSignature);
        pdf.save(`${filename}.pdf`);
        toast.success('PDF descargado', { id: 'validate-pdf' });
        return;
      }

      toast.error('No hay un archivo disponible para este documento.', { id: 'validate-pdf' });
    } catch (err: any) {
      toast.error('Error al preparar el PDF: ' + (err.message || ''), { id: 'validate-pdf' });
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
        const qrSize = Math.min(el.width * certScale * 0.9, el.height * certScale * 0.9);
        return (
          <div className="w-full h-full flex items-center justify-center bg-white">
            <QRCodeCanvas value={validationUrl} size={Math.max(qrSize * 3, 120)} bgColor="#ffffff" fgColor="#006e2f" level="M" style={{ width: qrSize, height: qrSize }} />
          </div>
        );
      }
      if (el.type === 'line') return <div className="w-full border-t border-neutral-400" />;
      if (el.type === 'shape') return <div className="w-full h-full border border-neutral-400" />;
      if (el.type === 'signature') {
        return (
          <div className="w-full h-full flex items-center justify-center select-none" onContextMenu={e => e.preventDefault()} draggable={false}>
            {selectedSignature?.signature_image_url ? (
              <div
                className="w-full h-full bg-no-repeat bg-contain bg-center"
                style={{ backgroundImage: `url("${selectedSignature.signature_image_url}")`, pointerEvents: 'none', userSelect: 'none', WebkitTouchCallout: 'none' }}
                draggable={false}
              />
            ) : (
              <span className="italic text-[10px] select-none text-neutral-400">
                {isRevoked ? 'Firma revocada' : reviewerInfo?.signature_name || filledContent || '[Firma]'}
              </span>
            )}
          </div>
        );
      }
      return (
        <span className="w-full" style={templateTextStyle(el.align)}>
          <RichText content={el.content} data={requestData} bold={el.bold} italic={el.italic} />
        </span>
      );
    };

    return (
      <div
        key={el.id || index}
        className="absolute"
        style={{ left: el.x * certScale, top: el.y * certScale, width: el.width * certScale, height: el.height * certScale }}
      >
        <div
          className="w-full h-full flex items-center overflow-hidden"
          style={{
            fontSize: (el.fontSize || 14) * certScale,
            color: el.color || '#17251d',
            fontFamily: 'Roboto, Helvetica, Arial, sans-serif',
            justifyContent: el.align === 'center' ? 'center' : el.align === 'right' ? 'flex-end' : 'flex-start',
            padding: '2px 4px',
            lineHeight: 1.2,
          }}
        >
          {renderContent()}
        </div>
      </div>
    );
  };

  // ── Datos para la ficha ──
  const holderName = (rawRequestData.nombre_estudiante || rawRequestData.nombre || '').toString().trim();
  const holderDocument = (rawRequestData.documento_estudiante || rawRequestData.document_id || rawRequestData.documento || '').toString().trim();
  const shownKeys = new Set(['nombre_estudiante', 'nombre', 'documento_estudiante', 'document_id', 'documento']);
  const extraData = Object.entries(rawRequestData).filter(([k, v]) => !shownKeys.has(k) && v !== null && v !== '' && typeof v !== 'object');
  const longDate = (iso?: string | null) =>
    iso && !isNaN(new Date(iso).getTime())
      ? new Date(iso).toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' })
      : null;

  const downloadLabel = hasSignedPdf ? 'Descargar PDF firmado' : 'Descargar PDF';

  return (
    <div className="portal">
      <div ref={pageRef} className="mx-auto max-w-6xl px-5 sm:px-8 pt-7 pb-14">
        <header data-rise className="flex items-center justify-between gap-4 pb-6 border-b border-[var(--rule)]">
          <a href="/validate" aria-label="Volver al buscador"><img src="/Logo%20Verix.png" alt="VERIX" className="h-9 w-auto" /></a>
          {institutionData && (
            <div className="flex items-center gap-2.5 min-w-0">
              {institutionData.logo_url && (
                <img
                  src={institutionData.logo_url}
                  alt=""
                  className="h-7 w-auto object-contain"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                />
              )}
              <span className="text-sm text-[var(--ink-soft)] truncate">{institutionData.name}</span>
            </div>
          )}
        </header>

        <main className="pt-10">
          {loading && (
            <div role="status" className="py-24 max-w-md">
              <p className="display text-3xl">Consultando el registro…</p>
              <div className="mt-6 h-px w-full bg-[var(--rule)] overflow-hidden">
                <div className="h-full w-1/3 bg-[var(--seal)] animate-[portal-scan_1.1s_ease-in-out_infinite]" />
              </div>
            </div>
          )}

          {error && !loading && (
            <div className="py-16 max-w-xl">
              <h1 className="display text-[clamp(2.2rem,5vw,3.6rem)] tone-revoked">No encontramos ese certificado.</h1>
              <p className="mt-4 text-lg text-[var(--ink-soft)]">
                {error} Revise que el código o el documento esté completo y escrito igual que en el certificado.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <button
                  onClick={() => { if (currentCode) loadCertificate(currentCode); }}
                  className="btn-line"
                >
                  <RefreshCw size={16} /> Intentar de nuevo
                </button>
                <a href="/validate" className="btn-ink no-underline">Buscar con otro dato</a>
              </div>
            </div>
          )}

          {request && !loading && (
            <>
              <section data-rise className="flex flex-col sm:flex-row sm:items-center gap-6 sm:gap-8 pb-10">
                <Seal ref={sealRef} tone={tone} ring={sealRing} size={128} />
                <div className="min-w-0">
                  <h1 className={`display text-[clamp(2.4rem,5.6vw,4.4rem)] tone-${tone}`}>{status.label}</h1>
                  <p className="mt-2 text-lg text-[var(--ink-soft)] max-w-[56ch]">{status.desc}</p>
                </div>
              </section>

              <div className="grid lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] gap-10 lg:gap-14 items-start">
                {/* Ficha */}
                <div data-rise>
                  <dl className="facts">
                    {holderName && (<><dt>Titular</dt><dd className="display !font-medium text-xl">{holderName}</dd></>)}
                    {holderDocument && (<><dt>Documento</dt><dd className="num">{holderDocument}</dd></>)}
                    <dt>Documento expedido</dt><dd>{template?.name || 'Certificado'}</dd>
                    <dt>Radicado</dt><dd className="num">{request.consecutive_number || 'Sin radicado'}</dd>
                    <dt>Código</dt>
                    <dd>
                      <span className="mono">{verificationCode}</span>
                      <button
                        onClick={() => copyToClipboard(verificationCode, 'code')}
                        className="ml-2 inline-flex align-middle p-1 text-[var(--ink-soft)] hover:text-[var(--ink)]"
                        aria-label="Copiar código"
                      >
                        {copiedCode ? <Check size={14} className="tone-valid" /> : <Copy size={14} />}
                      </button>
                    </dd>
                    <dt>Emisión</dt>
                    <dd>{longDate(request.reviewed_at) || formatDateToSpanish(requestData.fecha_aprobacion) || longDate(request.created_at) || '—'}</dd>
                    {reviewerInfo && !isRevoked && (
                      <><dt>Firmado por</dt><dd>{reviewerInfo.signature_name || 'Firmante autorizado'}{reviewerInfo.signature_title ? <span className="block text-sm font-normal text-[var(--ink-soft)]">{reviewerInfo.signature_title}</span> : null}</dd></>
                    )}
                    {isRevoked && (
                      <>
                        <dt>Revocado</dt>
                        <dd className="tone-revoked">
                          {longDate(request.revoked_at) || 'Fecha no registrada'}
                          <span className="block text-sm font-normal">{request.revoke_reason || 'La entidad emisora no indicó un motivo.'}</span>
                        </dd>
                      </>
                    )}
                    {request.status === 'REJECTED' && request.rejection_reason && (
                      <><dt>Motivo del rechazo</dt><dd className="tone-revoked">{request.rejection_reason}</dd></>
                    )}
                    {request.type === 'MASSIVE' && request.batch_id && (
                      <><dt>Lote</dt><dd className="num">#{request.batch_id.substring(0, 8).toUpperCase()} · {request.batch_total} certificados</dd></>
                    )}
                    {extraData.map(([k, v]) => (
                      <Fragment key={k}><dt className="capitalize">{k.replace(/_/g, ' ')}</dt><dd>{String(v)}</dd></Fragment>
                    ))}
                  </dl>
                  <div className="border-t border-[var(--rule)]" />
                </div>

                {/* Documento */}
                <div data-rise className="min-w-0">
                  {isRevoked ? (
                    <div className="border border-[var(--revoked)] bg-[var(--revoked-wash)] p-8">
                      <p className="display text-3xl tone-revoked">Documento no disponible</p>
                      <p className="mt-3 max-w-[48ch]">
                        La entidad emisora revocó este certificado. Ya no se puede ver ni descargar; la ficha conserva el motivo y la fecha.
                      </p>
                    </div>
                  ) : (
                    <>
                      <div ref={deskRef} className="bg-[var(--paper-deep)] p-4 sm:p-7 flex flex-col items-center gap-6 overflow-hidden">
                        {pageNumbers.map((pageNo) => (
                          <div
                            key={pageNo}
                            ref={pageNo === pageNumbers[0] ? certificateRef : undefined}
                            className="paper-sheet relative shrink-0 select-none overflow-hidden"
                            style={{ width: pageWidth * certScale, height: pageHeight * certScale }}
                          >
                            {elements.filter((el: any) => (el.page ?? 0) === pageNo).map((el: any, i: number) => renderElement(el, i))}
                            {elements.length === 0 && (
                              <div className="absolute inset-0 flex items-center justify-center text-neutral-400 text-sm">Sin elementos en la plantilla</div>
                            )}
                          </div>
                        ))}
                      </div>

                      <div className="mt-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                        <p className="text-sm text-[var(--ink-soft)] max-w-[46ch]">
                          {canDownloadPdf
                            ? hasSignedPdf
                              ? 'Es el archivo original con la firma digital de la institución. Cualquier lector de PDF puede comprobarla.'
                              : 'Se genera con los datos registrados y las proporciones de papel Carta de la plantilla.'
                            : 'La descarga se habilita cuando el documento es aprobado.'}
                        </p>
                        {canDownloadPdf ? (
                          <button onClick={handleDownloadPdf} disabled={pdfLoading} className="btn-ink shrink-0">
                            {pdfLoading ? <Loader2 size={18} className="animate-spin" /> : <Download size={18} />}
                            {pdfLoading ? 'Preparando archivo' : downloadLabel}
                          </button>
                        ) : (
                          <span className="inline-flex items-center gap-2 text-sm font-medium tone-neutral"><Clock size={16} /> Descarga no disponible</span>
                        )}
                      </div>
                    </>
                  )}
                </div>
              </div>

              <section data-rise className="mt-16 pt-8 border-t border-[var(--rule)] grid sm:grid-cols-[auto_1fr] gap-8 items-start">
                <div className="bg-white p-3 w-fit paper-sheet">
                  <QRCodeCanvas value={validationUrl} size={116} bgColor="#ffffff" fgColor="#17251d" level="M" />
                </div>
                <div className="max-w-[60ch]">
                  <h2 className="display text-2xl">Compártalo o compruébelo desde otro dispositivo</h2>
                  <p className="mt-2 text-[var(--ink-soft)]">
                    El código QR del documento abre esta misma ficha en el registro de VERIX. Si la información no coincide con la que usted ve aquí, el documento no es auténtico.
                  </p>
                  <button onClick={() => copyToClipboard(validationUrl, 'link')} className="btn-line mt-4">
                    {copiedLink ? <Check size={16} /> : <Copy size={16} />}
                    {copiedLink ? 'Enlace copiado' : 'Copiar enlace'}
                  </button>
                </div>
              </section>
            </>
          )}
        </main>

        <footer className="mt-20 pt-5 border-t border-[var(--rule)] text-sm text-[var(--ink-soft)] flex flex-wrap justify-between gap-x-6 gap-y-1">
          <span><a href="/validate" className="underline underline-offset-4">Nueva consulta</a></span>
          <span>VERIX · desarrollado por Jose Alfredo Gutierrez Contreras · © {new Date().getFullYear()}</span>
        </footer>
      </div>
    </div>
  );
}
