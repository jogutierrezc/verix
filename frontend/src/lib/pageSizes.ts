/**
 * Standard page dimensions in points (1pt = 1/72 inch).
 * jsPDF uses points as the default unit.
 */
export const PAGE_SIZES = {
  A4:       { label: 'A4',       width: 595,  height: 842  },
  LETTER:   { label: 'Carta',    width: 612,  height: 792  },
  LEGAL:    { label: 'Oficio',   width: 612,  height: 1008 },
} as const;

export type PageSizeName = keyof typeof PAGE_SIZES;

/** Tamaño por defecto de todas las plantillas: Carta (US Letter, 8.5×11 in). */
export const DEFAULT_PAGE_SIZE: PageSizeName = 'LETTER';

/**
 * Normaliza cualquier valor guardado (columna `page_size`, `config.pageSize`,
 * "carta", "letter", "oficio"...) a una clave válida. Si falta, usa Carta.
 */
export function normalizePageSize(value: unknown): PageSizeName {
  const v = String(value ?? '').trim().toUpperCase();
  if (v === 'A4') return 'A4';
  if (v === 'LEGAL' || v === 'OFICIO') return 'LEGAL';
  if (v === 'LETTER' || v === 'CARTA') return 'LETTER';
  return DEFAULT_PAGE_SIZE;
}

/**
 * Returns page width and height accounting for orientation.
 *
 * @param pageSize - 'A4' | 'LETTER' | 'LEGAL'
 * @param orientation - 'portrait' | 'landscape'
 * @returns { width, height } in points
 */
export function getPageDimensions(
  pageSize: PageSizeName = DEFAULT_PAGE_SIZE,
  orientation: 'portrait' | 'landscape' = 'portrait',
): { width: number; height: number } {
  const dims = PAGE_SIZES[normalizePageSize(pageSize)];

  if (orientation === 'landscape') {
    // Swap width and height for landscape
    return { width: dims.height, height: dims.width };
  }

  return { width: dims.width, height: dims.height };
}

/**
 * Returns the human-readable label for a page size.
 */
export function getPageSizeLabel(pageSize: PageSizeName): string {
  return PAGE_SIZES[normalizePageSize(pageSize)].label;
}
