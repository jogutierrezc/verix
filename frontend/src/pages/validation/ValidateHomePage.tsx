import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Shield, Search, Hash, FileText, ArrowRight, Info } from 'lucide-react';

export function ValidateHomePage() {
  const navigate = useNavigate();
  const [searchCode, setSearchCode] = useState('');

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const code = searchCode.trim();
    if (!code) return;
    navigate(`/validate/${encodeURIComponent(code)}`);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-green-50 flex items-center justify-center p-4">
      <div className="w-full max-w-lg">
        {/* Header with logo */}
        <div className="text-center mb-8">
          <div className="flex justify-center mb-4">
            <img src="/Logo%20Verix.png" alt="VERIX" className="h-12 w-auto" />
          </div>
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-white/80 backdrop-blur rounded-full shadow-sm border border-green-200 mb-4">
            <Shield size={16} className="text-green-600" />
            <span className="text-sm font-semibold text-green-800">VERIX · Validación de Documentos</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-800">Verificar Certificado</h1>
          <p className="text-sm text-gray-500 mt-1">
            Ingresa el código de solicitud o el número de radicado del certificado
          </p>
        </div>

        {/* Search card */}
        <div className="bg-white rounded-2xl shadow-lg p-8">
          <form onSubmit={handleSearch} className="space-y-4">
            <div className="relative">
              <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                className="input w-full pl-11 pr-4 py-3 text-base"
                placeholder="Código de solicitud o radicado..."
                value={searchCode}
                onChange={e => setSearchCode(e.target.value)}
                autoFocus
              />
            </div>
            <button
              type="submit"
              disabled={!searchCode.trim()}
              className="btn-primary w-full py-3 text-base"
            >
              <Search size={18} />
              Buscar certificado
            </button>
          </form>

          <div className="mt-6 pt-6 border-t border-gray-100">
            <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
              <Info size={14} />
              ¿Cómo obtener el código?
            </h3>
            <div className="space-y-3 text-sm text-gray-500">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-green-100 flex items-center justify-center shrink-0">
                  <Hash size={16} className="text-green-600" />
                </div>
                <div>
                  <p className="font-medium text-gray-700">Por radicado</p>
                  <p className="text-xs text-gray-400">
                    Ingresa el número de radicado que aparece en el certificado impreso (ej: DIP-2026-000001)
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center shrink-0">
                  <FileText size={16} className="text-blue-600" />
                </div>
                <div>
                  <p className="font-medium text-gray-700">Por código de solicitud</p>
                  <p className="text-xs text-gray-400">
                    Ingresa el ID único de la solicitud (ej: REQ-2024-000001)
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Examples */}
        <div className="mt-4 text-center">
          <p className="text-xs text-gray-400">
            Ejemplos: <button onClick={() => navigate('/validate/REQ-2024-000001')} className="text-green-600 hover:underline font-mono">REQ-2024-000001</button>
            {' · '}
            <button onClick={() => navigate('/validate/DIP-2026-000001')} className="text-green-600 hover:underline font-mono">DIP-2026-000001</button>
          </p>
        </div>

        {/* Powered by */}
        <div className="text-center mt-8">
          <p className="text-xs text-gray-400">
            Powered by <span className="font-semibold text-green-700">VERIX</span> · Sistema de Certificación Digital
          </p>
        </div>
      </div>
    </div>
  );
}
