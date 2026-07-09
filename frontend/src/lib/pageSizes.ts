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

/**
 * Returns page width and height accounting for orientation.
 *
 * @param pageSize - 'A4' | 'LETTER' | 'LEGAL'
 * @param orientation - 'portrait' | 'landscape'
 * @returns { width, height } in points
 */
export function getPageDimensions(
  pageSize: PageSizeName = 'A4',
  orientation: 'portrait' | 'landscape' = 'portrait',
): { width: number; height: number } {
  const dims = PAGE_SIZES[pageSize] || PAGE_SIZES.A4;

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
  return PAGE_SIZES[pageSize]?.label ?? 'A4';
}
