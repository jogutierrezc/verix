import type { CSSProperties } from 'react';

/**
 * Texto enriquecido mínimo para plantillas.
 *   **texto**  → negrilla
 *   __texto__  → cursiva
 * El estilo base del elemento (bold/italic) se respeta y las marcas lo invierten
 * solo hacia "activado", así `**{{nombre_estudiante}}**` pone en negrilla el
 * valor que se rellene dentro de un párrafo justificado.
 */
export interface RichSegment {
  text: string;
  bold: boolean;
  italic: boolean;
}

export function parseRichText(content: string, baseBold = false, baseItalic = false): RichSegment[] {
  const out: RichSegment[] = [];
  let bold = false;
  let italic = false;
  for (const part of (content || '').split(/(\*\*|__)/)) {
    if (part === '**') { bold = !bold; continue; }
    if (part === '__') { italic = !italic; continue; }
    if (part) out.push({ text: part, bold: baseBold || bold, italic: baseItalic || italic });
  }
  return out;
}

/** Quita las marcas (para listas, tooltips, etc.). */
export function stripRichText(content: string): string {
  return (content || '').replace(/\*\*|__/g, '');
}

/** Reemplaza {{variable}} dejando intactas las que no tienen valor. */
export function fillVars(text: string, data: Record<string, any>): string {
  return text.replace(/\{\{\s*([^}\s]+)\s*\}\}/g, (_, key) => {
    const value = data[key];
    return value === null || value === undefined ? `{{${key}}}` : String(value);
  });
}

/**
 * Estilo CSS común para texto de plantilla (canvas, vista previa y portal).
 * Justificado sin cortar palabras con guiones.
 */
export function templateTextStyle(align?: string): CSSProperties {
  return {
    textAlign: (align as CSSProperties['textAlign']) || 'left',
    hyphens: 'none',
    WebkitHyphens: 'none',
    wordBreak: 'normal',
    overflowWrap: 'break-word',
    whiteSpace: 'pre-wrap',
    textJustify: 'inter-word',
  } as CSSProperties;
}

export function RichText({
  content,
  data = {},
  bold,
  italic,
}: {
  content: string;
  data?: Record<string, any>;
  bold?: boolean;
  italic?: boolean;
}) {
  return (
    <>
      {parseRichText(content, bold, italic).map((seg, i) => (
        <span
          key={i}
          style={{
            fontWeight: seg.bold ? 700 : 400,
            fontStyle: seg.italic ? 'italic' : 'normal',
          }}
        >
          {fillVars(seg.text, data)}
        </span>
      ))}
    </>
  );
}
