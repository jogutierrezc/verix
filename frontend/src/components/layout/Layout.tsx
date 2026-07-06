import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import {
  LayoutDashboard, FileText, FileSpreadsheet, Users, Building2,
  ClipboardList, Settings, LogOut, Menu, Bell, X, Hash,
} from 'lucide-react';

const adminLinks = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/requests', icon: FileText, label: 'Solicitudes' },
  { to: '/templates', icon: FileSpreadsheet, label: 'Plantillas' },
  { to: '/radicados', icon: Hash, label: 'Radicados' },
  { to: '/users', icon: Users, label: 'Usuarios' },
  { to: '/institutions', icon: Building2, label: 'Instituciones' },
  { to: '/audit', icon: ClipboardList, label: 'Auditoría' },
  { to: '/settings', icon: Settings, label: 'Configuración' },
];

const signerLinks = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/requests', icon: FileText, label: 'Solicitudes' },
  { to: '/settings', icon: Settings, label: 'Configuración' },
];

const applicantLinks = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/requests', icon: FileText, label: 'Mis Solicitudes' },
  { to: '/settings', icon: Settings, label: 'Configuración' },
];

const mobileLinks = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Inicio' },
  { to: '/requests', icon: FileText, label: 'Solicitudes' },
  { to: '/settings', icon: Settings, label: 'Configuración' },
  { to: '/templates', icon: FileSpreadsheet, label: 'Más' },
];

