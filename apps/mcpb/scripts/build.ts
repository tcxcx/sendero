/**
 * Build pipeline for the Sendero .mcpb bundle.
 *
 * Steps:
 *   1. Wipe dist/.
 *   2. Compile server/index.ts → dist/server/index.js (bun build, target=node, minified).
 *   3. Copy manifest.json + icon.png + icons/* into dist/.
 *   4. Run `mcpb pack dist/ dist/sendero.mcpb` via the official CLI.
 *
 * Output: apps/mcpb/dist/sendero.mcpb — drop into Claude Desktop to install.
 *
 * The bundle is fully self-contained: no node_modules inside, no postinstall
 * step. Claude Desktop ships its own Node 20 runtime and our server/index.js
 * uses only the standard library + fetch (built-in since Node 18).
 */

import { execSync } from 'node:child_process';
import { copyFileSync, cpSync, mkdirSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const DIST = resolve(ROOT, 'dist');

console.log('[build] wiping dist/');
rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });
mkdirSync(resolve(DIST, 'server'), { recursive: true });

console.log('[build] compiling server/index.ts → dist/server/index.js');
execSync(
  `bun build ${resolve(ROOT, 'server/index.ts')} --outdir ${resolve(DIST, 'server')} --target=node --minify`,
  { stdio: 'inherit' }
);

console.log('[build] copying manifest + icons');
copyFileSync(resolve(ROOT, 'manifest.json'), resolve(DIST, 'manifest.json'));
copyFileSync(resolve(ROOT, 'icon.png'), resolve(DIST, 'icon.png'));
cpSync(resolve(ROOT, 'icons'), resolve(DIST, 'icons'), { recursive: true });

// Drop a pruned package.json into dist/server so MCPB's validator
// can identify the runtime. We DON'T need the real deps because
// the proxy uses only Node stdlib + fetch.
copyFileSync(resolve(ROOT, 'server/package.json'), resolve(DIST, 'server/package.json'));

console.log('[build] packing dist/ → sendero-<version>.mcpb');
const pkg = await Bun.file(resolve(ROOT, 'package.json')).json();
const outName = `sendero-${pkg.version}.mcpb`;
execSync(`bunx @anthropic-ai/mcpb pack ${DIST} ${resolve(ROOT, outName)}`, {
  stdio: 'inherit',
});

console.log(`[build] done → apps/mcpb/${outName}`);
