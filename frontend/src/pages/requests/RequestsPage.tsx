import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { auditApi, getClientIP } from '../../services/api';
import { Plus, Search, MoreHorizontal, CheckCircle, XCircle, X, Eye, Download, ChevronDown, ChevronRight, Package, FileText, Loader2 } from 'lucide-react';
import { format } from 'date-fns';
import toast from 'react-hot-toast';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { CertificatePreview, renderTemplateToPdf, fillTemplate, convertDatesInData, safeJsonParse } from '../../components/certificate/CertificatePreview';
import type { TemplateElement } from '../../components/editor/TemplateCanvas';
import { SkeletonCard } from '../../components/ui/SkeletonCard';

const statusConfig: Record<string, { label: string; color: string; bg: string; borderColor: string }> = {
  DRAFT: { label: 'Borrador', color: 'text-on-surface-variant', bg: 'bg-surface-variant', borderColor: 'border-surface-variant' },
  PENDING: { label: 'Pendiente', color: 'text-secondary', bg: 'bg-secondary-fixed', borderColor: 'border-secondary' },
  IN_REVIEW: { label: 'En revisión', color: 'text-tertiary', bg: 'bg-tertiary-fixed', borderColor: 'border-tertiary' },
  APPROVED: { label: 'Aprobado', color: 'text-primary', bg: 'bg-primary/10', borderColor: 'border-primary' },
  REJECTED: { label: 'Rechazado', color: 'text-error', bg: 'bg-error-container', borderColor: 'border-error' },
  SIGNED: { label: 'Firmado', color: 'text-primary', bg: 'bg-primary-fixed', borderColor: 'border-primary' },
  REVOKED: { label: 'Revocado', color: 'text-on-surface-variant', bg: 'bg-surface-variant', borderColor: 'border-surface-variant' },
};

