import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { Search, Download, RefreshCw, ClipboardList, Filter } from 'lucide-react';
import { format } from 'date-fns';

export function AuditPage() {
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [moduleFilter, setModuleFilter] = useState('');

  useEffect(() => { loadLogs(); }, [moduleFilter]);

  const loadLogs = async () => {
    setLoading(true);
    try {
      let query = supabase.from('audit_logs').select('*').order('created_at', { ascending: false }).limit(50);
      if (moduleFilter) query = query.eq('module', moduleFilter);
      const { data } = await query;
      setLogs(data || []);
    } catch (err) {
      console.error('Error loading audit:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleExport = () => {
    const csv = [
      ['Fecha/Hora', 'Usuario', 'Módulo', 'Acción', 'IP', 'Descripción'].join(','),
      ...logs.map(l =>
        [l.created_at, l.user_email || '', l.module, l.action, l.ip_address || '', `"${(l.description || '').replace(/"/g, '""')}"`].join(',')
      ),
    ].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `auditoria-${format(new Date(), 'yyyy-MM-dd')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const moduleColors: Record<string, string> = {
    auth: 'bg-primary/10 text-primary',
    users: 'bg-secondary-fixed text-secondary',
    requests: 'bg-tertiary-fixed text-tertiary',
    templates: 'bg-surface-variant text-on-surface-variant',
    certificates: 'bg-primary-fixed text-on-primary-fixed',
    institutions: 'bg-secondary/10 text-secondary',
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6 animate-fade-in">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-primary/10 rounded-2xl flex items-center justify-center">
            <ClipboardList size={20} className="text-primary" />
          </div>
          <div>
            <h1 className="text-headline-lg font-headline-lg text-on-surface">Auditoría</h1>
            <p className="text-body-md text-on-surface-variant">Registro inmutable de todas las acciones del sistema</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <select className="input w-40" value={moduleFilter} onChange={e => setModuleFilter(e.target.value)}>
            <option value="">Todos los módulos</option>
            <option value="auth">Auth</option>
            <option value="users">Usuarios</option>
            <option value="requests">Solicitudes</option>
            <option value="templates">Plantillas</option>
            <option value="certificates">Certificados</option>
            <option value="institutions">Instituciones</option>
          </select>
          <button onClick={loadLogs} className="btn-secondary btn-sm"><RefreshCw size={16} /></button>
          <button onClick={handleExport} className="btn-primary btn-sm"><Download size={16} /> Exportar</button>
        </div>
      </div>

      <div className="glass-card rounded-2xl overflow-hidden border border-white/40">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-surface-container-low/50 border-b border-outline-variant/20">
                <th className="text-left px-6 py-4 text-[11px] font-bold text-on-surface-variant uppercase tracking-wider">Fecha/Hora</th>
                <th className="text-left px-6 py-4 text-[11px] font-bold text-on-surface-variant uppercase tracking-wider">Usuario</th>
                <th className="text-left px-6 py-4 text-[11px] font-bold text-on-surface-variant uppercase tracking-wider">Módulo</th>
                <th className="text-left px-6 py-4 text-[11px] font-bold text-on-surface-variant uppercase tracking-wider">Acción</th>
                <th className="text-left px-6 py-4 text-[11px] font-bold text-on-surface-variant uppercase tracking-wider">IP</th>
                <th className="text-left px-6 py-4 text-[11px] font-bold text-on-surface-variant uppercase tracking-wider">Descripción</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant/10">
              {loading ? (
                <tr><td colSpan={6} className="px-6 py-12 text-center text-on-surface-variant">Cargando...</td></tr>
              ) : logs.length === 0 ? (
                <tr><td colSpan={6} className="px-6 py-12 text-center text-on-surface-variant">Sin registros de auditoría</td></tr>
              ) : logs.map((log) => (
                <tr key={log.id} className="hover:bg-primary/[0.02] transition-colors">
                  <td className="px-6 py-4 text-sm text-on-surface-variant whitespace-nowrap font-mono">
                    {format(new Date(log.created_at), 'dd/MM/yyyy HH:mm')}
                  </td>
                  <td className="px-6 py-4 text-sm font-medium text-on-surface">{log.user_email || log.user_name || '—'}</td>
                  <td className="px-6 py-4">
                    <span className={`text-[11px] font-bold px-3 py-1 rounded-full ${moduleColors[log.module] || 'bg-surface-variant text-on-surface-variant'}`}>
                      {log.module}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <span className="text-xs font-mono bg-surface-container-low px-2 py-1 rounded-md">{log.action}</span>
                  </td>
                  <td className="px-6 py-4 text-sm text-on-surface-variant/60 font-mono">{log.ip_address || '—'}</td>
                  <td className="px-6 py-4 text-sm text-on-surface-variant max-w-xs truncate" title={log.description || ''}>
                    {log.description || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="p-4 bg-surface-container-low/50 flex items-center justify-between text-sm text-on-surface-variant">
          <span>Mostrando {logs.length} registros</span>
          <div className="flex gap-2">
            <button className="btn-secondary btn-sm">Anterior</button>
            <button className="btn-primary btn-sm">Siguiente</button>
          </div>
        </div>
      </div>
    </div>
  );
}
