import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { Plus, Search, Edit3, Copy, Trash2, FileSpreadsheet } from 'lucide-react';
import toast from 'react-hot-toast';
import { format } from 'date-fns';

export function TemplatesPage() {
  const navigate = useNavigate();
  const [templates, setTemplates] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => { loadTemplates(); }, []);

  const loadTemplates = async () => {
    setLoading(true);
    try {
      const { data } = await supabase
        .from('templates')
        .select('*, institution:institutions(name)')
        .order('name');
      setTemplates(data || []);
    } catch (err) {
      console.error('Error loading templates:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!window.confirm(`¿Eliminar la plantilla "${name}"?`)) return;
    try {
      const { error } = await supabase.from('templates').delete().eq('id', id);
      if (error) throw error;
      toast.success('Plantilla eliminada');
      loadTemplates();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const filtered = templates.filter(t =>
    !search || t.name?.toLowerCase().includes(search.toLowerCase()) ||
    t.code?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="max-w-6xl mx-auto space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-primary/10 rounded-2xl flex items-center justify-center">
            <FileSpreadsheet size={20} className="text-primary" />
          </div>
          <div>
            <h1 className="text-headline-lg font-headline-lg text-on-surface">Plantillas</h1>
            <p className="text-body-md text-on-surface-variant">Gestionar plantillas de certificados</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-on-surface-variant/50" />
            <input type="text" placeholder="Buscar..." className="input pl-10 w-48"
              value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <button onClick={() => navigate('/templates/editor')} className="btn-primary btn-sm">
            <Plus size={16} /> Nueva plantilla
          </button>
        </div>
      </div>

      {/* Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {loading ? (
          [...Array(3)].map((_, i) => (
            <div key={i} className="glass-card p-6 rounded-2xl animate-pulse">
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 bg-surface-container rounded-xl" />
                <div className="flex-1">
                  <div className="h-5 bg-surface-container rounded w-3/4 mb-2" />
                  <div className="h-4 bg-surface-container rounded w-1/2" />
                </div>
              </div>
            </div>
          ))
        ) : filtered.length === 0 ? (
          <div className="col-span-full text-center py-16">
            <FileSpreadsheet size={48} className="mx-auto text-surface-variant mb-4" />
            <p className="text-headline-md font-headline-md text-on-surface-variant mb-1">No hay plantillas</p>
            <p className="text-body-md text-on-surface-variant/60">Crea una nueva plantilla para comenzar</p>
            <button onClick={() => navigate('/templates/editor')} className="btn-primary mt-6">
              <Plus size={16} /> Crear plantilla
            </button>
          </div>
        ) : filtered.map((t) => (
          <div key={t.id} className="glass-card p-6 rounded-2xl hover:shadow-lg transition-all group border border-white/40">
            <div className="flex items-start justify-between mb-4">
              <div className="w-12 h-12 bg-primary/10 rounded-xl flex items-center justify-center">
                <span className="text-primary font-bold text-lg">{t.name?.charAt(0) || 'T'}</span>
              </div>
              <span className={`text-[11px] font-bold px-3 py-1 rounded-full ${t.is_active ? 'bg-primary/10 text-primary' : 'bg-surface-variant text-on-surface-variant'}`}>
                {t.is_active ? 'Activa' : 'Inactiva'}
              </span>
            </div>
            <h3 className="font-semibold text-on-surface mb-1">{t.name}</h3>
            <p className="text-sm text-on-surface-variant/70 mb-1">{t.category || 'Sin categoría'}</p>
            <p className="text-xs text-on-surface-variant/50 mb-4">{t.institution?.name || 'Sin institución'}</p>
            <div className="flex items-center justify-between pt-3 border-t border-outline-variant/20">
              <div className="flex items-center gap-3 text-xs text-on-surface-variant/60">
                <span>{t.variables?.length || 0} variables</span>
                <span>v{t.version || 1}.0</span>
              </div>
              <div className="flex items-center gap-1">
                <button onClick={() => navigate(`/templates/editor?id=${t.id}`)}
                  className="btn-icon text-primary" title="Editar">
                  <Edit3 size={15} />
                </button>
                <button onClick={() => handleDelete(t.id, t.name)}
                  className="btn-icon text-error" title="Eliminar">
                  <Trash2 size={15} />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
