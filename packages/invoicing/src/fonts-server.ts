// packages/invoicing/src/fonts-server.ts
// URLs populated by scripts/deploy-invoice-fonts.ts → Vercel Blob. Stable once set.

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const FONT_BASE =
  process.env.INVOICE_FONT_BASE_URL ??
  'https://PLACEHOLDER-RUN-DEPLOY-FONTS.blob.vercel-storage.com/fonts/invoice';

function localFallback(name: string): string {
  const url = import.meta.url;
  if (!url) return `./assets/fonts/${name}`;
  const here = dirname(fileURLToPath(url));
  return join(here, 'assets', 'fonts', name);
}

function fontPath(name: string): string {
  if (FONT_BASE.includes('PLACEHOLDER')) return localFallback(name);
  return `${FONT_BASE}/${name}`;
}

export const pdfFontPaths = {
  inter: {
    regular: fontPath('inter-regular.ttf'),
    medium: fontPath('inter-medium.ttf'),
    semibold: fontPath('inter-semibold.ttf'),
    bold: fontPath('inter-bold.ttf'),
    italic: fontPath('inter-italic.ttf'),
  },
  jetbrainsMono: {
    regular: fontPath('jetbrains-mono-regular.ttf'),
    bold: fontPath('jetbrains-mono-bold.ttf'),
  },
} as const;
