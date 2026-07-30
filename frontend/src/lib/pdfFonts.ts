/**
 * Roboto font loader for jsPDF
 *
 * Dynamically fetches current Roboto TTF URLs from Google Fonts CSS2 API
 * using an older User-Agent that triggers TTF format responses.
 * Falls back to jsPDF built-in fonts (Helvetica) if the fetch fails.
 */

interface FontData {
  vfs: Record<string, string>;
  fontName: string;
}

let fontCache: FontData | null = null;
let fontLoadAttempted = false;

async function fetchFontAsBase64(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to fetch font: ${response.statusText}`);
  const arrayBuffer = await response.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Constructs a URL for a specific Google Fonts font file pattern.
 * Google Fonts CSS2 API returns URLs like:
 *   https://fonts.gstatic.com/s/roboto/v30/KFOmCnqEu92Fr1Me5mZ6BA.ttf
 * But the path changes between versions. We use the CSS2 API to get
 * the current URLs dynamically.
 */
const GOOGLE_FONTS_CSS_URL =
  'https://fonts.googleapis.com/css2?family=Roboto:ital,wght@0,400;0,700;1,400;1,700';

/** Older Safari UA to force Google Fonts to serve TTF instead of WOFF2 */
const OLD_UA =
  'Mozilla/5.0 (Macintosh; U; Intel Mac OS X 10_6_8; de-at) AppleWebKit/533.21.1 (KHTML, like Gecko) Version/5.0.5 Safari/533.21.1';

/** Style → CSS unicode-range pattern to extract the latin (first) URL for each variant */
type FontStyleKey = 'normal' | 'bold' | 'italic' | 'bolditalic';

interface FontVariantRule {
  fontStyle: string;
  fontWeight: string;
  key: FontStyleKey;
}

const VARIANT_RULES: FontVariantRule[] = [
  { fontStyle: 'normal', fontWeight: '400', key: 'normal' },
  { fontStyle: 'normal', fontWeight: '700', key: 'bold' },
  { fontStyle: 'italic', fontWeight: '400', key: 'italic' },
  { fontStyle: 'italic', fontWeight: '700', key: 'bolditalic' },
];

/**
 * Fetches the Google Fonts CSS and parses it to extract the current TTF URLs
 * for each Roboto variant (normal, bold, italic, bolditalic).
 */
async function fetchFontUrlsFromCss(): Promise<Record<FontStyleKey, string>> {
  const response = await fetch(GOOGLE_FONTS_CSS_URL, {
    headers: { 'User-Agent': OLD_UA },
  });

  if (!response.ok) {
    throw new Error(`Google Fonts CSS API returned ${response.status}`);
  }

  const css = await response.text();

  // Parse @font-face blocks — each block has font-style, font-weight, and src(url)
  // We split by @font-face and extract the relevant info
  const blocks = css.split('@font-face');

  const result: Partial<Record<FontStyleKey, string>> = {};

  for (const block of blocks) {
    if (!block.includes('font-family')) continue;

    const styleMatch = block.match(/font-style:\s*(\w+)/);
    const weightMatch = block.match(/font-weight:\s*(\d+)/);
    const urlMatch = block.match(/src:\s*url\(([^)]+\.ttf)\)/);

    if (!styleMatch || !weightMatch || !urlMatch) continue;

    const style = styleMatch[1];
    const weight = weightMatch[1];
    const url = urlMatch[1];

    // Find which variant this block corresponds to
    const variant = VARIANT_RULES.find(
      (v) => v.fontStyle === style && v.fontWeight === weight,
    );

    if (variant && !result[variant.key]) {
      // First match wins (latin subset is usually first)
      result[variant.key] = url;
    }
  }

  // Verify we got all 4 variants
  const missing = VARIANT_RULES.filter((v) => !result[v.key]);
  if (missing.length > 0) {
    console.warn(
      `⚠️ No se encontraron URLs TTF para: ${missing.map((v) => v.key).join(', ')}`,
    );
  }

  if (Object.keys(result).length === 0) {
    throw new Error('No se pudieron extraer URLs de fuentes del CSS de Google Fonts');
  }

  return result as Record<FontStyleKey, string>;
}

/**
 * Returns the cached Roboto font data (fetched once from Google Fonts CDN).
 * Safe to call multiple times — only one network request is made.
 * If the fetch fails, returns null so callers can fall back to built-in fonts.
 */
export async function getRobotoFontData(): Promise<FontData | null> {
  if (fontCache) return fontCache;
  if (fontLoadAttempted) return null; // Already tried and failed

  fontLoadAttempted = true;

  try {
    // Step 1: Get current font URLs from Google Fonts CSS2 API
    const fontUrls = await fetchFontUrlsFromCss();

    // Step 2: Download all 4 TTF files in parallel
    const variants = [fontUrls.normal, fontUrls.bold, fontUrls.italic, fontUrls.bolditalic];
    const results = await Promise.allSettled(variants.map((url) => fetchFontAsBase64(url)));

    const vfs: Record<string, string> = {};
    const fileNames = [
      'Roboto-Regular.ttf',
      'Roboto-Bold.ttf',
      'Roboto-Italic.ttf',
      'Roboto-BoldItalic.ttf',
    ];
    let successCount = 0;

    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      if (r.status === 'fulfilled') {
        vfs[fileNames[i]] = r.value;
        successCount++;
      } else {
        console.warn(`⚠️ No se pudo descargar ${fileNames[i]}:`, r.reason);
      }
    }

    if (successCount === 0) {
      console.warn('⚠️ No se pudo descargar ninguna variante de Roboto');
      return null;
    }

    fontCache = { vfs, fontName: 'Roboto' };
    console.log(`✅ Roboto fonts loaded (${successCount}/4 variants)`);
    return fontCache;
  } catch (err) {
    console.warn('⚠️ No se pudo cargar Roboto desde Google Fonts:', err);
    return null;
  }
}

/**
 * Registers the Roboto font variants into a jsPDF instance.
 * Must be called after creating the pdf and before setFont().
 * If fontData is null (failed to load), this is a no-op and jsPDF
 * will use its built-in Helvetica font by default.
 *
 * Usage:
 *   const pdf = new jsPDF(...);
 *   const fontData = await getRobotoFontData();
 *   if (fontData) registerRobotoFonts(pdf, fontData);
 *   // If fontData is null, pdf.setFont('Helvetica') is used automatically
 */
export function registerRobotoFonts(pdf: any, fontData: FontData): void {
  pdf.addFileToVFS('Roboto-Regular.ttf', fontData.vfs['Roboto-Regular.ttf']);
  pdf.addFileToVFS('Roboto-Bold.ttf', fontData.vfs['Roboto-Bold.ttf']);
  pdf.addFileToVFS('Roboto-Italic.ttf', fontData.vfs['Roboto-Italic.ttf']);
  pdf.addFileToVFS('Roboto-BoldItalic.ttf', fontData.vfs['Roboto-BoldItalic.ttf']);

  pdf.addFont('Roboto-Regular.ttf', 'Roboto', 'normal');
  pdf.addFont('Roboto-Bold.ttf', 'Roboto', 'bold');
  pdf.addFont('Roboto-Italic.ttf', 'Roboto', 'italic');
  pdf.addFont('Roboto-BoldItalic.ttf', 'Roboto', 'bolditalic');
}
