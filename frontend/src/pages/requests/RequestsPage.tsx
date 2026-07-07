import { useState, useEffect } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { Plus, Search, MoreHorizontal, CheckCircle, XCircle, X, Eye, Download } from 'lucide-react';
import { format } from 'date-fns';
import toast from 'react-hot-toast';
import { CertificatePreview } from '../../components/certificate/CertificatePreview';

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
  const [search, setSearch] = useState('');
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

  useEffect(() => { loadRequests(); }, [user, statusFilter]);

  const loadRequests = async () => {
    setLoading(true);
    try {
      let query = supabase
        .from('certificate_requests')
        .select('*, user:users!certificate_requests_user_id_fkey(first_name, last_name, email), template:templates(name)')
        .order('created_at', { ascending: false });

      if (user?.role === 'APPLICANT') query = query.eq('user_id', user.id);
      if (user?.role === 'SIGNER') query = query.in('status', ['PENDING', 'IN_REVIEW', 'APPROVED']);
      if (statusFilter) query = query.eq('status', statusFilter);

      const { data, error } = await query;

      if (error) {
        console.error('❌ Error al cargar solicitudes:', error);
        toast.error('Error al cargar las solicitudes');
        setRequests([]);
        return;
      }

      console.log('📋 Solicitudes cargadas:', data?.length || 0);
      setRequests(data || []);
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

  const filtered = requests.filter(r =>
    !search ||
    r.code?.toLowerCase().includes(search.toLowerCase()) ||
    `${r.user?.first_name || ''} ${r.user?.last_name || ''}`.toLowerCase().includes(search.toLowerCase()) ||
    getStudentName(r).toLowerCase().includes(search.toLowerCase()) ||
    getStudentDocument(r).toLowerCase().includes(search.toLowerCase()) ||
    r.template?.name?.toLowerCase().includes(search.toLowerCase())
  );

  const eligibleDownloadRequests = requests.filter(req =>
    req.certificate_url && ['APPROVED', 'SIGNED'].includes(req.status),
  );

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

  const getStudentName = (req: any) => {
    return req.data?.nombre_estudiante || req.data?.nombre || `${req.user?.first_name || ''} ${req.user?.last_name || ''}`.trim() || '—';
  };

  const getStudentDocument = (req: any) => {
    return req.data?.documento_estudiante || req.data?.document_id || req.data?.documento || req.user?.document_id || '—';
  };

  return (
    <div className="max-w-screen-2xl mx-auto px-4 md:px-6 xl:px-8 space-y-6 animate-fade-in min-h-screen">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-primary/10 rounded-2xl flex items-center justify-center">
            <svg className="w-5 h-5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
          </div>
          <div>
            <h1 className="text-headline-lg font-headline-lg text-on-surface">Solicitudes</h1>
            <p className="text-body-md text-on-surface-variant">
              {user?.role === 'APPLICANT' ? 'Mis solicitudes de certificados' : 'Gestiona las solicitudes de emisión'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-on-surface-variant/50" />
            <input type="text" placeholder="Buscar..." className="input pl-10 w-40 md:w-48"
              value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <select className="input w-32" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            <option value="">Todos</option>
            {Object.entries(statusConfig).map(([k, v]) => (
              <option key={k} value={k}>{v.label}</option>
            ))}
          </select>
          {(user?.role === 'SIGNER' || user?.role === 'ADMIN') && selectedRequestIds.length > 0 && (
            <button
              onClick={() => openSelectedRequestsModal(selectedRequestIds)}
              className="btn-secondary btn-sm"
            >
              Firmar seleccionadas ({selectedRequestIds.length})
            </button>
          )}
          {user?.role === 'APPLICANT' && (
            <>
              <button
                onClick={downloadSelectedCertificates}
                disabled={downloading || (selectedRequestIds.length === 0 ? eligibleDownloadRequests.length === 0 : selectedDownloadableCount === 0)}
                className="btn-secondary btn-sm"
              >
                {downloading
                  ? `Descargando (${downloadProgress.current}/${downloadProgress.total})`
                  : `Descargar masivo (${selectedRequestIds.length > 0 ? selectedDownloadableCount : eligibleDownloadRequests.length})`}
              </button>
              <Link to="/requests/new" className="btn-primary btn-sm">
                <Plus size={16} /> Nueva
              </Link>
            </>
          )}
        </div>
      </div>

      {/* Request list */}
      <div className="space-y-3">
        {loading ? (
          [...Array(4)].map((_, i) => (
            <div key={i} className="glass-card p-5 rounded-2xl animate-pulse">
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-xl bg-surface-container" />
                <div className="flex-1">
                  <div className="h-4 bg-surface-container rounded w-48 mb-2" />
                  <div className="h-3 bg-surface-container rounded w-32" />
                </div>
              </div>
            </div>
          ))
        ) : filtered.length === 0 ? (
          <div className="glass-card p-12 rounded-2xl text-center">
            <p className="text-body-lg text-on-surface-variant">No hay solicitudes</p>
            <p className="text-body-md text-on-surface-variant/60 mt-1">Las solicitudes aparecerán aquí</p>
          </div>
        ) : filtered.map((req) => {
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
                      {req.batch_id && (
                        <button
                          onClick={() => openBatchModal(req.batch_id)}
                          className="p-2 hover:bg-secondary/10 rounded-full text-secondary transition-colors"
                          title="Firmar lote"
                        >
                          <span className="text-sm font-semibold">Lote</span>
                        </button>
                      )}
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
        })}
      </div>

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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-fade-in">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden">
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