export function Layout({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);

  const links =
    user?.role === 'ADMIN'
      ? adminLinks
      : user?.role === 'SIGNER'
        ? signerLinks
        : applicantLinks;

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const fullName = `${user?.first_name || ''} ${user?.last_name || ''}`.trim() || 'Usuario';
  const initials = `${user?.first_name?.charAt(0) || ''}${user?.last_name?.charAt(0) || ''}`.toUpperCase() || 'U';

  return (
    <div className="min-h-screen bg-mesh flex">
      {/* Sidebar overlay (mobile) */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/20 backdrop-blur-sm z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Desktop Sidebar - w-80 for more breathing room */}
      <aside className="hidden lg:flex flex-col h-screen w-[320px] sticky top-0 bg-surface/70 backdrop-blur-xl border-r border-white/20 shadow-lg z-30">
        {/* Logo - more padding */}
        <div className="px-10 pt-10 pb-8 flex items-center gap-4">
          <div className="w-12 h-12 bg-primary rounded-2xl flex items-center justify-center shadow-lg shadow-primary/20">
            <span className="text-on-primary font-bold text-xl">V</span>
          </div>
          <div>
            <h1 className="text-[26px] font-bold text-primary leading-tight tracking-tight">VERIX</h1>
            <p className="text-[10px] font-bold text-on-surface-variant/50 uppercase tracking-[0.15em]">Institutional</p>
          </div>
        </div>

        {/* Navigation - wider padding */}
        <nav className="flex-1 px-5 space-y-1.5">
          {links.map((link) => {
            const isActive = location.pathname === link.to;
            const Icon = link.icon;
            return (
              <Link
                key={link.to}
                to={link.to}
                className={`flex items-center gap-4 px-5 py-3.5 rounded-2xl transition-all duration-200 group ${
                  isActive
                    ? 'bg-primary text-on-primary shadow-lg shadow-primary/20 font-semibold'
                    : 'text-on-surface-variant hover:bg-surface-container-high/50 hover:text-on-surface font-medium'
                }`}
              >
                <Icon size={22} className={isActive ? '' : 'group-hover:translate-x-0.5 transition-transform'} />
                <span className="text-[15px]">{link.label}</span>
                {isActive && (
                  <div className="ml-auto w-1.5 h-1.5 rounded-full bg-on-primary/60" />
                )}
              </Link>
            );
          })}
        </nav>

        {/* Bottom section - more spacing */}
        <div className="mt-auto px-5 pb-8 pt-4 border-t border-white/20">
          <div className="flex items-center gap-4 px-3 py-4">
            <div className="w-11 h-11 rounded-2xl bg-primary-fixed/50 flex items-center justify-center text-primary text-sm font-bold border-2 border-primary/10">
              {initials}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-on-surface truncate">{fullName}</p>
              <p className="text-[12px] text-on-surface-variant/70 capitalize font-medium">
                {user?.role === 'ADMIN' ? 'Administrador' : user?.role === 'SIGNER' ? 'Firmante' : 'Solicitante'}
              </p>
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="inline-flex items-center gap-3 w-full justify-start px-4 py-3.5 rounded-xl text-error/70 hover:bg-error/5 hover:text-error transition-all font-medium"
          >
            <LogOut size={20} />
            <span>Cerrar sesión</span>
          </button>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 max-w-[1600px] mx-auto w-full">
        {/* Top bar */}
        <header className="h-16 bg-white/70 backdrop-blur-xl border-b border-white/20 shadow-sm sticky top-0 z-30 flex items-center justify-between px-margin-mobile lg:px-margin-desktop">
          <div className="flex items-center gap-4">
            <button
              onClick={() => setSidebarOpen(true)}
              className="lg:hidden p-2.5 rounded-xl hover:bg-surface-container-high/50 transition-colors"
            >
              <Menu size={24} className="text-on-surface" />
            </button>
            <div className="lg:hidden flex items-center gap-2">
              <div className="w-9 h-9 bg-primary rounded-xl flex items-center justify-center shadow-sm">
                <span className="text-on-primary font-bold text-base">V</span>
              </div>
              <span className="text-[22px] font-bold text-primary tracking-tight">VERIX</span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Notifications */}
            <button className="relative p-2.5 text-on-surface-variant hover:bg-surface-container-high/50 rounded-xl transition-colors">
              <Bell size={22} />
              <span className="absolute top-2 right-2 w-2.5 h-2.5 bg-error rounded-full ring-2 ring-white" />
            </button>

            {/* Profile dropdown */}
            <div className="relative">
              <button
                onClick={() => setProfileOpen(!profileOpen)}
                className="flex items-center gap-2 p-1.5 hover:bg-surface-container-high/50 rounded-xl transition-colors"
              >
                <div className="w-10 h-10 rounded-2xl bg-primary-fixed/50 flex items-center justify-center text-primary text-sm font-bold border-2 border-primary/10 hover:border-primary/30 transition-colors">
                  {initials}
                </div>
              </button>

              {profileOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setProfileOpen(false)} />
                  <div className="absolute right-0 top-full mt-3 w-64 glass-card rounded-2xl shadow-xl z-20 py-3 animate-scale-in border border-white/50">
                    <div className="px-6 py-4 border-b border-outline-variant/20">
                      <p className="text-sm font-bold text-on-surface">{fullName}</p>
                      <p className="text-xs text-on-surface-variant mt-0.5">{user?.email}</p>
                    </div>
                    <Link
                      to="/settings"
                      onClick={() => setProfileOpen(false)}
                      className="flex items-center gap-3 px-6 py-3.5 text-sm text-on-surface hover:bg-surface-container-high/50 transition-colors font-medium"
                    >
                      <Settings size={16} />
                      Configuración
                    </Link>
                    <div className="border-t border-outline-variant/20 mt-1 pt-1">
                      <button
                        onClick={handleLogout}
                        className="flex items-center gap-3 px-6 py-3.5 text-sm text-error hover:bg-error/5 transition-colors w-full font-medium"
                      >
                        <LogOut size={16} />
                        Cerrar sesión
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </header>

        {/* Mobile sidebar drawer */}
        <aside className={`fixed inset-y-0 left-0 z-50 w-[300px] bg-surface/90 backdrop-blur-xl border-r border-white/20 shadow-xl transform transition-transform duration-300 ease-out lg:hidden ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}>
          <div className="flex flex-col h-full">
            <div className="flex items-center justify-between px-6 h-16 border-b border-white/20">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 bg-primary rounded-xl flex items-center justify-center shadow-sm">
                  <span className="text-on-primary font-bold text-base">V</span>
                </div>
                <span className="text-xl font-bold text-primary tracking-tight">VERIX</span>
              </div>
              <button
                onClick={() => setSidebarOpen(false)}
                className="p-2 rounded-xl hover:bg-surface-container-high/50 transition-colors"
              >
                <X size={22} />
              </button>
            </div>
            <nav className="flex-1 px-4 py-6 space-y-1">
              {links.map((link) => {
                const isActive = location.pathname === link.to;
                const Icon = link.icon;
                return (
                  <Link
                    key={link.to}
                    to={link.to}
                    onClick={() => setSidebarOpen(false)}
                    className={`flex items-center gap-4 px-4 py-3.5 rounded-2xl transition-all duration-200 ${
                      isActive
                        ? 'bg-primary text-on-primary shadow-md font-semibold'
                        : 'text-on-surface-variant hover:bg-surface-container-high/50 font-medium'
                    }`}
                  >
                    <Icon size={22} />
                    <span>{link.label}</span>
                  </Link>
                );
              })}
            </nav>
            <div className="border-t border-white/20 p-4">
              <button
                onClick={handleLogout}
                className="flex items-center gap-3 px-4 py-3.5 text-error hover:bg-error/5 rounded-2xl w-full transition-all font-medium"
              >
                <LogOut size={20} />
                <span>Cerrar sesión</span>
              </button>
            </div>
          </div>
        </aside>

        {/* Page content - more generous padding */}
        <main className="flex-1 p-margin-mobile lg:p-margin-desktop overflow-auto">
          {children}
        </main>

        {/* Bottom Navigation (Mobile only) */}
        <nav className="lg:hidden fixed bottom-0 left-0 w-full z-50 bg-white/80 backdrop-blur-xl border-t border-white/20 shadow-[0_-4px_12px_rgba(0,0,0,0.06)] pb-safe px-6 pt-3 flex justify-around items-center">
          {mobileLinks.map((link) => {
            const isActive = location.pathname === link.to;
            const Icon = link.icon;
            return (
              <Link
                key={link.to}
                to={link.to}
                className={`flex flex-col items-center justify-center transition-all duration-200 gap-1 ${
                  isActive ? 'text-primary font-semibold scale-110' : 'text-on-surface-variant/60'
                }`}
              >
                <div className={`p-1.5 rounded-xl transition-all ${isActive ? 'bg-primary/10' : ''}`}>
                  <Icon size={22} />
                </div>
                <span className="text-[10px] font-medium">{link.label}</span>
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
