import { useState, useEffect, useMemo, useCallback } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { FileText, CheckCircle, XCircle, Clock, Plus, TrendingUp, TrendingDown, Building2, Activity, Layout } from 'lucide-react';
import { format, subWeeks, subMonths, eachDayOfInterval, eachWeekOfInterval, eachMonthOfInterval, differenceInHours } from 'date-fns';
import { es } from 'date-fns/locale';
import { SkeletonCard } from '../../components/ui/SkeletonCard';
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  Cell, LabelList
} from 'recharts';

// ── Types ──
type TimePeriod = 'day' | 'week' | 'month' | 'semester' | 'year';

interface PeriodOption {
  key: TimePeriod;
  label: string;
  months: number;
}

const PERIODS: PeriodOption[] = [
  { key: 'day', label: 'Día', months: 1 },
  { key: 'week', label: 'Semana', months: 3 },
  { key: 'month', label: 'Mes', months: 12 },
  { key: 'semester', label: 'Semestre', months: 24 },
  { key: 'year', label: 'Año', months: 60 },
];

interface FlowDataPoint {
  label: string;
  created: number;
  approved: number;
  rejected: number;
}

interface DependencyStat {
  name: string;
  count: number;
  approved: number;
  percentage: number;
}

interface ProjectionData {
  year: number;
  actual: number;
  projected: number;
}

const COLORS = {
  primary: '#006e2f',
  primaryLight: '#22c55e',
  secondary: '#9d4300',
  error: '#ba1a1a',
  info: '#1a6bba',
  surface: '#e6e8ea',
  chart: ['#006e2f', '#22c55e', '#9d4300', '#ba1a1a', '#1a6bba', '#7b1fa2', '#00897b'],
};

const statusColors: Record<string, string> = {
  PENDING: COLORS.secondary,
  APPROVED: COLORS.primary,
  SIGNED: COLORS.primaryLight,
  REJECTED: COLORS.error,
  IN_REVIEW: COLORS.info,
  DRAFT: COLORS.surface,
  REVOKED: '#565e74',
};

// ── Linear regression for projections ──
function linearRegression(data: { x: number; y: number }[]) {
  const n = data.length;
  if (n < 2) return { slope: 0, intercept: 0, r2: 0 };
  const sumX = data.reduce((s, d) => s + d.x, 0);
  const sumY = data.reduce((s, d) => s + d.y, 0);
  const sumXY = data.reduce((s, d) => s + d.x * d.y, 0);
  const sumX2 = data.reduce((s, d) => s + d.x * d.x, 0);
  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;
  const meanY = sumY / n;
  const ssTot = data.reduce((s, d) => s + (d.y - meanY) ** 2, 0);
  const ssRes = data.reduce((s, d) => s + (d.y - (slope * d.x + intercept)) ** 2, 0);
  const r2 = ssTot > 0 ? 1 - ssRes / ssTot : 0;
  return { slope, intercept, r2 };
}

// ── Custom Tooltip ──
const ChartTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white/95 backdrop-blur-md rounded-xl shadow-xl border border-outline-variant/30 p-3 text-sm">
      <p className="font-bold text-on-surface mb-1.5">{label}</p>
      {payload.map((p: any, i: number) => (
        <div key={i} className="flex items-center gap-2 text-xs">
          <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: p.color }} />
          <span className="text-on-surface-variant">{p.name}:</span>
          <span className="font-semibold text-on-surface">{p.value}</span>
        </div>
      ))}
    </div>
  );
};

// ── Mini stat card ──
function StatCard({ icon: Icon, label, value, trend, trendUp, color }: {
  icon: any; label: string; value: string | number; trend?: string; trendUp?: boolean; color: string;
}) {
  return (
    <div className="glass-card p-4 rounded-2xl flex flex-col gap-2.5 active:scale-[0.98] transition-transform duration-200">
      <div className="flex items-center justify-between">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ backgroundColor: `${color}15` }}>
          <Icon size={20} style={{ color }} />
        </div>
        {trend && (
          <span className={`flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full ${trendUp ? 'text-primary bg-primary/10' : 'text-error bg-error-container'}`}>
            {trendUp ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
            {trend}
          </span>
        )}
      </div>
      <div>
        <span className="text-headline-sm font-headline-sm block leading-none">{value}</span>
        <span className="text-label-sm font-label-sm text-on-surface-variant">{label}</span>
      </div>
    </div>
  );
}

