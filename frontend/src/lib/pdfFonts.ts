/**
 * Roboto font loader for jsPDF
 *
 * Fetches Roboto TTF files from Google Fonts CDN, caches them as base64,
 * and registers them with a jsPDF instance so pdf.setFont('Roboto') works.
 */

interface FontData {
  vfs: Record<string, string>;
  fontName: string;
}

let fontCache: FontData | null = null;

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

const FONT_URLS = {
  normal: 'https://fonts.gstatic.com/s/roboto/v30/KFOmCnqEu92Fr1Me5mZ6BA.ttf',
  bold: 'https://fonts.gstatic.com/s/roboto/v30/KFOlCnqEu92Fr1MmWUlvAx05IsDqlA.ttf',
  italic: 'https://fonts.gstatic.com/s/roboto/v30/KFOkCnqEu92Fr1Mu52xPzQ.ttf',
  bolditalic: 'https://fonts.gstatic.com/s/roboto/v30/KFOjCnqEu92Fr1Mu51TjBhc9AMX6lJQ.ttf',
};

/**
 * Returns the cached Roboto font data (fetched once from Google Fonts CDN).
 * Safe to call multiple times — only one network request is made.
 */
export async function getRobotoFontData(): Promise<FontData> {
  if (fontCache) return fontCache;

  const [normalData, boldData, italicData, bolditalicData] = await Promise.all([
    fetchFontAsBase64(FONT_URLS.normal),
    fetchFontAsBase64(FONT_URLS.bold),
    fetchFontAsBase64(FONT_URLS.italic),
    fetchFontAsBase64(FONT_URLS.bolditalic),
  ]);

  fontCache = {
    vfs: {
      'Roboto-Regular.ttf': normalData,
      'Roboto-Bold.ttf': boldData,
      'Roboto-Italic.ttf': italicData,
      'Roboto-BoldItalic.ttf': bolditalicData,
    },
    fontName: 'Roboto',
  };

  return fontCache;
}

/**
 * Registers the 4 Roboto font variants into a jsPDF instance.
 * Must be called after creating the pdf and before setFont().
 *
 * Usage:
 *   const pdf = new jsPDF(...);
 *   const fontData = await getRobotoFontData();
 *   registerRobotoFonts(pdf, fontData);
 *   pdf.setFont('Roboto', 'normal');
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
