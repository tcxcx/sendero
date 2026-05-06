#!/usr/bin/env bun
/**
 * Smoke: monocle_place_researcher (Vertex direct → AI Gateway fallback).
 *
 *   bun run scripts/_smoke-monocle.ts "Mameya Kakeru" Tokyo cafe JP
 *   bun run scripts/_smoke-monocle.ts "Don Julio" "Buenos Aires" mid_restaurant AR
 *
 * Env: GOOGLE_CLOUD_PROJECT + GOOGLE_APPLICATION_CREDENTIALS_JSON (Vertex)
 *      OR AI_GATEWAY_API_KEY (Gateway fallback).
 */

import 'dotenv/config';

import { runMonoclePlaceResearcher } from '../packages/tools/src/anticipation/monocle-place-researcher';
import type { ToolContext } from '../packages/tools/src/types';

const [name = 'Mameya Kakeru', city = 'Tokyo', category, countryCode] = process.argv.slice(2);

const ctx: ToolContext = {
  traveler: { tenantId: 'org_smoke', userId: 'usr_smoke' },
  caller: { effectiveKeyType: 'sandbox', keyType: 'sandbox', scopes: ['*'] },
};

console.log(
  `\n› monocle_place_researcher({ name: "${name}", city: "${city}"${category ? `, category: "${category}"` : ''}${countryCode ? `, countryCode: "${countryCode}"` : ''} })\n`
);

const input: Record<string, unknown> = { name, city, locale: 'en-US' };
if (category) input.category = category;
if (countryCode) input.countryCode = countryCode;

const r = await runMonoclePlaceResearcher(input as never, ctx);

if (r.status !== 'ok') {
  console.log(`status: ${r.status}`);
  if (r.status === 'unavailable') console.log(`reason: ${r.reason}`);
  console.log(`message: ${r.message}`);
  process.exit(0);
}

const rep = r.report;
console.log(`via:        ${r.via}`);
console.log(`verdict:    ${rep.verdict}`);
console.log(`takeaway:   ${rep.takeaway}\n`);
console.log(`vibe tags:        ${rep.vibeTags.join(', ')}`);
console.log(`signature items:  ${rep.signatureItems.join(', ')}`);
console.log(`is overrated:     ${rep.isOverrated}`);
console.log(`reservation req:  ${rep.reservationRequired}`);
console.log(`best for:         ${rep.bestFor.join(', ')}`);
console.log(`not for:          ${rep.notFor.join(', ')}`);
if (rep.guideMentions.length) {
  console.log(
    `guides:           ${rep.guideMentions.map(g => `${g.guide}${g.year ? ` (${g.year})` : ''}`).join(', ')}`
  );
}
if (rep.fineprint.length) {
  console.log(`fineprint:        ${rep.fineprint.join(' / ')}`);
}
if (rep.budget) {
  console.log(
    `\nbudget tier: ${rep.budget.tier}  range: $${rep.budget.range.low}-${rep.budget.range.high}`
  );
  console.log(`money talk:  ${rep.budget.moneyTalk}`);
}
console.log(`\nsources (${rep.sources.length}):`);
for (const s of rep.sources.slice(0, 8)) {
  console.log(`  • ${s.uri}${s.title ? ` — ${s.title}` : ''}`);
}