export function DashboardPage() {
  const { user } = useAuth();
  const isAdminOrSigner = user?.role === 'ADMIN' || user?.role === 'SIGNER';
  const isApplicant = user?.role === 'APPLICANT';

  // ── State ──
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<TimePeriod>('month');
  const [allRequests, setAllRequests] = useState<any[]>([]);
  const [dependencies, setDependencies] = useState<any[]>([]);
  const [recentActivity, setRecentActivity] = useState<any[]>([]);

  // ── Data loading ──
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      // 1. Fetch all requests (filtered by role)
      let query = supabase
        .from('certificate_requests')
        .select('id, code, status, created_at, reviewed_at, user_id, template_id, verification_code, certificate_url, template:templates(name), user:users!certificate_requests_user_id_fkey(id, first_name, last_name, dependency_id, dependency:dependencies(name))')
        .order('created_at', { ascending: false });

      if (isApplicant) {
        query = query.eq('user_id', user!.id);
      }

      const { data: requests } = await query;
      setAllRequests(requests || []);

      // 2. Load dependencies for name mapping
      const { data: deps } = await supabase.from('dependencies').select('id, name');
      setDependencies(deps || []);

      // 3. Recent activity
      let activityQuery = supabase
        .from('certificate_requests')
        .select('id, code, status, created_at, user:users(first_name, last_name), template:templates(name)')
        .order('created_at', { ascending: false })
        .limit(5);

      if (isApplicant) activityQuery = activityQuery.eq('user_id', user!.id);

      const { data: activity } = await activityQuery;
      setRecentActivity(activity || []);
    } catch (err) {
      console.error('Error loading dashboard data:', err);
    } finally {
      setLoading(false);
    }
  }, [user, isApplicant]);

  useEffect(() => { loadData(); }, [loadData]);

  // ── Derived analytics ──
  const periodConfig = PERIODS.find(p => p.key === period)!;

  const flowData = useMemo<FlowDataPoint[]>(() => {
    const now = new Date();
    const startDate = subMonths(now, periodConfig.months);
    const filtered = allRequests.filter(r => new Date(r.created_at) >= startDate);

    // Group by month for semester/year, by week or day for shorter periods
    let intervals: Date[];
    let formatLabel: (d: Date) => string;

    if (period === 'day') {
      intervals = eachDayOfInterval({ start: subMonths(now, 1), end: now });
      formatLabel = d => format(d, 'dd MMM', { locale: es });
    } else if (period === 'week') {
      intervals = eachWeekOfInterval({ start: subWeeks(now, 12), end: now }, { weekStartsOn: 1 });
      formatLabel = d => `Sem ${format(d, 'dd/MM', { locale: es })}`;
    } else if (period === 'semester') {
      // Aggregate into 2 semesters per year (Jan-Jun, Jul-Dec)
      const semesters: Date[] = [];
      let cursor = subMonths(now, 24);
      const semesterStart = cursor.getMonth() < 6 ? 0 : 6;
      cursor = new Date(cursor.getFullYear(), semesterStart, 1);
      while (cursor <= now) {
        semesters.push(cursor);
        cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 6, 1);
      }
      intervals = semesters;
      formatLabel = d => {
        const m = d.getMonth();
        return `${d.getFullYear()} ${m < 6 ? 'H1' : 'H2'}`;
      };
    } else if (period === 'year') {
      // Aggregate by year
      const years: Date[] = [];
      let cursor = new Date(new Date().getFullYear() - 5, 0, 1);
      while (cursor <= now) {
        years.push(cursor);
        cursor = new Date(cursor.getFullYear() + 1, 0, 1);
      }
      intervals = years;
      formatLabel = d => `${d.getFullYear()}`;
    } else {
      // month
      intervals = eachMonthOfInterval({ start: subMonths(now, 12), end: now });
      formatLabel = d => format(d, 'MMM', { locale: es });
    }

    return intervals.map(date => {
      const start = date;
      let end: Date;
      if (period === 'day') end = new Date(start);
      else if (period === 'week') end = new Date(start.getTime() + 6 * 24 * 60 * 60 * 1000);
      else if (period === 'semester') {
        const m = start.getMonth();
        end = new Date(start.getFullYear(), m < 6 ? 5 : 11, 31);
      } else if (period === 'year') {
        end = new Date(start.getFullYear(), 11, 31);
      } else end = new Date(start.getFullYear(), start.getMonth() + 1, 0);

      const inInterval = (r: any) => {
        const d = new Date(r.created_at);
        return d >= start && d <= end;
      };

      const bucket = filtered.filter(inInterval);
      return {
        label: formatLabel(start),
        created: bucket.length,
        approved: bucket.filter(r => r.status === 'APPROVED' || r.status === 'SIGNED').length,
        rejected: bucket.filter(r => r.status === 'REJECTED').length,
      };
    });
  }, [allRequests, period, periodConfig]);

  // ── Status distribution ──
  const statusDistribution = useMemo(() => {
    const counts: Record<string, number> = {};
    const now = new Date();
    const startDate = subMonths(now, periodConfig.months);
    const filtered = allRequests.filter(r => new Date(r.created_at) >= startDate);

    for (const r of filtered) {
      counts[r.status] = (counts[r.status] || 0) + 1;
    }

    const labelMap: Record<string, string> = {
      PENDING: 'Pendiente', APPROVED: 'Aprobado', SIGNED: 'Firmado',
      REJECTED: 'Rechazado', IN_REVIEW: 'Revisión', DRAFT: 'Borrador', REVOKED: 'Revocado',
    };

    return Object.entries(counts)
      .map(([status, value]) => ({
        name: labelMap[status] || status,
        value,
        color: statusColors[status] || COLORS.surface,
      }))
      .sort((a, b) => b.value - a.value);
  }, [allRequests, period, periodConfig]);

  // ── Top dependencies ──
  const topDependencies = useMemo<DependencyStat[]>(() => {
    const depCount: Record<string, { count: number; approved: number }> = {};
    const depNameMap = new Map(dependencies.map(d => [d.id, d.name]));
    const now = new Date();
    const startDate = subMonths(now, periodConfig.months);
    const filtered = allRequests.filter(r => new Date(r.created_at) >= startDate);

    for (const r of filtered) {
      const depId = r.user?.dependency_id;
      if (!depId) continue;
      if (!depCount[depId]) depCount[depId] = { count: 0, approved: 0 };
      depCount[depId].count++;
      if (r.status === 'APPROVED' || r.status === 'SIGNED') depCount[depId].approved++;
    }

    const total = filtered.length;
    return Object.entries(depCount)
      .map(([id, st]) => ({
        name: depNameMap.get(id) || 'Sin dependencia',
        count: st.count,
        approved: st.approved,
        percentage: total > 0 ? Math.round((st.count / total) * 100) : 0,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);
  }, [allRequests, dependencies, period, periodConfig]);

  // ── Stats summary ──
  const stats = useMemo(() => {
    const now = new Date();
    const startDate = subMonths(now, periodConfig.months);
    const filtered = allRequests.filter(r => new Date(r.created_at) >= startDate);
    const total = filtered.length;
    const pending = filtered.filter(r => r.status === 'PENDING').length;
    const approved = filtered.filter(r => r.status === 'APPROVED' || r.status === 'SIGNED').length;
    const rejected = filtered.filter(r => r.status === 'REJECTED').length;
    const approvalRate = total > 0 ? Math.round((approved / total) * 100) : 0;

    // Average approval time (hours)
    const approvedReqs = filtered.filter(r => r.reviewed_at && (r.status === 'APPROVED' || r.status === 'SIGNED'));
    const totalHours = approvedReqs.reduce((sum, r) => {
      return sum + differenceInHours(new Date(r.reviewed_at), new Date(r.created_at));
    }, 0);
    const avgApprovalTime = approvedReqs.length > 0 ? Math.round(totalHours / approvedReqs.length) : 0;

    return { total, pending, approved, rejected, approvalRate, avgApprovalTime };
  }, [allRequests, period, periodConfig]);

  // ── Future projection (linear regression) ──
  const projection = useMemo<{ nextYear: number; growth: number; data: ProjectionData[] }>(() => {
    // Use monthly data for projection
    const monthlyData = eachMonthOfInterval({
      start: subMonths(new Date(), 12),
      end: new Date(),
    }).map((date, i) => {
      const start = date;
      const end = new Date(date.getFullYear(), date.getMonth() + 1, 0);
      const count = allRequests.filter(r => {
        const d = new Date(r.created_at);
        return d >= start && d <= end;
      }).length;
      return { x: i, y: count, month: format(date, 'MMM yy', { locale: es }) };
    });

    const regression = linearRegression(monthlyData.map(d => ({ x: d.x, y: d.y })));
    const currentYearTotal = allRequests.filter(r => {
      const d = new Date(r.created_at);
      return d.getFullYear() === new Date().getFullYear();
    }).length;

    // Project next 12 months
    const projectedMonthly = regression.slope * 11 + regression.intercept; // last point + 1
    const projectedNextYear = Math.max(0, Math.round(projectedMonthly * 12));
    const growth = regression.r2 > 0.5 && regression.slope > 0
      ? Math.round((regression.slope / (regression.intercept || 1)) * 100)
      : 0;

    const chartData: ProjectionData[] = [];
    const currentYear = new Date().getFullYear();
    chartData.push({ year: currentYear - 1, actual: currentYearTotal, projected: 0 });
    chartData.push({ year: currentYear, actual: currentYearTotal, projected: 0 });
    chartData.push({ year: currentYear + 1, actual: 0, projected: projectedNextYear });

    return { nextYear: projectedNextYear, growth, data: chartData };
  }, [allRequests]);

  // ── Template usage stats ──
  const templateStats = useMemo(() => {
    const counts: Record<string, { count: number; approved: number; rejected: number; pending: number }> = {};
    const now = new Date();
    const startDate = subMonths(now, periodConfig.months);
    const filtered = allRequests.filter(r => new Date(r.created_at) >= startDate);

    for (const r of filtered) {
      const name = r.template?.name || 'Sin plantilla';
      if (!counts[name]) counts[name] = { count: 0, approved: 0, rejected: 0, pending: 0 };
      counts[name].count++;
      if (r.status === 'APPROVED' || r.status === 'SIGNED') counts[name].approved++;
      else if (r.status === 'REJECTED') counts[name].rejected++;
      else counts[name].pending++;
    }

    return Object.entries(counts)
      .map(([name, st]) => ({
        name,
        count: st.count,
        approved: st.approved,
        rejected: st.rejected,
        pending: st.pending,
        approvalRate: st.count > 0 ? Math.round((st.approved / st.count) * 100) : 0,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
  }, [allRequests, period, periodConfig]);

  // ── Template annual projection ──
  const templateProjection = useMemo(() => {
    // Group by template + year
    const yearTemplate: Record<string, Record<number, number>> = {};
    const currentYear = new Date().getFullYear();

    for (const r of allRequests) {
      const d = new Date(r.created_at);
      const year = d.getFullYear();
      // Only last 2 years + current year
      if (year < currentYear - 1) continue;
      const name = r.template?.name || 'Sin plantilla';
      if (!yearTemplate[name]) yearTemplate[name] = {};
      yearTemplate[name][year] = (yearTemplate[name][year] || 0) + 1;
    }

    // Calculate growth rate and project next year
    const projections = Object.entries(yearTemplate)
      .filter(([name]) => name !== 'Sin plantilla')
      .map(([name, years]) => {
        const lastYear = years[currentYear - 1] || 0;
        const thisYear = years[currentYear] || 0;
        const growth = lastYear > 0 ? Math.round(((thisYear - lastYear) / lastYear) * 100) : 0;
        const projected = Math.max(0, Math.round(thisYear * (1 + (growth / 100))));
        return { name, lastYear, thisYear, projected, growth };
      })
      .sort((a, b) => b.thisYear - a.thisYear)
      .slice(0, 8);

    return projections;
  }, [allRequests]);

  // ── Status display config ──
  const statusDisplay: Record<string, { label: string; color: string; bg: string }> = {
    PENDING: { label: 'Pendiente', color: 'text-secondary', bg: 'bg-secondary-fixed' },
    APPROVED: { label: 'Aprobado', color: 'text-primary', bg: 'bg-primary/10' },
    SIGNED: { label: 'Firmado', color: 'text-primary', bg: 'bg-primary-fixed' },
    REJECTED: { label: 'Rechazado', color: 'text-error', bg: 'bg-error-container' },
    IN_REVIEW: { label: 'En revisión', color: 'text-tertiary', bg: 'bg-tertiary-fixed' },
    DRAFT: { label: 'Borrador', color: 'text-on-surface-variant', bg: 'bg-surface-variant' },
    REVOKED: { label: 'Revocado', color: 'text-on-surface-variant', bg: 'bg-surface-variant' },
  };

  // ── Render ──
  return (
    <div className="max-w-7xl mx-auto space-y-6 animate-fade-in">
      {/* Greeting */}
      <section>
        <h1 className="text-headline-lg-mobile md:text-headline-lg font-headline-lg text-on-surface">
          {isApplicant ? `Hola, ${user?.first_name || 'Usuario'} 👋` : 'Panel de Analítica 📊'}
        </h1>
        <p className="text-body-md font-body-md text-on-surface-variant mt-1">
          {isApplicant
            ? 'Gestiona tus solicitudes de certificados.'
            : 'Análisis de flujo de solicitudes, firmas por dependencia y proyecciones.'}
        </p>
      </section>

      {/* Stats + Period Selector */}
      <section className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3 flex-1">
          <StatCard icon={FileText} label="Solicitudes" value={loading ? '--' : stats.total} color={COLORS.primary} />
          <StatCard icon={Clock} label="Pendientes" value={loading ? '--' : stats.pending}
            color={COLORS.secondary} trend={stats.pending > 0 ? `${stats.pending}` : undefined} trendUp={false} />
          <StatCard icon={CheckCircle} label="Aprobados" value={loading ? '--' : stats.approved}
            color={COLORS.primaryLight} trend={stats.approvalRate > 0 ? `${stats.approvalRate}%` : undefined} trendUp={stats.approvalRate > 50} />
          <StatCard icon={XCircle} label="Rechazados" value={loading ? '--' : stats.rejected}
            color={COLORS.error} trend={stats.rejected > 0 ? `${stats.rejected}` : undefined} trendUp={false} />
          <StatCard icon={Activity} label="Tiempo prom." value={loading ? '--' : `${stats.avgApprovalTime}h`}
            color={COLORS.info} />
        </div>

        {/* Period selector - horizontal scroll on mobile */}
        {isAdminOrSigner && (
          <div className="w-full sm:w-auto overflow-x-auto -mx-2 sm:mx-0 px-2 sm:px-0 [&::-webkit-scrollbar]:hidden">
            <div className="inline-flex glass-card rounded-xl p-1 shrink-0">
              {PERIODS.map(p => (
                <button
                  key={p.key}
                  onClick={() => setPeriod(p.key)}
                  className={`px-4 py-2 sm:px-3 sm:py-1.5 text-xs font-bold rounded-lg transition-all whitespace-nowrap touch-manipulation ${
                    period === p.key
                      ? 'bg-primary text-on-primary shadow-sm'
                      : 'text-on-surface-variant hover:text-on-surface active:text-on-surface'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </section>

      {isApplicant ? (
        <>
          {/* Applicant: simplified stats + recent activity */}
          <section className="glass-card p-5 rounded-2xl flex flex-col sm:flex-row items-center justify-between gap-4">
            <div>
              <h3 className="text-sm font-bold text-on-surface">Estado de tus solicitudes</h3>
              <p className="text-xs text-on-surface-variant mt-1">Últimos 12 meses</p>
            </div>
            <div className="flex items-center gap-4 text-sm">
              <div className="flex items-center gap-2">
                <div className="w-2.5 h-2.5 rounded-full bg-secondary" />
                <span className="text-on-surface-variant">Pendientes: <strong className="text-on-surface">{stats.pending}</strong></span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-2.5 h-2.5 rounded-full bg-primary" />
                <span className="text-on-surface-variant">Aprobados: <strong className="text-on-surface">{stats.approved}</strong></span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-2.5 h-2.5 rounded-full bg-error" />
                <span className="text-on-surface-variant">Rechazados: <strong className="text-on-surface">{stats.rejected}</strong></span>
              </div>
            </div>
          </section>

          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={flowData}>
                <defs>
                  <linearGradient id="colorCreated" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={COLORS.primary} stopOpacity={0.2} />
                    <stop offset="95%" stopColor={COLORS.primary} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e6e8ea" />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#565e74' }} />
                <YAxis tick={{ fontSize: 11, fill: '#565e74' }} />
                <Tooltip content={<ChartTooltip />} />
                <Area type="monotone" dataKey="created" name="Creadas" stroke={COLORS.primary} fill="url(#colorCreated)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </>
      ) : (
        /* ── ADMIN / SIGNER: Full analytics ── */
        <>
          {/* Row 1: Flow chart + Status donut */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Main flow chart */}
            <div className="glass-card p-5 rounded-2xl lg:col-span-2">
              <h3 className="text-sm font-bold text-on-surface mb-1">Flujo de solicitudes</h3>
              <p className="text-[11px] text-on-surface-variant/60 mb-4">Evolución mensual de creación, aprobación y rechazo</p>
              <div className="h-[280px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={flowData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e6e8ea" />
                    <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#565e74' }} interval="preserveStartEnd" />
                    <YAxis tick={{ fontSize: 10, fill: '#565e74' }} />
                    <Tooltip content={<ChartTooltip />} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Line type="monotone" dataKey="created" name="Creadas" stroke={COLORS.info} strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                    <Line type="monotone" dataKey="approved" name="Aprobadas" stroke={COLORS.primary} strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                    <Line type="monotone" dataKey="rejected" name="Rechazadas" stroke={COLORS.error} strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Status distribution donut */}
            <div className="glass-card p-5 rounded-2xl">
              <h3 className="text-sm font-bold text-on-surface mb-1">Distribución por estado</h3>
              <p className="text-[11px] text-on-surface-variant/60 mb-2">Total: {stats.total} solicitudes</p>
              <div className="h-[250px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={statusDistribution}
                      cx="50%" cy="50%"
                      innerRadius={55}
                      outerRadius={85}
                      paddingAngle={3}
                      dataKey="value"
                    >
                      {statusDistribution.map((entry, i) => (
                        <Cell key={i} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip content={<ChartTooltip />} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-1.5 mt-1">
                {statusDistribution.map(s => (
                  <div key={s.name} className="flex items-center gap-1.5 text-[11px]">
                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: s.color }} />
                    <span className="text-on-surface-variant">{s.name}</span>
                    <strong className="text-on-surface">{s.value}</strong>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Row 2: Dependencies bar + Cumulative area + Projection */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Top dependencies */}
            <div className="glass-card p-5 rounded-2xl">
              <h3 className="text-sm font-bold text-on-surface mb-1 flex items-center gap-2">
                <Building2 size={14} className="text-primary" />
                Dependencias con más actividad
              </h3>
              <p className="text-[11px] text-on-surface-variant/60 mb-4">Gestión de firmas por dependencia</p>
              <div className="h-[260px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={topDependencies} layout="vertical" margin={{ left: 10, right: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e6e8ea" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 10, fill: '#565e74' }} />
                    <YAxis dataKey="name" type="category" tick={{ fontSize: 10, fill: '#565e74' }} width={100} />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar dataKey="count" name="Solicitudes" fill={COLORS.primary} radius={[0, 4, 4, 0]}>
                      <LabelList dataKey="count" position="right" style={{ fontSize: 10, fill: '#191c1e', fontWeight: 600 }} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              {topDependencies.length === 0 && (
                <p className="text-xs text-on-surface-variant/60 text-center py-8">Sin datos de dependencias</p>
              )}
            </div>

            {/* Cumulative flow */}
            <div className="glass-card p-5 rounded-2xl">
              <h3 className="text-sm font-bold text-on-surface mb-1">Flujo acumulado</h3>
              <p className="text-[11px] text-on-surface-variant/60 mb-4">Solicitudes acumuladas en el tiempo</p>
              <div className="h-[260px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={flowData}>
                    <defs>
                      <linearGradient id="gradCreated" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={COLORS.info} stopOpacity={0.15} />
                        <stop offset="95%" stopColor={COLORS.info} stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="gradApproved" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={COLORS.primary} stopOpacity={0.2} />
                        <stop offset="95%" stopColor={COLORS.primary} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e6e8ea" />
                    <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#565e74' }} />
                    <YAxis tick={{ fontSize: 10, fill: '#565e74' }} />
                    <Tooltip content={<ChartTooltip />} />
                    <Area type="monotone" dataKey="created" name="Creadas" stroke={COLORS.info} fill="url(#gradCreated)" strokeWidth={2} />
                    <Area type="monotone" dataKey="approved" name="Aprobadas" stroke={COLORS.primary} fill="url(#gradApproved)" strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Future projection */}
            <div className="glass-card p-5 rounded-2xl">
              <h3 className="text-sm font-bold text-on-surface mb-1 flex items-center gap-2">
                <TrendingUp size={14} className="text-primary" />
                Proyección anual
              </h3>
              <p className="text-[11px] text-on-surface-variant/60 mb-4">Estimación basada en tendencia histórica</p>

              <div className="h-[180px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={projection.data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e6e8ea" vertical={false} />
                    <XAxis dataKey="year" tick={{ fontSize: 11, fill: '#565e74' }} />
                    <YAxis tick={{ fontSize: 10, fill: '#565e74' }} />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar dataKey="actual" name="Actual" fill={COLORS.primary} radius={[4, 4, 0, 0]} />
                    <Bar dataKey="projected" name="Proyectado" fill={COLORS.secondary} radius={[4, 4, 0, 0]} opacity={0.7} />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <div className="grid grid-cols-2 gap-3 mt-3 pt-3 border-t border-outline-variant/20">
                <div>
                  <p className="text-[10px] text-on-surface-variant/60 uppercase tracking-wider font-bold">Proyección {new Date().getFullYear() + 1}</p>
                  <p className="text-headline-sm font-headline-sm text-primary">{projection.nextYear}</p>
                </div>
                <div>
                  <p className="text-[10px] text-on-surface-variant/60 uppercase tracking-wider font-bold">Crecimiento estimado</p>
                  <p className={`text-headline-sm font-headline-sm ${projection.growth > 0 ? 'text-primary' : 'text-error'}`}>
                    {projection.growth > 0 ? '+' : ''}{projection.growth}%
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Row 3: Template usage stats */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Template usage frequency - horizontal bar chart */}
            <div className="glass-card p-5 rounded-2xl lg:col-span-2">
              <h3 className="text-sm font-bold text-on-surface mb-1 flex items-center gap-2">
                <Layout size={14} className="text-primary" />
                Uso de plantillas
              </h3>
              <p className="text-[11px] text-on-surface-variant/60 mb-4">Frecuencia de uso por tipo de plantilla en el período</p>
              <div className="h-[280px]">
                {templateStats.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={templateStats} layout="vertical" margin={{ left: 10, right: 30, bottom: 10 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e6e8ea" horizontal={false} />
                      <XAxis type="number" tick={{ fontSize: 10, fill: '#565e74' }} />
                      <YAxis dataKey="name" type="category" tick={{ fontSize: 10, fill: '#565e74' }} width={120} />
                      <Tooltip content={<ChartTooltip />} />
                      <Bar dataKey="approved" name="Aprobadas" fill={COLORS.primaryLight} radius={[0, 4, 4, 0]} stackId="a" />
                      <Bar dataKey="pending" name="Pendientes" fill={COLORS.secondary} radius={[0, 4, 4, 0]} stackId="a" />
                      <Bar dataKey="rejected" name="Rechazadas" fill={COLORS.error} radius={[0, 4, 4, 0]} stackId="a" />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex items-center justify-center h-full text-xs text-on-surface-variant/60">
                    Sin datos de plantillas en el período
                  </div>
                )}
              </div>
              {templateStats.length > 0 && (
                <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-[11px] text-on-surface-variant">
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: COLORS.primary }} />
                    <strong className="text-on-surface">{templateStats.reduce((s, t) => s + t.count, 0)}</strong> total
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: COLORS.primaryLight }} />
                    <strong className="text-on-surface">{templateStats.reduce((s, t) => s + t.approved, 0)}</strong> aprobadas
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: COLORS.secondary }} />
                    <strong className="text-on-surface">{templateStats.reduce((s, t) => s + t.pending, 0)}</strong> pendientes
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: COLORS.error }} />
                    <strong className="text-on-surface">{templateStats.reduce((s, t) => s + t.rejected, 0)}</strong> rechazadas
                  </span>
                </div>
              )}
            </div>

            {/* Template annual projection */}
            <div className="glass-card p-5 rounded-2xl">
              <h3 className="text-sm font-bold text-on-surface mb-1 flex items-center gap-2">
                <TrendingUp size={14} className="text-primary" />
                Prospectiva por plantilla
              </h3>
              <p className="text-[11px] text-on-surface-variant/60 mb-4">Proyección anual por tipo de plantilla</p>
              <div className="space-y-3 max-h-[280px] overflow-y-auto custom-scrollbar pr-1">
                {templateProjection.length > 0 ? (
                  templateProjection.map(t => (
                    <div key={t.name} className="flex items-center gap-3 p-2.5 rounded-xl hover:bg-surface-container-low transition-colors">
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-on-surface truncate" title={t.name}>{t.name}</p>
                        <div className="flex items-center gap-2 mt-1.5">
                          {/* Mini bar showing this year vs projected */}
                          <div className="flex-1 h-2 bg-surface-variant rounded-full overflow-hidden">
                            <div className="h-full rounded-full" style={{
                              width: `${Math.min(100, (t.thisYear / Math.max(t.projected, 1)) * 100)}%`,
                              backgroundColor: COLORS.primary,
                            }} />
                          </div>
                          <span className="text-[10px] font-mono font-bold text-on-surface w-6 text-right">
                            {t.thisYear}
                          </span>
                          <span className="text-[10px] font-mono text-on-surface-variant/60">→</span>
                          <span className="text-[10px] font-mono font-bold text-secondary w-6">
                            {t.projected}
                          </span>
                        </div>
                      </div>
                      {t.growth !== 0 && (
                        <div className={`shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                          t.growth > 0 ? 'text-primary bg-primary/10' : 'text-error bg-error-container'
                        }`}>
                          {t.growth > 0 ? '+' : ''}{t.growth}%
                        </div>
                      )}
                    </div>
                  ))
                ) : (
                  <div className="flex items-center justify-center h-32 text-xs text-on-surface-variant/60">
                    Sin datos históricos suficientes
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Recent Activity */}
          <section>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-headline-md font-headline-md text-on-surface">Actividad reciente</h2>
              <Link to="/requests" className="text-primary font-semibold text-label-sm hover:underline">Ver todas</Link>
            </div>

            <div className="space-y-2">
              {loading ? (
                <SkeletonCard variant="list-item" count={3} />
              ) : recentActivity.length === 0 ? (
                <div className="glass-card p-6 rounded-2xl text-center text-on-surface-variant">
                  <p>Sin actividad reciente</p>
                </div>
              ) : recentActivity.map((item) => {
                const status = statusDisplay[item.status] || { label: item.status, color: '', bg: '' };
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
        </>
      )}

      {/* New request FAB for mobile */}
      {isApplicant && (
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
