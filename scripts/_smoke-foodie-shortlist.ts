#!/usr/bin/env bun
/**
 * Smoke: foodie_shortlist_builder (composes ramen + cheap_michelin +
 * specialty_coffee finders, then decorates with budget envelopes).
 *
 *   bun run scripts/_smoke-foodie-shortlist.ts "Tokyo" JP
 *
 * Env: GOOGLE_PLACES_API_KEY, GOOGLE_CUSTOM_SEARCH_API_KEY +
 *      GOOGLE_CUSTOM_SEARCH_ENGINE_ID. Falls through gracefully when
 *      any source is unavailable.
 */

import 'dotenv/config';

import { runFoodieShortlistBuilder } from '../packages/tools/src/anticipation/foodie-shortlist-builder';
import type { ToolContext } from '../packages/tools/src/types';

const [city = 'Tokyo', countryCode] = process.argv.slice(2);

const ctx: ToolContext = {
  traveler: { tenantId: 'org_smoke', userId: 'usr_smoke' },
  caller: { effectiveKeyType: 'sandbox', keyType: 'sandbox', scopes: ['*'] },
};

console.log(
  `\n› foodie_shortlist_builder({ city: "${city}"${countryCode ? `, countryCode: "${countryCode}"` : ''} })\n`
);

const input: Record<string, unknown> = { city, perCategoryLimit: 4, languageCode: 'en' };
if (countryCode) input.countryCode = countryCode;

const r = await runFoodieShortlistBuilder(input as never, ctx);

if (r.status !== 'ok') {
  console.log(`status: ${r.status}`);
  if (r.status === 'unavailable') console.log(`reason: ${r.reason}`);
  console.log(`message: ${r.message}`);
  process.exit(0);
}

console.log(r.summary);
console.log();
for (const sec of r.sections) {
  console.log(`### ${sec.title}`);
  for (const p of sec.picks) {
    console.log(`  • ${p.name}${typeof p.rating === 'number' ? `  ${p.rating.toFixed(1)}★` : ''}`);
    console.log(`    ${p.rationale}`);
    if (p.budget) console.log(`    ${p.budget.tier}: ${p.budget.moneyTalk}`);
    if (p.website) console.log(`    ${p.website}`);
  }
  console.log();
}
