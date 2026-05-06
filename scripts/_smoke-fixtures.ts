#!/usr/bin/env bun
/**
 * Smoke: lookup_match_fixtures (reference smoke for the live grounded
 * pattern). Vertex direct first, AI Gateway fallback. Prints the
 * structured fixture rows the LLM coerced + the cited sources.
 *
 *   bun run scripts/_smoke-fixtures.ts "Deportivo Cuenca Copa Sudamericana 2026"
 *
 * Env required:
 *   - GOOGLE_CLOUD_PROJECT + GOOGLE_APPLICATION_CREDENTIALS_JSON (Vertex direct)
 *   OR
 *   - AI_GATEWAY_API_KEY (AI Gateway fallback)
 */

import 'dotenv/config';

import { lookupMatchFixturesTool } from '../packages/tools/src/lookup-match-fixtures';

const query =
  process.argv.slice(2).join(' ').trim() ||
  'Deportivo Cuenca Copa Sudamericana 2026 remaining fixtures';

console.log(`\n› lookup_match_fixtures("${query}")\n`);

const r = await lookupMatchFixturesTool.handler({ query, limit: 4, locale: 'es-AR' } as never);
console.log(JSON.stringify(r, null, 2));
