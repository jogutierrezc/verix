import { useState, useEffect } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { FileText, CheckCircle, XCircle, Clock, Plus, TrendingUp, TrendingDown } from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

export function DashboardPage() {
  const { user } = useAuth();
  const [stats, setStats] = useState({ total: 0, pending: 0, approved: 0, rejected: 0 });
  const [recentActivity, setRecentActivity] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, [user]);

  const loadData = async () => {
    try {
      let baseQuery = supabase.from('certificate_requests').select('*', { count: 'exact', head: true });
      if (user?.role === 'APPLICANT') baseQuery = baseQuery.eq('user_id', user.id);

      const [total, pending, approved, rejected] = await Promise.all([
        baseQuery,
        supabase.from('certificate_requests').select('*', { count: 'exact', head: true }).eq('status', 'PENDING').then(r => r.count || 0),
        supabase.from('certificate_requests').select('*', { count: 'exact', head: true }).eq('status', 'APPROVED').then(r => r.count || 0),
        supabase.from('certificate_requests').select('*', { count: 'exact', head: true }).eq('status', 'REJECTED').then(r => r.count || 0),
      ]);

      setStats({
        total: total.count || 0,
        pending: pending as number,
        approved: approved as number,
        rejected: rejected as number,
      });

      let activityQuery = supabase
        .from('certificate_requests')
        .select('id, code, status, created_at, user:users(first_name, last_name), template:templates(name)')
        .order('created_at', { ascending: false })
        .limit(5);

      if (user?.role === 'APPLICANT') activityQuery = activityQuery.eq('user_id', user.id);

      const { data: activity } = await activityQuery;
      setRecentActivity(activity || []);

    } catch (err) {
      console.error('Error loading dashboard:', err);
    } finally {
      setLoading(false);
    }
  };

  const statusConfig: Record<string, { label: string; color: string; bg: string }> = {
    DRAFT: { label: 'Borrador', color: 'text-on-surface-variant', bg: 'bg-surface-variant' },
    PENDING: { label: 'Pendiente', color: 'text-secondary', bg: 'bg-secondary-fixed' },
    IN_REVIEW: { label: 'En revisión', color: 'text-tertiary', bg: 'bg-tertiary-fixed' },
    APPROVED: { label: 'Aprobado', color: 'text-primary', bg: 'bg-primary/10' },
    REJECTED: { label: 'Rechazado', color: 'text-error', bg: 'bg-error-container' },
    SIGNED: { label: 'Firmado', color: 'text-primary', bg: 'bg-primary-fixed' },
    REVOKED: { label: 'Revocado', color: 'text-on-surface-variant', bg: 'bg-surface-variant' },
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6 animate-fade-in">
      {/* Greeting */}
      <section>
        <h1 className="text-headline-lg-mobile md:text-headline-lg font-headline-lg text-on-surface">
          Hola, {user?.first_name || 'Usuario'} 👋
        </h1>
        <p className="text-body-md font-body-md text-on-surface-variant mt-1">
          {user?.role === 'ADMIN'
            ? 'Aquí tienes un resumen general de la plataforma.'
            : user?.role === 'SIGNER'
              ? 'Revisa y aprueba solicitudes pendientes.'
              : 'Gestiona tus solicitudes de certificados.'}
        </p>
      </section>

      {/* Search bar */}
      <section className="relative group">
        <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
          <svg className="w-4 h-4 text-outline" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
        </div>
        <input
          className="block w-full pl-10 pr-4 py-3 glass-card border-transparent focus:border-primary focus:ring-4 focus:ring-primary/10 rounded-2xl text-body-md transition-all outline-none"
          placeholder="Buscar certificados, solicitudes, usuarios..."
          type="text"
        />
      </section>

      {/* Stats Bento Grid */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {/* Pending */}
        <div className="glass-card p-4 rounded-2xl flex flex-col gap-2.5 active:scale-[0.98] transition-transform duration-200">
          <div className="w-9 h-9 rounded-xl bg-secondary-fixed flex items-center justify-center">
            <Clock size={20} className="text-secondary" />
          </div>
          <div>
            <span className="text-headline-sm font-headline-sm block leading-none">
              {loading ? <span className="animate-pulse">--</span> : stats.pending}
            </span>
            <span className="text-label-sm font-label-sm text-on-surface-variant">Pendientes</span>
            <div className="mt-1.5 flex items-center gap-1 text-[10px] font-semibold text-secondary bg-secondary-fixed py-0.5 px-1.5 rounded-full w-fit">
              <TrendingUp size={12} /> +12
            </div>
          </div>
        </div>

        {/* Approved */}
        <div className="glass-card p-4 rounded-2xl flex flex-col gap-2.5 active:scale-[0.98] transition-transform duration-200">
          <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center">
            <CheckCircle size={20} className="text-primary" />
          </div>
          <div>
            <span className="text-headline-sm font-headline-sm block leading-none">
              {loading ? <span className="animate-pulse">--</span> : stats.approved}
            </span>
            <span className="text-label-sm font-label-sm text-on-surface-variant">Aprobados</span>
            <div className="mt-1.5 flex items-center gap-1 text-[10px] font-semibold text-primary bg-primary/10 py-0.5 px-1.5 rounded-full w-fit">
              <TrendingUp size={12} /> +18%
            </div>
          </div>
        </div>

        {/* Rejected */}
        <div className="glass-card p-4 rounded-2xl flex flex-col gap-2.5 active:scale-[0.98] transition-transform duration-200">
          <div className="w-9 h-9 rounded-xl bg-error-container flex items-center justify-center">
            <XCircle size={20} className="text-error" />
          </div>
          <div>
            <span className="text-headline-sm font-headline-sm block leading-none">
              {loading ? <span className="animate-pulse">--</span> : stats.rejected}
            </span>
            <span className="text-label-sm font-label-sm text-on-surface-variant">Rechazados</span>
            <div className="mt-1.5 flex items-center gap-1 text-[10px] font-semibold text-error bg-error-container py-0.5 px-1.5 rounded-full w-fit">
              <TrendingDown size={12} /> -5%
            </div>
          </div>
        </div>

        {/* Total */}
        <div className="glass-card p-4 rounded-2xl flex flex-col gap-2.5 active:scale-[0.98] transition-transform duration-200">
          <div className="w-9 h-9 rounded-xl bg-surface-container-high flex items-center justify-center">
            <FileText size={20} className="text-on-surface-variant" />
          </div>
          <div>
            <span className="text-headline-sm font-headline-sm block leading-none">
              {loading ? <span className="animate-pulse">--</span> : stats.total}
            </span>
            <span className="text-label-sm font-label-sm text-on-surface-variant">Totales</span>
          </div>
        </div>
      </section>

      {/* Activity Chart */}
      <section className="glass-card p-4 rounded-2xl relative overflow-hidden h-32 flex flex-col justify-end">
        <div className="absolute top-4 left-4">
          <h3 className="text-[10px] font-bold text-on-surface-variant uppercase tracking-widest">Actividad de Emisión</h3>
          <p className="text-headline-sm font-headline-sm text-primary mt-0.5">Tendencia al alza</p>
        </div>
        <div className="w-full flex items-end justify-between h-16 gap-1 px-1">
          {[40, 60, 35, 75, 55, 90, 65].map((h, i) => (
            <div key={i} className="w-full bg-primary/20 rounded-md transition-all duration-500 hover:bg-primary"
              style={{ height: `${h}%` }} />
          ))}
        </div>
      </section>

      {/* Recent Activity */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-headline-md font-headline-md text-on-surface">Actividad reciente</h2>
          <Link to="/requests" className="text-primary font-semibold text-label-sm hover:underline">Ver todas</Link>
        </div>

        <div className="space-y-2">
          {loading ? (
            [...Array(3)].map((_, i) => (
              <div key={i} className="glass-card p-3.5 rounded-2xl animate-pulse">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-surface-container" />
                  <div className="flex-1">
                    <div className="h-4 bg-surface-container rounded w-40 mb-1" />
                    <div className="h-3 bg-surface-container rounded w-28" />
                  </div>
                </div>
              </div>
            ))
          ) : recentActivity.length === 0 ? (
            <div className="glass-card p-6 rounded-2xl text-center text-on-surface-variant">
              <p>Sin actividad reciente</p>
            </div>
          ) : recentActivity.map((item) => {
            const status = statusConfig[item.status] || { label: item.status, color: '', bg: '' };
            return (
              <Link
                key={item.id}
                to="/requests"
                className="glass-card p-3.5 rounded-2xl flex items-center justify-between group active:bg-surface-container-high/40 transition-all"
              >
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-surface-container flex items-center justify-center">
                    <FileText size={18} className="text-outline" />
                  </div>
                  <div>
                    <p className="text-body-md font-semibold text-on-surface">{item.code}</p>
                    <p className="text-label-sm text-on-surface-variant">
                      {item.user?.first_name} {item.user?.last_name}
                      {item.template?.name && ` · ${item.template.name}`}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${status.color} ${status.bg}`}>
                    {status.label}
                  </span>
                  <span className="text-[11px] text-on-surface-variant/60 hidden sm:block">
                    {format(new Date(item.created_at), 'dd MMM', { locale: es })}
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      </section>

      {/* New request FAB for mobile */}
      {user?.role === 'APPLICANT' && (
        <Link
          to="/requests/new"
          className="fixed bottom-24 right-6 w-16 h-16 bg-primary text-on-primary rounded-full shadow-2xl flex items-center justify-center hover:scale-105 active:scale-95 transition-all z-40 lg:hidden"
        >
          <Plus size={32} />
        </Link>
      )}
    </div>
  );
}
