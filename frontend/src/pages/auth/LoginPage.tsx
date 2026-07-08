import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { LogIn, Eye, EyeOff, Mail, Lock, QrCode } from 'lucide-react';
import toast from 'react-hot-toast';

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      toast.error('Por favor completa todos los campos');
      return;
    }

    setIsLoading(true);
    try {
      await login(email, password);
      toast.success('Inicio de sesión exitoso');
      navigate('/dashboard');
    } catch (error: any) {
      const message = error?.message || 'Error al iniciar sesión';
      console.error('🚨 [LOGIN PAGE] Error capturado:', {
        message: error?.message,
        status: error?.status,
        name: error?.name,
        code: error?.code,
      });
      // Mostrar detalles adicionales si es 500
      const displayMsg = error?.status === 500
        ? `Error del servidor (500). Revisa la consola (F12) para más detalles.`
        : message;
      toast.error(displayMsg);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-mesh flex flex-col items-center justify-center p-margin-mobile md:p-12 relative overflow-hidden">
      {/* Floating background elements */}
      <div className="fixed inset-0 z-0 pointer-events-none">
        <div className="absolute top-1/4 -right-20 w-64 h-64 bg-primary/10 rounded-full blur-[100px]" />
        <div className="absolute bottom-1/4 -left-20 w-80 h-80 bg-secondary-container/5 rounded-full blur-[120px]" />
      </div>

      {/* Top branding */}
      <div className="relative z-10 w-full flex flex-col items-center mb-8 md:mb-12">
        <div className="relative mb-4">
          <div className="absolute -inset-4 bg-primary/20 blur-3xl rounded-full" />
          <div className="relative bg-white p-5 rounded-2xl shadow-sm border border-white/50 flex items-center justify-center">
            <img src="/Logo%20Verix.png" alt="VERIX" className="h-12 w-auto" />
          </div>
        </div>
        <p className="text-body-md font-body-md text-on-surface-variant mt-2 text-center opacity-80">
          Plataforma Institucional de Certificados
        </p>
      </div>

      {/* Glass card login form */}
      <div className="relative z-10 glass-card w-full max-w-sm rounded-2xl p-8 flex flex-col space-y-6">
        <div className="space-y-1">
          <h2 className="text-headline-md font-headline-md text-on-surface">Bienvenido</h2>
          <p className="text-body-md font-body-md text-on-surface-variant">Ingresa tus credenciales seguras</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Email */}
          <div className="space-y-2">
            <label className="text-label-sm font-label-sm text-on-surface-variant ml-1">USUARIO O EMAIL</label>
            <div className="flex items-center bg-white/50 border border-outline-variant/30 rounded-xl px-4 py-3.5 transition-all focus-within:border-primary focus-within:ring-4 focus-within:ring-primary/10">
              <Mail size={18} className="text-on-surface-variant mr-3 shrink-0" />
              <input
                className="w-full bg-transparent border-none focus:outline-none focus:ring-0 text-body-md font-body-md text-on-surface placeholder:text-on-surface-variant/40 p-0"
                placeholder="ej. admin@institucion.edu"
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                disabled={isLoading}
                autoComplete="email"
              />
            </div>
          </div>

          {/* Password */}
          <div className="space-y-2">
            <label className="text-label-sm font-label-sm text-on-surface-variant ml-1">CONTRASEÑA</label>
            <div className="flex items-center bg-white/50 border border-outline-variant/30 rounded-xl px-4 py-3.5 transition-all focus-within:border-primary focus-within:ring-4 focus-within:ring-primary/10">
              <Lock size={18} className="text-on-surface-variant mr-3 shrink-0" />
              <input
                className="w-full bg-transparent border-none focus:outline-none focus:ring-0 text-body-md font-body-md text-on-surface placeholder:text-on-surface-variant/40 p-0"
                placeholder="••••••••"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                disabled={isLoading}
                autoComplete="current-password"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="text-on-surface-variant/60 p-0.5"
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          {/* Submit */}
          <button
            type="submit"
            disabled={isLoading}
            className="w-full bg-primary text-on-primary text-headline-md font-headline-md py-4 rounded-xl shadow-lg shadow-primary/20 active:scale-[0.98] transition-all duration-200 flex items-center justify-center gap-2"
          >
            {isLoading ? (
              <div className="w-5 h-5 border-2 border-on-primary border-t-transparent rounded-full animate-spin" />
            ) : (
              <>
                <span>Acceder</span>
                <LogIn size={20} />
              </>
            )}
          </button>
        </form>

        {/* Recovery link */}
        <div className="flex justify-center pt-2">
          <a className="text-body-md font-body-md text-primary font-semibold hover:underline cursor-pointer">
            ¿Olvidaste tu contraseña?
          </a>
        </div>
      </div>

      {/* Public verification access */}
      <div className="relative z-10 mt-6 w-full max-w-sm">
        <button className="w-full glass-card py-4 rounded-xl flex items-center justify-center gap-3 text-on-surface-variant font-semibold border border-white/40 active:scale-[0.98] transition-all">
          <QrCode size={22} className="text-primary" />
          <span className="text-body-md font-body-md">Validar Certificado Público</span>
        </button>
      </div>

      {/* Footer */}
      <div className="relative z-10 mt-8 flex items-center justify-center gap-6 text-on-surface-variant/60">
        <a className="text-label-sm font-label-sm hover:text-primary transition-colors cursor-pointer">Términos</a>
        <span className="w-1.5 h-1.5 bg-outline-variant/30 rounded-full" />
        <a className="text-label-sm font-label-sm hover:text-primary transition-colors cursor-pointer">Privacidad</a>
        <span className="w-1.5 h-1.5 bg-outline-variant/30 rounded-full" />
        <a className="text-label-sm font-label-sm hover:text-primary transition-colors cursor-pointer">Soporte</a>
      </div>

      {/* Biometric hint */}
      <div className="fixed bottom-8 left-0 w-full flex flex-col items-center pointer-events-none opacity-30">
        <span className="text-3xl mb-1">🔐</span>
        <p className="text-label-sm font-label-sm">Biometría disponible</p>
      </div>
    </div>
  );
}
