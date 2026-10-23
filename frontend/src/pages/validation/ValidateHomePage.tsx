import { useLayoutEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import gsap from 'gsap';
import { ArrowRight, Loader2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { Seal } from './Seal';
import './portal.css';

interface FoundCertificate {
  verification_code: string;
  code: string;
  status: string;
  consecutive_number: string | null;
  issued_at: string | null;
  holder_name: string | null;
  template_name: string | null;
}

/** "1.094.852.114", "1094852114" o "CC 1094852114" → documento; el resto se trata como código. */
function asDocumentNumber(input: string): string | null {
  const digits = input.replace(/^(c\.?c\.?|t\.?i\.?|c\.?e\.?)\s*/i, '').replace(/[\s.\-]/g, '');
  return /^\d{5,15}$/.test(digits) ? digits : null;
}

const formatDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' }) : '—';

export function ValidateHomePage() {
  const navigate = useNavigate();
  const root = useRef<HTMLDivElement>(null);
  const seal = useRef<SVGSVGElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<FoundCertificate[] | null>(null);
  const [searchedDoc, setSearchedDoc] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Un solo momento coreografiado: el sello se estampa sobre el espécimen.
  useLayoutEffect(() => {
    const mm = gsap.matchMedia();
    mm.add('(prefers-reduced-motion: no-preference)', () => {
      const tl = gsap.timeline({ defaults: { ease: 'expo.out' } });
      tl.from('[data-rise]', { y: 22, opacity: 0, duration: 0.9, stagger: 0.08 })
        .from('[data-sheet]', { y: 40, rotate: 0, opacity: 0, duration: 1.1 }, 0.1)
        .from('[data-line]', { scaleX: 0, transformOrigin: 'left center', duration: 0.7, stagger: 0.05 }, 0.5)
        .from(seal.current, { scale: 1.9, rotate: -24, opacity: 0, duration: 0.28, ease: 'power3.in' }, 1.0)
        .to('[data-sheet]', { y: 3, duration: 0.07, yoyo: true, repeat: 1, ease: 'power1.inOut' }, '>-0.02');
    }, root);
    return () => mm.revert();
  }, []);

  const animateResults = () => {
    requestAnimationFrame(() => {
      gsap.matchMedia().add('(prefers-reduced-motion: no-preference)', () => {
        gsap.from('[data-result]', { y: 14, opacity: 0, duration: 0.6, stagger: 0.06, ease: 'expo.out', clearProps: 'all' });
      }, resultsRef);
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const value = query.trim();
    if (!value || searching) return;
    setError(null);
    setResults(null);

    const doc = asDocumentNumber(value);
    if (!doc) {
      navigate(`/validate/${encodeURIComponent(value)}`);
      return;
    }

    setSearching(true);
    try {
      const { data, error: rpcError } = await supabase.rpc('search_certificates_by_document', { p_document: doc });
      if (rpcError) {
        // Migración sin aplicar: se conserva la búsqueda anterior (un resultado)
        navigate(`/validate/${encodeURIComponent(doc)}`);
        return;
      }
      const list: FoundCertificate[] = Array.isArray(data) ? data : [];
      if (list.length === 1) {
        navigate(`/validate/${encodeURIComponent(list[0].verification_code)}`);
        return;
      }
      setSearchedDoc(doc);
      setResults(list);
      if (list.length > 0) animateResults();
    } catch {
      setError('No pudimos conectar con el registro. Revise su conexión e intente de nuevo.');
    } finally {
      setSearching(false);
    }
  };

  return (
    <div ref={root} className="portal">
      <div className="mx-auto max-w-6xl px-5 sm:px-8 pt-8 pb-16 min-h-screen flex flex-col">
        <header data-rise className="flex items-center justify-between">
          <img src="/Logo%20Verix.png" alt="VERIX" className="h-9 w-auto" />
          <button
            onClick={() => navigate('/login')}
            className="text-sm font-medium underline underline-offset-4 decoration-[var(--rule)] hover:decoration-[var(--ink)] transition-colors"
          >
            Acceso institucional
          </button>
        </header>

        <main className="flex-1 grid lg:grid-cols-[1.15fr_0.85fr] gap-14 lg:gap-10 items-center py-14 lg:py-10">
          <section>
            <h1 data-rise className="display text-[clamp(2.6rem,6.2vw,5rem)]">
              Compruebe que un certificado es auténtico.
            </h1>
            <p data-rise className="mt-6 max-w-[52ch] text-lg text-[var(--ink-soft)]">
              Escriba el número de documento del estudiante, el código impreso en el certificado o su radicado.
              Le mostraremos si fue expedido y sigue vigente.
            </p>

            <form data-rise onSubmit={handleSubmit} className="mt-10 max-w-xl">
              <label htmlFor="lookup" className="block text-sm font-semibold mb-1">
                Documento, código o radicado
              </label>
              <input
                id="lookup"
                className="ledger-input"
                value={query}
                onChange={(e) => { setQuery(e.target.value); if (results) setResults(null); }}
                placeholder="1094852114"
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                inputMode="text"
                autoFocus
              />
              <div className="mt-5 flex items-center gap-5">
                <button type="submit" className="btn-ink" disabled={!query.trim() || searching}>
                  {searching ? <Loader2 size={18} className="animate-spin" /> : null}
                  {searching ? 'Consultando' : 'Consultar'}
                  {!searching && <ArrowRight size={18} />}
                </button>
                <span className="text-sm text-[var(--ink-soft)]">
                  Ejemplo de código: <span className="mono">VRX-9821-LK75</span>
                </span>
              </div>
            </form>

            <div ref={resultsRef} aria-live="polite" className="mt-12 max-w-xl">
              {error && <p className="tone-revoked font-medium">{error}</p>}

              {results && results.length === 0 && (
                <div data-result>
                  <p className="display text-2xl">Sin resultados para {searchedDoc}.</p>
                  <p className="mt-2 text-[var(--ink-soft)]">
                    Verifique que escribió el número completo, sin letras. Si el documento es correcto, es posible que
                    el certificado aún no haya sido aprobado; consulte con la institución que lo emitió.
                  </p>
                </div>
              )}

              {results && results.length > 1 && (
                <div>
                  <p data-result className="text-sm text-[var(--ink-soft)] mb-3 num">
                    {results.length} certificados para el documento {searchedDoc}
                  </p>
                  {results.map((c) => {
                    const revoked = c.status === 'REVOKED';
                    return (
                      <a
                        key={c.verification_code}
                        data-result
                        className="ledger-row"
                        href={`/validate/${encodeURIComponent(c.verification_code)}`}
                        onClick={(ev) => { ev.preventDefault(); navigate(`/validate/${encodeURIComponent(c.verification_code)}`); }}
                      >
                        <span>
                          <span className="display text-xl block">{c.template_name || 'Certificado'}</span>
                          <span className="text-sm text-[var(--ink-soft)] num">
                            {c.holder_name ? `${c.holder_name} · ` : ''}{formatDate(c.issued_at)}
                          </span>
                        </span>
                        <span className={`text-sm font-semibold ${revoked ? 'tone-revoked' : 'tone-valid'}`}>
                          {revoked ? 'Revocado' : 'Vigente'}
                        </span>
                      </a>
                    );
                  })}
                </div>
              )}
            </div>
          </section>

          {/* Espécimen: hoja carta apaisada con el sello estampándose */}
          <aside aria-hidden className="hidden lg:block">
            <div data-sheet className="paper-sheet relative aspect-[11/8.5] w-full max-w-[460px] ml-auto -rotate-2 p-7">
              <div className="h-2 w-16 bg-[var(--ink)]" data-line />
              <div className="mt-5 display text-[1.7rem] leading-tight">Certificado de aprobación</div>
              <div className="mt-5 space-y-2.5">
                {[92, 100, 78, 96, 60].map((w, i) => (
                  <div key={i} data-line className="h-[5px] bg-[var(--rule)]" style={{ width: `${w}%` }} />
                ))}
              </div>
              <div className="absolute left-7 bottom-8 w-32">
                <div data-line className="h-px bg-[var(--ink)]" />
                <div className="mt-1.5 text-[10px] text-[var(--ink-soft)]">Firma autorizada</div>
              </div>
              <div className="absolute right-6 bottom-5">
                <Seal ref={seal} tone="valid" ring="Registro verificado" size={118} />
              </div>
            </div>
          </aside>
        </main>

        <footer data-rise className="text-sm text-[var(--ink-soft)] flex flex-wrap gap-x-6 gap-y-1 justify-between border-t border-[var(--rule)] pt-5">
          <span>La consulta es pública y no requiere cuenta.</span>
          <span>VERIX · desarrollado por Jose Alfredo Gutierrez Contreras</span>
        </footer>
      </div>
    </div>
  );
}
