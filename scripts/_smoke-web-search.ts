#!/usr/bin/env bun
/**
 * Smoke: web_search (Vertex direct → AI Gateway fallback).
 *
 *   bun run scripts/_smoke-web-search.ts "Lollapalooza Argentina 2026 dates"
 *
 * Env: same as _smoke-fixtures.ts.
 */

import 'dotenv/config';

import { webSearchTool } from '../packages/tools/src/web-search';

const query = process.argv.slice(2).join(' ').trim() || 'next Boca Juniors home match May 2026';

console.log(`\n› web_search("${query}")\n`);

const r = await webSearchTool.handler({ query, locale: 'es-AR' } as never);
console.log(JSON.stringify(r, null, 2));
