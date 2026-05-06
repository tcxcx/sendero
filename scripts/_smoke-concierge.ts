#!/usr/bin/env bun
/**
 * Smoke: hobby_concierge_discover (flagship orchestrator entry).
 *
 *   bun run scripts/_smoke-concierge.ts "Buenos Aires" arrival_pack
 *   bun run scripts/_smoke-concierge.ts Tokyo work_from_cafe
 *
 * Composes city_taste_map_builder → foodie + work_from_cafe + networking.
 */

import 'dotenv/config';

import { runHobbyConciergeDiscover } from '../packages/tools/src/anticipation/hobby-concierge-discover';
import type { ToolContext } from '../packages/tools/src/types';

const [city = 'Buenos Aires', mode = 'arrival_pack'] = process.argv.slice(2);

const ctx: ToolContext = {
  traveler: { tenantId: 'org_smoke', userId: 'usr_smoke' },
  caller: { effectiveKeyType: 'sandbox', keyType: 'sandbox', scopes: ['*'] },
};

console.log(`\n› hobby_concierge_discover({ city: "${city}", mode: "${mode}" })\n`);

const r = await runHobbyConciergeDiscover(
  { city, mode, languageCode: 'en', hobbies: ['founder', 'specialty coffee', 'ramen'] } as never,
  ctx
);

if (r.status !== 'ok') {
  console.log(`status: ${r.status}`);
  console.log(`message: ${r.message}`);
  process.exit(0);
}

console.log(r.summary ?? r.message);
console.log();
for (const sec of r.sections ?? []) {
  console.log(`### ${sec.title}`);
  for (const it of sec.items) {
    console.log(`  • ${it.name}`);
    if (it.reason) console.log(`    ${it.reason}`);
    if (it.expectedSpend) console.log(`    ${it.expectedSpend}`);
    if (it.url) console.log(`    ${it.url}`);
  }
  console.log();
}
if (r.recommendedNextAction) {
  console.log(`Top move today: ${r.recommendedNextAction}`);
}
