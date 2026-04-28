/**
 * Lazy, module-cached font loader for the Sendero OG card.
 *
 * Satori needs static-weight TTF/OTF binaries at render time — variable
 * fonts (e.g. Fraunces-Variable.ttf) crash opentype.js inside Satori.
 * So we fetch single-weight static instances of both families from the
 * Google Fonts CDN. The CSS endpoint negotiates `woff2` when sent a
 * desktop UA; we extract the binary URL from the stylesheet, fetch it,
 * and cache the buffer for the lifetime of the function instance.
 *
 * Cold starts pay ~200ms over the network once; every subsequent
 * render is zero-network. If a font fails to load (CDN blip), the
 * cache resets so the next request retries instead of permanently
 * serving a card with a missing family.
 */

export interface OgFont {
  name: string;
  data: ArrayBuffer;
  weight: 400 | 500 | 600 | 700;
  style: 'normal' | 'italic';
}

let cache: Promise<OgFont[]> | null = null;

export function loadOgFonts(): Promise<OgFont[]> {
  if (!cache) {
    cache = loadAll().catch(err => {
      cache = null;
      throw err;
    });
  }
  return cache;
}

async function loadAll(): Promise<OgFont[]> {
  const [fraunces500, fraunces600, geist400, geist600] = await Promise.all([
    fetchGoogleFont('Fraunces', 500),
    fetchGoogleFont('Fraunces', 600),
    fetchGoogleFont('Geist', 400),
    fetchGoogleFont('Geist', 600),
  ]);
  return [
    { name: 'Fraunces', data: fraunces500, weight: 500, style: 'normal' },
    { name: 'Fraunces', data: fraunces600, weight: 600, style: 'normal' },
    { name: 'Geist', data: geist400, weight: 400, style: 'normal' },
    { name: 'Geist', data: geist600, weight: 600, style: 'normal' },
  ];
}

async function fetchGoogleFont(family: string, weight: number): Promise<ArrayBuffer> {
  // Satori (opentype.js) only parses raw TTF/OTF — woff2 throws
  // "Unsupported OpenType signature wOF2". The Google Fonts v1
  // (`/css?family=`) endpoint reliably serves `.ttf` URLs, while the
  // v2 endpoint serves woff2 to modern UAs. Use v1 here, even though
  // it's the older API, because it's the only Satori-compatible path
  // that doesn't require us to host font binaries ourselves.
  const cssUrl = `https://fonts.googleapis.com/css?family=${encodeURIComponent(family)}:${weight}`;
  const cssRes = await fetch(cssUrl);
  if (!cssRes.ok) {
    throw new Error(`og fonts: css ${family} ${weight} → ${cssRes.status}`);
  }
  const css = await cssRes.text();
  // v1 returns a single @font-face per request — no subset blocks to
  // disambiguate, so the first url() is the right one.
  const match = css.match(/url\((https:\/\/[^)]+\.ttf)\)/);
  if (!match) {
    throw new Error(`og fonts: no ttf url in css for ${family} ${weight}`);
  }
  const fontRes = await fetch(match[1]);
  if (!fontRes.ok) {
    throw new Error(`og fonts: binary ${family} ${weight} → ${fontRes.status}`);
  }
  return await fontRes.arrayBuffer();
}
