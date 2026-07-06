import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '../../lib/supabase';
import { usersApi } from '../../services/api';
import { Plus, Search, UserCheck, UserX, Users as UsersIcon, Building2, Layers, X, Lock, Eye, EyeOff } from 'lucide-react';
import toast from 'react-hot-toast';

const roleConfig: Record<string, { label: string; bg: string; color: string }> = {
  ADMIN: { label: 'Admin', bg: 'bg-primary/10', color: 'text-primary' },
  SIGNER: { label: 'Firmante', bg: 'bg-secondary-fixed', color: 'text-secondary' },
  APPLICANT: { label: 'Solicitante', bg: 'bg-surface-variant', color: 'text-on-surface-variant' },
};

export function UsersPage() {
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

  useEffect(() => { loadUsers(); loadInstitutions(); }, []);

  const loadUsers = async () => {
    setLoading(true);
    try {
      const { data } = await supabase
        .from('users')
        .select('*, institution:institutions(name)')
        .order('created_at', { ascending: false });
      setUsers(data || []);
    } catch (err) {
      console.error('Error loading users:', err);
    } finally {
      setLoading(false);
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

      {/* Table */}
      <div className="glass-card rounded-2xl overflow-hidden border border-white/40">
        <div className="overflow-x-auto">
          <table className="w-full">
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
                      <span className={`text-[11px] font-bold px-3 py-1 rounded-full ${role.bg} ${role.color}`}>
                        {role.label}
                      </span>
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

      {/* Create user modal */}
      {showModal && typeof document !== 'undefined' ? createPortal(
        <div className="fixed inset-0 z-[1000] flex items-center justify-center p-2 md:p-4 overflow-y-auto">
          <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" onClick={() => setShowModal(false)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[85vh] animate-scale-in border border-white/40 overflow-hidden">
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

              <div className="h-16" />
            </div>
          </div>
        </div>,
        document.body
      ) : null}

      {/* Reset password modal */}
      {resetPasswordUser && typeof document !== 'undefined' ? createPortal(
        <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" onClick={() => setResetPasswordUser(null)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md animate-scale-in border border-white/40 overflow-hidden">
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
    </div>
  );
}
