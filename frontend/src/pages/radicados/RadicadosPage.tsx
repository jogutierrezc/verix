import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '../../lib/supabase';
import {
  Plus, Search, Hash, Trash2, Edit3, Building2, Layers, X
} from 'lucide-react';
import toast from 'react-hot-toast';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

export function RadicadosPage() {
  const [radicados, setRadicados] = useState<any[]>([]);
  const [institutions, setInstitutions] = useState<any[]>([]);
  const [templates, setTemplates] = useState<any[]>([]);
  const [dependencies, setDependencies] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: '',
    code: '',
    description: '',
    institution_id: '',
    dependency_id: '',
    template_id: '',
    prefix: '',
    suffix: '',
    format: '{prefix}{year}-{number}{suffix}',
    padding: 6,
    reset_yearly: true,
    current_number: 0,
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => { loadData(); }, []);

  // Load all dependencies with hierarchy info
  useEffect(() => {
    if (!form.institution_id) { setDependencies([]); return; }
    (async () => {
      try {
        const { data } = await supabase
          .from('dependencies')
          .select('id, name, code, parent_id')
          .eq('institution_id', form.institution_id)
          .order('parent_id', { ascending: false, nullsFirst: true })
          .order('name');
        setDependencies(data || []);
      } catch (err) {
        console.error('Error loading dependencies:', err);
      }
    })();
  }, [form.institution_id]);

  // Build hierarchical dependency options
  const buildDependencyOptions = () => {
    const roots = dependencies.filter(d => !d.parent_id);
    const subs = dependencies.filter(d => d.parent_id);
    const options: { id: string; label: string; isSub: boolean }[] = [];
    roots.forEach(root => {
      options.push({ id: root.id, label: root.name, isSub: false });
      const children = subs.filter(s => s.parent_id === root.id);
      children.forEach(child => {
        options.push({ id: child.id, label: `↳ ${child.name}`, isSub: true });
      });
    });
    return options;
  };

  const loadData = async () => {
    setLoading(true);
    try {
      const [radicadosRes, instRes, tmplRes] = await Promise.all([
        supabase.from('radicados').select('*, institution:institutions(name, code), dependency:dependencies(name, code), template:templates(name)').order('name'),
        supabase.from('institutions').select('id, name, code').order('name'),
        supabase.from('templates').select('id, name, code').order('name'),
      ]);
      setRadicados(radicadosRes.data || []);
      setInstitutions(instRes.data || []);
      setTemplates(tmplRes.data || []);
    } catch (err) {
      console.error('Error loading radicados:', err);
    } finally {
      setLoading(false);
    }
  };

  const openCreate = () => {
    setEditingId(null);
    setForm({
      name: '',
      code: '',
      description: '',
      institution_id: institutions[0]?.id || '',
      dependency_id: '',
      template_id: '',
      prefix: '',
      suffix: '',
      format: '{prefix}{year}-{number}{suffix}',
      padding: 6,
      reset_yearly: true,
      current_number: 0,
    });
    setShowModal(true);
  };

  const openEdit = (r: any) => {
    setEditingId(r.id);
    setForm({
      name: r.name || '',
      code: r.code || '',
      description: r.description || '',
      institution_id: r.institution_id || '',
      dependency_id: r.dependency_id || '',
      template_id: r.template_id || '',
      prefix: r.prefix || '',
      suffix: r.suffix || '',
      format: r.format || '{prefix}{year}-{number}{suffix}',
      padding: r.padding || 6,
      reset_yearly: r.reset_yearly ?? true,
      current_number: r.current_number || 0,
    });
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.name || !form.code || !form.institution_id) {
      toast.error('Nombre, código e institución son requeridos');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: form.name,
        code: form.code,
        description: form.description || null,
        institution_id: form.institution_id,
        dependency_id: form.dependency_id || null,
        template_id: form.template_id || null,
        prefix: form.prefix,
        suffix: form.suffix,
        format: form.format,
        padding: form.padding,
        reset_yearly: form.reset_yearly,
        current_number: form.current_number,
      };

      if (editingId) {
        const { error } = await supabase.from('radicados').update(payload).eq('id', editingId);
        if (error) throw error;
        toast.success('Radicado actualizado');
      } else {
        const { error } = await supabase.from('radicados').insert(payload);
        if (error) throw error;
        toast.success('Radicado creado');
      }
      setShowModal(false);
      loadData();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!window.confirm(`¿Eliminar el radicado "${name}"?`)) return;
    try {
      const { error } = await supabase.from('radicados').delete().eq('id', id);
      if (error) throw error;
      toast.success('Radicado eliminado');
      loadData();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const filtered = radicados.filter(r =>
    !search ||
    r.name?.toLowerCase().includes(search.toLowerCase()) ||
    r.code?.toLowerCase().includes(search.toLowerCase()) ||
    r.institution?.name?.toLowerCase().includes(search.toLowerCase())
  );

  const formatPreview = (r: any) => {
    const year = new Date().getFullYear();
    return r.format
      .replace('{prefix}', r.prefix || '')
      .replace('{suffix}', r.suffix || '')
      .replace('{year}', String(year))
      .replace('{number}', '1'.padStart(r.padding || 6, '0'))
      .replace('{institution_code}', r.institution?.code || '')
      .replace('{dependency_code}', r.dependency?.code || '');
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-primary/10 rounded-2xl flex items-center justify-center">
            <Hash size={20} className="text-primary" />
          </div>
          <div>
            <h1 className="text-headline-lg font-headline-lg text-on-surface">Radicados</h1>
            <p className="text-body-md text-on-surface-variant">Gestionar secuencias numéricas para certificados</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-on-surface-variant/50" />
            <input type="text" placeholder="Buscar..." className="input pl-10 w-48"
              value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <button onClick={openCreate} className="btn-primary btn-sm">
            <Plus size={16} /> Nuevo radicado
          </button>
        </div>
      </div>

      {/* Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {loading ? (
          [...Array(3)].map((_, i) => (
            <div key={i} className="glass-card p-6 rounded-2xl animate-pulse">
              <div className="space-y-3">
                <div className="h-5 bg-surface-container rounded w-3/4" />
                <div className="h-4 bg-surface-container rounded w-1/2" />
                <div className="h-4 bg-surface-container rounded w-2/3" />
              </div>
            </div>
          ))
        ) : filtered.length === 0 ? (
          <div className="col-span-full text-center py-16">
            <Hash size={48} className="mx-auto text-surface-variant mb-4" />
            <p className="text-headline-md font-headline-md text-on-surface-variant mb-1">No hay radicados</p>
            <p className="text-body-md text-on-surface-variant/60">Crea un radicado para comenzar a gestionar secuencias</p>
            <button onClick={openCreate} className="btn-primary mt-6">
              <Plus size={16} /> Crear radicado
            </button>
          </div>
        ) : filtered.map((r) => (
          <div key={r.id} className="glass-card p-5 rounded-2xl hover:shadow-lg transition-all group border border-white/40">
            <div className="flex items-start justify-between mb-3">
              <div className="w-10 h-10 bg-primary/10 rounded-xl flex items-center justify-center">
                <Hash size={20} className="text-primary" />
              </div>
              <span className={`text-[11px] font-bold px-3 py-1 rounded-full ${
                r.is_active ? 'bg-primary/10 text-primary' : 'bg-surface-variant text-on-surface-variant'
              }`}>
                {r.is_active ? 'Activo' : 'Inactivo'}
              </span>
            </div>
            <h3 className="font-semibold text-on-surface mb-0.5">{r.name}</h3>
            <p className="text-xs text-on-surface-variant/70 font-mono mb-1">{r.code}</p>
            <div className="flex items-center gap-1.5 text-xs text-on-surface-variant/60 mb-3">
              {r.institution && (
                <span className="flex items-center gap-1"><Building2 size={12} /> {r.institution?.name}</span>
              )}
            </div>

            {/* Format preview */}
            <div className="bg-white/50 border border-outline-variant/30 rounded-lg p-3 mb-3">
              <p className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider mb-1">Formato</p>
              <p className="text-sm font-mono font-bold text-primary">{formatPreview(r)}</p>
              <p className="text-[10px] text-on-surface-variant/60 mt-0.5">
                {r.prefix && <>Prefijo: <span className="font-mono">{r.prefix}</span></>}
                {r.suffix && <> · Sufijo: <span className="font-mono">{r.suffix}</span></>}
                {' · '} {r.padding} dígitos
                {r.reset_yearly && ' · Reinicio anual'}
              </p>
            </div>

            <div className="flex items-center justify-between pt-3 border-t border-outline-variant/20">
              <div className="text-xs text-on-surface-variant/60">
                <span className="font-semibold text-on-surface">{r.current_number}</span> usados
                {r.template && <> · {r.template.name}</>}
              </div>
              <div className="flex items-center gap-1">
                <button onClick={() => openEdit(r)}
                  className="btn-icon text-primary" title="Editar">
                  <Edit3 size={15} />
                </button>
                <button onClick={() => handleDelete(r.id, r.name)}
                  className="btn-icon text-error" title="Eliminar">
                  <Trash2 size={15} />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Create/Edit Modal */}
      {showModal && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4 overflow-y-auto">
          <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" onClick={() => setShowModal(false)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[85vh] animate-scale-in border border-white/40 overflow-hidden">
            <div className="sticky top-0 z-10 bg-white flex items-center justify-between px-6 py-4 border-b border-outline-variant/10">
              <h3 className="text-lg font-bold text-on-surface">
                {editingId ? 'Editar radicado' : 'Nuevo radicado'}
              </h3>
              <button onClick={() => setShowModal(false)} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-surface-container-high transition-colors">
                <X size={18} className="text-on-surface-variant" />
              </button>
            </div>
            <div className="p-6 space-y-4 overflow-y-auto max-h-[calc(85vh-6rem)]">
                {/* Name & Code */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="label">Nombre *</label>
                    <input className="input" value={form.name}
                      onChange={e => setForm({...form, name: e.target.value})}
                      placeholder="Ej: Diplomas Derecho 2024" />
                  </div>
                  <div>
                    <label className="label">Código *</label>
                    <input className="input" value={form.code}
                      onChange={e => setForm({...form, code: e.target.value})}
                      placeholder="Ej: RAD-DER-001" />
                  </div>
                </div>

                <div>
                  <label className="label">Descripción</label>
                  <input className="input" value={form.description}
                    onChange={e => setForm({...form, description: e.target.value})}
                    placeholder="Descripción opcional" />
                </div>

                {/* Institution & Dependency */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="label flex items-center gap-1"><Building2 size={14} /> Institución *</label>
                    <select className="input" value={form.institution_id}
                      onChange={e => setForm({...form, institution_id: e.target.value})}>
                      <option value="">Seleccionar...</option>
                      {institutions.map(inst => (
                        <option key={inst.id} value={inst.id}>{inst.name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                  <label className="label flex items-center gap-1"><Layers size={14} /> Dependencia</label>
                  <select className="input" value={form.dependency_id}
                    onChange={e => setForm({...form, dependency_id: e.target.value})}>
                    <option value="">Sin dependencia</option>
                    {buildDependencyOptions().map(opt => (
                      <option key={opt.id} value={opt.id}
                        className={opt.isSub ? 'pl-4 text-sm text-on-surface-variant' : ''}
                      >
                        {opt.label}
                      </option>
                    ))}
                  </select>
                  </div>
                </div>

                {/* Template */}
                <div>
                  <label className="label">Plantilla asociada</label>
                  <select className="input" value={form.template_id}
                    onChange={e => setForm({...form, template_id: e.target.value})}>
                    <option value="">Sin plantilla (uso general)</option>
                    {templates.map(t => (
                      <option key={t.id} value={t.id}>{t.name} ({t.code})</option>
                    ))}
                  </select>
                </div>

                <hr className="border-outline-variant/20" />

                {/* Format Configuration */}
                <p className="text-label-sm font-bold text-on-surface-variant uppercase tracking-wider">Configuración de Formato</p>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="label">Prefijo</label>
                    <input className="input" value={form.prefix}
                      onChange={e => setForm({...form, prefix: e.target.value})}
                      placeholder="Ej: DIP-" />
                  </div>
                  <div>
                    <label className="label">Sufijo</label>
                    <input className="input" value={form.suffix}
                      onChange={e => setForm({...form, suffix: e.target.value})}
                      placeholder="Ej: -DER" />
                  </div>
                </div>

                <div>
                  <label className="label">Formato <span className="text-[10px] text-on-surface-variant/60">(usa {'{prefix}'}, {'{year}'}, {'{number}'}, {'{suffix}'}, {'{institution_code}'}, {'{dependency_code}'})</span></label>
                  <input className="input font-mono text-sm" value={form.format}
                    onChange={e => setForm({...form, format: e.target.value})}
                    placeholder='{prefix}{year}-{number}{suffix}' />
                  <div className="mt-1.5 text-xs text-on-surface-variant/60 bg-surface-container-low px-3 py-1.5 rounded-lg">
                    Vista previa: <span className="font-mono font-bold text-primary">
                      {form.format
                        .replace('{prefix}', form.prefix || '')
                        .replace('{suffix}', form.suffix || '')
                        .replace('{year}', String(new Date().getFullYear()))
                        .replace('{number}', '1'.padStart(form.padding, '0'))
                        .replace('{institution_code}', institutions.find(i => i.id === form.institution_id)?.code || '')
                        .replace('{dependency_code}', '')}
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="label">Dígitos</label>
                    <input type="number" className="input" min={1} max={10} value={form.padding}
                      onChange={e => setForm({...form, padding: parseInt(e.target.value) || 6})} />
                  </div>
                  <div>
                    <label className="label">Inicio</label>
                    <input type="number" className="input" min={0} value={form.current_number}
                      onChange={e => setForm({...form, current_number: parseInt(e.target.value) || 0})} />
                  </div>
                  <div className="flex items-end pb-1">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" className="toggle-switch" checked={form.reset_yearly}
                        onChange={e => setForm({...form, reset_yearly: e.target.checked})} />
                      <span className="text-xs font-medium text-on-surface-variant">Reinicio anual</span>
                    </label>
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-3 border-t border-outline-variant/10 px-6 py-4">
                <button onClick={() => setShowModal(false)} className="btn-secondary btn-sm">Cancelar</button>
                <button onClick={handleSave} disabled={saving} className="btn-primary btn-sm">
                  {saving ? 'Guardando...' : editingId ? 'Actualizar' : 'Crear radicado'}
                </button>
              </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
