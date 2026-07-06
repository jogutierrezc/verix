import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '../../lib/supabase';
import {
  Plus, Search, Building2, Trash2, Edit3, ChevronDown, ChevronRight,
  Layers, Users, UserCheck, UserPlus, X, Save, Hash
} from 'lucide-react';
import toast from 'react-hot-toast';

interface Institution {
  id: string;
  name: string;
  short_name: string;
  code: string;
  logo_url: string | null;
  is_active: boolean;
  created_at: string;
}

interface Dependency {
  id: string;
  name: string;
  code: string | null;
  description: string | null;
  parent_id: string | null;
  is_active: boolean;
  created_at: string;
  role_type: 'SIGNER' | 'APPLICANT';
  dependency_count?: number;
  user_count?: number;
}

interface ResourceCounts {
  [depId: string]: { templates: number; radicados: number; users: number };
}

export function InstitutionsPage() {
  const [institutions, setInstitutions] = useState<Institution[]>([]);
  const [expandedInst, setExpandedInst] = useState<string | null>(null);
  const [expandedDep, setExpandedDep] = useState<string | null>(null);
  const [dependencies, setDependencies] = useState<Record<string, Dependency[]>>({});
  const [subdeps, setSubdeps] = useState<Record<string, Dependency[]>>({});
  const [resourceCounts, setResourceCounts] = useState<ResourceCounts>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  // Institution modal
  const [showInstModal, setShowInstModal] = useState(false);
  const [editInstId, setEditInstId] = useState<string | null>(null);
  const [instForm, setInstForm] = useState({ name: '', short_name: '', code: '' });
  const [savingInst, setSavingInst] = useState(false);

  // Dependency modal
  const [showDepModal, setShowDepModal] = useState(false);
  const [editDepId, setEditDepId] = useState<string | null>(null);
  const [depForm, setDepForm] = useState({
    name: '', code: '', description: '', institution_id: '', parent_id: '' as string | null,
  });
  const [savingDep, setSavingDep] = useState(false);

  useEffect(() => { loadInstitutions(); }, []);

  const loadInstitutions = async () => {
    setLoading(true);
    try {
      const { data } = await supabase.from('institutions').select('*').order('name');
      setInstitutions(data || []);
    } catch (err) {
      console.error('Error:', err);
    } finally {
      setLoading(false);
    }
  };

  const loadDependencies = async (instId: string) => {
    try {
      const { data } = await supabase
        .from('dependencies')
        .select('id, name, code, description, parent_id, is_active, created_at')
        .eq('institution_id', instId)
        .is('parent_id', null)
        .order('name');
      // Count subdependencies for each dependency
      const { data: allSubs } = await supabase
        .from('dependencies')
        .select('parent_id')
        .eq('institution_id', instId)
        .not('parent_id', 'is', null);
      const subCounts: Record<string, number> = {};
      (allSubs || []).forEach((s: any) => {
        subCounts[s.parent_id] = (subCounts[s.parent_id] || 0) + 1;
      });
      const deps = (data || []).map(d => ({
        ...d,
        role_type: 'SIGNER' as const,
        dependency_count: subCounts[d.id] || 0,
      }));
      setDependencies(prev => ({ ...prev, [instId]: deps }));
    } catch (err) {
      console.error('Error loading dependencies:', err);
      // Show empty list on error so user knows something failed
      setDependencies(prev => ({ ...prev, [instId]: [] }));
    }
  };

  const loadSubdeps = async (depId: string) => {
    try {
      const { data } = await supabase
        .from('dependencies')
        .select('*')
        .eq('parent_id', depId)
        .order('name');
      const subs = (data || []).map(d => ({
        ...d,
        role_type: 'APPLICANT' as const,
      }));
      setSubdeps(prev => ({ ...prev, [depId]: subs }));
      // Load related resources for this dependency and its subdependencies
      loadResourceCounts(depId);
    } catch (err) {
      console.error('Error loading subdependencies:', err);
    }
  };

  // Load templates, radicados and users linked to a dependency
  const loadResourceCounts = async (depId: string) => {
    try {
      const [templatesRes, radicadosRes, usersRes] = await Promise.all([
        supabase.from('templates').select('id', { count: 'exact', head: true }).eq('dependency_id', depId),
        supabase.from('radicados').select('id', { count: 'exact', head: true }).eq('dependency_id', depId),
        supabase.from('users').select('id', { count: 'exact', head: true }).eq('dependency_id', depId),
      ]);
      setResourceCounts(prev => ({
        ...prev,
        [depId]: {
          templates: templatesRes.count || 0,
          radicados: radicadosRes.count || 0,
          users: usersRes.count || 0,
        },
      }));
    } catch (err) {
      console.error('Error loading resource counts:', err);
    }
  };

  const toggleInstitution = (instId: string) => {
    if (expandedInst === instId) {
      setExpandedInst(null);
    } else {
      setExpandedInst(instId);
      setExpandedDep(null);
      // Always fetch fresh data from the database
      loadDependencies(instId);
    }
  };

  const toggleDependency = (depId: string) => {
    if (expandedDep === depId) {
      setExpandedDep(null);
    } else {
      setExpandedDep(depId);
      if (!subdeps[depId]) {
        loadSubdeps(depId);
      }
    }
  };

  // --- Institution CRUD ---
  const openCreateInst = () => {
    setEditInstId(null);
    setInstForm({ name: '', short_name: '', code: '' });
    setShowInstModal(true);
  };

  const openEditInst = (inst: Institution) => {
    setEditInstId(inst.id);
    setInstForm({ name: inst.name, short_name: inst.short_name || '', code: inst.code });
    setShowInstModal(true);
  };

  const handleSaveInst = async () => {
    if (!instForm.name || !instForm.code) {
      toast.error('Nombre y código requeridos');
      return;
    }
    setSavingInst(true);
    try {
      if (editInstId) {
        const { error } = await supabase.from('institutions').update(instForm).eq('id', editInstId);
        if (error) throw error;
        toast.success('Institución actualizada');
      } else {
        const { error } = await supabase.from('institutions').insert(instForm);
        if (error) throw error;
        toast.success('Institución creada');
      }
      setShowInstModal(false);
      loadInstitutions();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSavingInst(false);
    }
  };

  const handleDeleteInst = async (id: string, name: string) => {
    if (!window.confirm(`¿Eliminar la institución "${name}"?\nSe eliminarán todas sus dependencias.`)) return;
    try {
      const { error } = await supabase.from('institutions').delete().eq('id', id);
      if (error) throw error;
      toast.success('Institución eliminada');
      setExpandedInst(null);
      loadInstitutions();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  // --- Dependency CRUD ---
  const openCreateDep = (institutionId: string, parentId: string | null = null) => {
    setEditDepId(null);
    setDepForm({ name: '', code: '', description: '', institution_id: institutionId, parent_id: parentId });
    setShowDepModal(true);
  };

  const openEditDep = (dep: Dependency) => {
    setEditDepId(dep.id);
    setDepForm({
      name: dep.name,
      code: dep.code || '',
      description: dep.description || '',
      institution_id: expandedInst || '',
      parent_id: dep.parent_id,
    });
    setShowDepModal(true);
  };

  const handleSaveDep = async () => {
    if (!depForm.name) {
      toast.error('El nombre es requerido');
      return;
    }
    setSavingDep(true);
    try {
      const payload: any = {
        name: depForm.name,
        code: depForm.code || null,
        description: depForm.description || null,
        institution_id: depForm.institution_id,
      };
      if (depForm.parent_id) {
        payload.parent_id = depForm.parent_id;
      }

      if (editDepId) {
        const { error } = await supabase.from('dependencies').update(payload).eq('id', editDepId);
        if (error) throw error;
        toast.success(depForm.parent_id ? 'Subdependencia actualizada' : 'Dependencia actualizada');
      } else {
        const { error } = await supabase.from('dependencies').insert(payload);
        if (error) throw error;
        toast.success(depForm.parent_id ? 'Subdependencia creada' : 'Dependencia creada');
      }
      setShowDepModal(false);
      // Refetch
      if (depForm.institution_id) {
        loadDependencies(depForm.institution_id);
        if (depForm.parent_id) {
          loadSubdeps(depForm.parent_id);
        }
      }
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSavingDep(false);
    }
  };

  const handleDeleteDep = async (id: string, name: string, isSub: boolean) => {
    if (!window.confirm(`¿Eliminar "${name}"?\n${isSub ? '' : 'Las subdependencias quedarán sin padre.'}`)) return;
    try {
      const { error } = await supabase.from('dependencies').delete().eq('id', id);
      if (error) throw error;
      toast.success(isSub ? 'Subdependencia eliminada' : 'Dependencia eliminada');
      if (expandedInst) {
        loadDependencies(expandedInst);
        const parentId = dependencies[expandedInst]?.find(d => d.id === id)?.parent_id
          || Object.values(subdeps).flat().find(s => s.id === id)?.parent_id;
        if (parentId) loadSubdeps(parentId);
      }
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const filtered = institutions.filter(i =>
    !search || i.name?.toLowerCase().includes(search.toLowerCase()) || i.code?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="max-w-6xl mx-auto space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-primary/10 rounded-2xl flex items-center justify-center">
            <Building2 size={20} className="text-primary" />
          </div>
          <div>
            <h1 className="text-headline-lg font-headline-lg text-on-surface">Instituciones</h1>
            <p className="text-body-md text-on-surface-variant">Gestionar instituciones, dependencias y subdependencias</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-on-surface-variant/50" />
            <input type="text" placeholder="Buscar..." className="input pl-10 w-48"
              value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <button onClick={openCreateInst} className="btn-primary btn-sm">
            <Plus size={16} /> Nueva institución
          </button>
        </div>
      </div>

      {/* Institutions list */}
      <div className="space-y-3">
        {loading ? (
          [...Array(3)].map((_, i) => (
            <div key={i} className="glass-card p-6 rounded-2xl animate-pulse">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-surface-container rounded-xl" />
                <div className="flex-1"><div className="h-5 bg-surface-container rounded w-3/4 mb-2" /><div className="h-4 bg-surface-container rounded w-1/2" /></div>
              </div>
            </div>
          ))
        ) : filtered.length === 0 ? (
          <div className="glass-card p-16 rounded-2xl text-center">
            <Building2 size={48} className="mx-auto text-surface-variant mb-4" />
            <p className="text-headline-md font-headline-md text-on-surface-variant mb-1">No hay instituciones</p>
            <p className="text-body-md text-on-surface-variant/60 mb-6">Crea la primera institución para comenzar</p>
            <button onClick={openCreateInst} className="btn-primary">
              <Plus size={16} /> Crear institución
            </button>
          </div>
        ) : filtered.map((inst) => {
          const isExpanded = expandedInst === inst.id;
          const deps = dependencies[inst.id] || [];
          return (
            <div key={inst.id} className="glass-card rounded-2xl overflow-hidden border border-white/40 transition-all">
              {/* Institution header */}
              <div
                className="p-5 flex items-center justify-between cursor-pointer hover:bg-primary/[0.02] transition-colors"
                onClick={() => toggleInstitution(inst.id)}
              >
                <div className="flex items-center gap-4">
                  <div className="w-14 h-14 bg-primary/10 rounded-xl flex items-center justify-center shrink-0">
                    <Building2 size={28} className="text-primary" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-on-surface">{inst.name}</h3>
                    <p className="text-sm text-on-surface-variant/70 mt-0.5 flex items-center gap-2">
                      {inst.short_name && <>{inst.short_name} · </>}
                      Código: {inst.code}
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 text-primary text-[10px] font-bold">
                        <Layers size={10} /> {deps.length} dependencias
                      </span>
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
                  <button onClick={() => openEditInst(inst)}
                    className="btn-icon text-primary opacity-0 group-hover:opacity-100 hover:opacity-100 transition-all"
                    title="Editar institución">
                    <Edit3 size={15} />
                  </button>
                  <button onClick={() => handleDeleteInst(inst.id, inst.name)}
                    className="btn-icon text-error opacity-0 group-hover:opacity-100 hover:opacity-100 transition-all"
                    title="Eliminar institución">
                    <Trash2 size={15} />
                  </button>
                  {isExpanded ? <ChevronDown size={20} className="text-on-surface-variant" /> : <ChevronRight size={20} className="text-on-surface-variant" />}
                </div>
              </div>

              {/* Expanded: Dependencies section */}
              {isExpanded && (
                <div className="border-t border-outline-variant/20 bg-white/30 px-5 pb-5 animate-fade-in">
                  {/* Dependencies header */}
                  <div className="flex items-center justify-between py-4">
                    <div className="flex items-center gap-2">
                      <Layers size={16} className="text-primary" />
                      <h4 className="font-bold text-on-surface text-sm uppercase tracking-wider">
                        Dependencias <span className="text-on-surface-variant font-normal normal-case">(Firmantes — Rol SIGNER)</span>
                      </h4>
                    </div>
                    <button onClick={() => openCreateDep(inst.id)} className="btn-primary btn-xs">
                      <Plus size={14} /> Agregar dependencia
                    </button>
                  </div>

                  {deps.length === 0 ? (
                    <div className="bg-white/40 rounded-xl p-8 text-center border border-dashed border-outline-variant/40">
                      <Layers size={32} className="mx-auto text-outline-variant mb-2" />
                      <p className="text-sm text-on-surface-variant">Sin dependencias aún</p>
                      <button onClick={() => openCreateDep(inst.id)} className="btn-primary btn-sm mt-3">
                        <Plus size={14} /> Crear primera dependencia
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {deps.map((dep) => {
                        const isDepExpanded = expandedDep === dep.id;
                        const subs = subdeps[dep.id] || [];
                        return (
                          <div key={dep.id} className="bg-white/50 rounded-xl border border-outline-variant/20 overflow-hidden transition-all">
                            {/* Dependency header */}
                            <div className="flex items-center justify-between p-4 cursor-pointer hover:bg-primary/[0.02]"
                              onClick={() => toggleDependency(dep.id)}>
                              <div className="flex items-center gap-3">
                                <div className="w-10 h-10 bg-secondary-fixed/50 rounded-lg flex items-center justify-center">
                                  <UserCheck size={18} className="text-secondary" />
                                </div>
                                <div>
                                  <div className="flex items-center gap-2">
                                    <span className="font-semibold text-on-surface">{dep.name}</span>
                                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-secondary-fixed text-secondary uppercase">
                                      SIGNER
                                    </span>
                                  </div>
                                  <p className="text-xs text-on-surface-variant/70 mt-0.5">
                                    {dep.code && <>Código: {dep.code}</>}
                                    {dep.description && <> · {dep.description}</>}
                                  </p>
                                  <div className="flex items-center gap-2 mt-1">
                                    <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-surface-container-low text-on-surface-variant">
                                      <Users size={10} /> {dep.dependency_count || 0} sub
                                    </span>
                                    {resourceCounts[dep.id] && (
                                      <>
                                        <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-primary/5 text-primary">
                                          <Hash size={10} /> {resourceCounts[dep.id].radicados} radicados
                                        </span>
                                        <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-secondary-fixed/30 text-secondary">
                                          <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                                          {resourceCounts[dep.id].templates} plantillas
                                        </span>
                                      </>
                                    )}
                                  </div>
                                </div>
                              </div>
                              <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
                                <button onClick={() => openCreateDep(inst.id, dep.id)}
                                  className="btn-icon text-primary" title="Agregar subdependencia">
                                  <UserPlus size={14} />
                                </button>
                                <button onClick={() => openEditDep(dep)}
                                  className="btn-icon text-on-surface-variant" title="Editar dependencia">
                                  <Edit3 size={14} />
                                </button>
                                <button onClick={() => handleDeleteDep(dep.id, dep.name, false)}
                                  className="btn-icon text-error" title="Eliminar dependencia">
                                  <Trash2 size={14} />
                                </button>
                                {isDepExpanded ? <ChevronDown size={16} className="text-on-surface-variant" /> : <ChevronRight size={16} className="text-on-surface-variant" />}
                              </div>
                            </div>

                            {/* Expanded: Sub-dependencies */}
                            {isDepExpanded && (
                              <div className="border-t border-outline-variant/10 px-4 py-3 bg-white/20 space-y-2 animate-fade-in">
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-2 text-xs text-on-surface-variant">
                                    <Users size={14} />
                                    <span className="font-bold uppercase tracking-wider">
                                      Subdependencias <span className="font-normal normal-case">(Solicitantes — Rol APPLICANT)</span>
                                    </span>
                                  </div>
                                  <button onClick={() => openCreateDep(inst.id, dep.id)} className="btn-primary btn-xs">
                                    <Plus size={12} /> Agregar
                                  </button>
                                </div>

                                {subs.length === 0 ? (
                                  <div className="bg-white/40 rounded-lg p-6 text-center border border-dashed border-outline-variant/30">
                                    <p className="text-xs text-on-surface-variant">Sin subdependencias</p>
                                    <button onClick={() => openCreateDep(inst.id, dep.id)}
                                      className="btn-primary btn-xs mt-2">
                                      <Plus size={12} /> Crear subdependencia
                                    </button>
                                  </div>
                                ) : (
                                  subs.map((sub) => (
                                    <div key={sub.id}
                                      className="flex items-center justify-between bg-white/50 rounded-lg border border-outline-variant/10 p-3 hover:shadow-sm transition-all">
                                      <div className="flex items-center gap-3">
                                        <div className="w-8 h-8 bg-surface-variant/50 rounded-lg flex items-center justify-center">
                                          <Users size={14} className="text-on-surface-variant" />
                                        </div>
                                        <div>
                                          <div className="flex items-center gap-2">
                                            <span className="text-sm font-semibold text-on-surface">{sub.name}</span>
                                            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-surface-variant text-on-surface-variant uppercase">
                                              APPLICANT
                                            </span>
                                          </div>
                                          {sub.code && (
                                            <p className="text-xs text-on-surface-variant/60">Código: {sub.code}</p>
                                          )}
                                        </div>
                                      </div>
                                      <div className="flex items-center gap-1">
                                        <button onClick={() => openEditDep(sub)}
                                          className="btn-icon text-on-surface-variant" title="Editar">
                                          <Edit3 size={12} />
                                        </button>
                                        <button onClick={() => handleDeleteDep(sub.id, sub.name, true)}
                                          className="btn-icon text-error" title="Eliminar">
                                          <Trash2 size={12} />
                                        </button>
                                      </div>
                                    </div>
                                  ))
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Institution Modal */}
      {showInstModal && typeof document !== 'undefined' ? createPortal(
        <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4 overflow-y-auto">
          <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" onClick={() => setShowInstModal(false)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] animate-scale-in border border-white/40 overflow-hidden">
            <div className="sticky top-0 z-10 bg-white flex items-center justify-between px-6 py-4 border-b border-outline-variant/10">
              <h3 className="text-lg font-bold text-on-surface">
                {editInstId ? 'Editar institución' : 'Nueva institución'}
              </h3>
              <button onClick={() => setShowInstModal(false)} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-surface-container-high transition-colors">
                <X size={18} className="text-on-surface-variant" />
              </button>
            </div>
            <div className="p-6 space-y-4 overflow-y-auto max-h-[calc(85vh-6rem)]">
              <div>
                <label className="label">Nombre *</label>
                <input className="input" value={instForm.name}
                  onChange={e => setInstForm({...instForm, name: e.target.value})}
                  placeholder="Ej: Universidad Autónoma" />
              </div>
              <div>
                <label className="label">Nombre corto</label>
                <input className="input" value={instForm.short_name}
                  onChange={e => setInstForm({...instForm, short_name: e.target.value})}
                  placeholder="Ej: UABC" />
              </div>
              <div>
                <label className="label">Código *</label>
                <input className="input" value={instForm.code}
                  onChange={e => setInstForm({...instForm, code: e.target.value})}
                  placeholder="Ej: UABC-001" />
              </div>
            </div>
            <div className="flex justify-end gap-3 border-t border-outline-variant/10 px-6 py-4">
              <button onClick={() => setShowInstModal(false)} className="btn-secondary btn-sm">Cancelar</button>
              <button onClick={handleSaveInst} disabled={savingInst} className="btn-primary btn-sm">
                {savingInst ? 'Guardando...' : editInstId ? 'Actualizar' : 'Crear'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      ) : null}

      {/* Dependency Modal */}
      {showDepModal && (
        <>
          <div className="fixed inset-0 bg-black/20 backdrop-blur-sm z-40" onClick={() => setShowDepModal(false)} />
          <div className="fixed inset-0 flex items-start justify-center z-50 p-4 overflow-y-auto">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md animate-scale-in my-8 border border-white/40">
              <div className="flex items-center justify-between border-b border-outline-variant/10 px-6 py-4">
                <h3 className="text-lg font-bold text-on-surface">
                  {editDepId
                    ? (depForm.parent_id ? 'Editar subdependencia' : 'Editar dependencia')
                    : (depForm.parent_id ? 'Nueva subdependencia' : 'Nueva dependencia')}
                </h3>
                <button onClick={() => setShowDepModal(false)} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-surface-container-high transition-colors">
                  <X size={18} className="text-on-surface-variant" />
                </button>
              </div>
              <div className="p-6 space-y-4">
                {/* Role badge */}
                <div className="flex items-center gap-3 p-3 rounded-xl bg-primary/5 border border-primary/10">
                  {depForm.parent_id ? (
                    <>
                      <div className="w-8 h-8 rounded-lg bg-surface-variant/50 flex items-center justify-center shrink-0">
                        <Users size={16} className="text-on-surface-variant" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-on-surface">Rol: Solicitante (APPLICANT)</p>
                        <p className="text-xs text-on-surface-variant">Los usuarios de esta subdependencia podrán solicitar certificados</p>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="w-8 h-8 rounded-lg bg-secondary-fixed/50 flex items-center justify-center shrink-0">
                        <UserCheck size={16} className="text-secondary" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-on-surface">Rol: Firmante (SIGNER)</p>
                        <p className="text-xs text-on-surface-variant">Los usuarios de esta dependencia podrán firmar certificados</p>
                      </div>
                    </>
                  )}
                </div>

                <div>
                  <label className="label">Nombre *</label>
                  <input className="input" value={depForm.name}
                    onChange={e => setDepForm({...depForm, name: e.target.value})}
                    placeholder={depForm.parent_id ? 'Ej: Programa de Derecho' : 'Ej: Facultad de Derecho'} />
                </div>
                <div>
                  <label className="label">Código</label>
                  <input className="input" value={depForm.code}
                    onChange={e => setDepForm({...depForm, code: e.target.value})}
                    placeholder={depForm.parent_id ? 'Ej: DER-PROG' : 'Ej: FAC-DER'} />
                </div>
                <div>
                  <label className="label">Descripción</label>
                  <textarea className="input min-h-[80px]" value={depForm.description}
                    onChange={e => setDepForm({...depForm, description: e.target.value})}
                    placeholder="Descripción opcional" />
                </div>
              </div>
              <div className="flex justify-end gap-3 border-t border-outline-variant/10 px-6 py-4">
                <button onClick={() => setShowDepModal(false)} className="btn-secondary btn-sm">Cancelar</button>
                <button onClick={handleSaveDep} disabled={savingDep} className="btn-primary btn-sm">
                  {savingDep ? 'Guardando...' : editDepId ? 'Actualizar' : 'Crear'}
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
