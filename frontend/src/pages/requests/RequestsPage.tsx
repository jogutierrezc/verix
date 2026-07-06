import { useState, useEffect } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { Plus, Search, MoreHorizontal, CheckCircle, XCircle, Eye, Download } from 'lucide-react';
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
    !search || r.code?.toLowerCase().includes(search.toLowerCase()) ||
    r.user?.first_name?.toLowerCase().includes(search.toLowerCase()) ||
    r.template?.name?.toLowerCase().includes(search.toLowerCase())
  );

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
          {user?.role === 'APPLICANT' && (
            <Link to="/requests/new" className="btn-primary btn-sm">
              <Plus size={16} /> Nueva
            </Link>
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
              <div className="flex-1 grid grid-cols-1 md:grid-cols-4 gap-3">
                <div>
                  <span className="text-[11px] uppercase tracking-wider text-on-surface-variant/60 font-bold">ID Solicitud</span>
                  <p className="font-mono text-sm font-semibold text-primary mt-0.5">{req.code}</p>
                </div>
                <div>
                  <span className="text-[11px] uppercase tracking-wider text-on-surface-variant/60 font-bold">Solicitante</span>
                  <p className="font-semibold text-sm mt-0.5">{req.user?.first_name} {req.user?.last_name}</p>
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
    </div>
  );
}
