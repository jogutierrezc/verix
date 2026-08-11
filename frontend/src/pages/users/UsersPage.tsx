import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '../../lib/supabase';
import { usersApi, userPermissionsApi } from '../../services/api';
import { useAuth } from '../../hooks/useAuth';
import { Plus, Search, UserCheck, UserX, Users as UsersIcon, Building2, Layers, X, Lock, Eye, EyeOff, Shield, FileSpreadsheet, Check, ChevronDown, ChevronUp } from 'lucide-react';
import toast from 'react-hot-toast';

const roleConfig: Record<string, { label: string; bg: string; color: string }> = {
  ADMIN: { label: 'Admin', bg: 'bg-primary/10', color: 'text-primary' },
  SIGNER: { label: 'Firmante', bg: 'bg-secondary-fixed', color: 'text-secondary' },
  APPLICANT: { label: 'Solicitante', bg: 'bg-surface-variant', color: 'text-on-surface-variant' },
};

export function UsersPage() {
  const { refreshUser } = useAuth();
  const [users, setUsers] = useState<any[]>([]);
  const [institutions, setInstitutions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [dependencies, setDependencies] = useState<any[]>([]);
  const [form, setForm] = useState({
    email: '',
    password: '',
    first_name: '',
    last_name: '',
    phone: '',
    role: 'APPLICANT' as string,
    institution_id: '',
    dependency_id: '',
  });
  const [creating, setCreating] = useState(false);
  const [resetPasswordUser, setResetPasswordUser] = useState<any>(null);
  const [newPassword, setNewPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [resettingPassword, setResettingPassword] = useState(false);
  
  // Permissions modal state
  const [permissionsUser, setPermissionsUser] = useState<any>(null);
  const [permissionsLoading, setPermissionsLoading] = useState(false);
  const [permissionsSaving, setPermissionsSaving] = useState(false);
  const [templates, setTemplates] = useState<any[]>([]);
  const [allowedTemplateIds, setAllowedTemplateIds] = useState<string[]>([]);
  const [canCreateRequests, setCanCreateRequests] = useState(true);
  const [canViewAllRequests, setCanViewAllRequests] = useState(false);
  const [selectAllTemplates, setSelectAllTemplates] = useState(true);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  
  // Permissions count per user (for badge display)
  const [userPermissionsMap, setUserPermissionsMap] = useState<Map<string, { count: number; total: number }>>(new Map());

  useEffect(() => { loadUsers(); loadInstitutions(); loadTemplates(); }, []);

  const loadUsers = async () => {
    setLoading(true);
    try {
      const { data } = await supabase
        .from('users')
        .select('*, institution:institutions(name)')
        .order('created_at', { ascending: false });
      setUsers(data || []);
      // Load permissions for all non-ADMIN users
      if (data && data.length > 0) {
        await loadPermissionsForUsers(data.filter(u => u.role !== 'ADMIN'));
      }
    } catch (err) {
      console.error('Error loading users:', err);
    } finally {
      setLoading(false);
    }
  };

  // Load permissions count for all non-ADMIN users
  const loadPermissionsForUsers = async (nonAdminUsers: any[]) => {
    try {
      // Check if user_permissions table exists first
      const { error: tableCheck } = await supabase
        .from('user_permissions')
        .select('user_id')
        .limit(1);
      
      // If table doesn't exist, skip loading permissions
      if (tableCheck && tableCheck.message?.includes('does not exist')) {
        console.warn('user_permissions table does not exist. Run the SQL migration first.');
        return;
      }
      
      const { data: permissions } = await supabase
        .from('user_permissions')
        .select('user_id, allowed_template_ids');
      
      if (!permissions) return;
      
      // Get total active templates count
      const { count: totalTemplates } = await supabase
        .from('templates')
        .select('*', { count: 'exact', head: true })
        .eq('is_active', true);
      
      const permMap = new Map<string, { count: number; total: number }>();
      for (const perm of permissions) {
        const templateCount = perm.allowed_template_ids?.length || 0;
        permMap.set(perm.user_id, { 
          count: templateCount, 
          total: totalTemplates || 0 
        });
      }
      
      // For users without permissions record, they have access to all templates
      for (const user of nonAdminUsers) {
        if (!permMap.has(user.id)) {
          permMap.set(user.id, { count: -1, total: totalTemplates || 0 }); // -1 means "all"
        }
      }
      
      setUserPermissionsMap(permMap);
    } catch (err) {
      console.error('Error loading permissions:', err);
    }
  };

  const loadInstitutions = async () => {
    try {
      const { data } = await supabase.from('institutions').select('id, name, code').order('name');
      setInstitutions(data || []);
    } catch (err) {
      console.error('Error loading institutions:', err);
    }
  };

  // Load templates for permissions modal
  const loadTemplates = async () => {
    setTemplatesLoading(true);
    try {
      const { data } = await supabase
        .from('templates')
        .select('id, name, code, category, dependency:dependencies(name)')
        .eq('is_active', true)
        .order('name');
      setTemplates(data || []);
    } catch (err) {
      console.error('Error loading templates:', err);
    } finally {
      setTemplatesLoading(false);
    }
  };

  // Get permissions badge info for a user
  const getPermissionsBadge = (userId: string) => {
    const perms = userPermissionsMap.get(userId);
    if (!perms) return null;
    
    if (perms.count === -1) {
      // User has access to all templates
      return { label: 'Todas', variant: 'primary' as const };
    } else if (perms.count === 0) {
      // User has no specific templates assigned (but no permissions record = all access)
      return null;
    } else {
      return { 
        label: `${perms.count}/${perms.total}`, 
        variant: 'secondary' as const 
      };
    }
  };

  // Open permissions modal for a user
  const openPermissionsModal = async (user: any) => {
    console.log('Opening permissions modal for user:', user.id, user.email);
    setPermissionsUser(user);
    setPermissionsLoading(true);
    setSelectAllTemplates(true);
    setAllowedTemplateIds([]);
    setCanCreateRequests(true);
    setCanViewAllRequests(false);
    
    // Load templates if not loaded yet
    if (templates.length === 0) {
      console.log('Loading templates...');
      await loadTemplates();
    }
    
    // Load user's current permissions
    try {
      console.log('Loading permissions for user:', user.id);
      const permissions = await userPermissionsApi.getByUserId(user.id);
      console.log('Loaded permissions:', permissions);
      if (permissions) {
        setAllowedTemplateIds(permissions.allowed_template_ids || []);
        setCanCreateRequests(permissions.can_create_requests ?? true);
        setCanViewAllRequests(permissions.can_view_all_requests ?? false);
        // If user has specific templates, not all
        if (permissions.allowed_template_ids && permissions.allowed_template_ids.length > 0) {
          setSelectAllTemplates(false);
        }
      }
    } catch (err) {
      console.error('Error loading permissions:', err);
    } finally {
      setPermissionsLoading(false);
    }
  };

  // Save permissions
  const handleSavePermissions = async () => {
    if (!permissionsUser) return;
    setPermissionsSaving(true);
    
    const templateIds = selectAllTemplates ? [] : allowedTemplateIds;
    console.log('Saving permissions for user:', permissionsUser.id);
    console.log('  selectAllTemplates:', selectAllTemplates);
    console.log('  templateIds:', templateIds);
    console.log('  canCreateRequests:', canCreateRequests);
    console.log('  canViewAllRequests:', canViewAllRequests);
    
    try {
      await userPermissionsApi.upsert(permissionsUser.id, {
        allowed_template_ids: templateIds,
        can_create_requests: canCreateRequests,
        can_view_all_requests: canViewAllRequests,
      });
      console.log('Permissions saved successfully');
      toast.success('Permisos actualizados exitosamente');
      setPermissionsUser(null);
      // Reload users and refresh permissions map
      await loadUsers();
      // Refresh current user's permissions if editing own account
      await refreshUser();
    } catch (err: any) {
      console.error('Error saving permissions:', err);
      toast.error(err.message || 'Error al guardar permisos');
    } finally {
      setPermissionsSaving(false);
    }
  };

  // Toggle template selection
  const toggleTemplate = (templateId: string) => {
    setAllowedTemplateIds(prev => {
      if (prev.includes(templateId)) {
        return prev.filter(id => id !== templateId);
      } else {
        return [...prev, templateId];
      }
    });
  };

  // Toggle all templates
  const toggleAllTemplates = () => {
    if (selectAllTemplates) {
      // Currently all selected, switch to none (user will select specific ones)
      setSelectAllTemplates(false);
      setAllowedTemplateIds([]);
    } else {
      // Currently specific, switch to all
      setSelectAllTemplates(true);
      setAllowedTemplateIds([]);
    }
  };

  // Load dependencies when institution changes
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
        setForm(prev => ({ ...prev, dependency_id: '' }));
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

  const handleCreate = async () => {
    if (!form.email || !form.password || !form.first_name) {
      toast.error('Completa los campos obligatorios');
      return;
    }
    setCreating(true);
    try {
      await usersApi.create({
        email: form.email,
        password: form.password,
        first_name: form.first_name,
        last_name: form.last_name,
        role: form.role,
        institution_id: form.institution_id || null,
        dependency_id: form.dependency_id || null,
      });
      toast.success('Usuario creado exitosamente');
      setShowModal(false);
      setForm({ email: '', password: '', first_name: '', last_name: '', phone: '', role: 'APPLICANT', institution_id: '', dependency_id: '' });
      loadUsers();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setCreating(false);
    }
  };

  const handleToggleStatus = async (user: any) => {
    const newStatus = user.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
    try {
      const { error } = await supabase.from('users').update({ status: newStatus }).eq('id', user.id);
      if (error) throw error;
      toast.success(`Usuario ${newStatus === 'ACTIVE' ? 'activado' : 'desactivado'}`);
      loadUsers();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const filtered = users.filter(u =>
    !search || u.first_name?.toLowerCase().includes(search.toLowerCase()) ||
    u.last_name?.toLowerCase().includes(search.toLowerCase()) ||
    u.email?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="max-w-6xl mx-auto space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-primary/10 rounded-2xl flex items-center justify-center">
            <UsersIcon size={20} className="text-primary" />
          </div>
          <div>
            <h1 className="text-headline-lg font-headline-lg text-on-surface">Usuarios</h1>
            <p className="text-body-md text-on-surface-variant">Gestionar usuarios del sistema</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-on-surface-variant/50" />
            <input type="text" placeholder="Buscar..." className="input pl-10 w-48"
              value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <button onClick={() => setShowModal(true)} className="btn-primary btn-sm">
            <Plus size={16} /> Nuevo usuario
          </button>
        </div>
      </div>

      {/* Table - horizontal scroll on mobile */}
      <div className="glass-card rounded-2xl overflow-hidden border border-white/40">
        <div className="overflow-x-auto [-webkit-overflow-scrolling:touch]">
          <table className="w-full min-w-[640px]">
            <thead>
              <tr className="bg-surface-container-low/50 border-b border-outline-variant/20">
                <th className="text-left px-6 py-4 text-[11px] font-bold text-on-surface-variant uppercase tracking-wider">Usuario</th>
                <th className="text-left px-6 py-4 text-[11px] font-bold text-on-surface-variant uppercase tracking-wider">Email</th>
                <th className="text-left px-6 py-4 text-[11px] font-bold text-on-surface-variant uppercase tracking-wider">Rol</th>
                <th className="text-left px-6 py-4 text-[11px] font-bold text-on-surface-variant uppercase tracking-wider">Institución</th>
                <th className="text-left px-6 py-4 text-[11px] font-bold text-on-surface-variant uppercase tracking-wider">Estado</th>
                <th className="text-right px-6 py-4 text-[11px] font-bold text-on-surface-variant uppercase tracking-wider">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant/10">
              {loading ? (
                <tr><td colSpan={6} className="px-6 py-12 text-center text-on-surface-variant">Cargando...</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={6} className="px-6 py-12 text-center text-on-surface-variant">Sin usuarios</td></tr>
              ) : filtered.map((u) => {
                const role = roleConfig[u.role] || { label: u.role, bg: '', color: '' };
                return (
                  <tr key={u.id} className="hover:bg-primary/[0.02] transition-colors">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-full bg-primary-fixed/50 flex items-center justify-center text-primary text-xs font-bold">
                          {u.first_name?.charAt(0)}{u.last_name?.charAt(0)}
                        </div>
                        <span className="font-semibold text-on-surface">{u.first_name} {u.last_name}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-sm text-on-surface-variant">{u.email}</td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <span className={`text-[11px] font-bold px-3 py-1 rounded-full ${role.bg} ${role.color}`}>
                          {role.label}
                        </span>
                        {u.role !== 'ADMIN' && (() => {
                          const badge = getPermissionsBadge(u.id);
                          if (!badge) return null;
                          return (
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1 ${
                              badge.variant === 'primary' 
                                ? 'bg-tertiary/10 text-tertiary' 
                                : 'bg-secondary-fixed text-secondary'
                            }`} title="Plantillas permitidas">
                              <FileSpreadsheet size={10} />
                              {badge.label}
                            </span>
                          );
                        })()}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-sm text-on-surface-variant">{u.institution?.name || '—'}</td>
                    <td className="px-6 py-4">
                      <span className={`text-[11px] font-bold px-3 py-1 rounded-full ${
                        u.status === 'ACTIVE' ? 'bg-primary/10 text-primary' : 'bg-surface-variant text-on-surface-variant'
                      }`}>
                        {u.status === 'ACTIVE' ? 'Activo' : 'Inactivo'}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        {u.role !== 'ADMIN' && (
                          <button onClick={() => openPermissionsModal(u)}
                            className="btn-icon text-tertiary"
                            title="Gestionar permisos">
                            <Shield size={16} />
                          </button>
                        )}
                        <button onClick={() => { setResetPasswordUser(u); setNewPassword(''); }}
                          className="btn-icon text-warning-500"
                          title="Cambiar contraseña">
                          <Lock size={16} />
                        </button>
                        <button onClick={() => handleToggleStatus(u)}
                          className={`btn-icon ${
                            u.status === 'ACTIVE' ? 'text-error' : 'text-primary'
                          }`}
                          title={u.status === 'ACTIVE' ? 'Desactivar' : 'Activar'}>
                          {u.status === 'ACTIVE' ? <UserX size={16} /> : <UserCheck size={16} />}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create user modal - full-screen on mobile */}
      {showModal && typeof document !== 'undefined' ? createPortal(
        <div className="fixed inset-0 z-[1000] flex items-end md:items-center justify-center md:p-4 overflow-y-auto">
          <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" onClick={() => setShowModal(false)} />
          <div className="relative bg-white rounded-t-3xl md:rounded-2xl shadow-2xl w-full md:max-w-3xl max-h-[95vh] md:max-h-[85vh] animate-slide-up md:animate-scale-in border border-white/40 overflow-hidden">
            {/* Top bar */}
            <div className="sticky top-0 z-10 bg-white flex items-center justify-between px-4 md:px-8 py-5 border-b border-outline-variant/10">
              <div className="flex items-center gap-4">
                <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center">
                  <UsersIcon size={28} className="text-primary" />
                </div>
                <div>
                  <p className="text-base text-on-surface-variant">Crea un nuevo usuario en el sistema</p>
                </div>
              </div>
              <button onClick={() => setShowModal(false)} className="w-10 h-10 flex items-center justify-center rounded-xl hover:bg-surface-container-high transition-colors">
                <X size={22} className="text-on-surface-variant" />
              </button>
            </div>

            {/* Form content */}
            <div className="px-4 md:px-8 py-6 md:py-8 overflow-y-auto max-h-[72vh]">
              {/* Section 1: Personal Info */}
              <section className="mb-12 md:mb-16">
                <div className="flex items-center gap-4 mb-8">
                  <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center shrink-0">
                    <UsersIcon size={28} className="text-primary" />
                  </div>
                  <div>
                    <h3 className="text-2xl font-bold text-on-surface">Información Personal</h3>
                    <p className="text-base text-on-surface-variant">Datos básicos del usuario</p>
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 md:gap-8">
                  <div>
                    <label className="block text-sm font-bold text-on-surface mb-2">Nombre *</label>
                    <input className="input text-base py-3 px-4" value={form.first_name}
                      onChange={e => setForm({ ...form, first_name: e.target.value })}
                      placeholder="Ej: Juan" />
                  </div>
                  <div>
                    <label className="block text-sm font-bold text-on-surface mb-2">Apellido</label>
                    <input className="input text-base py-3 px-4" value={form.last_name}
                      onChange={e => setForm({ ...form, last_name: e.target.value })}
                      placeholder="Ej: Pérez" />
                  </div>
                  <div>
                    <label className="block text-sm font-bold text-on-surface mb-2">Teléfono</label>
                    <input className="input text-base py-3 px-4" value={form.phone}
                      onChange={e => setForm({ ...form, phone: e.target.value })}
                      placeholder="+57 300 123 4567" />
                  </div>
                </div>
              </section>

              <hr className="border-outline-variant/10 mb-12 md:mb-16" />

              {/* Section 2: Credentials */}
              <section className="mb-12 md:mb-16">
                <div className="flex items-center gap-4 mb-8">
                  <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center shrink-0">
                    <svg className="w-7 h-7 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
                  </div>
                  <div>
                    <h3 className="text-2xl font-bold text-on-surface">Credenciales de Acceso</h3>
                    <p className="text-base text-on-surface-variant">Email y contraseña para iniciar sesión</p>
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-8">
                  <div>
                    <label className="block text-sm font-bold text-on-surface mb-2">Correo electrónico *</label>
                    <input className="input text-base py-3 px-4" type="email" value={form.email}
                      onChange={e => setForm({ ...form, email: e.target.value })}
                      placeholder="ej: juan.perez@email.com" />
                  </div>
                  <div>
                    <label className="block text-sm font-bold text-on-surface mb-2">Contraseña *</label>
                    <input className="input text-base py-3 px-4" type="password" value={form.password}
                      onChange={e => setForm({ ...form, password: e.target.value })}
                      placeholder="Mínimo 6 caracteres" />
                  </div>
                </div>
              </section>

              <hr className="border-outline-variant/10 mb-12 md:mb-16" />

              {/* Section 3: Role & Institution */}
              <section className="mb-12 md:mb-16">
                <div className="flex items-center gap-4 mb-8">
                  <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center shrink-0">
                    <Building2 size={28} className="text-primary" />
                  </div>
                  <div>
                    <h3 className="text-2xl font-bold text-on-surface">Asignación</h3>
                    <p className="text-base text-on-surface-variant">Rol, institución, dependencia y subdependencia</p>
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 md:gap-8">
                  <div>
                    <label className="block text-sm font-bold text-on-surface mb-2">Rol</label>
                    <select className="input text-base py-3 px-4" value={form.role}
                      onChange={e => setForm({ ...form, role: e.target.value })}>
                      <option value="APPLICANT">Solicitante — Puede solicitar certificados</option>
                      <option value="SIGNER">Firmante — Puede firmar certificados</option>
                      <option value="ADMIN">Administrador — Acceso total al sistema</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-bold text-on-surface mb-2">
                      <span className="flex items-center gap-1.5"><Building2 size={16} /> Institución</span>
                    </label>
                    <select className="input text-base py-3 px-4" value={form.institution_id}
                      onChange={e => setForm({ ...form, institution_id: e.target.value })}>
                      <option value="">Sin institución</option>
                      {institutions.map(inst => (
                        <option key={inst.id} value={inst.id}>
                          {inst.name} {inst.code ? `(${inst.code})` : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-bold text-on-surface mb-2">
                      <span className="flex items-center gap-1.5"><Layers size={16} /> Dependencia</span>
                    </label>
                    <select className="input text-base py-3 px-4" value={form.dependency_id}
                      onChange={e => setForm({ ...form, dependency_id: e.target.value })}
                      disabled={!form.institution_id}>
                      <option value="">Sin dependencia</option>
                      {buildDependencyOptions().map(opt => (
                        <option key={opt.id} value={opt.id}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </section>

              {/* Action buttons */}
              <div className="flex items-center justify-end gap-4 pt-8 border-t border-outline-variant/10">
                <button onClick={() => setShowModal(false)} className="btn-secondary text-base px-6 py-3">Cancelar</button>
                <button onClick={handleCreate} disabled={creating} className="btn-primary text-base px-8 py-3">
                  {creating ? (
                    <span className="flex items-center gap-2">
                      <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Creando...
                    </span>
                  ) : (
                    <><UsersIcon size={18} /> Crear usuario</>
                  )}
                </button>
              </div>

              <div className="h-8 md:h-16" />
            </div>
          </div>
        </div>,
        document.body
      ) : null}

      {/* Reset password modal - full-screen on mobile */}
      {resetPasswordUser && typeof document !== 'undefined' ? createPortal(
        <div className="fixed inset-0 z-[1000] flex items-end md:items-center justify-center p-0 md:p-4">
          <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" onClick={() => setResetPasswordUser(null)} />
          <div className="relative bg-white rounded-t-3xl md:rounded-2xl shadow-2xl w-full md:max-w-md animate-slide-up md:animate-scale-in border border-white/40 overflow-hidden">
            <div className="flex items-center justify-between px-6 py-5 border-b border-outline-variant/10">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-warning-500/10 flex items-center justify-center">
                  <Lock size={20} className="text-warning-500" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-on-surface">Cambiar contraseña</h3>
                  <p className="text-sm text-on-surface-variant">{resetPasswordUser.first_name} {resetPasswordUser.last_name}</p>
                </div>
              </div>
              <button onClick={() => setResetPasswordUser(null)} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-surface-container-high transition-colors">
                <X size={18} className="text-on-surface-variant" />
              </button>
            </div>

            <div className="px-6 py-6 space-y-4">
              <div>
                <label className="block text-sm font-bold text-on-surface mb-2">Nueva contraseña</label>
                <div className="flex items-center bg-white/50 border border-outline-variant/30 rounded-xl px-4 py-3 transition-all focus-within:border-primary focus-within:ring-4 focus-within:ring-primary/10">
                  <Lock size={18} className="text-on-surface-variant mr-3 shrink-0" />
                  <input
                    className="w-full bg-transparent border-none focus:outline-none focus:ring-0 text-base text-on-surface placeholder:text-on-surface-variant/40 p-0"
                    type={showNewPassword ? 'text' : 'password'}
                    value={newPassword}
                    onChange={e => setNewPassword(e.target.value)}
                    placeholder="Mínimo 6 caracteres"
                    autoComplete="new-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowNewPassword(!showNewPassword)}
                    className="text-on-surface-variant/60 p-0.5 ml-2"
                  >
                    {showNewPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-2 text-xs text-on-surface-variant bg-surface-container-low/50 rounded-lg px-4 py-3">
                <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                <span>El usuario podrá iniciar sesión con esta nueva contraseña inmediatamente.</span>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-outline-variant/10 bg-surface-container-low/30">
              <button onClick={() => setResetPasswordUser(null)} className="btn-secondary text-sm px-5 py-2.5">Cancelar</button>
              <button
                onClick={async () => {
                  if (!newPassword || newPassword.length < 6) {
                    toast.error('La contraseña debe tener al menos 6 caracteres');
                    return;
                  }
                  setResettingPassword(true);
                  try {
                    await usersApi.resetPassword(resetPasswordUser.id, newPassword);
                    toast.success('Contraseña actualizada exitosamente');
                    setResetPasswordUser(null);
                    setNewPassword('');
                  } catch (err: any) {
                    toast.error(err.message || 'Error al cambiar contraseña');
                  } finally {
                    setResettingPassword(false);
                  }
                }}
                disabled={resettingPassword}
                className="btn-primary text-sm px-5 py-2.5"
              >
                {resettingPassword ? (
                  <span className="flex items-center gap-2">
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Actualizando...
                  </span>
                ) : 'Actualizar contraseña'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      ) : null}

      {/* Permissions modal - full-screen on mobile */}
      {permissionsUser && typeof document !== 'undefined' ? createPortal(
        <div className="fixed inset-0 z-[1000] flex items-end md:items-center justify-center md:p-4 overflow-y-auto">
          <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" onClick={() => setPermissionsUser(null)} />
          <div className="relative bg-white rounded-t-3xl md:rounded-2xl shadow-2xl w-full md:max-w-2xl max-h-[95vh] md:max-h-[90vh] animate-slide-up md:animate-scale-in border border-white/40 overflow-hidden">
            {/* Top bar */}
            <div className="sticky top-0 z-10 bg-white flex items-center justify-between px-4 md:px-8 py-5 border-b border-outline-variant/10">
              <div className="flex items-center gap-4">
                <div className="w-14 h-14 rounded-2xl bg-tertiary/10 flex items-center justify-center">
                  <Shield size={28} className="text-tertiary" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-on-surface">Permisos de Acción</h3>
                  <p className="text-sm text-on-surface-variant">{permissionsUser.first_name} {permissionsUser.last_name}</p>
                </div>
              </div>
              <button onClick={() => setPermissionsUser(null)} className="w-10 h-10 flex items-center justify-center rounded-xl hover:bg-surface-container-high transition-colors">
                <X size={22} className="text-on-surface-variant" />
              </button>
            </div>

            {/* Content */}
            <div className="px-4 md:px-8 py-6 md:py-8 overflow-y-auto max-h-[72vh]">
              {permissionsLoading ? (
                <div className="flex items-center justify-center py-12">
                  <span className="w-8 h-8 border-3 border-primary/20 border-t-primary rounded-full animate-spin" />
                </div>
              ) : (
                <div className="space-y-8">
                  {/* Role indicator */}
                  <div className="bg-surface-container-low/50 rounded-xl p-4 flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                      <UsersIcon size={20} className="text-primary" />
                    </div>
                    <div>
                      <p className="text-sm font-bold text-on-surface">Rol: {roleConfig[permissionsUser.role]?.label || permissionsUser.role}</p>
                      <p className="text-xs text-on-surface-variant">{permissionsUser.email}</p>
                    </div>
                  </div>

                  {/* General permissions */}
                  <div>
                    <h4 className="text-sm font-bold text-on-surface mb-4 uppercase tracking-wider">Permisos Generales</h4>
                    <div className="space-y-3">
                      <label className="flex items-center gap-3 p-3 rounded-xl hover:bg-surface-container-low/30 cursor-pointer transition-colors">
                        <div className="relative" onClick={(e) => { e.preventDefault(); setCanCreateRequests(!canCreateRequests); }}>
                          <div className={`w-11 h-6 rounded-full transition-colors ${canCreateRequests ? 'bg-primary' : 'bg-surface-variant'}`} />
                          <div className={`absolute left-0.5 top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${canCreateRequests ? 'translate-x-5' : ''}`} />
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-on-surface">Crear solicitudes</p>
                          <p className="text-xs text-on-surface-variant">Puede crear nuevas solicitudes de certificados</p>
                        </div>
                      </label>

                      {permissionsUser.role === 'APPLICANT' && (
                        <label className="flex items-center gap-3 p-3 rounded-xl hover:bg-surface-container-low/30 cursor-pointer transition-colors">
                          <div className="relative" onClick={(e) => { e.preventDefault(); setCanViewAllRequests(!canViewAllRequests); }}>
                            <div className={`w-11 h-6 rounded-full transition-colors ${canViewAllRequests ? 'bg-primary' : 'bg-surface-variant'}`} />
                            <div className={`absolute left-0.5 top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${canViewAllRequests ? 'translate-x-5' : ''}`} />
                          </div>
                          <div>
                            <p className="text-sm font-semibold text-on-surface">Ver todas las solicitudes</p>
                            <p className="text-xs text-on-surface-variant">Puede ver solicitudes de otros usuarios de su dependencia</p>
                          </div>
                        </label>
                      )}
                    </div>
                  </div>

                  {/* Template permissions */}
                  <div>
                    <div className="flex items-center justify-between mb-4">
                      <h4 className="text-sm font-bold text-on-surface uppercase tracking-wider">Plantillas Permitidas</h4>
                    </div>
                    
                    <p className="text-xs text-on-surface-variant mb-4">
                      Selecciona los tipos de documentos que el usuario puede {permissionsUser.role === 'SIGNER' ? 'firmar' : 'solicitar'}. Si no seleccionas ninguna, el usuario podrá usar todas las plantillas disponibles.
                    </p>

                    {/* Toggle all */}
                    <button
                      onClick={toggleAllTemplates}
                      className="w-full flex items-center justify-between p-4 rounded-xl border-2 transition-all mb-3"
                      style={{
                        borderColor: selectAllTemplates ? 'var(--md-sys-color-primary)' : 'var(--md-sys-color-outline-variant)',
                        backgroundColor: selectAllTemplates ? 'var(--md-sys-color-primary-container)' : 'transparent'
                      }}
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                          <FileSpreadsheet size={20} className="text-primary" />
                        </div>
                        <div className="text-left">
                          <p className="text-sm font-bold text-on-surface">Todas las plantillas</p>
                          <p className="text-xs text-on-surface-variant">Acceso completo a todos los tipos de documento</p>
                        </div>
                      </div>
                      <div className="w-6 h-6 rounded-full border-2 flex items-center justify-center"
                        style={{
                          borderColor: selectAllTemplates ? 'var(--md-sys-color-primary)' : 'var(--md-sys-color-outline-variant)',
                          backgroundColor: selectAllTemplates ? 'var(--md-sys-color-primary)' : 'transparent'
                        }}>
                        {selectAllTemplates && <Check size={14} className="text-white" />}
                      </div>
                    </button>

                    {!selectAllTemplates && (
                      <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
                        {templatesLoading ? (
                          <div className="flex items-center justify-center py-8">
                            <span className="w-6 h-6 border-2 border-primary/20 border-t-primary rounded-full animate-spin" />
                          </div>
                        ) : templates.length === 0 ? (
                          <div className="text-center py-8 text-on-surface-variant">
                            <FileSpreadsheet size={32} className="mx-auto mb-2 opacity-50" />
                            <p className="text-sm">No hay plantillas disponibles</p>
                          </div>
                        ) : (
                          templates.map((template) => {
                            const isSelected = allowedTemplateIds.includes(template.id);
                            return (
                              <button
                                key={template.id}
                                onClick={() => toggleTemplate(template.id)}
                                className="w-full flex items-center justify-between p-3 rounded-xl border transition-all hover:shadow-sm"
                                style={{
                                  borderColor: isSelected ? 'var(--md-sys-color-primary)' : 'var(--md-sys-color-outline-variant)',
                                  backgroundColor: isSelected ? 'var(--md-sys-color-primary-container)' : 'transparent'
                                }}
                              >
                                <div className="flex items-center gap-3">
                                  <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
                                    <span className="text-primary font-bold text-sm">{template.name?.charAt(0) || 'T'}</span>
                                  </div>
                                  <div className="text-left">
                                    <p className="text-sm font-semibold text-on-surface">{template.name}</p>
                                    <p className="text-xs text-on-surface-variant">
                                      {template.code || 'Sin código'}{template.category ? ` · ${template.category}` : ''}
                                    </p>
                                  </div>
                                </div>
                                <div className="w-5 h-5 rounded-md border-2 flex items-center justify-center"
                                  style={{
                                    borderColor: isSelected ? 'var(--md-sys-color-primary)' : 'var(--md-sys-color-outline-variant)',
                                    backgroundColor: isSelected ? 'var(--md-sys-color-primary)' : 'transparent'
                                  }}>
                                  {isSelected && <Check size={12} className="text-white" />}
                                </div>
                              </button>
                            );
                          })
                        )}
                      </div>
                    )}

                    {!selectAllTemplates && allowedTemplateIds.length > 0 && (
                      <p className="text-xs text-on-surface-variant mt-3">
                        {allowedTemplateIds.length} plantilla{allowedTemplateIds.length !== 1 ? 's' : ''} seleccionada{allowedTemplateIds.length !== 1 ? 's' : ''}
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Action buttons */}
            <div className="flex items-center justify-end gap-3 px-4 md:px-8 py-4 border-t border-outline-variant/10 bg-surface-container-low/30">
              <button onClick={() => setPermissionsUser(null)} className="btn-secondary text-sm px-5 py-2.5">
                Cancelar
              </button>
              <button
                onClick={handleSavePermissions}
                disabled={permissionsSaving || permissionsLoading}
                className="btn-primary text-sm px-6 py-2.5"
              >
                {permissionsSaving ? (
                  <span className="flex items-center gap-2">
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Guardando...
                  </span>
                ) : (
                  <><Check size={16} /> Guardar permisos</>
                )}
              </button>
            </div>
          </div>
        </div>,
        document.body
      ) : null}
    </div>
  );
}
