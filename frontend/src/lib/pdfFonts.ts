/**
 * Roboto font loader for jsPDF.
 *
 * The four TTF variants are served from /fonts (public folder) so bold and
 * italic always work, with no dependency on Google Fonts. Browsers ignore a
 * custom User-Agent header, so the previous CSS2 scraping never returned TTF
 * and silently fell back to Helvetica without bold.
 */

interface FontData {
  vfs: Record<string, string>;
  fontName: string;
}

const FONT_FILES = [
  'Roboto-Regular.ttf',
  'Roboto-Bold.ttf',
  'Roboto-Italic.ttf',
  'Roboto-BoldItalic.ttf',
] as const;

let fontPromise: Promise<FontData | null> | null = null;

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function fetchFontAsBase64(file: string): Promise<string> {
  const base = import.meta.env.BASE_URL || '/';
  const response = await fetch(`${base}fonts/${file}`);
  if (!response.ok) throw new Error(`No se pudo cargar ${file}: ${response.status}`);
  return bytesToBase64(new Uint8Array(await response.arrayBuffer()));
}

async function loadFonts(): Promise<FontData | null> {
  try {
    const results = await Promise.all(FONT_FILES.map(fetchFontAsBase64));
    const vfs: Record<string, string> = {};
    FONT_FILES.forEach((file, i) => { vfs[file] = results[i]; });
    return { vfs, fontName: 'Roboto' };
  } catch (err) {
    console.warn('No se pudo cargar Roboto, se usará Helvetica:', err);
    fontPromise = null; // permitir reintento en la siguiente generación
    return null;
  }
}

/** Returns the cached Roboto data (one fetch per session). Null if loading failed. */
export function getRobotoFontData(): Promise<FontData | null> {
  if (!fontPromise) fontPromise = loadFonts();
  return fontPromise;
}

/** Registers the four Roboto variants into a jsPDF instance. */
export function registerRobotoFonts(pdf: any, fontData: FontData): void {
  const styles = ['normal', 'bold', 'italic', 'bolditalic'];
  FONT_FILES.forEach((file, i) => {
    pdf.addFileToVFS(file, fontData.vfs[file]);
    pdf.addFont(file, 'Roboto', styles[i]);
  });
}
