import { useState, useEffect, useMemo, useRef } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { supabase } from '../../lib/supabase';
import {
  FileText, CheckCircle, XCircle, Clock, TrendingUp, TrendingDown,
  Activity, Download, Eye, Printer, BarChart3, Filter,
} from 'lucide-react';
import { format, subMonths, eachMonthOfInterval, differenceInHours } from 'date-fns';
import { es } from 'date-fns/locale';
import toast from 'react-hot-toast';
import jsPDF from 'jspdf';
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  Cell, LabelList,
} from 'recharts';

// ── Types ──
type ReportPeriod = 'monthly' | 'semester' | 'annual';

interface PeriodOption {
  key: ReportPeriod;
  label: string;
  months: number;
}

const PERIODS: PeriodOption[] = [
  { key: 'monthly', label: 'Mensual', months: 12 },
  { key: 'semester', label: 'Semestral', months: 24 },
  { key: 'annual', label: 'Anual', months: 60 },
];

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
function StatCard({ icon: Icon, label, value, sub, trend, trendUp, color }: {
  icon: any; label: string; value: string | number; sub?: string; trend?: string; trendUp?: boolean; color: string;
}) {
  return (
    <div className="glass-card p-4 rounded-2xl flex flex-col gap-2.5 active:scale-[0.98] transition-transform duration-200">
      <div className="flex items-center justify-between">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ backgroundColor: `${color}15` }}>
          <Icon size={20} style={{ color }} />
        </div>
        {trend && (
          <span className={`flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
            trendUp ? 'text-primary bg-primary/10' : 'text-error bg-error-container'
          }`}>
            {trendUp ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
            {trend}
          </span>
        )}
      </div>
      <div>
        <span className="text-headline-sm font-headline-sm block leading-none">{value}</span>
        <span className="text-label-sm font-label-sm text-on-surface-variant">{label}</span>
        {sub && <p className="text-[10px] text-on-surface-variant/60 mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

export function ReportsPage() {
  const { user } = useAuth();
  const role = user?.role || 'APPLICANT';
  const isAdmin = role === 'ADMIN';
  const isSigner = role === 'SIGNER';
  const isApplicant = role === 'APPLICANT';

  // ── State ──
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<ReportPeriod>('monthly');
  const [allRequests, setAllRequests] = useState<any[]>([]);
  const reportRef = useRef<HTMLDivElement>(null);

  // ── Load data ──
  useEffect(() => {
    loadData();
  }, [role, user?.id]);

  const loadData = async () => {
    setLoading(true);
    try {
      // Load requests based on role
      let query = supabase
        .from('certificate_requests')
        .select('id, code, status, created_at, reviewed_at, reviewed_by, user_id, template_id, certificate_url, template:templates(name)')
        .order('created_at', { ascending: false });

      // ── Role-based filtering ──
      if (isApplicant) {
        query = query.eq('user_id', user!.id);
      } else if (isSigner) {
        // SIGNER sees: all requests they reviewed (their signature activity)
        query = query.eq('reviewed_by', user!.id);
      }

      const { data: requests } = await query;
      setAllRequests(requests || []);
    } catch (err) {
      console.error('Error loading reports data:', err);
      toast.error('Error al cargar datos del reporte');
    } finally {
      setLoading(false);
    }
  };

  // ── Period config ──
  const periodConfig = PERIODS.find(p => p.key === period)!;

  // ── Filtered data by period ──
  const filteredRequests = useMemo(() => {
    const now = new Date();
    const startDate = subMonths(now, periodConfig.months);
    return allRequests.filter(r => new Date(r.created_at) >= startDate);
  }, [allRequests, periodConfig]);

  // ── Stats summary ──
  const stats = useMemo(() => {
    const total = filteredRequests.length;
    const pending = filteredRequests.filter(r => r.status === 'PENDING').length;
    const approved = filteredRequests.filter(r => r.status === 'APPROVED' || r.status === 'SIGNED').length;
    const rejected = filteredRequests.filter(r => r.status === 'REJECTED').length;
    const inReview = filteredRequests.filter(r => r.status === 'IN_REVIEW').length;
    const revoked = filteredRequests.filter(r => r.status === 'REVOKED').length;
    const withDownload = filteredRequests.filter(r => r.certificate_url).length;
    const approvalRate = total > 0 ? Math.round((approved / total) * 100) : 0;

    // Average approval time (hours) - for signer/admin only
    const approvedReqs = filteredRequests.filter(
      r => r.reviewed_at && (r.status === 'APPROVED' || r.status === 'SIGNED')
    );
    const totalHours = approvedReqs.reduce((sum, r) =>
      sum + differenceInHours(new Date(r.reviewed_at), new Date(r.created_at)), 0
    );
    const avgApprovalTime = approvedReqs.length > 0 ? Math.round(totalHours / approvedReqs.length) : 0;

    // Signed count (distinct from approved - has signature)
    const signed = filteredRequests.filter(r => r.status === 'SIGNED').length;

    return {
      total, pending, approved, rejected, inReview, revoked,
      withDownload, approvalRate, avgApprovalTime, signed,
    };
  }, [filteredRequests]);

  // ── Signer-specific stats ──
  const signerStats = useMemo(() => {
    if (!isSigner || !user?.id) return null;
    const myReviewed = filteredRequests.filter(r => r.reviewed_by === user.id);
    const myApproved = myReviewed.filter(r => r.status === 'APPROVED' || r.status === 'SIGNED');
    const myRejected = myReviewed.filter(r => r.status === 'REJECTED');
    const mySigned = myReviewed.filter(r => r.status === 'SIGNED');
    const myRate = myReviewed.length > 0
      ? Math.round((myApproved.length / myReviewed.length) * 100) : 0;

    return {
      total: myReviewed.length,
      approved: myApproved.length,
      rejected: myRejected.length,
      signed: mySigned.length,
      approvalRate: myRate,
    };
  }, [filteredRequests, isSigner, user?.id]);

  // ── Flow data by period ──
  const flowData = useMemo(() => {
    const now = new Date();
    let intervals: Date[];
    let formatLabel: (d: Date) => string;

    if (period === 'annual') {
      const years: Date[] = [];
      let cursor = new Date(new Date().getFullYear() - 5, 0, 1);
      while (cursor <= now) {
        years.push(cursor);
        cursor = new Date(cursor.getFullYear() + 1, 0, 1);
      }
      intervals = years;
      formatLabel = d => `${d.getFullYear()}`;
    } else if (period === 'semester') {
      const sems: Date[] = [];
      let cursor = subMonths(now, 24);
      const semStart = cursor.getMonth() < 6 ? 0 : 6;
      cursor = new Date(cursor.getFullYear(), semStart, 1);
      while (cursor <= now) {
        sems.push(cursor);
        cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 6, 1);
      }
      intervals = sems;
      formatLabel = d => {
        const m = d.getMonth();
        return `${d.getFullYear()} ${m < 6 ? 'H1' : 'H2'}`;
      };
    } else {
      intervals = eachMonthOfInterval({ start: subMonths(now, 12), end: now });
      formatLabel = d => format(d, 'MMM', { locale: es });
    }

    return intervals.map(date => {
      const start = date;
      let end: Date;
      if (period === 'annual') {
        end = new Date(start.getFullYear(), 11, 31);
      } else if (period === 'semester') {
        const m = start.getMonth();
        end = new Date(start.getFullYear(), m < 6 ? 5 : 11, 31);
      } else {
        end = new Date(start.getFullYear(), start.getMonth() + 1, 0);
      }

      const bucket = filteredRequests.filter(r => {
        const d = new Date(r.created_at);
        return d >= start && d <= end;
      });

      return {
        label: formatLabel(start),
        creadas: bucket.length,
        aprobadas: bucket.filter(r => r.status === 'APPROVED' || r.status === 'SIGNED').length,
        rechazadas: bucket.filter(r => r.status === 'REJECTED').length,
      };
    });
  }, [filteredRequests, period]);

  // ── Status distribution ──
  const statusDistribution = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const r of filteredRequests) {
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
  }, [filteredRequests]);

  // ── Template usage ──
  const templateUsage = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const r of filteredRequests) {
      const name = r.template?.name || 'Sin plantilla';
      counts[name] = (counts[name] || 0) + 1;
    }
    return Object.entries(counts)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10);
  }, [filteredRequests]);

  // ── Download activity (by period intervals) ──
  const downloadActivity = useMemo(() => {
    const now = new Date();
    let intervals: Date[];
    let formatLabel: (d: Date) => string;

    if (period === 'annual') {
      const years: Date[] = [];
      let cursor = new Date(now.getFullYear() - 5, 0, 1);
      while (cursor <= now) { years.push(cursor); cursor = new Date(cursor.getFullYear() + 1, 0, 1); }
      intervals = years;
      formatLabel = d => `${d.getFullYear()}`;
    } else if (period === 'semester') {
      const sems: Date[] = [];
      let cursor = subMonths(now, 24);
      cursor = new Date(cursor.getFullYear(), cursor.getMonth() < 6 ? 0 : 6, 1);
      while (cursor <= now) { sems.push(cursor); cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 6, 1); }
      intervals = sems;
      formatLabel = d => `${d.getFullYear()} ${d.getMonth() < 6 ? 'H1' : 'H2'}`;
    } else {
      intervals = eachMonthOfInterval({ start: subMonths(now, 12), end: now });
      formatLabel = d => format(d, 'MMM', { locale: es });
    }

    return intervals.map(date => {
      const start = date;
      let end: Date;
      if (period === 'annual') end = new Date(start.getFullYear(), 11, 31);
      else if (period === 'semester') end = new Date(start.getFullYear(), start.getMonth() < 6 ? 5 : 11, 31);
      else end = new Date(start.getFullYear(), start.getMonth() + 1, 0);

      const count = filteredRequests.filter(r => {
        const d = new Date(r.created_at);
        return d >= start && d <= end && r.certificate_url;
      }).length;
      return { label: formatLabel(start), descargas: count };
    });
  }, [filteredRequests, period, periodConfig]);

  // ── Template trend (period breakdown) ──
  const templateTrend = useMemo(() => {
    const now = new Date();
    const templatesSet = [...new Set(filteredRequests.map(r => r.template?.name).filter(Boolean))].slice(0, 5);
    if (templatesSet.length === 0) return [];

    let intervals: Date[];
    let formatLabel: (d: Date) => string;

    if (period === 'annual') {
      const years: Date[] = [];
      let cursor = new Date(now.getFullYear() - 5, 0, 1);
      while (cursor <= now) { years.push(cursor); cursor = new Date(cursor.getFullYear() + 1, 0, 1); }
      intervals = years;
      formatLabel = d => `${d.getFullYear()}`;
    } else if (period === 'semester') {
      const sems: Date[] = [];
      let cursor = subMonths(now, 24);
      cursor = new Date(cursor.getFullYear(), cursor.getMonth() < 6 ? 0 : 6, 1);
      while (cursor <= now) { sems.push(cursor); cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 6, 1); }
      intervals = sems;
      formatLabel = d => `${d.getFullYear()} ${d.getMonth() < 6 ? 'H1' : 'H2'}`;
    } else {
      intervals = eachMonthOfInterval({ start: subMonths(now, 12), end: now });
      formatLabel = d => format(d, 'MMM', { locale: es });
    }

    return intervals.map(date => {
      const start = date;
      let end: Date;
      if (period === 'annual') end = new Date(start.getFullYear(), 11, 31);
      else if (period === 'semester') end = new Date(start.getFullYear(), start.getMonth() < 6 ? 5 : 11, 31);
      else end = new Date(start.getFullYear(), start.getMonth() + 1, 0);

      const point: any = { label: formatLabel(start) };
      for (const t of templatesSet) {
        point[t] = filteredRequests.filter(r => {
          const d = new Date(r.created_at);
          return d >= start && d <= end && r.template?.name === t;
        }).length;
      }
      return point;
    });
  }, [filteredRequests, period, periodConfig]);

  // ── Export PDF ──
  const handleExportPdf = () => {
    const pdf = new jsPDF('p', 'mm', 'a4');
    const pageW = 190; // usable width
    let y = 15;

    // Helper to add text
    const addText = (text: string, size: number, bold = false, x = 10) => {
      pdf.setFont('helvetica', bold ? 'bold' : 'normal');
      pdf.setFontSize(size);
      pdf.text(text, x, y);
      y += size * 0.5;
    };

    const addLine = () => {
      y += 3;
      pdf.setDrawColor(200, 200, 200);
      pdf.line(10, y, pageW + 10, y);
      y += 5;
    };

    // ── Header ──
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(18);
    pdf.setTextColor(0, 110, 47);
    pdf.text('VERIX - Reporte de Certificados', 10, y);
    y += 10;

    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(10);
    pdf.setTextColor(100, 100, 100);
    pdf.text(`Generado: ${format(new Date(), "dd 'de' MMMM 'de' yyyy, HH:mm", { locale: es })}`, 10, y);
    y += 5;
    pdf.text(`Período: ${PERIODS.find(p => p.key === period)?.label}`, 10, y);
    y += 5;
    pdf.text(`Rol: ${isAdmin ? 'Administrador' : isSigner ? 'Firmante' : 'Solicitante'}`, 10, y);
    y += 10;
    addLine();

    // ── Summary ──
    addText('Resumen General', 14, true);
    addText(`Total solicitudes: ${stats.total}`, 10);
    addText(`Aprobadas: ${stats.approved} (${stats.approvalRate}%)`, 10);
    addText(`Pendientes: ${stats.pending}`, 10);
    addText(`Rechazadas: ${stats.rejected}`, 10);
    addText(`Firmadas: ${stats.signed}`, 10);
    addText(`Descargas disponibles: ${stats.withDownload}`, 10);
    if (stats.avgApprovalTime > 0) {
      addText(`Tiempo promedio de aprobación: ${stats.avgApprovalTime} horas`, 10);
    }
    addLine();

    // ── Template usage ──
    if (templateUsage.length > 0) {
      addText('Uso de Plantillas', 14, true);
      for (const t of templateUsage) {
        addText(`${t.name}: ${t.value} solicitudes`, 10);
      }
      addLine();
    }

    // ── Status distribution ──
    if (statusDistribution.length > 0) {
      addText('Distribución por Estado', 14, true);
      for (const s of statusDistribution) {
        addText(`${s.name}: ${s.value}`, 10);
      }
      addLine();
    }

    // ── Signer-specific ──
    if (signerStats && isSigner) {
      addText('Mi Gestión como Firmante', 14, true);
      addText(`Total revisadas: ${signerStats.total}`, 10);
      addText(`Aprobadas: ${signerStats.approved}`, 10);
      addText(`Rechazadas: ${signerStats.rejected}`, 10);
      addText(`Firmadas electrónicamente: ${signerStats.signed}`, 10);
      addText(`Tasa de aprobación: ${signerStats.approvalRate}%`, 10);
      addLine();
    }

    // ── Footer ──
    y = Math.max(y, 270);
    pdf.setFont('helvetica', 'italic');
    pdf.setFontSize(8);
    pdf.setTextColor(150, 150, 150);
    pdf.text('Reporte generado por VERIX - Sistema de Certificación Electrónica', 10, y);
    pdf.text(`Página 1 de 1`, pageW, y, { align: 'right' });

    pdf.save(`reporte-certificados-${period}-${format(new Date(), 'yyyy-MM-dd')}.pdf`);
    toast.success('✅ Reporte exportado como PDF');
  };

  // ── Print ──
  const handlePrint = () => {
    window.print();
  };

  // ── Status display ──
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
    <div className="max-w-7xl mx-auto space-y-6 animate-fade-in" ref={reportRef}>
      {/* Header */}
      <section className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-headline-lg-mobile md:text-headline-lg font-headline-lg text-on-surface flex items-center gap-3">
            <BarChart3 size={28} className="text-primary" />
            Reportes
          </h1>
          <p className="text-body-md font-body-md text-on-surface-variant mt-1">
            {isApplicant
              ? 'Estadísticas de tus solicitudes de certificados'
              : isSigner
                ? 'Analítica de firmas y gestión de solicitudes'
                : 'Panel completo de reportes y analítica del sistema'}
          </p>
        </div>

        {/* Export actions */}
        <div className="flex items-center gap-2 print:hidden">
          <button onClick={handleExportPdf} disabled={loading}
            className="btn-secondary btn-sm px-4 py-2.5 text-xs flex items-center gap-2">
            <Download size={16} /> Exportar PDF
          </button>
          <button onClick={handlePrint} disabled={loading}
            className="btn-secondary btn-sm px-4 py-2.5 text-xs flex items-center gap-2">
            <Printer size={16} /> Imprimir
          </button>
        </div>
      </section>

      {/* Period filter */}
      <section className="flex items-center gap-3 print:hidden">
        <Filter size={16} className="text-on-surface-variant/60" />
        <div className="inline-flex glass-card rounded-xl p-1">
          {PERIODS.map(p => (
            <button
              key={p.key}
              onClick={() => setPeriod(p.key)}
              className={`px-5 py-2 text-xs font-bold rounded-lg transition-all whitespace-nowrap touch-manipulation ${
                period === p.key
                  ? 'bg-primary text-on-primary shadow-sm'
                  : 'text-on-surface-variant hover:text-on-surface'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <span className="text-[10px] text-on-surface-variant/60 font-medium ml-1">
          {periodConfig.months} meses
        </span>
      </section>

      {/* Loading */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <>
          {/* ── Stats cards ── */}
          <section className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
            <StatCard icon={FileText} label="Solicitudes" value={stats.total}
              sub="En el período seleccionado" color={COLORS.primary} />
            <StatCard icon={CheckCircle} label="Aprobadas" value={stats.approved}
              trend={stats.approvalRate > 0 ? `${stats.approvalRate}%` : undefined}
              trendUp={stats.approvalRate > 50} color={COLORS.primaryLight} />
            <StatCard icon={Clock} label="Pendientes" value={stats.pending}
              trend={stats.pending > 0 ? `${stats.pending}` : undefined}
              trendUp={false} color={COLORS.secondary} />
            <StatCard icon={XCircle} label="Rechazadas" value={stats.rejected}
              color={COLORS.error} />
            <StatCard icon={Download} label="Descargas" value={stats.withDownload}
              sub="Certificados disponibles" color={COLORS.info} />
            <StatCard icon={Activity} label="Tiempo prom." value={stats.avgApprovalTime > 0 ? `${stats.avgApprovalTime}h` : '—'}
              sub="Aprobación" color={COLORS.chart[5]} />
          </section>

          {/* ── Signer-specific stats ── */}
          {signerStats && (
            <section className="glass-card p-5 rounded-2xl border border-primary/10 bg-primary/[0.02]">
              <h3 className="text-sm font-bold text-on-surface mb-3 flex items-center gap-2">
                <Eye size={16} className="text-primary" />
                Mi gestión como firmante
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                <div className="p-3 rounded-xl bg-white/60">
                  <p className="text-headline-sm font-headline-sm text-primary">{signerStats.total}</p>
                  <p className="text-[11px] text-on-surface-variant">Solicitudes revisadas</p>
                </div>
                <div className="p-3 rounded-xl bg-white/60">
                  <p className="text-headline-sm font-headline-sm text-primary">{signerStats.approved}</p>
                  <p className="text-[11px] text-on-surface-variant">Aprobadas</p>
                </div>
                <div className="p-3 rounded-xl bg-white/60">
                  <p className="text-headline-sm font-headline-sm text-secondary">{signerStats.rejected}</p>
                  <p className="text-[11px] text-on-surface-variant">Rechazadas</p>
                </div>
                <div className="p-3 rounded-xl bg-white/60">
                  <p className="text-headline-sm font-headline-sm text-primary">{signerStats.signed}</p>
                  <p className="text-[11px] text-on-surface-variant">Firmadas electrónicamente</p>
                </div>
                <div className="p-3 rounded-xl bg-white/60">
                  <p className="text-headline-sm font-headline-sm text-primary">{signerStats.approvalRate}%</p>
                  <p className="text-[11px] text-on-surface-variant">Tasa de aprobación</p>
                </div>
              </div>
            </section>
          )}

          {/* ── Row 1: Flow chart + Status donut ── */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Flow chart */}
            <div className="glass-card p-5 rounded-2xl lg:col-span-2">
              <h3 className="text-sm font-bold text-on-surface mb-1">Flujo de solicitudes</h3>
              <p className="text-[11px] text-on-surface-variant/60 mb-4">
                Evolución de creación, aprobación y rechazo en el período
              </p>
              <div className="h-[280px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={flowData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e6e8ea" />
                    <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#565e74' }} interval="preserveStartEnd" />
                    <YAxis tick={{ fontSize: 10, fill: '#565e74' }} />
                    <Tooltip content={<ChartTooltip />} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Line type="monotone" dataKey="creadas" name="Creadas" stroke={COLORS.info} strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                    <Line type="monotone" dataKey="aprobadas" name="Aprobadas" stroke={COLORS.primary} strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                    <Line type="monotone" dataKey="rechazadas" name="Rechazadas" stroke={COLORS.error} strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Status donut */}
            <div className="glass-card p-5 rounded-2xl">
              <h3 className="text-sm font-bold text-on-surface mb-1">Distribución por estado</h3>
              <p className="text-[11px] text-on-surface-variant/60 mb-2">Total: {stats.total} solicitudes</p>
              <div className="h-[250px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={statusDistribution}
                      cx="50%" cy="50%"
                      innerRadius={55} outerRadius={85}
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

          {/* ── Row 2: Template usage + Template trend + Download activity ── */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Template usage */}
            <div className="glass-card p-5 rounded-2xl">
              <h3 className="text-sm font-bold text-on-surface mb-1">Plantillas más usadas</h3>
              <p className="text-[11px] text-on-surface-variant/60 mb-4">Frecuencia de uso en el período</p>
              <div className="h-[260px]">
                {templateUsage.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={templateUsage} layout="vertical" margin={{ left: 10, right: 20 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e6e8ea" horizontal={false} />
                      <XAxis type="number" tick={{ fontSize: 10, fill: '#565e74' }} />
                      <YAxis dataKey="name" type="category" tick={{ fontSize: 10, fill: '#565e74' }} width={100} />
                      <Tooltip content={<ChartTooltip />} />
                      <Bar dataKey="value" name="Solicitudes" fill={COLORS.primary} radius={[0, 4, 4, 0]}>
                        <LabelList dataKey="value" position="right" style={{ fontSize: 10, fill: '#191c1e', fontWeight: 600 }} />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex items-center justify-center h-full text-xs text-on-surface-variant/60">
                    Sin datos de plantillas
                  </div>
                )}
              </div>
            </div>

            {/* Template trend (admin/signer only) */}
            {(isAdmin || isSigner) && (
              <div className="glass-card p-5 rounded-2xl">
                <h3 className="text-sm font-bold text-on-surface mb-1">Flujo por plantilla</h3>
                <p className="text-[11px] text-on-surface-variant/60 mb-4">Tendencia mensual (top 5)</p>
                <div className="h-[260px]">
                  {templateTrend.length > 0 && Object.keys(templateTrend[0] || {}).length > 1 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={templateTrend}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e6e8ea" />
                        <XAxis dataKey="label" tick={{ fontSize: 9, fill: '#565e74' }} />
                        <YAxis tick={{ fontSize: 9, fill: '#565e74' }} />
                        <Tooltip content={<ChartTooltip />} />
                        <Legend wrapperStyle={{ fontSize: 9 }} />
                        {Object.keys(templateTrend[0] || {})
                          .filter(k => k !== 'label')
                          .map((key, i) => (
                            <Area
                              key={key}
                              type="monotone"
                              dataKey={key}
                              name={key}
                              stroke={COLORS.chart[i % COLORS.chart.length]}
                              fill={`${COLORS.chart[i % COLORS.chart.length]}22`}
                              strokeWidth={1.5}
                              dot={false}
                            />
                          ))}
                      </AreaChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="flex items-center justify-center h-full text-xs text-on-surface-variant/60">
                      Datos insuficientes para tendencia
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Download activity */}
            <div className="glass-card p-5 rounded-2xl">
              <h3 className="text-sm font-bold text-on-surface mb-1 flex items-center gap-2">
                <Download size={14} className="text-primary" />
                Descargas de certificados
              </h3>
              <p className="text-[11px] text-on-surface-variant/60 mb-4">Certificados disponibles por mes</p>
              <div className="h-[260px]">
                {downloadActivity.some(d => d.descargas > 0) ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={downloadActivity}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e6e8ea" vertical={false} />
                      <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#565e74' }} />
                      <YAxis tick={{ fontSize: 10, fill: '#565e74' }} />
                      <Tooltip content={<ChartTooltip />} />
                      <Bar dataKey="descargas" name="Descargas" fill={COLORS.info} radius={[4, 4, 0, 0]}>
                        <LabelList dataKey="descargas" position="top" style={{ fontSize: 9, fill: '#565e74' }} />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex items-center justify-center h-full text-xs text-on-surface-variant/60">
                    Sin descargas en el período
                  </div>
                )}
              </div>
              <div className="mt-3 pt-3 border-t border-outline-variant/10 flex items-center justify-between text-xs text-on-surface-variant">
                <span>Total disponibles</span>
                <strong className="text-on-surface text-sm">{stats.withDownload}</strong>
              </div>
            </div>
          </div>

          {/* ── Applicant-specific summary table ── */}
          {isApplicant && (
            <section className="glass-card p-5 rounded-2xl">
              <h3 className="text-sm font-bold text-on-surface mb-3">Resumen de mis solicitudes</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-outline-variant/20 text-left text-[11px] text-on-surface-variant/60 uppercase tracking-wider font-bold">
                      <th className="pb-2 pr-4">Métrica</th>
                      <th className="pb-2 pr-4">Valor</th>
                      <th className="pb-2">Porcentaje</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-b border-outline-variant/10">
                      <td className="py-2.5 pr-4 font-medium">Total solicitudes</td>
                      <td className="py-2.5 pr-4 font-semibold">{stats.total}</td>
                      <td className="py-2.5">100%</td>
                    </tr>
                    <tr className="border-b border-outline-variant/10">
                      <td className="py-2.5 pr-4 font-medium text-primary">Aprobadas / Firmadas</td>
                      <td className="py-2.5 pr-4 font-semibold text-primary">{stats.approved}</td>
                      <td className="py-2.5">{stats.total > 0 ? Math.round((stats.approved / stats.total) * 100) : 0}%</td>
                    </tr>
                    <tr className="border-b border-outline-variant/10">
                      <td className="py-2.5 pr-4 font-medium text-secondary">Pendientes</td>
                      <td className="py-2.5 pr-4 font-semibold text-secondary">{stats.pending}</td>
                      <td className="py-2.5">{stats.total > 0 ? Math.round((stats.pending / stats.total) * 100) : 0}%</td>
                    </tr>
                    <tr>
                      <td className="py-2.5 pr-4 font-medium text-error">Rechazadas</td>
                      <td className="py-2.5 pr-4 font-semibold text-error">{stats.rejected}</td>
                      <td className="py-2.5">{stats.total > 0 ? Math.round((stats.rejected / stats.total) * 100) : 0}%</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div className="mt-4 pt-3 border-t border-outline-variant/10 flex items-center justify-between text-xs text-on-surface-variant">
                <div className="flex items-center gap-2">
                  <Download size={14} />
                  <span>Certificados disponibles para descarga</span>
                </div>
                <strong className="text-on-surface text-sm">{stats.withDownload}</strong>
              </div>
            </section>
          )}

          {/* ── Recent requests table (admin/signer) ── */}
          {(isAdmin || isSigner) && (
            <section>
              <h3 className="text-sm font-bold text-on-surface mb-3">Últimas solicitudes del período</h3>
              <div className="glass-card rounded-2xl overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-outline-variant/20 bg-surface-container-low/50">
                        <th className="text-left p-3 text-[11px] text-on-surface-variant/60 uppercase tracking-wider font-bold">Código</th>
                        <th className="text-left p-3 text-[11px] text-on-surface-variant/60 uppercase tracking-wider font-bold">Plantilla</th>
                        <th className="text-left p-3 text-[11px] text-on-surface-variant/60 uppercase tracking-wider font-bold">Estado</th>
                        <th className="text-left p-3 text-[11px] text-on-surface-variant/60 uppercase tracking-wider font-bold">Creada</th>
                        <th className="text-left p-3 text-[11px] text-on-surface-variant/60 uppercase tracking-wider font-bold">Descarga</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredRequests.slice(0, 15).map(req => {
                        const status = statusDisplay[req.status] || { label: req.status, color: '', bg: '' };
                        return (
                          <tr key={req.id} className="border-b border-outline-variant/10 hover:bg-surface-container-low/30 transition-colors">
                            <td className="p-3 font-mono text-xs font-semibold text-primary">{req.code}</td>
                            <td className="p-3 text-xs text-on-surface-variant">{req.template?.name || '—'}</td>
                            <td className="p-3">
                              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${status.color} ${status.bg}`}>
                                {status.label}
                              </span>
                            </td>
                            <td className="p-3 text-xs text-on-surface-variant">
                              {format(new Date(req.created_at), 'dd/MM/yyyy', { locale: es })}
                            </td>
                            <td className="p-3">
                              {req.certificate_url ? (
                                <span className="flex items-center gap-1 text-[10px] text-primary font-semibold">
                                  <Download size={12} /> Disponible
                                </span>
                              ) : (
                                <span className="text-[10px] text-on-surface-variant/40">—</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                      {filteredRequests.length === 0 && (
                        <tr>
                          <td colSpan={5} className="p-8 text-center text-xs text-on-surface-variant/60">
                            No hay solicitudes en el período seleccionado
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>
          )}
        </>
      )}

      {/* Print styles */}
      <style>{`
        @media print {
          body { background: white !important; }
          .print\\:hidden { display: none !important; }
          .glass-card { box-shadow: none !important; border: 1px solid #e2e8f0 !important; background: white !important; }
          @page { margin: 1.5cm; }
        }
      `}</style>
    </div>
  );
}
