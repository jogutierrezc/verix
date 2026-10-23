import { getPageDimensions, normalizePageSize } from '../../lib/pageSizes';
import { stripRichText } from '../../lib/richText';
import type { TemplateElement } from './TemplateCanvas';

/**
 * Miniatura de la primera página de una plantilla, con las proporciones reales
 * del papel guardado (Carta por defecto). Sirve para reconocer el documento a
 * simple vista al solicitarlo.
 */
export function TemplateThumb({ config, width = 88 }: { config: any; width?: number }) {
  const cfg = typeof config === 'string' ? safeParse(config) : config || {};
  const orientation = cfg.orientation === 'portrait' ? 'portrait' : 'landscape';
  const { width: pw, height: ph } = getPageDimensions(normalizePageSize(cfg.pageSize), orientation);
  const scale = width / pw;
  const elements: TemplateElement[] = (cfg.elements || []).filter((el: TemplateElement) => (el.page ?? 0) === 0);

  return (
    <div
      className="relative shrink-0 overflow-hidden bg-white ring-1 ring-black/10"
      style={{ width, height: ph * scale, boxShadow: '0 1px 2px rgba(0,0,0,0.08)' }}
      aria-hidden
    >
      {elements.map((el) => {
        const box = { left: el.x * scale, top: el.y * scale, width: el.width * scale, height: el.height * scale };
        if (el.type === 'image' && el.imageUrl) {
          return <img key={el.id} src={el.imageUrl} alt="" className="absolute object-contain" style={box} />;
        }
        if (el.type === 'qr') {
          return <div key={el.id} className="absolute bg-neutral-800/70" style={{ ...box, width: Math.min(box.width, box.height), height: Math.min(box.width, box.height) }} />;
        }
        if (el.type === 'line') {
          return <div key={el.id} className="absolute border-t border-neutral-400" style={{ ...box, height: 0, top: box.top + box.height / 2 }} />;
        }
        if (el.type === 'shape') {
          return <div key={el.id} className="absolute border border-neutral-400" style={box} />;
        }
        if (el.type === 'signature') {
          return <div key={el.id} className="absolute border-b border-neutral-500" style={{ ...box, height: box.height * 0.9 }} />;
        }
        const text = stripRichText(el.content || '');
        if (!text.trim()) return null;
        return (
          <div
            key={el.id}
            className="absolute overflow-hidden leading-none text-neutral-700"
            style={{
              ...box,
              fontSize: Math.max(2, (el.fontSize || 14) * scale),
              fontWeight: el.bold ? 700 : 400,
              textAlign: (el.align as any) || 'left',
            }}
          >
            {text.replace(/\{\{[^}]+\}\}/g, '▒▒▒▒')}
          </div>
        );
      })}
    </div>
  );
}

function safeParse(str: string) {
  try { return JSON.parse(str); } catch { return {}; }
}
