#!/usr/bin/env bun
/**
 * Uploads invoice PDF fonts to Vercel Blob. Idempotent — re-running overwrites
 * in place. On success, prints the resulting URLs to paste into fonts-server.ts.
 *
 * Usage:
 *   export BLOB_READ_WRITE_TOKEN=...
 *   bun run deploy:fonts
 */

import { put } from '@vercel/blob';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const FONTS = [
  'inter-regular.ttf',
  'inter-medium.ttf',
  'inter-semibold.ttf',
  'inter-bold.ttf',
  'inter-italic.ttf',
  'jetbrains-mono-regular.ttf',
  'jetbrains-mono-bold.ttf',
];

async function main() {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    console.error('✗ BLOB_READ_WRITE_TOKEN not set');
    process.exit(1);
  }

  const here = dirname(fileURLToPath(import.meta.url));
  const fontsDir = join(here, '..', 'packages', 'invoicing', 'src', 'assets', 'fonts');

  const urls: Record<string, string> = {};
  for (const name of FONTS) {
    const buf = await readFile(join(fontsDir, name));
    const result = await put(`fonts/invoice/${name}`, buf, {
      access: 'public',
      addRandomSuffix: false,
      allowOverwrite: true,
      token,
    });
    urls[name] = result.url;
    console.log(`✓ ${name} → ${result.url}`);
  }

  console.log('\nPaste these URLs (or the shared base prefix) into packages/invoicing/src/fonts-server.ts:');
  console.log(JSON.stringify(urls, null, 2));
}

main().catch(err => {
  console.error('deploy failed:', err);
  process.exit(1);
});