export function RequestsPage() {
  const { user } = useAuth();
  const [requests, setRequests] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [selected, setSelected] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [previewRequestId, setPreviewRequestId] = useState<string | null>(null);
  const [batchSigning, setBatchSigning] = useState(false);
  const [signingBatchId, setSigningBatchId] = useState<string | null>(null);
  const [showBatchModal, setShowBatchModal] = useState(false);
  const [batchRequests, setBatchRequests] = useState<any[]>([]);
  const [signingRequestIds, setSigningRequestIds] = useState<string[]>([]);
  const [selectedRequestIds, setSelectedRequestIds] = useState<string[]>([]);
  const [batchSelectedSignatureId, setBatchSelectedSignatureId] = useState<string | null>(null);
  const [batchSignatures, setBatchSignatures] = useState<any[]>([]);
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState({ current: 0, total: 0 });
  const [expandedBatches, setExpandedBatches] = useState<Set<string>>(new Set());

  // ── Pagination ──
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const pageSize = 20;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  // ── Debounced search ──
  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      setDebouncedSearch(searchInput);
      setPage(1);
    }, 400);
    return () => { if (searchTimerRef.current) clearTimeout(searchTimerRef.current); };
  }, [searchInput]);

  useEffect(() => { loadRequests(); }, [user, statusFilter, page, debouncedSearch]);

  const loadRequests = async () => {
    setLoading(true);
    try {
      // Build the base query
      let query = supabase
        .from('certificate_requests')
        .select('*, user:users!certificate_requests_user_id_fkey(first_name, last_name, email), template:templates(name)', { count: 'exact' });

      // Role-based filters
      if (user?.role === 'APPLICANT') query = query.eq('user_id', user.id);
      if (user?.role === 'SIGNER') query = query.in('status', ['PENDING', 'IN_REVIEW', 'APPROVED']);

      // Status filter
      if (statusFilter) query = query.eq('status', statusFilter);

      // Server-side search via .or()
      if (debouncedSearch) {
        const searchTerm = debouncedSearch.trim();
        query = query.or(
          `code.ilike.%${searchTerm}%,user.first_name.ilike.%${searchTerm}%,user.last_name.ilike.%${searchTerm}%,template.name.ilike.%${searchTerm}%`
        );
      }

      // Pagination
      const from = (page - 1) * pageSize;
      const to = from + pageSize - 1;

      const { data, error, count } = await query
        .order('created_at', { ascending: false })
        .range(from, to);

      if (error) {
        console.error('❌ Error al cargar solicitudes:', error);
        toast.error('Error al cargar las solicitudes');
        setRequests([]);
        return;
      }

      console.log('📋 Solicitudes cargadas:', data?.length || 0, 'Total:', count || 0);
      setRequests(data || []);
      if (count !== null) setTotalCount(count);
    } catch (err) {
      console.error('❌ Error al cargar solicitudes:', err);
      toast.error('Error al cargar las solicitudes');
      setRequests([]);
    } finally {
      setLoading(false);
    }
  };

  const loadBatchSignatures = async () => {
    if (!user?.institution_id) return;
    try {
      const { data, error } = await supabase
        .from('authorized_signatures')
        .select('id, full_name, title, signature_image_url, is_primary')
        .eq('institution_id', user.institution_id)
        .eq('is_active', true)
        .order('is_primary', { ascending: false })
        .order('full_name');

      if (error) throw error;
      const signatures = data || [];
      setBatchSignatures(signatures);
      setBatchSelectedSignatureId(signatures.find((sig: any) => sig.is_primary)?.id || signatures[0]?.id || null);
    } catch (err) {
      console.error('❌ Error al cargar firmas autorizadas:', err);
    }
  };

  useEffect(() => {
    if (!user?.institution_id) return;
    loadBatchSignatures();
  }, [user?.institution_id]);

  const openBatchModal = (batchId: string) => {
    const requestsInBatch = requests.filter(req => req.batch_id === batchId);
    setBatchRequests(requestsInBatch);
    setSigningBatchId(batchId);
    setSigningRequestIds(requestsInBatch.map(req => req.id));
    setShowBatchModal(true);
    setBatchSelectedSignatureId(batchSignatures.find((sig: any) => sig.is_primary)?.id || batchSignatures[0]?.id || null);
  };

  const openSelectedRequestsModal = (requestIds: string[]) => {
    const requestsInBatch = requests.filter(req => requestIds.includes(req.id));
    setBatchRequests(requestsInBatch);
    setSigningBatchId(null);
    setSigningRequestIds(requestIds);
    setShowBatchModal(true);
    setBatchSelectedSignatureId(batchSignatures.find((sig: any) => sig.is_primary)?.id || batchSignatures[0]?.id || null);
  };

  const toggleRequestSelection = (id: string) => {
    setSelectedRequestIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id],
    );
  };

  const handleApproveBatch = async () => {
    if (!signingBatchId && signingRequestIds.length === 0) return;

    if (batchSignatures.length > 0 && !batchSelectedSignatureId) {
      toast.error('Selecciona una firma autorizada');
      return;
    }

    setBatchSigning(true);
    try {
      const updateData: any = {
        status: 'APPROVED',
        reviewed_by: user?.id,
        reviewed_at: new Date().toISOString(),
      };

      if (batchSelectedSignatureId) {
        const selectedSig = batchSignatures.find((sig: any) => sig.id === batchSelectedSignatureId);
        if (selectedSig) {
          updateData.reviewer_notes = JSON.stringify({
            signature_id: selectedSig.id,
            signature_name: selectedSig.full_name,
            signature_title: selectedSig.title,
            signature_url: selectedSig.signature_image_url,
          });
        }
      }

      const query = supabase.from('certificate_requests').update(updateData);
      if (signingRequestIds.length > 0) {
        query.in('id', signingRequestIds);
      } else if (signingBatchId) {
        query.eq('batch_id', signingBatchId);
      }

      const { error } = await query.in('status', ['PENDING', 'IN_REVIEW']);

      if (error) throw error;

      // ── Audit log: firma de lote ──
      try {
        const ip = await getClientIP();
        const auditSigName = batchSelectedSignatureId
          ? batchSignatures.find((s: any) => s.id === batchSelectedSignatureId)?.full_name || 'Desconocido'
          : 'Sin firma';
        await auditApi.log({
          user_id: user?.id,
          user_email: user?.email,
          module: 'signatures',
          action: 'batch_sign',
          entity_id: signingBatchId || signingRequestIds.join(','),
          entity_type: 'certificate_request_batch',
          ip_address: ip,
          description: `Firma masiva de ${signingRequestIds.length} solicitudes - Firma: ${auditSigName}`,
        });
      } catch { /* silent */ }

      toast.success('Lote firmado exitosamente');
      setShowBatchModal(false);
      setSigningBatchId(null);
      setSigningRequestIds([]);
      setBatchRequests([]);
      loadRequests();
    } catch (err: any) {
      toast.error(err.message || 'Error al firmar el lote');
      console.error('❌ Batch sign error:', err);
    } finally {
      setBatchSigning(false);
    }
  };

  const downloadSelectedCertificates = async () => {
    const eligibleRequests = requests.filter((req) => req.certificate_url && ['APPROVED', 'SIGNED'].includes(req.status));
    const selectedDownloadIds = selectedRequestIds.filter((id) => eligibleRequests.some((req) => req.id === id));
    const idsToDownload = selectedDownloadIds.length > 0 ? selectedDownloadIds : eligibleRequests.map((req) => req.id);
    const selectedRequests = eligibleRequests.filter((req) => idsToDownload.includes(req.id));

    if (selectedRequests.length === 0) {
      toast.error('No hay documentos disponibles para descarga');
      return;
    }

    setDownloading(true);
    setDownloadProgress({ current: 0, total: selectedRequests.length });

    try {
      for (let i = 0; i < selectedRequests.length; i++) {
        const request = selectedRequests[i];
        const url = request.certificate_url;
        if (!url) continue;

        const response = await fetch(url);
        if (!response.ok) {
          console.error('Error descargando:', url, response.status);
          continue;
        }

        const blob = await response.blob();
        const link = document.createElement('a');
        const objectUrl = URL.createObjectURL(blob);
        link.href = objectUrl;
        link.download = `${request.code || 'certificado'}-${i + 1}.pdf`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(objectUrl);

        setDownloadProgress({ current: i + 1, total: selectedRequests.length });
      }

      toast.success('Descarga masiva iniciada');
      setSelectedRequestIds([]);
    } catch (err: any) {
      console.error('❌ Error al descargar archivos:', err);
      toast.error('Error al descargar archivos');
    } finally {
      setDownloading(false);
    }
  };

  const handleReject = async (id: string) => {
    if (!rejectReason) { toast.error('Debes indicar un motivo'); return; }
    try {
      const { error } = await supabase
        .from('certificate_requests')
        .update({ status: 'REJECTED', reviewed_by: user?.id, reviewed_at: new Date().toISOString(), rejection_reason: rejectReason })
        .eq('id', id);
      if (error) throw error;
      toast.success('Solicitud rechazada');
      setSelected(null);
      setRejectReason('');
      loadRequests();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const getStudentName = (req: any) => {
    return req.data?.nombre_estudiante || req.data?.nombre || `${req.user?.first_name || ''} ${req.user?.last_name || ''}`.trim() || '—';
  };

  const getStudentDocument = (req: any) => {
    return req.data?.documento_estudiante || req.data?.document_id || req.data?.documento || req.user?.document_id || '—';
  };

  // Search is now server-side via debouncedSearch → no client-side filtering needed
  const filtered = requests;

  const eligibleDownloadRequests = requests.filter(req =>
    req.certificate_url && ['APPROVED', 'SIGNED'].includes(req.status),
  );

  // Inline pagination with fewer buttons on mobile
  const getPageNumbers = () => {
    const pages: (number | 'ellipsis')[] = [];
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else if (page <= 4) {
      for (let i = 1; i <= 5; i++) pages.push(i);
      pages.push('ellipsis');
      pages.push(totalPages);
    } else if (page >= totalPages - 3) {
      pages.push(1);
      pages.push('ellipsis');
      for (let i = totalPages - 4; i <= totalPages; i++) pages.push(i);
    } else {
      pages.push(1);
      pages.push('ellipsis');
      pages.push(page - 1);
      pages.push(page);
      pages.push(page + 1);
      pages.push('ellipsis');
      pages.push(totalPages);
    }
    return pages;
  };

  const selectedDownloadableCount = selectedRequestIds.length > 0
    ? requests.filter(req => selectedRequestIds.includes(req.id) && req.certificate_url && ['APPROVED', 'SIGNED'].includes(req.status)).length
    : 0;

  const isSelectableForApplicant = (req: any) => {
    return Boolean(req.certificate_url && ['APPROVED', 'SIGNED'].includes(req.status));
  };

  const canSelectRequest = (req: any) => {
    if (user?.role === 'SIGNER' || user?.role === 'ADMIN') {
      return req.status === 'PENDING';
    }
    if (user?.role === 'APPLICANT') {
      return isSelectableForApplicant(req);
    }
    return false;
  };

  const isRequestDownloadable = (req: any) => {
    return Boolean(req.certificate_url && ['APPROVED', 'SIGNED'].includes(req.status));
  };

  // ── Batch grouping ──
  const groupBatches = useCallback((items: any[]) => {
    const individualReqs: any[] = [];
    const batchMap = new Map<string, any[]>();

    for (const req of items) {
      if (req.batch_id) {
        const existing = batchMap.get(req.batch_id) || [];
        existing.push(req);
        batchMap.set(req.batch_id, existing);
      } else {
        individualReqs.push(req);
      }
    }

    return { individualReqs, batchMap };
  }, []);

  const toggleBatchExpand = (batchId: string) => {
    setExpandedBatches(prev => {
      const next = new Set(prev);
      if (next.has(batchId)) {
        next.delete(batchId);
      } else {
        next.add(batchId);
      }
      return next;
    });
  };

  // ── Download batch as ZIP — generates PDFs on-the-fly for ALL requests ──
  const downloadBatchAsZip = async (batchId: string, batchReqs: any[]) => {
    if (batchReqs.length === 0) {
      toast.error('No hay solicitudes en este lote');
      return;
    }

    setDownloading(true);
    setDownloadProgress({ current: 0, total: batchReqs.length });

    try {
      const zip = new JSZip();
      const folder = zip.folder(`lote-${batchId.substring(0, 8).toLowerCase()}`);
      if (!folder) {
        toast.error('Error al crear el archivo ZIP');
        return;
      }

      // Pre-fetch unique template configs to avoid N+1 queries
      const templateIds = [...new Set(batchReqs.map(r => r.template_id).filter(Boolean))];
      let templateCache: Map<string, any> = new Map();

      if (templateIds.length > 0) {
        const { data: templates } = await supabase
          .from('templates')
          .select('id, config')
          .in('id', templateIds);

        if (templates) {
          for (const t of templates) {
            const rawConfig = t.config?.elements
              ? t.config
              : t.config?.config
                ? (typeof t.config.config === 'string' ? safeJsonParse(t.config.config) : t.config.config)
                : typeof t.config === 'string' ? safeJsonParse(t.config) : (t.config || {});
            templateCache.set(t.id, rawConfig);
          }
        }
      }

      let successCount = 0;

      for (let i = 0; i < batchReqs.length; i++) {
        const req = batchReqs[i];
        const fileName = `${req.code || 'certificado'}-${String(i + 1).padStart(3, '0')}.pdf`;

        try {
          // Case 1: existing certificate URL — download the pre-generated PDF
          if (req.certificate_url) {
            const response = await fetch(req.certificate_url);
            if (response.ok) {
              const blob = await response.blob();
              folder.file(fileName, blob);
              successCount++;
              setDownloadProgress({ current: i + 1, total: batchReqs.length });
              continue;
            }
            console.warn(`⚠️ Error descargando PDF existente para ${req.code}, generando uno nuevo...`);
          }

          // Case 2: no existing URL or download failed — generate PDF on-the-fly
          const templateConfig = templateCache.get(req.template_id);
          if (!templateConfig) {
            console.warn(`⚠️ No se encontró plantilla para ${req.code}, saltando...`);
            setDownloadProgress({ current: i + 1, total: batchReqs.length });
            continue;
          }

          const elements: TemplateElement[] = templateConfig.elements || [];
          const pageOrientation = templateConfig.orientation || 'landscape';
          const pageWidth = pageOrientation === 'landscape' ? 842 : 595;
          const pageHeight = pageOrientation === 'landscape' ? 595 : 842;

          const rawData = req.data || {};
          const reqCode = req.code || '';
          const verificationCode = req.verification_code || reqCode;
          const validationUrl = `${window.location.origin}/validate/${verificationCode}`;

          const requestData = {
            ...convertDatesInData(rawData),
            codigo: verificationCode,
            codigo_certificado: verificationCode,
            codigo_solicitud: reqCode,
            id_solicitud: reqCode,
            codigo_verificacion: verificationCode,
            qr_content: validationUrl,
            ...(req.batch_id ? {
              lote_id: req.batch_id,
              lote_total: String(req.batch_total || ''),
              lote_indice: String((req.row_index ?? -1) + 1),
            } : {}),
          };

          const pdf = await renderTemplateToPdf(
            elements,
            pageOrientation,
            pageWidth,
            pageHeight,
            requestData,
            null, // no signature for pending certificates
          );

          const pdfBlob = pdf.output('blob');
          folder.file(fileName, pdfBlob);
          successCount++;
        } catch (err) {
          console.warn(`⚠️ Error generando PDF para ${req.code}:`, err);
        }

        setDownloadProgress({ current: i + 1, total: batchReqs.length });
      }

      if (successCount === 0) {
        toast.error('No se pudo generar ningún PDF del lote');
        setDownloading(false);
        return;
      }

      const zipBlob = await zip.generateAsync({ type: 'blob' });
      const batchCode = batchReqs[0]?.code?.substring(0, 10) || batchId.substring(0, 8);
      saveAs(zipBlob, `certificados-lote-${batchCode}.zip`);

      const skipped = batchReqs.length - successCount;
      const msg = skipped > 0
        ? `✅ Lote descargado (${successCount} certificados, ${skipped} omitidos)`
        : `✅ Lote descargado (${successCount} certificados)`;
      toast.success(msg);
    } catch (err: any) {
      console.error('❌ Error al generar ZIP:', err);
      toast.error('Error al descargar el lote');
    } finally {
      setDownloading(false);
    }
  };

  return (      <div className="max-w-screen-2xl mx-auto px-4 md:px-6 xl:px-8 space-y-6 animate-fade-in min-h-screen pb-24 md:pb-12">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-primary/10 rounded-2xl flex items-center justify-center shrink-0">
            <svg className="w-5 h-5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
          </div>
          <div className="min-w-0">
            <h1 className="text-headline-lg-mobile md:text-headline-lg font-headline-lg text-on-surface">Solicitudes</h1>
            <p className="text-body-sm md:text-body-md text-on-surface-variant truncate">
              {user?.role === 'APPLICANT' ? 'Mis solicitudes de certificados' : 'Gestiona las solicitudes de emisión'}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[120px] max-w-[200px]">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant/50" />
            <input type="text" placeholder="Buscar..." className="input pl-9 pr-2 w-full text-sm h-10"
              value={searchInput} onChange={e => setSearchInput(e.target.value)} />
          </div>
          <select className="input w-auto min-w-[100px] text-sm h-10" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            <option value="">Todos</option>
            {Object.entries(statusConfig).map(([k, v]) => (
              <option key={k} value={k}>{v.label}</option>
            ))}
          </select>
          {(user?.role === 'SIGNER' || user?.role === 'ADMIN') && selectedRequestIds.length > 0 && (
            <button
              onClick={() => openSelectedRequestsModal(selectedRequestIds)}
              className="btn-secondary btn-sm text-xs h-10"
            >
              Firmar ({selectedRequestIds.length})
            </button>
          )}
          {user?.role === 'APPLICANT' && (
            <>
              <button
                onClick={downloadSelectedCertificates}
                disabled={downloading || (selectedRequestIds.length === 0 ? eligibleDownloadRequests.length === 0 : selectedDownloadableCount === 0)}
                className="btn-secondary btn-sm text-xs h-10"
              >
                {downloading
                  ? `Descargando (${downloadProgress.current}/${downloadProgress.total})`
                  : `Descargar (${selectedRequestIds.length > 0 ? selectedDownloadableCount : eligibleDownloadRequests.length})`}
              </button>
              <Link to="/requests/new" className="btn-primary btn-sm h-10">
                <Plus size={16} /> Nueva
              </Link>
            </>
          )}
        </div>
      </div>

      {/* Request list with batch grouping */}
      <div className="space-y-3">
        {loading ? (
          <SkeletonCard variant="card-sm" count={4} />
        ) : filtered.length === 0 ? (
          <div className="glass-card p-12 rounded-2xl text-center">
            <p className="text-body-lg text-on-surface-variant">No hay solicitudes</p>
            <p className="text-body-md text-on-surface-variant/60 mt-1">Las solicitudes aparecerán aquí</p>
          </div>
        ) : (() => {
          const { individualReqs, batchMap } = groupBatches(filtered);
          const allItems: any[] = [];

          // Add individual (non-batch) requests first
          for (const req of individualReqs) {
            allItems.push({ type: 'individual', req });
          }

          // Add batch groups
          for (const [batchId, batchReqs] of batchMap) {
            allItems.push({ type: 'batch', batchId, batchReqs });
          }

          return allItems.map((item: any) => {
            if (item.type === 'individual') {
              const req = item.req;
              const status = statusConfig[req.status] || { label: req.status, color: '', bg: '', borderColor: '' };
              return (
                <div key={req.id} className={`glass-card p-5 rounded-2xl flex flex-col md:flex-row md:items-center gap-4 hover:shadow-md transition-all group border-l-4 ${status.borderColor}`}>
                  <div className="flex-1 grid grid-cols-1 md:grid-cols-5 gap-3">
                    <div className="flex flex-col gap-2">
                      {canSelectRequest(req) ? (
                        <div className="flex items-center gap-2 text-sm text-on-surface">
                          <input
                            type="checkbox"
                            className="h-5 w-5 rounded border-outline-variant text-primary focus:ring-primary"
                            checked={selectedRequestIds.includes(req.id)}
                            onChange={() => toggleRequestSelection(req.id)}
                          />
                          <span className="font-medium">Seleccionar</span>
                        </div>
                      ) : null}
                      <div>
                        <span className="text-[11px] uppercase tracking-wider text-on-surface-variant/60 font-bold">ID Solicitud</span>
                        <p className="font-mono text-sm font-semibold text-primary mt-0.5">{req.code}</p>
                      </div>
                    </div>
                    <div>
                      <span className="text-[11px] uppercase tracking-wider text-on-surface-variant/60 font-bold">Estudiante</span>
                      <p className="font-semibold text-sm mt-0.5">{getStudentName(req)}</p>
                    </div>
                    <div>
                      <span className="text-[11px] uppercase tracking-wider text-on-surface-variant/60 font-bold">Documento</span>
                      <p className="text-sm text-on-surface-variant truncate mt-0.5">{getStudentDocument(req)}</p>
                    </div>
                    <div>
                      <span className="text-[11px] uppercase tracking-wider text-on-surface-variant/60 font-bold">Plantilla</span>
                      <p className="text-sm text-on-surface-variant truncate mt-0.5">{req.template?.name || '—'}</p>
                    </div>
                    <div className="hidden md:block">
                      <span className="text-[11px] uppercase tracking-wider text-on-surface-variant/60 font-bold">Fecha</span>
                      <p className="text-sm text-on-surface-variant mt-0.5">
                        {format(new Date(req.created_at), 'dd/MM/yyyy HH:mm')}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center justify-between md:justify-end gap-4 border-t md:border-t-0 pt-4 md:pt-0 border-outline-variant/20">
                    <span className={`px-3 py-1.5 rounded-full text-xs font-bold flex items-center gap-1.5 ${status.color} ${status.bg}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${status.color.replace('text-', 'bg-')}`} />
                      {status.label}
                    </span>
                    <div className="flex items-center gap-1">
                      {(user?.role === 'SIGNER' || user?.role === 'ADMIN') && req.status === 'PENDING' && (
                        <>
                          <button onClick={() => setPreviewRequestId(req.id)}
                            className="p-2 hover:bg-primary/10 rounded-full text-primary transition-colors" title="Vista previa">
                            <Eye size={18} />
                          </button>
                          <button onClick={() => setSelected(selected === req.id ? null : req.id)}
                            className="p-2 hover:bg-error/10 rounded-full text-error transition-colors" title="Rechazar">
                            <XCircle size={18} />
                          </button>
                        </>
                      )}
                      {(req.status === 'APPROVED' || req.status === 'SIGNED') && (
                        <button
                          onClick={() => setPreviewRequestId(req.id)}
                          className="p-2 hover:bg-primary/10 rounded-full text-primary transition-colors"
                          title="Ver certificado"
                        >
                          <Download size={18} />
                        </button>
                      )}
                      <button className="p-2 hover:bg-surface-container-high rounded-full text-on-surface-variant transition-colors">
                        <MoreHorizontal size={18} />
                      </button>
                    </div>
                  </div>

                  {/* Reject modal */}
                  {selected === req.id && (
                    <div className="absolute mt-2 right-0 top-full z-10 bg-white rounded-2xl shadow-xl border border-outline-variant/30 p-5 w-72 animate-scale-in">
                      <p className="text-sm font-bold text-on-surface mb-2">Motivo de rechazo</p>
                      <textarea className="input mb-3" rows={3} value={rejectReason}
                        onChange={e => setRejectReason(e.target.value)} placeholder="Indica el motivo..." />
                      <div className="flex gap-2">
                        <button onClick={() => handleReject(req.id)} className="btn-danger btn-sm flex-1">Rechazar</button>
                        <button onClick={() => { setSelected(null); setRejectReason(''); }} className="btn-secondary btn-sm">Cancelar</button>
                      </div>
                    </div>
                  )}
                </div>
              );
            }

            // ── Batch group card ──
            const { batchId, batchReqs } = item;
            const isExpanded = expandedBatches.has(batchId);
            const approvedCount = batchReqs.filter((r: any) => ['APPROVED', 'SIGNED'].includes(r.status)).length;
            const pendingCount = batchReqs.filter((r: any) => r.status === 'PENDING').length;
            const firstReq = batchReqs[0];
            const batchCode = firstReq?.code?.substring(0, 10) || batchId.substring(0, 8);
            const eligibleDownload = batchReqs.filter((r: any) => r.certificate_url && ['APPROVED', 'SIGNED'].includes(r.status));

            return (
              <div key={batchId} className="glass-card rounded-2xl overflow-hidden border border-primary/10 hover:shadow-md transition-all">
                {/* Batch header - always visible */}
                <button
                  onClick={() => toggleBatchExpand(batchId)}
                  className="w-full flex items-center gap-4 p-5 text-left hover:bg-surface-container-low/50 transition-colors"
                >
                  <div className="w-10 h-10 rounded-xl bg-secondary/10 flex items-center justify-center shrink-0">
                    <Package size={20} className="text-secondary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-sm text-on-surface">Lote {batchCode}</span>
                      <span className="px-2 py-0.5 bg-secondary/10 text-secondary text-[10px] font-bold rounded-full">
                        {batchReqs.length} solicitudes
                      </span>
                    </div>
                    <p className="text-xs text-on-surface-variant/70 mt-0.5">
                      Creado {format(new Date(firstReq.created_at), 'dd/MM/yyyy')}
                      {firstReq.template?.name && ` · ${firstReq.template.name}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    {pendingCount > 0 && (
                      <span className="text-xs text-secondary font-semibold">{pendingCount} pendientes</span>
                    )}
                    {approvedCount > 0 && (
                      <span className="text-xs text-primary font-semibold">{approvedCount} aprobados</span>
                    )}
                    {isExpanded ? (
                      <ChevronDown size={20} className="text-on-surface-variant/60 shrink-0" />
                    ) : (
                      <ChevronRight size={20} className="text-on-surface-variant/60 shrink-0" />
                    )}
                  </div>
                </button>

                {/* Batch actions bar */}
                <div className="flex items-center gap-2 px-5 pb-3">
                  {/* Sign batch (for signers/admins with pending items) */}
                  {(user?.role === 'SIGNER' || user?.role === 'ADMIN') && pendingCount > 0 && (
                    <>
                      <button
                        onClick={(e) => { e.stopPropagation(); openBatchModal(batchId); }}
                        className="btn-secondary btn-xs px-3 py-1.5 text-xs"
                      >
                        <CheckCircle size={14} /> Firmar lote
                      </button>
                      {batchReqs.filter((r: any) => r.status === 'PENDING').slice(0, 3).map((r: any) => (
                        <button
                          key={r.id}
                          onClick={(e) => { e.stopPropagation(); setPreviewRequestId(r.id); }}
                          className="p-1.5 hover:bg-primary/10 rounded-full text-primary transition-colors"
                          title={`Vista previa: ${r.code}`}
                        >
                          <Eye size={16} />
                        </button>
                      ))}
                    </>
                  )}

                  {/* Download batch ZIP — always visible */}
                  <button
                    onClick={(e) => { e.stopPropagation(); downloadBatchAsZip(batchId, batchReqs); }}
                    disabled={downloading}
                    className="btn-secondary btn-xs px-3 py-1.5 text-xs"
                  >
                    {downloading ? (
                      <><Loader2 size={14} className="animate-spin" /> {downloadProgress.current}/{downloadProgress.total}</>
                    ) : (
                      <><Download size={14} /> Descargar lote ({batchReqs.length})</>
                    )}
                  </button>
                </div>

                {/* Expanded children */}
                {isExpanded && (
                  <div className="border-t border-outline-variant/10 divide-y divide-outline-variant/5 animate-fade-in">
                    {batchReqs.map((req: any) => {
                      const status = statusConfig[req.status] || { label: req.status, color: '', bg: '', borderColor: '' };
                      return (
                        <div
                          key={req.id}
                          className={`flex items-center gap-3 px-5 py-3 hover:bg-surface-container-low/50 transition-colors border-l-4 ${status.borderColor}`}
                        >
                          <div className="flex-1 grid grid-cols-1 md:grid-cols-4 gap-2 text-sm">
                            <div>
                              <span className="text-[10px] uppercase tracking-wider text-on-surface-variant/50 font-bold block">Código</span>
                              <span className="font-mono text-xs font-semibold text-primary">{req.code}</span>
                            </div>
                            <div>
                              <span className="text-[10px] uppercase tracking-wider text-on-surface-variant/50 font-bold block">Estudiante</span>
                              <span className="text-xs text-on-surface">{getStudentName(req)}</span>
                            </div>
                            <div>
                              <span className="text-[10px] uppercase tracking-wider text-on-surface-variant/50 font-bold block">Documento</span>
                              <span className="text-xs text-on-surface-variant">{getStudentDocument(req)}</span>
                            </div>
                            <div className="flex items-center justify-between gap-2">
                              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${status.color} ${status.bg}`}>
                                {status.label}
                              </span>
                              <div className="flex items-center gap-1">
                                {(req.status === 'APPROVED' || req.status === 'SIGNED') && (
                                  <button
                                    onClick={(e) => { e.stopPropagation(); setPreviewRequestId(req.id); }}
                                    className="p-1.5 hover:bg-primary/10 rounded-full text-primary transition-colors"
                                    title="Ver certificado"
                                  >
                                    <Eye size={15} />
                                  </button>
                                )}
                                {user?.role === 'APPLICANT' && isRequestDownloadable(req) && (
                                  <a
                                    href={req.certificate_url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="p-1.5 hover:bg-primary/10 rounded-full text-primary transition-colors"
                                    title="Descargar"
                                    onClick={e => e.stopPropagation()}
                                  >
                                    <Download size={15} />
                                  </a>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          });
        })()}
      </div>

      {/* Pagination - simplified on mobile */}
      {!loading && totalCount > pageSize && (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-2 pt-2 pb-4">
          <p className="text-xs sm:text-sm text-on-surface-variant/70 order-2 sm:order-1">
            <span className="hidden sm:inline">{(page - 1) * pageSize + 1}–{Math.min(page * pageSize, totalCount)} de {totalCount} resultados</span>
            <span className="sm:hidden">Pág {page}/{totalPages}</span>
          </p>
          <div className="flex items-center gap-1 order-1 sm:order-2">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              className="px-3 py-2 sm:py-1.5 text-xs font-semibold rounded-lg transition-all disabled:opacity-30 disabled:cursor-not-allowed hover:bg-surface-container-high text-on-surface-variant min-h-[44px]"
            >
              ← Anterior
            </button>

            {/* Page numbers - simplified on mobile */}
            <div className="hidden sm:flex items-center gap-1">
              {getPageNumbers().map((p, i) =>
                p === 'ellipsis' ? (
                  <span key={`e-${i}`} className="w-8 h-8 flex items-center justify-center text-xs text-on-surface-variant/40">…</span>
                ) : (
                  <button
                    key={p}
                    onClick={() => setPage(p)}
                    className={`w-8 h-8 text-xs font-bold rounded-lg transition-all ${
                      p === page
                        ? 'bg-primary text-on-primary shadow-sm'
                        : 'text-on-surface-variant hover:bg-surface-container-high'
                    }`}
                  >
                    {p}
                  </button>
                )
              )}
            </div>

            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="px-3 py-2 sm:py-1.5 text-xs font-semibold rounded-lg transition-all disabled:opacity-30 disabled:cursor-not-allowed hover:bg-surface-container-high text-on-surface-variant min-h-[44px]"
            >
              Siguiente →
            </button>
          </div>
        </div>
      )}

      {/* Preview modal */}
      {previewRequestId && user && (
        <CertificatePreview
          requestId={previewRequestId}
          userId={user.id}
          userRole={user.role}
          userInstitutionId={user.institution_id}
          onClose={() => setPreviewRequestId(null)}
          onApproved={() => loadRequests()}
        />
      )}

      {showBatchModal && (
        <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/50 backdrop-blur-sm p-0 md:p-4 animate-fade-in">
          <div className="bg-white rounded-t-3xl md:rounded-3xl shadow-2xl w-full md:max-w-2xl max-h-[95vh] md:max-h-[90vh] overflow-hidden animate-slide-up md:animate-scale-in">
            <div className="flex items-center justify-between px-6 py-4 border-b border-outline-variant/20">
              <div>
                <h2 className="text-lg font-bold text-on-surface">Firmar lote</h2>
                <p className="text-sm text-on-surface-variant">Revisa las solicitudes agrupadas y selecciona la firma autorizada.</p>
              </div>
              <button onClick={() => setShowBatchModal(false)} className="p-2 rounded-xl text-on-surface-variant hover:bg-surface-container-high">
                <X size={20} />
              </button>
            </div>
            <div className="p-6 space-y-6 overflow-y-auto max-h-[70vh]">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-surface-container-low rounded-2xl p-4">
                  <h3 className="text-sm font-semibold text-on-surface mb-3">Lote</h3>
                  <p className="text-sm text-on-surface-variant">ID de lote</p>
                  <p className="font-mono text-sm text-primary mt-1">{signingBatchId}</p>
                  <p className="text-sm text-on-surface-variant mt-3">Cantidad de solicitudes</p>
                  <p className="font-semibold text-on-surface mt-1">{batchRequests.length}</p>
                </div>
                <div className="bg-surface-container-low rounded-2xl p-4">
                  <h3 className="text-sm font-semibold text-on-surface mb-3">Solicitudes en el lote</h3>
                  <ul className="space-y-2 text-sm">
                    {batchRequests.slice(0, 6).map((req) => (
                      <li key={req.id} className="flex items-center justify-between gap-3">
                        <span className="font-medium truncate">{req.code}</span>
                        <span className="text-on-surface-variant text-xs">{req.template?.name || 'Sin plantilla'}</span>
                      </li>
                    ))}
                    {batchRequests.length > 6 && (
                      <li className="text-xs text-on-surface-variant">+{batchRequests.length - 6} más</li>
                    )}
                  </ul>
                </div>
              </div>

              <div className="glass-card p-5 rounded-2xl border border-white/40">
                <h3 className="text-sm font-semibold text-on-surface mb-3">Firma autorizada</h3>
                {batchSignatures.length === 0 ? (
                  <p className="text-sm text-on-surface-variant">No se encontraron firmas autorizadas para tu institución.</p>
                ) : (
                  <div className="grid grid-cols-1 gap-3">
                    {batchSignatures.map((sig) => (
                      <button
                        key={sig.id}
                        onClick={() => setBatchSelectedSignatureId(sig.id)}
                        className={`flex items-center justify-between gap-3 p-3 rounded-xl border transition-all text-left ${
                          batchSelectedSignatureId === sig.id
                            ? 'border-primary bg-primary/5'
                            : 'border-outline-variant/30 hover:border-primary/30 hover:bg-surface-container-low'
                        }`}
                      >
                        <div>
                          <p className="font-semibold text-sm text-on-surface">{sig.full_name}</p>
                          <p className="text-xs text-on-surface-variant mt-1">{sig.title}</p>
                        </div>
                        {batchSelectedSignatureId === sig.id && (
                          <CheckCircle size={18} className="text-primary" />
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-outline-variant/20">
              <button onClick={() => setShowBatchModal(false)} className="btn-secondary px-6 py-3">Cancelar</button>
              <button onClick={handleApproveBatch} disabled={batchSigning || batchSignatures.length > 0 && !batchSelectedSignatureId} className="btn-primary px-6 py-3">
                {batchSigning ? 'Firmando lote...' : 'Firmar lote'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
