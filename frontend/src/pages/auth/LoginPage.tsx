import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import {
  Eye,
  EyeOff,
  Mail,
  Lock,
  QrCode,
  CheckCircle,
  ArrowRight,
} from 'lucide-react';
import toast from 'react-hot-toast';

interface Slide {
  tag: string;
  tagColor: string;
  title: string;
  description: string;
}

const SLIDES: Slide[] = [
  {
    tag: 'Seguridad Total',
    tagColor: 'text-emerald-300 bg-emerald-500/20 border-emerald-500/30',
    title: 'La plataforma definitiva para tus certificados seguros.',
    description:
      'VERIX implementa criptografía de punta y firmas digitales distribuidas para asegurar que cada credencial emitida sea absolutamente inalterable, rápida de verificar y aceptada globalmente.',
  },
  {
    tag: 'Validación Instantánea',
    tagColor: 'text-teal-300 bg-teal-500/20 border-teal-500/30',
    title: 'Validación mediante código QR o firma digital.',
    description:
      'Estudiantes, reclutadores y entidades reguladoras pueden constatar la autenticidad de un título en segundos desde cualquier rincón del mundo, sin burocracia ni intermediarios.',
  },
  {
    tag: 'Ecosistema Moderno',
    tagColor: 'text-green-300 bg-green-500/20 border-green-500/30',
    title: 'Integración directa con instituciones líderes.',
    description:
      'Unificamos la expedición de insignias, diplomas de grado y certificaciones profesionales en una experiencia digital fluida, limpia y amigable con el medio ambiente.',
  },
];

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [currentSlide, setCurrentSlide] = useState(0);
  const { login } = useAuth();
  const navigate = useNavigate();

  const nextSlide = useCallback(() => {
    setCurrentSlide((prev) => (prev + 1) % SLIDES.length);
  }, []);

  // Auto-rotate carousel
  useEffect(() => {
    const interval = setInterval(nextSlide, 7000);
    return () => clearInterval(interval);
  }, [nextSlide]);

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
      const displayMsg =
        error?.status === 500
          ? `Error del servidor (500). Revisa la consola (F12) para más detalles.`
          : message;
      toast.error(displayMsg);
    } finally {
      setIsLoading(false);
    }
  };

  const slide = SLIDES[currentSlide];

  return (
    <div className="min-h-screen flex overflow-hidden font-sans select-none antialiased">
      {/* LEFT PANEL: Dynamic Gradient Background + Branding + Carousel */}
      <div className="hidden lg:flex lg:w-1/2 min-h-screen flex-col relative text-white overflow-hidden"
        style={{
          background: 'linear-gradient(-45deg, #022c22, #166534, #0f766e, #064e3b)',
          backgroundSize: '400% 400%',
          animation: 'gradientMove 15s ease infinite',
        }}
      >
        <style>{`
          @keyframes gradientMove {
            0% { background-position: 0% 50%; }
            50% { background-position: 100% 50%; }
            100% { background-position: 0% 50%; }
          }
          @keyframes floatBlob {
            0% { transform: translate(0px, 0px) scale(1); }
            50% { transform: translate(60px, -40px) scale(1.2); }
            100% { transform: translate(-30px, 50px) scale(0.9); }
          }
          @keyframes carouselEnter {
            from { opacity: 0; transform: translateX(16px); }
            to { opacity: 1; transform: translateX(0); }
          }
          .carousel-slide-enter {
            animation: carouselEnter 0.6s cubic-bezier(0.16, 1, 0.3, 1) forwards;
          }
        `}</style>

        {/* Floating blobs */}
        <div
          className="absolute rounded-full opacity-45 mix-blend-screen pointer-events-none"
          style={{
            width: 350,
            height: 350,
            background: '#22c55e',
            top: '-10%',
            left: '-10%',
            animation: 'floatBlob 25s infinite alternate',
          }}
        />
        <div
          className="absolute rounded-full opacity-45 mix-blend-screen pointer-events-none"
          style={{
            width: 400,
            height: 400,
            background: '#0f766e',
            bottom: '-15%',
            right: '-5%',
            animation: 'floatBlob 30s infinite alternate',
            animationDelay: '2s',
          }}
        />

        {/* Brand logo - absolute top */}
        <div className="absolute top-0 left-0 right-0 z-10 p-12 pb-0">
          <div className="flex items-center gap-3">
            <img
              src="/Logo%20Verix.png"
              alt="VERIX"
              className="h-10 w-auto brightness-0 invert"
            />
          </div>
        </div>

        {/* Carousel - vertically centered in remaining space */}
        <div className="flex-1 flex items-center justify-center z-10 px-12">
          <div className="max-w-lg w-full">
            <div key={currentSlide} className="carousel-slide-enter">
              <span
                className={`px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wider inline-block ${slide.tagColor}`}
              >
                {slide.tag}
              </span>
              <h1 className="text-4xl xl:text-5xl font-extrabold tracking-tight mt-4 leading-tight">
                {slide.title}
              </h1>
              <p className="text-emerald-100/80 mt-4 leading-relaxed text-base">
                {slide.description}
              </p>
            </div>

            {/* Carousel controls */}
            <div className="flex items-center gap-6 mt-8">
              <div className="flex gap-2">
                {SLIDES.map((_, i) => (
                  <button
                    key={i}
                    onClick={() => setCurrentSlide(i)}
                    className={`rounded-full transition-all duration-300 cursor-pointer ${
                      i === currentSlide ? 'w-8 h-2 bg-white' : 'w-2 h-2 bg-white/40'
                    }`}
                  />
                ))}
              </div>
              <div className="text-xs text-emerald-200/60 font-medium">Auto-rotación activa</div>
            </div>

            {/* Stats panel */}
            <div className="mt-12 p-6 rounded-2xl backdrop-blur-md border border-white/10 shadow-2xl"
              style={{ background: 'rgba(255, 255, 255, 0.08)' }}
            >
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <span className="block text-2xl font-black text-white">99.9%</span>
                  <span className="text-[10px] uppercase text-emerald-300 tracking-wider font-semibold">
                    Integridad
                  </span>
                </div>
                <div className="border-l border-white/10 pl-4">
                  <span className="block text-2xl font-black text-white">+5M</span>
                  <span className="text-[10px] uppercase text-emerald-300 tracking-wider font-semibold">
                    Emitidos
                  </span>
                </div>
                <div className="border-l border-white/10 pl-4">
                  <span className="block text-2xl font-black text-white">&lt; 1s</span>
                  <span className="text-[10px] uppercase text-emerald-300 tracking-wider font-semibold">
                    Validación
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Footer - absolute bottom */}
        <div className="absolute bottom-0 left-0 right-0 z-10 px-12 pb-6">
          <div className="flex justify-between items-center text-xs text-emerald-200/60 border-t border-white/10 pt-6">
            <span>© 2026 VERIX Inc. Todos los derechos reservados.</span>
            <div className="flex gap-4">
              <span className="hover:text-white transition-colors cursor-pointer">Seguridad</span>
              <span>•</span>
              <span className="hover:text-white transition-colors cursor-pointer">Infraestructura</span>
            </div>
          </div>
        </div>
      </div>

      {/* RIGHT PANEL: Login Form */}
      <div className="w-full lg:w-1/2 min-h-screen bg-[#f7f9fb] flex items-center justify-center p-6 sm:p-8">
        {/* Auth box - centered vertically with natural spacing */}
        <div className="w-full max-w-md space-y-6">
          {/* Main logo */}
          <div className="text-center">
            <div className="inline-flex items-center gap-3 bg-white px-6 py-3 rounded-2xl shadow-md border border-slate-100 mb-4">
              <img src="/Logo%20Verix.png" alt="VERIX" className="h-10 w-auto" />
              <div className="w-5 h-5 bg-emerald-100 rounded-full flex items-center justify-center">
                <CheckCircle size={12} className="text-[#006e2f]" />
              </div>
            </div>
            <p className="text-on-surface-variant text-xs font-semibold tracking-wide uppercase">
              Plataforma Institucional de Certificados
            </p>
          </div>

          {/* Login card */}
          <div className="bg-white p-8 rounded-[2rem] border border-slate-100 shadow-xl shadow-slate-200/50">
            <div className="mb-6">
              <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-800 tracking-tight">
                Bienvenido
              </h2>
              <p className="text-on-surface-variant text-sm mt-1">
                Ingresa tus credenciales seguras de acceso
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Email */}
              <div className="space-y-1.5">
                <label className="text-on-surface-variant text-xs font-bold uppercase tracking-wider block">
                  Usuario o Email
                </label>
                <div className="relative">
                  <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400">
                    <Mail size={16} />
                  </span>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    disabled={isLoading}
                    autoComplete="email"
                    className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-800 placeholder-slate-400 transition-all outline-none focus:border-[#006e2f] focus:ring-4 focus:ring-[#006e2f]/10"
                    placeholder="ej. admin@institucion.edu"
                  />
                </div>
              </div>

              {/* Password */}
              <div className="space-y-1.5">
                <label className="text-on-surface-variant text-xs font-bold uppercase tracking-wider block">
                  Contraseña
                </label>
                <div className="relative">
                  <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400">
                    <Lock size={16} />
                  </span>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={isLoading}
                    autoComplete="current-password"
                    className="w-full pl-10 pr-10 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-800 placeholder-slate-400 transition-all outline-none focus:border-[#006e2f] focus:ring-4 focus:ring-[#006e2f]/10"
                    placeholder="••••••••"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute inset-y-0 right-0 flex items-center pr-3 text-slate-400 hover:text-slate-600 transition-colors"
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              {/* Submit */}
              <button
                type="submit"
                disabled={isLoading}
                className="w-full bg-gradient-to-r from-emerald-800 to-emerald-700 hover:from-emerald-700 hover:to-emerald-600 active:scale-[0.98] text-white py-3.5 px-6 rounded-xl font-bold text-sm tracking-wide shadow-lg shadow-emerald-700/20 hover:shadow-emerald-700/30 transition-all duration-200 flex items-center justify-center gap-2"
              >
                {isLoading ? (
                  <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <>
                    <span>Acceder</span>
                    <ArrowRight size={16} />
                  </>
                )}
              </button>
            </form>

            {/* Forgot password */}
            <div className="text-center mt-5">
              <span
                onClick={() => toast.success('Enlace de restablecimiento enviado.')}
                className="text-emerald-700 hover:text-emerald-800 text-xs font-bold hover:underline transition-all cursor-pointer"
              >
                ¿Olvidaste tu contraseña?
              </span>
            </div>
          </div>

          {/* Public certificate validation button */}
          <button
            onClick={() => navigate('/validate')}
            className="w-full py-4 px-6 bg-white border border-slate-200 rounded-xl text-slate-700 hover:text-emerald-700 hover:bg-slate-50 font-bold text-sm shadow-md transition-all duration-200 flex items-center justify-center gap-3"
          >
            <span className="w-5 h-5 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-700">
              <QrCode size={12} />
            </span>
            <span>Validar Certificado Público</span>
          </button>

          {/* Simple footer */}
          <p className="text-center text-xs text-slate-400">
            © 2026 VERIX · Plataforma Institucional de Certificados
          </p>
        </div>
      </div>
    </div>
  );
}
