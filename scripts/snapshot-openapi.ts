/**
 * Snapshot the OpenAPI 3.1 doc for `@sendero/tools` to disk.
 *
 * Usage:
 *   bun run scripts/snapshot-openapi.ts                # writes apps/docs/public/openapi/v<version>.json
 *   OPENAPI_VERSION=1.0.0 bun run scripts/snapshot-openapi.ts  # override version label
 *   OPENAPI_OUT=/tmp/foo.json bun run scripts/snapshot-openapi.ts
 *
 * Pinned snapshots back the docs site's "old version" links so phased
 * SDK rollouts can target the previous shape while we ship the new one
 * at /api/openapi.json. Run this BEFORE bumping the live version in
 * `packages/tools/src/openapi.ts` so the snapshot captures the prior
 * shape verbatim.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { buildOpenApiDoc, toolList } from '@sendero/tools';

const version = process.env.OPENAPI_VERSION ?? '1.0.0';
const out =
  process.env.OPENAPI_OUT ??
  resolve(__dirname, '..', 'apps', 'docs', 'public', 'openapi', `v${version}.json`);

const doc = buildOpenApiDoc({
  title: 'Sendero Agent Tools',
  version,
  serverUrl: 'https://www.sendero.travel',
  tools: toolList,
});

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(doc, null, 2) + '\n', 'utf8');

console.log(`wrote ${out} (${(JSON.stringify(doc).length / 1024).toFixed(1)} KiB)`);
