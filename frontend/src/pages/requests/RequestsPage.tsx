import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { auditApi, getClientIP } from '../../services/api';
import { Plus, Search, MoreHorizontal, CheckCircle, XCircle, X, Eye, Download, ChevronDown, ChevronRight, Package, FileText, Loader2, Edit, Trash2, AlertTriangle, AlertCircle, Upload, Table, RefreshCw, Database } from 'lucide-react';
import { format } from 'date-fns';
import toast from 'react-hot-toast';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import * as XLSX from 'xlsx';
import { CertificatePreview, renderTemplateToPdf, fillTemplate, convertDatesInData, safeJsonParse } from '../../components/certificate/CertificatePreview';
import type { TemplateElement } from '../../components/editor/TemplateCanvas';
import { getPageDimensions, type PageSizeName } from '../../lib/pageSizes';
import { SkeletonCard } from '../../components/ui/SkeletonCard';

const EDITABLE_STATUSES = ['DRAFT', 'PENDING', 'IN_REVIEW', 'REJECTED'];

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
  const navigate = useNavigate();
  const [requests, setRequests] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [selected, setSelected] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [revokeSelectedId, setRevokeSelectedId] = useState<string | null>(null);
  const [revokeReason, setRevokeReason] = useState('');
  const [previewRequestId, setPreviewRequestId] = useState<string | null>(null);
  const [showRejectedDataId, setShowRejectedDataId] = useState<string | null>(null);
  const [batchSigning, setBatchSigning] = useState(false);
  const [signingBatchId, setSigningBatchId] = useState<string | null>(null);
  const [showBatchModal, setShowBatchModal] = useState(false);
  const [batchRequests, setBatchRequests] = useState<any[]>([]);
  const [signingRequestIds, setSigningRequestIds] = useState<string[]>([]);
  const [selectedRequestIds, setSelectedRequestIds] = useState<string[]>([]);
  const [batchSelectedSignatureId, setBatchSelectedSignatureId] = useState<string | null>(null);
  const [batchSignatures, setBatchSignatures] = useState<any[]>([]);
  const [batchRejecting, setBatchRejecting] = useState(false);
  const [batchRejectionReason, setBatchRejectionReason] = useState('');
  const [showBatchRejectModal, setShowBatchRejectModal] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState({ current: 0, total: 0 });
  const [expandedBatches, setExpandedBatches] = useState<Set<string>>(new Set());

  // ── Full batch data cache (loaded on-demand, bypasses pagination) ──
  const [batchItemsCache, setBatchItemsCache] = useState<Map<string, any[]>>(new Map());
  const [loadingBatch, setLoadingBatch] = useState<string | null>(null);

  const fetchBatchItems = async (batchId: string): Promise<any[]> => {
    // Return from cache if already loaded
    if (batchItemsCache.has(batchId)) return batchItemsCache.get(batchId)!;

    setLoadingBatch(batchId);
    try {
      let query = supabase
        .from('certificate_requests')
        .select('*, user:users!certificate_requests_user_id_fkey(first_name, last_name, email), template:templates(name)')
        .eq('batch_id', batchId)
        .order('row_index', { ascending: true });

      if (user?.role === 'APPLICANT') query = query.eq('user_id', user.id);

      const { data, error } = await query;
      if (error) throw error;

      const items = data || [];
      setBatchItemsCache(prev => {
        const next = new Map(prev);
        next.set(batchId, items);
        return next;
      });
      return items;
    } catch (err) {
      console.error('Error fetching batch items:', err);
      toast.error('Error al cargar los datos completos del lote');
      return [];
    } finally {
      setLoadingBatch(null);
    }
  };

  // ── Delete confirmation ──
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [deleteConfirmBatchId, setDeleteConfirmBatchId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  // ── Batch edit via Excel ──
  const [showBatchEditModal, setShowBatchEditModal] = useState(false);
  const [batchEditBatchId, setBatchEditBatchId] = useState<string | null>(null);
  const [batchEditRequests, setBatchEditRequests] = useState<any[]>([]);
  const [batchEditExcelData, setBatchEditExcelData] = useState<Record<string, string>[]>([]);
  const [batchEditExcelColumns, setBatchEditExcelColumns] = useState<string[]>([]);
  const [batchEditColumnMapping, setBatchEditColumnMapping] = useState<Record<string, string>>({});
  const [batchEditImporting, setBatchEditImporting] = useState(false);
  const batchEditFileInputRef = useRef<HTMLInputElement>(null);

  // ── Pagination ──
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [totalCount, setTotalCount] = useState(0);
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
      if (user?.role === 'SIGNER') query = query.in('status', ['PENDING', 'IN_REVIEW', 'APPROVED', 'REJECTED', 'SIGNED', 'REVOKED']);

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
      let query = supabase
        .from('authorized_signatures')
        .select('id, full_name, title, signature_image_url, is_primary')
        .eq('institution_id', user.institution_id)
        .eq('is_active', true);

      // 🔒 SIGNER users only see their own assigned signatures.
      // ADMIN users can sign on behalf of any authorized signer in the same institution.
      if (user?.role === 'SIGNER' && user?.id) {
        query = query.eq('user_id', user.id);
      }

      const { data, error } = await query
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

  const openBatchModal = async (batchId: string) => {
    // Fetch ALL items for this batch (bypasses pagination)
    const allItems = await fetchBatchItems(batchId);
    setBatchRequests(allItems);
    setSigningBatchId(batchId);
    setSigningRequestIds(allItems.map(req => req.id));
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

  const openSelectedRequestsRejectModal = (requestIds: string[]) => {
    const requestsInBatch = requests.filter(req => requestIds.includes(req.id));
    setBatchRequests(requestsInBatch);
    setSigningBatchId(null);
    setSigningRequestIds(requestIds);
    setBatchRejectionReason('');
    setShowBatchRejectModal(true);
  };

  const openBatchRejectModal = async (batchId: string) => {
    const allItems = await fetchBatchItems(batchId);
    const pendingItems = allItems.filter(item => ['PENDING', 'IN_REVIEW'].includes(item.status));
    setBatchRequests(pendingItems);
    setSigningBatchId(batchId);
    setSigningRequestIds(pendingItems.map(item => item.id));
    setBatchRejectionReason('');
    setShowBatchRejectModal(true);
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

  const handleRejectBatch = async () => {
    const idsToReject = signingRequestIds;
    if (idsToReject.length === 0) {
      toast.error('No hay solicitudes seleccionadas para rechazar');
      return;
    }
    if (!batchRejectionReason.trim()) {
      toast.error('Debes indicar un motivo de rechazo');
      return;
    }

    setBatchRejecting(true);
    try {
      const query = supabase.from('certificate_requests').update({
        status: 'REJECTED',
        reviewed_by: user?.id,
        reviewed_at: new Date().toISOString(),
        rejection_reason: batchRejectionReason,
      });

      if (signingRequestIds.length > 0) {
        query.in('id', signingRequestIds);
      } else if (signingBatchId) {
        query.eq('batch_id', signingBatchId);
      }

      const { error } = await query.in('status', ['PENDING', 'IN_REVIEW']);
      if (error) throw error;

      try {
        const ip = await getClientIP();
        await auditApi.log({
          user_id: user?.id,
          user_email: user?.email,
          module: 'signatures',
          action: 'batch_reject',
          entity_id: signingBatchId || signingRequestIds.join(','),
          entity_type: 'certificate_request_batch',
          ip_address: ip,
          description: `Rechazo masivo de ${idsToReject.length} solicitudes - Motivo: ${batchRejectionReason}`,
        });
      } catch { /* silent */ }

      toast.success('Lote rechazado exitosamente');
      setShowBatchRejectModal(false);
      setBatchRejectionReason('');
      setSigningBatchId(null);
      setSigningRequestIds([]);
      setBatchRequests([]);
      loadRequests();
    } catch (err: any) {
      toast.error(err.message || 'Error al rechazar el lote');
      console.error('❌ Batch reject error:', err);
    } finally {
      setBatchRejecting(false);
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

  const handleRevoke = async (id: string) => {
    if (!revokeReason.trim()) { toast.error('Debes indicar un motivo de revocación'); return; }
    try {
      // Update reviewer_notes to mark the signature as revoked (disables it in validation)
      const revokedNotes = JSON.stringify({
        revoked: true,
        revoked_at: new Date().toISOString(),
        revoke_reason: revokeReason,
        revoked_by: user?.id,
        original_signature_removed: true,
      });

      const { error } = await supabase
        .from('certificate_requests')
        .update({
          status: 'REVOKED',
          reviewed_by: user?.id,
          reviewed_at: new Date().toISOString(),
          revoked_at: new Date().toISOString(),
          revoke_reason: revokeReason,
          reviewer_notes: revokedNotes,
        })
        .eq('id', id);
      if (error) throw error;

      // ── Audit log: firma revocada ──
      try {
        const ip = await getClientIP();
        await auditApi.log({
          user_id: user?.id,
          user_email: user?.email,
          module: 'signatures',
          action: 'revoke',
          entity_id: id,
          entity_type: 'certificate_request',
          ip_address: ip,
          description: `Firma revocada - Motivo: ${revokeReason} - Solicitud: ${id}`,
        });
      } catch { /* silent */ }

      toast.success('Firma revocada correctamente');
      setRevokeSelectedId(null);
      setRevokeReason('');
      loadRequests();
    } catch (err: any) {
      toast.error(err.message || 'Error al revocar la firma');
      console.error('❌ Revoke request error:', err);
    }
  };

  const handleApproveSingle = async (id: string) => {
    setBatchSigning(true);
    try {
      const selectedSig = batchSignatures.find((sig: any) => sig.id === batchSelectedSignatureId)
        || batchSignatures.find((sig: any) => sig.is_primary)
        || batchSignatures[0]
        || null;

      const updateData: any = {
        status: 'APPROVED',
        reviewed_by: user?.id,
        reviewed_at: new Date().toISOString(),
      };

      if (selectedSig) {
        updateData.reviewer_notes = JSON.stringify({
          signature_id: selectedSig.id,
          signature_name: selectedSig.full_name,
          signature_title: selectedSig.title,
          signature_url: selectedSig.signature_image_url,
        });
      }

      const { error } = await supabase
        .from('certificate_requests')
        .update(updateData)
        .eq('id', id)
        .in('status', ['PENDING', 'IN_REVIEW']);
      if (error) throw error;

      toast.success('Solicitud aprobada');
      loadRequests();
    } catch (err: any) {
      toast.error(err.message || 'Error al aprobar la solicitud');
      console.error('❌ Approve single request error:', err);
    } finally {
      setBatchSigning(false);
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

  const toggleBatchExpand = async (batchId: string) => {
    // If collapsing, just remove from expanded set
    if (expandedBatches.has(batchId)) {
      setExpandedBatches(prev => {
        const next = new Set(prev);
        next.delete(batchId);
        return next;
      });
      return;
    }

    // Fetch ALL items for this batch (bypasses pagination)
    await fetchBatchItems(batchId);

    // Now add to expanded set
    setExpandedBatches(prev => {
      const next = new Set(prev);
      next.add(batchId);
      return next;
    });
  };

  // ── Check if a request status is editable by applicant ──
  const isEditable = (req: any) => {
    return user?.role === 'APPLICANT' && EDITABLE_STATUSES.includes(req.status);
  };

  // ── Delete a single request ──
  const handleDeleteRequest = async (id: string) => {
    setDeleting(true);
    try {
      // Find which batch (if any) this request belongs to, so we can invalidate cache
      const targetReq = requests.find(r => r.id === id);
      const affectedBatchId = targetReq?.batch_id;

      const { error } = await supabase.from('certificate_requests').delete().eq('id', id);
      if (error) throw error;

      // Invalidate batch cache if this was a batch item
      if (affectedBatchId) {
        setBatchItemsCache(prev => { const next = new Map(prev); next.delete(affectedBatchId); return next; });
      }

      // Audit log
      try {
        const ip = await getClientIP();
        await auditApi.log({
          user_id: user?.id,
          user_email: user?.email,
          module: 'requests',
          action: 'delete',
          entity_id: id,
          entity_type: 'certificate_request',
          ip_address: ip,
          description: 'Solicitud eliminada por el solicitante',
        });
      } catch { /* silent */ }

      toast.success('Solicitud eliminada');
      setDeleteConfirmId(null);
      loadRequests();
    } catch (err: any) {
      toast.error(err.message || 'Error al eliminar la solicitud');
    } finally {
      setDeleting(false);
    }
  };

  // ── Delete an entire batch ──
  const handleDeleteBatch = async (batchId: string) => {
    setDeleting(true);
    try {
      const { error } = await supabase.from('certificate_requests').delete().eq('batch_id', batchId);
      if (error) throw error;

      // Invalidate batch cache
      setBatchItemsCache(prev => { const next = new Map(prev); next.delete(batchId); return next; });

      // Audit log
      try {
        const ip = await getClientIP();
        await auditApi.log({
          user_id: user?.id,
          user_email: user?.email,
          module: 'requests',
          action: 'batch_delete',
          entity_id: batchId,
          entity_type: 'certificate_request_batch',
          ip_address: ip,
          description: 'Lote completo eliminado por el solicitante',
        });
      } catch { /* silent */ }

      toast.success('Lote eliminado exitosamente');
      setDeleteConfirmBatchId(null);
      loadRequests();
    } catch (err: any) {
      toast.error(err.message || 'Error al eliminar el lote');
    } finally {
      setDeleting(false);
    }
  };

  // ── Open batch edit modal (re-upload Excel) ──
  const openBatchEditModal = async (batchId: string) => {
    // Fetch ALL items for this batch (bypasses pagination)
    const allItems = await fetchBatchItems(batchId);
    setBatchEditBatchId(batchId);
    setBatchEditRequests(allItems);
    setBatchEditExcelData([]);
    setBatchEditExcelColumns([]);
    setBatchEditColumnMapping({});
    setShowBatchEditModal(true);
  };

  // ── Handle Excel file upload for batch edit ──
  const handleBatchEditFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const data = new Uint8Array(evt.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array', cellDates: true });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const json = XLSX.utils.sheet_to_json<Record<string, string>>(sheet, { raw: false, defval: '' });

        if (json.length === 0) {
          toast.error('El archivo Excel está vacío');
          return;
        }

        const columns = Object.keys(json[0]);
        setBatchEditExcelColumns(columns);
        setBatchEditExcelData(json);

        // Auto-map columns to data keys from the first batch item
        if (batchEditRequests.length > 0) {
          const sampleData = batchEditRequests[0]?.data || {};
          const dataKeys = Object.keys(sampleData);
          const mapping: Record<string, string> = {};
          columns.forEach(col => {
            const match = dataKeys.find(
              k => k.toLowerCase() === col.toLowerCase().replace(/\s+/g, '_')
            );
            if (match) mapping[col] = match;
          });
          setBatchEditColumnMapping(mapping);
        }

        toast.success(`Se cargaron ${json.length} filas desde el Excel`);
      } catch (err) {
        toast.error('Error al leer el archivo Excel');
        console.error(err);
      }
    };
    reader.readAsArrayBuffer(file);
  };

  // ── Execute batch update from Excel ──
  const handleBatchEditImport = async () => {
    if (!batchEditBatchId || batchEditExcelData.length === 0) {
      toast.error('No hay datos para actualizar');
      return;
    }

    setBatchEditImporting(true);
    try {
      let updatedCount = 0;
      for (let i = 0; i < Math.min(batchEditExcelData.length, batchEditRequests.length); i++) {
        const row = batchEditExcelData[i];
        const existingReq = batchEditRequests[i];

        const mappedData: Record<string, string> = {};
        Object.entries(batchEditColumnMapping).forEach(([excelCol, templateVar]) => {
          if (!templateVar) return;
          const value = row[excelCol];
          if (value !== undefined && value !== null && String(value).trim() !== '') {
            mappedData[templateVar] = String(value);
          }
        });

        const { error: updateError } = await supabase
          .from('certificate_requests')
          .update({ data: mappedData })
          .eq('id', existingReq.id);

        if (!updateError) updatedCount++;
      }

      // Add new rows if Excel has more rows than existing batch
      if (batchEditExcelData.length > batchEditRequests.length) {
        const firstReq = batchEditRequests[0];
        const newRows = [];
        for (let i = batchEditRequests.length; i < batchEditExcelData.length; i++) {
          const row = batchEditExcelData[i];
          const mappedData: Record<string, string> = {};
          Object.entries(batchEditColumnMapping).forEach(([excelCol, templateVar]) => {
            if (!templateVar) return;
            const value = row[excelCol];
            if (value !== undefined && value !== null && String(value).trim() !== '') {
              mappedData[templateVar] = String(value);
            }
          });

          const code = `MAS-${batchEditBatchId.substring(0, 6).toUpperCase()}-${String(i + 1).padStart(4, '0')}`;
          newRows.push({
            code,
            type: 'MASSIVE',
            status: 'PENDING',
            user_id: user?.id,
            template_id: firstReq?.template_id,
            data: mappedData,
            batch_id: batchEditBatchId,
            batch_total: Math.max(batchEditExcelData.length, batchEditRequests.length),
            row_index: i,
          });
        }

        if (newRows.length > 0) {
          const { error: insertError } = await supabase.from('certificate_requests').insert(newRows);
          if (insertError) throw insertError;

          // Update batch_total on all items
          const newTotal = Math.max(batchEditExcelData.length, batchEditRequests.length);
          await supabase
            .from('certificate_requests')
            .update({ batch_total: newTotal })
            .eq('batch_id', batchEditBatchId);
        }
      }

      // Audit log
      try {
        const ip = await getClientIP();
        await auditApi.log({
          user_id: user?.id,
          user_email: user?.email,
          module: 'requests',
          action: 'batch_update',
          entity_id: batchEditBatchId,
          entity_type: 'certificate_request_batch',
          ip_address: ip,
          description: `Lote editado masivamente vía Excel por el solicitante (${updatedCount} actualizadas)`,
        });
      } catch { /* silent */ }

      // Invalidate batch cache so re-expand shows fresh data
      if (batchEditBatchId) {
        setBatchItemsCache(prev => { const next = new Map(prev); next.delete(batchEditBatchId); return next; });
      }

      toast.success(`✅ ${updatedCount} solicitudes actualizadas exitosamente`);
      setShowBatchEditModal(false);
      setBatchEditBatchId(null);
      setBatchEditRequests([]);
      setBatchEditExcelData([]);
      loadRequests();
    } catch (err: any) {
      toast.error(err.message || 'Error al actualizar el lote');
      console.error('Batch edit error:', err);
    } finally {
      setBatchEditImporting(false);
    }
  };

  // ── Download a single request PDF with Firma Electrónica (signature + QR) ──
  const downloadSignedPdf = async (req: any) => {
    setDownloading(true);
    try {
      toast.loading('Generando PDF con firma electrónica...', { id: `signed-pdf-${req.id}` });

      // 1. Load template config
      let rawConfig: any = null;
      if (req.template_id) {
        const { data: tmpl } = await supabase
          .from('templates')
          .select('config')
          .eq('id', req.template_id)
          .single();

        if (tmpl) {
          rawConfig = tmpl.config?.elements
            ? tmpl.config
            : tmpl.config?.config
              ? (typeof tmpl.config.config === 'string' ? safeJsonParse(tmpl.config.config) : tmpl.config.config)
              : typeof tmpl.config === 'string' ? safeJsonParse(tmpl.config) : (tmpl.config || {});
        }
      }

      if (!rawConfig) {
        toast.error('No se encontró la plantilla del certificado', { id: `signed-pdf-${req.id}` });
        return;
      }

      const elements: TemplateElement[] = rawConfig.elements || [];
      const pageOrientation = rawConfig.orientation || 'landscape';
      const pageSizeName: PageSizeName = rawConfig.pageSize || 'A4';
      const { width: pageWidth, height: pageHeight } = getPageDimensions(pageSizeName, pageOrientation);

      // 2. Build request data with validation URL
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
        ...(req.consecutive_number ? {
          radicado: req.consecutive_number,
          consecutivo: req.consecutive_number,
        } : {}),
        ...(req.batch_id ? {
          lote_id: req.batch_id,
          lote_total: String(req.batch_total || ''),
          lote_indice: String((req.row_index ?? -1) + 1),
        } : {}),
      };

      // 3. Extract signature from reviewer_notes (if available)
      let selectedSignature: { signature_image_url?: string } | null = null;
      if (req.reviewer_notes) {
        try {
          const parsed = typeof req.reviewer_notes === 'string'
            ? JSON.parse(req.reviewer_notes)
            : req.reviewer_notes;
          if (parsed?.signature_url) {
            selectedSignature = { signature_image_url: parsed.signature_url };
          }
        } catch {
          // Not valid JSON
        }
      }

      // 4. Generate PDF with signature
      const pdf = await renderTemplateToPdf(
        elements,
        pageOrientation,
        pageWidth,
        pageHeight,
        requestData,
        selectedSignature,
      );

      pdf.save(`certificado-${reqCode || req.id.substring(0, 8)}-firmado.pdf`);
      toast.success('✅ PDF con firma electrónica descargado', { id: `signed-pdf-${req.id}` });
    } catch (err: any) {
      toast.error('Error al generar PDF: ' + (err.message || ''), { id: `signed-pdf-${req.id}` });
      console.error('❌ Error generando PDF firmado:', err);
    } finally {
      setDownloading(false);
    }
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
          const pageSizeName: PageSizeName = templateConfig.pageSize || 'A4';
          const { width: pageWidth, height: pageHeight } = getPageDimensions(pageSizeName, pageOrientation);

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
            ...(req.consecutive_number ? {
              radicado: req.consecutive_number,
              consecutivo: req.consecutive_number,
            } : {}),
            ...(req.batch_id ? {
              lote_id: req.batch_id,
              lote_total: String(req.batch_total || ''),
              lote_indice: String((req.row_index ?? -1) + 1),
            } : {}),
          };

          // Extract signature from reviewer_notes (for approved/signed certificates)
          let selectedSignature: { signature_image_url?: string } | null = null;
          if (req.reviewer_notes && ['APPROVED', 'SIGNED'].includes(req.status)) {
            try {
              const parsed = typeof req.reviewer_notes === 'string'
                ? JSON.parse(req.reviewer_notes)
                : req.reviewer_notes;
              if (parsed?.signature_url) {
                selectedSignature = { signature_image_url: parsed.signature_url };
              }
            } catch {
              // Not valid JSON
            }
          }

          const pdf = await renderTemplateToPdf(
            elements,
            pageOrientation,
            pageWidth,
            pageHeight,
            requestData,
            selectedSignature,
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

          {/* Page size selector */}
          <select
            className="input w-auto min-w-[50px] text-sm h-10"
            value={pageSize}
            onChange={e => { setPageSize(Number(e.target.value)); setPage(1); }}
            title="Resultados por página"
          >
            <option value={20}>20</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
          </select>
          {(user?.role === 'SIGNER' || user?.role === 'ADMIN') && selectedRequestIds.length > 0 && (
            <>
              <button
                onClick={() => openSelectedRequestsModal(selectedRequestIds)}
                className="btn-secondary btn-sm text-xs h-10"
              >
                Firmar ({selectedRequestIds.length})
              </button>
              <button
                onClick={() => openSelectedRequestsRejectModal(selectedRequestIds)}
                className="btn-danger btn-sm text-xs h-10"
              >
                Rechazar ({selectedRequestIds.length})
              </button>
            </>
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
          // ── Deduplicate batches: each unique batch_id appears ONCE per page ──
          const seenBatchIds = new Set<string>();
          const individualReqs: any[] = [];
          for (const req of filtered) {
            if (req.batch_id) {
              seenBatchIds.add(req.batch_id);
            } else {
              individualReqs.push(req);
            }
          }

          const allItems: any[] = [];

          // Add individual (non-batch) requests first
          for (const req of individualReqs) {
            allItems.push({ type: 'individual', req });
          }

          // Add each unique batch ONCE (the paginated subset is just for preview info)
          for (const batchId of seenBatchIds) {
            const batchReqs = filtered.filter(req => req.batch_id === batchId);
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
                          <button onClick={() => handleApproveSingle(req.id)}
                            className="p-2 hover:bg-primary/10 rounded-full text-primary transition-colors" title="Aprobar solicitud">
                            <CheckCircle size={18} />
                          </button>
                          <button onClick={() => setSelected(selected === req.id ? null : req.id)}
                            className="p-2 hover:bg-error/10 rounded-full text-error transition-colors" title="Rechazar">
                            <XCircle size={18} />
                          </button>
                        </>
                      )}
                      {(req.status === 'APPROVED' || req.status === 'SIGNED') && (
                        <>
                          <button
                            onClick={() => setPreviewRequestId(req.id)}
                            className="p-2 hover:bg-primary/10 rounded-full text-primary transition-colors"
                            title="Ver certificado"
                          >
                            <Eye size={18} />
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); downloadSignedPdf(req); }}
                            disabled={downloading}
                            className="p-2 hover:bg-primary/10 rounded-full text-primary transition-colors"
                            title="Descargar PDF con Firma Electrónica"
                          >
                            <Download size={18} />
                          </button>
                          {(user?.role === 'SIGNER' || user?.role === 'ADMIN') && (
                            <button
                              onClick={() => { setSelected(null); setRevokeReason(''); setRevokeSelectedId(req.id); }}
                              className="p-2 hover:bg-amber-100 rounded-full text-amber-700 transition-colors"
                              title="Revocar firma"
                            >
                              <AlertTriangle size={18} />
                            </button>
                          )}
                        </>
                      )}
                      {/* Applicant edit/delete actions */}
                      {isEditable(req) && (
                        <>
                          <Link
                            to={`/requests/edit/${req.id}`}
                            className="p-2 hover:bg-primary/10 rounded-full text-primary transition-colors"
                            title="Editar solicitud"
                          >
                            <Edit size={18} />
                          </Link>
                          {req.status === 'REJECTED' && (
                            <>
                              <button
                                onClick={(e) => { e.stopPropagation(); setShowRejectedDataId(showRejectedDataId === req.id ? null : req.id); }}
                                className="p-2 hover:bg-sky-100 rounded-full text-sky-600 transition-colors"
                                title="Ver datos de la solicitud"
                              >
                                <Eye size={18} />
                              </button>
                              <Link
                                to={`/requests/new?reuse=${encodeURIComponent(req.id)}`}
                                className="p-2 hover:bg-primary/10 rounded-full text-primary transition-colors"
                                title="Reutilizar datos para nueva solicitud (con otra plantilla)"
                              >
                                <RefreshCw size={18} />
                              </Link>
                            </>
                          )}
                          <button
                            onClick={(e) => { e.stopPropagation(); setDeleteConfirmId(deleteConfirmId === req.id ? null : req.id); }}
                            className="p-2 hover:bg-error/10 rounded-full text-error transition-colors"
                            title="Eliminar solicitud"
                          >
                            <Trash2 size={18} />
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  {/* (Reject modal moved to centralized popup below) */}

                  {/* (Delete confirmation moved to centralized popup below) */}

                  {/* (Revoke modal moved to centralized popup below) */}

                  {/* Rejected request data preview */}
                  {showRejectedDataId === req.id && req.data && Object.keys(req.data).length > 0 && (
                    <div className="bg-sky-50/70 rounded-2xl p-5 border border-sky-200/60 mt-2 animate-fade-in">
                      <div className="flex items-center justify-between mb-3">
                        <h4 className="text-xs font-black text-sky-700 uppercase tracking-wider flex items-center gap-2">
                          <Database size={14} /> Datos de la solicitud
                        </h4>
                        <button
                          onClick={() => setShowRejectedDataId(null)}
                          className="p-1 hover:bg-sky-100 rounded-lg text-sky-500 transition-colors"
                        >
                          <X size={14} />
                        </button>
                      </div>
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-2.5 text-sm">
                        {Object.entries(req.data).map(([key, value]) => (
                          <div key={key}>
                            <span className="text-[10px] uppercase tracking-wider text-sky-600/70 font-bold block">{key.replace(/_/g, ' ')}</span>
                            <p className="font-semibold text-sky-900 mt-0.5 break-words">{String(value)}</p>
                          </div>
                        ))}
                      </div>
                      {req.rejection_reason && (
                        <div className="mt-3 pt-3 border-t border-sky-200/60">
                          <span className="text-[10px] uppercase tracking-wider text-rose-600/70 font-bold block">Motivo de rechazo</span>
                          <p className="text-sm font-medium text-rose-700 mt-0.5">{req.rejection_reason}</p>
                        </div>
                      )}
                      <div className="mt-3 pt-3 border-t border-sky-200/60 flex items-center justify-end gap-2">
                        <Link
                          to={`/requests/new?reuse=${encodeURIComponent(req.id)}`}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-primary text-white text-xs font-bold rounded-lg hover:bg-primary/90 transition-colors"
                        >
                          <RefreshCw size={14} /> Crear nueva con estos datos
                        </Link>
                      </div>
                    </div>
                  )}
                </div>
              );
            }

            // ── Batch group card ──
            const { batchId, batchReqs } = item;
            const isExpanded = expandedBatches.has(batchId);
            const firstReq = batchReqs[0];
            const batchCode = firstReq?.code?.substring(0, 10) || batchId.substring(0, 8);
            // Use cached full batch items when expanded, otherwise use paginated subset
            const cachedItems = batchItemsCache.get(batchId) || null;
            const displayItems = isExpanded && cachedItems ? cachedItems : batchReqs;
            const realTotal = firstReq?.batch_total || batchReqs.length;
            const approvedCount = displayItems.filter((r: any) => ['APPROVED', 'SIGNED'].includes(r.status)).length;
            const pendingCount = displayItems.filter((r: any) => r.status === 'PENDING').length;

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
                        {realTotal} solicitudes
                      </span>
                    </div>
                    <p className="text-xs text-on-surface-variant/70 mt-0.5">
                      Creado {format(new Date(firstReq.created_at), 'dd/MM/yyyy')}
                      {firstReq.template?.name && ` · ${firstReq.template.name}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    {loadingBatch === batchId && (
                      <Loader2 size={16} className="animate-spin text-primary shrink-0" />
                    )}
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
                <div className="flex items-center gap-2 px-5 pb-3 flex-wrap">
                  {/* Sign batch (for signers/admins with pending items) */}
                  {(user?.role === 'SIGNER' || user?.role === 'ADMIN') && pendingCount > 0 && (
                    <>
                      <button
                        onClick={(e) => { e.stopPropagation(); openBatchModal(batchId); }}
                        className="btn-secondary btn-xs px-3 py-1.5 text-xs"
                      >
                        <CheckCircle size={14} /> Firmar lote
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); openBatchRejectModal(batchId); }}
                        className="btn-danger btn-xs px-3 py-1.5 text-xs"
                      >
                        <XCircle size={14} /> Rechazar lote
                      </button>
                      {displayItems.filter((r: any) => r.status === 'PENDING').slice(0, 3).map((r: any) => (
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
                    onClick={async (e) => {
                      e.stopPropagation();
                      // Fetch all batch items before downloading
                      const allItems = cachedItems || await fetchBatchItems(batchId);
                      downloadBatchAsZip(batchId, allItems);
                    }}
                    disabled={downloading}
                    className="btn-secondary btn-xs px-3 py-1.5 text-xs"
                  >
                    {downloading ? (
                      <><Loader2 size={14} className="animate-spin" /> {downloadProgress.current}/{downloadProgress.total}</>
                    ) : (
                      <><Download size={14} /> Descargar lote ({realTotal})</>
                    )}
                  </button>

                  {/* Applicant: edit batch via Excel */}
                  {user?.role === 'APPLICANT' && displayItems.some((r: any) => EDITABLE_STATUSES.includes(r.status)) && (
                    <>
                      <button
                        onClick={(e) => { e.stopPropagation(); openBatchEditModal(batchId); }}
                        className="btn-secondary btn-xs px-3 py-1.5 text-xs"
                      >
                        <Upload size={14} /> Editar lote
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); setDeleteConfirmBatchId(deleteConfirmBatchId === batchId ? null : batchId); }}
                        className="p-1.5 hover:bg-error/10 rounded-full text-error transition-colors"
                        title="Eliminar lote completo"
                      >
                        <Trash2 size={16} />
                      </button>
                    </>
                  )}

                  {/* Delete batch confirmation */}
                  {deleteConfirmBatchId === batchId && (
                    <div className="w-full mt-2 bg-error-container/30 rounded-xl p-3 flex items-center justify-between gap-3 animate-fade-in">
                      <div className="flex items-center gap-2 text-xs text-error">
                        <AlertTriangle size={14} />
                        <span>¿Eliminar todo el lote ({realTotal} solicitudes)?</span>
                      </div>
                      <div className="flex gap-2 shrink-0">
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDeleteBatch(batchId); }}
                          disabled={deleting}
                          className="btn-danger btn-xs px-2 py-1 text-[10px]"
                        >
                          {deleting ? '...' : 'Eliminar'}
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); setDeleteConfirmBatchId(null); }}
                          className="btn-secondary btn-xs px-2 py-1 text-[10px]"
                        >
                          Cancelar
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Expanded children — uses full batch data from cache */}
                {isExpanded && (
                  <div className="border-t border-outline-variant/10 divide-y divide-outline-variant/5 animate-fade-in">
                    {displayItems.length > 1000 ? (
                      /* Show summary for very large batches */
                      <div className="px-5 py-8 text-center text-sm text-on-surface-variant/70">
                        <Package size={32} className="mx-auto text-secondary/40 mb-3" />
                        <p className="font-semibold text-on-surface mb-1">Lote de {realTotal} solicitudes</p>
                        <p className="text-xs">
                          {approvedCount} aprobadas · {pendingCount} pendientes · {realTotal - approvedCount - pendingCount} otras
                        </p>
                        <p className="text-xs mt-3 text-on-surface-variant/50">
                          Usa la opción <strong>"Editar lote"</strong> para hacer correcciones masivas vía Excel,
                          o descarga el ZIP completo.
                        </p>
                      </div>
                    ) : (
                      displayItems.map((req: any) => {
                        const status = statusConfig[req.status] || { label: req.status, color: '', bg: '', borderColor: '' };
                        return (
                          <div key={req.id} className="relative">
                            <div
                              className={`flex items-center gap-3 px-5 py-3 hover:bg-surface-container-low/50 transition-colors border-l-4 ${status.borderColor} ${
                                deleteConfirmId === req.id ? 'opacity-20 pointer-events-none' : ''
                              }`}
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
                                    {['PENDING', 'IN_REVIEW'].includes(req.status) && (user?.role === 'SIGNER' || user?.role === 'ADMIN') && (
                                      <>
                                        <button
                                          onClick={(e) => { e.stopPropagation(); setPreviewRequestId(req.id); }}
                                          className="p-1.5 hover:bg-primary/10 rounded-full text-primary transition-colors"
                                          title="Vista previa"
                                        >
                                          <Eye size={15} />
                                        </button>
                                        <button
                                          onClick={(e) => { e.stopPropagation(); handleApproveSingle(req.id); }}
                                          className="p-1.5 hover:bg-primary/10 rounded-full text-primary transition-colors"
                                          title="Aprobar solicitud"
                                        >
                                          <CheckCircle size={15} />
                                        </button>
                                        <button
                                          onClick={(e) => { e.stopPropagation(); setSelected(selected === req.id ? null : req.id); }}
                                          className="p-1.5 hover:bg-error/10 rounded-full text-error transition-colors"
                                          title="Rechazar solicitud"
                                        >
                                          <XCircle size={15} />
                                        </button>
                                      </>
                                    )}
                                    {(req.status === 'APPROVED' || req.status === 'SIGNED') && (
                                      <>
                                        <button
                                          onClick={(e) => { e.stopPropagation(); setPreviewRequestId(req.id); }}
                                          className="p-1.5 hover:bg-primary/10 rounded-full text-primary transition-colors"
                                          title="Ver certificado"
                                        >
                                          <Eye size={15} />
                                        </button>
                                        <button
                                          onClick={(e) => { e.stopPropagation(); downloadSignedPdf(req); }}
                                          disabled={downloading}
                                          className="p-1.5 hover:bg-primary/10 rounded-full text-primary transition-colors"
                                          title="Descargar PDF con Firma Electrónica"
                                        >
                                          <Download size={15} />
                                        </button>
                                        {(user?.role === 'SIGNER' || user?.role === 'ADMIN') && (
                                          <button
                                            onClick={(e) => { e.stopPropagation(); setSelected(null); setRevokeReason(''); setRevokeSelectedId(req.id); }}
                                            className="p-1.5 hover:bg-amber-100 rounded-full text-amber-700 transition-colors"
                                            title="Revocar firma"
                                          >
                                            <AlertTriangle size={15} />
                                          </button>
                                        )}
                                      </>
                                    )}
                                    {/* Applicant: edit individual batch item */}
                                    {user?.role === 'APPLICANT' && EDITABLE_STATUSES.includes(req.status) && (
                                      <>
                                        <Link
                                          to={`/requests/edit/${req.id}`}
                                          onClick={(e) => e.stopPropagation()}
                                          className="p-1.5 hover:bg-primary/10 rounded-full text-primary transition-colors"
                                          title={`Editar ${req.code}`}
                                        >
                                          <Edit size={15} />
                                        </Link>
                                        <button
                                          onClick={(e) => { e.stopPropagation(); setDeleteConfirmId(deleteConfirmId === req.id ? null : req.id); }}
                                          className="p-1.5 hover:bg-error/10 rounded-full text-error transition-colors"
                                          title={`Eliminar ${req.code}`}
                                        >
                                          <Trash2 size={15} />
                                        </button>
                                      </>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </div>

                            {/* (Reject modal moved to centralized popup below) */}
                            {/* (Delete confirmation moved to centralized popup below) */}
                          </div>
                        );
                      })
                    )}
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
                  <h3 className="text-sm font-semibold text-on-surface mb-3">Solicitudes en el lote ({batchRequests.length})</h3>
                  <div className="max-h-[280px] overflow-y-auto custom-scrollbar space-y-0.5">
                    {batchRequests.length === 0 ? (
                      <p className="text-xs text-on-surface-variant/60 text-center py-4">No hay solicitudes en este lote</p>
                    ) : (
                      batchRequests.map((req) => (
                        <div key={req.id} className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg hover:bg-white/50 transition-colors">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="font-mono text-[11px] font-semibold text-primary shrink-0">{req.code}</span>
                            <span className="text-[11px] text-on-surface-variant truncate">{getStudentName(req)}</span>
                          </div>
                          <span className="text-[10px] text-on-surface-variant/50 shrink-0">{req.template?.name || ''}</span>
                        </div>
                      ))
                    )}
                  </div>
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

      {showBatchRejectModal && (
        <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/50 backdrop-blur-sm p-0 md:p-4 animate-fade-in">
          <div className="bg-white rounded-t-3xl md:rounded-3xl shadow-2xl w-full md:max-w-xl max-h-[90vh] overflow-hidden animate-slide-up md:animate-scale-in">
            <div className="flex items-center justify-between px-6 py-4 border-b border-outline-variant/20">
              <div>
                <h2 className="text-lg font-bold text-on-surface">Rechazar lote</h2>
                <p className="text-sm text-on-surface-variant">Indica el motivo de rechazo para este conjunto de solicitudes.</p>
              </div>
              <button onClick={() => setShowBatchRejectModal(false)} className="p-2 rounded-xl text-on-surface-variant hover:bg-surface-container-high">
                <X size={20} />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div className="glass-card p-4 rounded-2xl border border-outline-variant/50">
                <p className="text-sm text-on-surface-variant">Cantidad de solicitudes seleccionadas: <strong>{batchRequests.length}</strong></p>
                {signingBatchId && (
                  <p className="text-sm text-on-surface-variant">Lote: <strong>{signingBatchId}</strong></p>
                )}
              </div>
              <div>
                <label className="text-sm font-semibold text-on-surface">Motivo de rechazo</label>
                <textarea
                  className="input mt-2 w-full min-h-[120px]"
                  value={batchRejectionReason}
                  onChange={(e) => setBatchRejectionReason(e.target.value)}
                  placeholder="Describe el motivo por el que se rechaza este lote"
                />
              </div>
            </div>
            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-outline-variant/20">
              <button onClick={() => setShowBatchRejectModal(false)} className="btn-secondary px-6 py-3">Cancelar</button>
              <button onClick={handleRejectBatch} disabled={batchRejecting || !batchRejectionReason.trim()} className="btn-danger px-6 py-3">
                {batchRejecting ? 'Rechazando...' : 'Rechazar lote'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Batch Edit Modal (re-upload Excel) ── */}
      {showBatchEditModal && (
        <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/50 backdrop-blur-sm p-0 md:p-4 animate-fade-in">
          <div className="bg-white rounded-t-3xl md:rounded-3xl shadow-2xl w-full md:max-w-2xl max-h-[95vh] md:max-h-[90vh] overflow-hidden animate-slide-up md:animate-scale-in">
            <div className="flex items-center justify-between px-6 py-4 border-b border-outline-variant/20">
              <div>
                <h2 className="text-lg font-bold text-on-surface">Editar lote con Excel</h2>
                <p className="text-sm text-on-surface-variant">
                  Sube un nuevo archivo Excel para reemplazar los datos del lote ({batchEditRequests.length} solicitudes)
                </p>
              </div>
              <button onClick={() => { setShowBatchEditModal(false); setBatchEditExcelData([]); }} className="p-2 rounded-xl text-on-surface-variant hover:bg-surface-container-high">
                <X size={20} />
              </button>
            </div>

            <div className="p-6 space-y-6 overflow-y-auto max-h-[70vh]">
              {batchEditExcelData.length === 0 ? (
                <div className="glass-card p-8 rounded-2xl border border-dashed border-outline-variant/50">
                  <div className="flex flex-col items-center text-center">
                    <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
                      <Upload size={32} className="text-primary" />
                    </div>
                    <h3 className="text-lg font-bold text-on-surface mb-1">Reemplazar datos del lote</h3>
                    <p className="text-sm text-on-surface-variant mb-6 max-w-md">
                      Sube un archivo Excel (.xlsx o .csv) con los datos actualizados.
                      Las filas se mapearán por orden a las solicitudes existentes.
                    </p>

                    <input
                      ref={batchEditFileInputRef}
                      type="file"
                      accept=".xlsx,.xls,.csv"
                      onChange={handleBatchEditFileUpload}
                      className="hidden"
                    />
                    <button
                      onClick={() => batchEditFileInputRef.current?.click()}
                      className="btn-primary px-8 py-3"
                    >
                      <Upload size={18} /> Seleccionar archivo
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Column mapping */}
                  {batchEditExcelColumns.length > 0 && batchEditRequests[0]?.data && (
                    <div className="glass-card p-5 rounded-2xl space-y-3 border border-white/40">
                      <h3 className="text-sm font-bold text-on-surface-variant uppercase tracking-wider flex items-center gap-2">
                        <AlertCircle size={14} />
                        Mapeo de columnas
                      </h3>
                      <p className="text-xs text-on-surface-variant/60">
                        Relaciona las columnas del Excel con los campos del lote
                      </p>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                        {batchEditExcelColumns.map(col => {
                          const dataKeys = Object.keys(batchEditRequests[0]?.data || {});
                          return (
                            <div key={col} className="flex items-center gap-2 bg-surface-container-low rounded-lg px-3 py-2.5">
                              <span className="text-sm font-medium text-on-surface w-1/3 truncate">{col}</span>
                              <span className="text-on-surface-variant/40">&rarr;</span>
                              <select
                                className="text-sm bg-white border border-outline-variant/30 rounded-lg px-2 py-1.5 flex-1"
                                value={batchEditColumnMapping[col] || ''}
                                onChange={e => setBatchEditColumnMapping({ ...batchEditColumnMapping, [col]: e.target.value })}
                              >
                                <option value="">No importar</option>
                                {dataKeys.map(k => (
                                  <option key={k} value={k}>{k.replace(/_/g, ' ')}</option>
                                ))}
                              </select>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Preview table */}
                  <div className="glass-card rounded-2xl overflow-hidden border border-white/40">
                    <div className="flex items-center justify-between px-5 py-4 border-b border-outline-variant/10">
                      <div className="flex items-center gap-2">
                        <Table size={18} className="text-primary" />
                        <span className="font-semibold text-sm text-on-surface">
                          Vista previa ({batchEditExcelData.length} filas)
                        </span>
                      </div>
                      <button
                        onClick={() => {
                          setBatchEditExcelData([]);
                          setBatchEditExcelColumns([]);
                          setBatchEditColumnMapping({});
                          if (batchEditFileInputRef.current) batchEditFileInputRef.current.value = '';
                        }}
                        className="text-xs text-error hover:underline"
                      >
                        Cambiar archivo
                      </button>
                    </div>
                    <div className="overflow-x-auto max-h-64 overflow-y-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="bg-surface-container-low/50">
                            {batchEditExcelColumns.map(col => (
                              <th key={col} className="text-left px-4 py-3 text-xs font-bold text-on-surface-variant uppercase whitespace-nowrap">
                                {col}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-outline-variant/10">
                          {batchEditExcelData.slice(0, 15).map((row, i) => (
                            <tr key={i} className="hover:bg-primary/[0.02]">
                              {batchEditExcelColumns.map(col => (
                                <td key={col} className="px-4 py-2.5 text-sm text-on-surface-variant truncate max-w-[200px]">
                                  {row[col] || <span className="text-on-surface-variant/30">—</span>}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {batchEditExcelData.length > 15 && (
                      <div className="px-5 py-3 text-xs text-center text-on-surface-variant/50 bg-surface-container-low/30">
                        Mostrando 15 de {batchEditExcelData.length} filas
                      </div>
                    )}
                  </div>

                  {/* Progress */}
                  {batchEditImporting && (
                    <div className="glass-card p-5 rounded-2xl border border-primary/20">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-semibold text-on-surface">Actualizando...</span>
                        <span className="text-sm text-on-surface-variant">{batchEditExcelData.length} solicitudes</span>
                      </div>
                      <div className="w-full bg-surface-container rounded-full h-2 overflow-hidden">
                        <div className="bg-primary h-full rounded-full animate-pulse" style={{ width: '60%' }} />
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-outline-variant/20">
              <button
                onClick={() => { setShowBatchEditModal(false); setBatchEditExcelData([]); }}
                className="btn-secondary px-6 py-3"
              >
                Cancelar
              </button>
              {batchEditExcelData.length > 0 && (
                <button
                  onClick={handleBatchEditImport}
                  disabled={batchEditImporting}
                  className="btn-primary px-8 py-3"
                >
                  {batchEditImporting ? (
                    <span className="flex items-center gap-2">
                      <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Actualizando...
                    </span>
                  ) : (
                    <><Upload size={18} /> Actualizar {batchEditExcelData.length} solicitudes</>
                  )}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Centralized Reject Modal (popup emergente) ── */}
      {selected && (() => {
        const rejectReq = filtered.find(r => r.id === selected);
        if (!rejectReq) return null;
        return (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4 animate-fade-in"
            onClick={() => { setSelected(null); setRejectReason(''); }}
          >
            <div
              className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden animate-scale-in"
              onClick={e => e.stopPropagation()}
            >
              {/* Header */}
              <div className="px-6 py-5 border-b border-slate-100 flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-rose-50 border border-rose-200 flex items-center justify-center shrink-0">
                  <XCircle size={20} className="text-rose-600" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">Rechazar solicitud</h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {rejectReq.code} — {getStudentName(rejectReq)}
                  </p>
                </div>
              </div>

              {/* Content */}
              <div className="px-6 py-5">
                <label className="block text-sm font-bold text-slate-700 mb-2">
                  Motivo de rechazo
                </label>
                <textarea
                  className="input w-full resize-none"
                  rows={4}
                  value={rejectReason}
                  onChange={e => setRejectReason(e.target.value)}
                  placeholder="Indica el motivo del rechazo..."
                  autoFocus
                />
              </div>

              {/* Footer */}
              <div className="px-6 py-4 bg-slate-50/70 border-t border-slate-100 flex items-center justify-end gap-3">
                <button
                  onClick={() => { setSelected(null); setRejectReason(''); }}
                  className="btn-secondary px-5 py-2.5 text-sm"
                >
                  Cancelar
                </button>
                <button
                  onClick={() => handleReject(selected)}
                  disabled={!rejectReason.trim()}
                  className="btn-danger px-5 py-2.5 text-sm"
                >
                  Rechazar solicitud
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Centralized Delete Confirmation (popup emergente) ── */}
      {deleteConfirmId && (() => {
        const delReq = filtered.find(r => r.id === deleteConfirmId);
        if (!delReq) return null;
        return (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4 animate-fade-in"
            onClick={() => setDeleteConfirmId(null)}
          >
            <div
              className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden animate-scale-in"
              onClick={e => e.stopPropagation()}
            >
              {/* Header */}
              <div className="px-6 py-5 border-b border-slate-100 flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-rose-50 border border-rose-200 flex items-center justify-center shrink-0">
                  <AlertTriangle size={20} className="text-rose-600" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">Eliminar solicitud</h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {delReq.code} — {getStudentName(delReq)}
                  </p>
                </div>
              </div>

              {/* Content */}
              <div className="px-6 py-5">
                <div className="bg-rose-50/70 rounded-xl p-4 border border-rose-100">
                  <p className="text-sm text-rose-700/80 leading-relaxed">
                    ¿Estás seguro de eliminar la solicitud <strong>{delReq.code}</strong>?
                  </p>
                  <p className="text-xs text-rose-500/70 mt-2">
                    Esta acción no se puede deshacer. Se eliminará permanentemente la solicitud y todos sus datos asociados.
                  </p>
                </div>
              </div>

              {/* Footer */}
              <div className="px-6 py-4 bg-slate-50/70 border-t border-slate-100 flex items-center justify-end gap-3">
                <button
                  onClick={() => setDeleteConfirmId(null)}
                  className="btn-secondary px-5 py-2.5 text-sm"
                >
                  Cancelar
                </button>
                <button
                  onClick={() => handleDeleteRequest(deleteConfirmId)}
                  disabled={deleting}
                  className="btn-danger px-5 py-2.5 text-sm"
                >
                  {deleting ? 'Eliminando...' : 'Eliminar solicitud'}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Centralized Revoke Modal (popup emergente) ── */}
      {revokeSelectedId && (() => {
        const revokeReq = filtered.find(r => r.id === revokeSelectedId);
        if (!revokeReq) return null;
        return (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4 animate-fade-in"
            onClick={() => { setRevokeSelectedId(null); setRevokeReason(''); }}
          >
            <div
              className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden animate-scale-in"
              onClick={e => e.stopPropagation()}
            >
              {/* Header */}
              <div className="px-6 py-5 border-b border-slate-100 flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-amber-50 border border-amber-200 flex items-center justify-center shrink-0">
                  <AlertTriangle size={20} className="text-amber-600" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">Revocar firma</h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {revokeReq.code} — {getStudentName(revokeReq)}
                  </p>
                </div>
              </div>

              {/* Content */}
              <div className="px-6 py-5 space-y-4">
                <div className="bg-amber-50/70 rounded-xl p-4 border border-amber-100">
                  <p className="text-xs text-amber-700/80 leading-relaxed">
                    Al revocar la firma, el certificado quedará marcado como <strong>revocado</strong> en el portal de validación y la firma dejará de mostrarse.
                    Esta acción no se puede deshacer.
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-2">
                    Motivo de revocación
                  </label>
                  <textarea
                    className="input w-full resize-none"
                    rows={4}
                    value={revokeReason}
                    onChange={e => setRevokeReason(e.target.value)}
                    placeholder="Indica el motivo para revocar la firma..."
                    autoFocus
                  />
                </div>
              </div>

              {/* Footer */}
              <div className="px-6 py-4 bg-slate-50/70 border-t border-slate-100 flex items-center justify-end gap-3">
                <button
                  onClick={() => { setRevokeSelectedId(null); setRevokeReason(''); }}
                  className="btn-secondary px-5 py-2.5 text-sm"
                >
                  Cancelar
                </button>
                <button
                  onClick={() => {
                    const id = revokeSelectedId;
                    if (id) handleRevoke(id);
                  }}
                  disabled={!revokeReason.trim()}
                  className="btn-danger px-5 py-2.5 text-sm"
                >
                  Revocar firma
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
