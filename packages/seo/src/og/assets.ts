/**
 * Lazy, module-cached image asset loader for the Sendero OG card.
 *
 * Satori's `<img>` tag accepts data URLs OR https URLs. For a shared
 * package the data-URL path is the cleanest: no consumer-app static
 * routing dependency, no extra HTTP hop on every render. Both binaries
 * (the halftone hero and the binoculars logo) are read once from disk
 * at the first render call, encoded to base64, and cached for the
 * lifetime of the function instance.
 *
 * Webp is used for the halftone hero because Satori's image pipeline
 * supports it (libvips path under the hood). The binoculars logo is
 * a 2048px PNG with a transparent background — kept as PNG so the
 * loose-linework brushwork survives without re-encoding.
 */

import { promises as fs } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

let halftoneCache: Promise<string> | null = null;
let binocularsCache: Promise<string> | null = null;

export function loadHalftoneHeroDataUrl(): Promise<string> {
  if (!halftoneCache) {
    // Use JPEG (not webp) — Satori's image pipeline crashes on certain
    // webp variants with "u2 is not iterable". Pre-resized to 1200×630
    // so the data URL stays under ~700KB after base64 encoding.
    halftoneCache = readAsDataUrl('halftone-hero.jpg', 'image/jpeg').catch(err => {
      halftoneCache = null;
      throw err;
    });
  }
  return halftoneCache;
}

export function loadBinocularsDataUrl(): Promise<string> {
  if (!binocularsCache) {
    binocularsCache = readAsDataUrl('binoculars-vermillion.png', 'image/png').catch(err => {
      binocularsCache = null;
      throw err;
    });
  }
  return binocularsCache;
}

async function readAsDataUrl(file: string, mime: string): Promise<string> {
  const here = dirname(fileURLToPath(import.meta.url));
  const path = join(here, 'assets', file);
  const buf = await fs.readFile(path);
  return `data:${mime};base64,${buf.toString('base64')}`;
}
