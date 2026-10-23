import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { supabase } from '../../lib/supabase';
import { templatesApi } from '../../services/api';
import { Plus, Search, Edit3, Copy, Trash2, FileSpreadsheet, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { format } from 'date-fns';
import { SkeletonCard } from '../../components/ui/SkeletonCard';
import { TemplateThumb } from '../../components/editor/TemplateThumb';
import { getPageSizeLabel, normalizePageSize } from '../../lib/pageSizes';
import { useStagger } from '../../lib/motion';

export function TemplatesPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [templates, setTemplates] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  useEffect(() => { loadTemplates(); }, [user?.dependency_id, user?.role]);

  const loadTemplates = async () => {
    setLoading(true);
    try {
      let query = supabase
        .from('templates')
        .select('*, institution:institutions(name), dependency:dependencies(name)')
        .order('name');

      // PRIORITY: If user has specific template permissions, use ONLY those IDs
      if (user?.role !== 'ADMIN' && user?.permissions?.allowed_template_ids && user.permissions.allowed_template_ids.length > 0) {
        // User has specific permissions - show ONLY those templates
        query = query.in('id', user.permissions.allowed_template_ids);
      } else {
        // No specific permissions: apply role-based filters
        if (user?.role === 'SIGNER') {
          // Signers see their dependency's templates or general templates
          query = query.or(`dependency_id.eq.${user.dependency_id || 'nil'},dependency_id.is.null`);
        } else if (user?.role === 'APPLICANT') {
          // Applicants see templates from their dependency
          if (user?.dependency_id) {
            query = query.eq('dependency_id', user.dependency_id);
          } else if (user?.institution_id) {
            query = query.eq('institution_id', user.institution_id);
          }
        }
      }

      const { data } = await query;
      setTemplates(data || []);
    } catch (err) {
      console.error('Error loading templates:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleDuplicate = async (id: string, name: string) => {
    try {
      const result = await templatesApi.duplicate(id);
      toast.success(`Plantilla "${name}" duplicada como "${result.name}"`);
      loadTemplates();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const { error } = await supabase.from('templates').delete().eq('id', id);
      if (error) throw error;
      toast.success('Plantilla eliminada');
      setConfirmId(null);
      loadTemplates();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const categories = [...new Set(templates.map(t => t.category).filter(Boolean))] as string[];
  const q = search.trim().toLowerCase();
  const filtered = templates.filter(t =>
    (category === 'all' || t.category === category) &&
    (!q || [t.name, t.code, t.category, t.dependency?.name].some((v: string) => v?.toLowerCase().includes(q))));

  useStagger(gridRef, loading ? 'loading' : filtered.map(t => t.id).join(','), !loading);

  return (
    <div className="max-w-6xl mx-auto space-y-6 animate-fade-in">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-primary/10 rounded-2xl flex items-center justify-center">
            <FileSpreadsheet size={20} className="text-primary" />
          </div>
          <div>
            <h1 className="text-headline-lg font-headline-lg text-on-surface">Plantillas</h1>
            <p className="text-body-md text-on-surface-variant tabular-nums">
              {loading ? 'Cargando…' : `${templates.length} plantilla${templates.length !== 1 ? 's' : ''} · ${templates.filter(t => t.is_active).length} activas`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-on-surface-variant/50" />
            <input type="search" placeholder="Nombre, código o dependencia" aria-label="Buscar plantillas"
              className="input pl-10 pr-9 w-64 [&::-webkit-search-cancel-button]:hidden"
              value={search} onChange={e => setSearch(e.target.value)}
              onKeyDown={e => { if (e.key === 'Escape') setSearch(''); }} />
            {search && (
              <button onClick={() => setSearch('')} aria-label="Limpiar búsqueda"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded-md text-on-surface-variant/60 hover:text-on-surface hover:bg-surface-container-high transition-colors">
                <X size={14} />
              </button>
            )}
          </div>
          <button onClick={() => navigate('/templates/editor')} className="btn-primary btn-sm">
            <Plus size={16} /> Nueva plantilla
          </button>
        </div>
      </div>

      {categories.length > 1 && (
        <div className="flex gap-1.5 overflow-x-auto pb-1" role="tablist" aria-label="Categoría">
          {['all', ...categories].map(c => (
            <button key={c} role="tab" aria-selected={category === c} onClick={() => setCategory(c)}
              className={`px-3.5 py-1.5 rounded-full text-sm whitespace-nowrap transition-colors duration-150 ${category === c ? 'bg-on-surface text-surface' : 'bg-surface-container-low text-on-surface-variant hover:bg-surface-container-high'}`}>
              {c === 'all' ? 'Todas' : c}
            </button>
          ))}
        </div>
      )}

      <div ref={gridRef} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {loading ? (
          <SkeletonCard variant="card" count={3} />
        ) : filtered.length === 0 ? (
          <div className="col-span-full text-center py-16">
            <FileSpreadsheet size={48} className="mx-auto text-surface-variant mb-4" />
            <p className="text-headline-md font-headline-md text-on-surface-variant mb-1">
              {search || category !== 'all' ? 'Ninguna plantilla coincide' : 'No hay plantillas'}
            </p>
            <p className="text-body-md text-on-surface-variant/60">
              {search || category !== 'all' ? 'Prueba con otro nombre o quita los filtros.' : 'Crea una nueva plantilla para comenzar'}
            </p>
            {search || category !== 'all' ? (
              <button onClick={() => { setSearch(''); setCategory('all'); }} className="btn-secondary mt-6">Quitar filtros</button>
            ) : (
              <button onClick={() => navigate('/templates/editor')} className="btn-primary mt-6">
                <Plus size={16} /> Crear plantilla
              </button>
            )}
          </div>
        ) : filtered.map((t) => (
          <div key={t.id} data-stagger className="glass-card rounded-2xl overflow-hidden border border-white/40 group [@media(hover:hover)]:hover:shadow-lg transition-shadow duration-200">
            <button
              onClick={() => navigate(`/templates/editor?id=${t.id}`)}
              className="w-full flex justify-center bg-surface-container-low py-5 active:scale-[0.99] transition-transform duration-150"
              aria-label={`Editar ${t.name}`}
            >
              <TemplateThumb config={t.config} width={170} />
            </button>
            <div className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="font-semibold text-on-surface truncate">{t.name}</h3>
                  <p className="text-xs text-on-surface-variant/70 mt-0.5 truncate">
                    {t.category || 'Sin categoría'} · {t.dependency?.name || 'Sin dependencia'}
                  </p>
                </div>
                <span className={`shrink-0 text-[11px] font-bold px-2.5 py-0.5 rounded-full ${t.is_active ? 'bg-primary/10 text-primary' : 'bg-surface-variant text-on-surface-variant'}`}>
                  {t.is_active ? 'Activa' : 'Inactiva'}
                </span>
              </div>
              <div className="flex items-center justify-between mt-3 pt-3 border-t border-outline-variant/20">
                <span className="text-xs text-on-surface-variant/60 tabular-nums">
                  {getPageSizeLabel(normalizePageSize(t.config?.pageSize ?? t.page_size))} · {t.variables?.length || 0} campos
                </span>
                {confirmId === t.id ? (
                  <div className="flex items-center gap-1.5 text-xs">
                    <span className="text-on-surface-variant">¿Eliminar?</span>
                    <button onClick={() => handleDelete(t.id)} className="px-2 py-1 rounded-md bg-error text-on-error font-semibold active:scale-95 transition-transform">Sí</button>
                    <button onClick={() => setConfirmId(null)} className="px-2 py-1 rounded-md bg-surface-container-high font-semibold">No</button>
                  </div>
                ) : (
                  <div className="flex items-center gap-1">
                    <button onClick={() => navigate(`/templates/editor?id=${t.id}`)} className="btn-icon text-primary" title="Editar"><Edit3 size={15} /></button>
                    <button onClick={() => handleDuplicate(t.id, t.name)} className="btn-icon text-secondary" title="Duplicar"><Copy size={15} /></button>
                    <button onClick={() => setConfirmId(t.id)} className="btn-icon text-error" title="Eliminar"><Trash2 size={15} /></button>
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
