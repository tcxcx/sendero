#!/usr/bin/env bun
/**
 * Smoke: B5+B6 pure tools.
 *
 *   bun run scripts/_smoke-batch3.ts
 */

import 'dotenv/config';

import {
  ticketResaleRiskCheckerTool,
  matchPostponementMonitorTool,
  fanGroupCoordinationToolTool,
} from '../packages/tools/src/anticipation/b5-sports';
import {
  marketDayFinderTool,
  giftRecommenderTool,
  pharmacyProductMapperTool,
  electronicsAdapterCheckerTool,
} from '../packages/tools/src/anticipation/b6-lifestyle';
import type { ToolContext } from '../packages/tools/src/types';

const ctx: ToolContext = {
  traveler: { tenantId: 'org_smoke', userId: 'usr_smoke' },
  caller: { effectiveKeyType: 'sandbox', keyType: 'sandbox', scopes: ['*'] },
};

console.log('\n=== ticket_resale_risk_checker (sketchy URL + 6× face) ===');
const resale = await ticketResaleRiskCheckerTool.handler(
  {
    url: 'https://cheap-tickets-now.example.com/listing/abc',
    askingPrice: 1200,
    faceValue: 200,
    context: 'football',
  } as never,
  ctx
);
if (resale.status === 'ok' && resale.verdict) {
  console.log(`  level: ${resale.verdict.riskLevel}`);
  for (const f of resale.verdict.flags) console.log(`  flag · ${f}`);
  for (const r of resale.verdict.recommendations) console.log(`  rec  · ${r}`);
}

console.log('\n=== ticket_resale_risk_checker (Ticketmaster, 1.2× face) ===');
const safe = await ticketResaleRiskCheckerTool.handler(
  { url: 'https://www.ticketmaster.com/event/abc', askingPrice: 240, faceValue: 200, context: 'football' } as never,
  ctx
);
if (safe.status === 'ok' && safe.verdict) console.log(`  level: ${safe.verdict.riskLevel} (${safe.verdict.flags.length} flags)`);

console.log('\n=== match_postponement_monitor (kickoff shifted +2h) ===');
const post = await matchPostponementMonitorTool.handler(
  {
    team: 'Boca Juniors',
    originalKickoffIso: '2026-05-15T21:00:00-03:00',
    latestKickoffIso: '2026-05-15T23:00:00-03:00',
    latestStatus: 'rescheduled',
  } as never,
  ctx
);
if (post.status === 'ok') {
  console.log(`  ${post.message}`);
  for (const g of post.guidance ?? []) console.log(`  · ${g}`);
}

console.log('\n=== fan_group_coordination_tool (8 fans) ===');
const fg = await fanGroupCoordinationToolTool.handler(
  {
    groupName: 'Boca-WC-2026',
    members: [
      { name: 'A', homeIata: 'EZE', budgetTier: 'medium', seatPreference: 'away_section' },
      { name: 'B', homeIata: 'EZE', budgetTier: 'medium', seatPreference: 'away_section' },
      { name: 'C', homeIata: 'AEP', budgetTier: 'medium', seatPreference: 'away_section' },
      { name: 'D', homeIata: 'JFK', budgetTier: 'premium', seatPreference: 'mixed' },
      { name: 'E', homeIata: 'LHR', budgetTier: 'medium', seatPreference: 'away_section' },
      { name: 'F', homeIata: 'GRU', budgetTier: 'budget', seatPreference: 'away_section' },
      { name: 'G', homeIata: 'EZE', budgetTier: 'medium', seatPreference: 'away_section' },
      { name: 'H', homeIata: 'EZE', budgetTier: 'medium', seatPreference: 'away_section' },
    ],
    matchCity: 'Asunción',
    matchAtIso: '2026-06-12T20:00:00-03:00',
  } as never,
  ctx
);
if (fg.status === 'ok') {
  console.log(`  ${fg.message}`);
  console.log(`  origins: ${JSON.stringify(fg.origins)}`);
  console.log(`  budget mix: ${JSON.stringify(fg.budgetMix)}`);
  for (const r of fg.recommendations ?? []) console.log(`  · ${r}`);
}

console.log('\n=== market_day_finder (Paris flea) ===');
const md = await marketDayFinderTool.handler(
  { city: 'Paris', countryCode: 'FR', marketKind: 'flea' } as never,
  ctx
);
if (md.status === 'ok') {
  for (const m of md.markets ?? []) console.log(`  · ${m.name} (${m.days})${m.notes ? ` — ${m.notes}` : ''}`);
}

console.log('\n=== gift_recommender (JP / friend / $50) ===');
const gift = await giftRecommenderTool.handler(
  { countryCode: 'JP', recipient: 'friend', budgetUsd: 50 } as never,
  ctx
);
if (gift.status === 'ok') {
  for (const s of gift.suggestions ?? []) {
    console.log(`  [${s.category}] ${s.approximateBudget}: ${s.examples.join(' / ')}`);
    if (s.packingNote) console.log(`    note: ${s.packingNote}`);
  }
}

console.log('\n=== pharmacy_product_mapper (paracetamol → JP) ===');
const pharm = await pharmacyProductMapperTool.handler(
  { countryCode: 'JP', productName: 'ibuprofen' } as never,
  ctx
);
if (pharm.status === 'ok' && pharm.match) {
  console.log(`  ${pharm.match.localName} | brand: ${pharm.match.brand} | OTC: ${pharm.match.otc}${pharm.match.notes ? ` | ${pharm.match.notes}` : ''}`);
}

console.log('\n=== electronics_adapter_checker (US → JP) ===');
const adapter = await electronicsAdapterCheckerTool.handler(
  { fromCountryCode: 'US', toCountryCode: 'JP' } as never,
  ctx
);
if (adapter.status === 'ok') {
  console.log(`  adapter=${adapter.needsAdapter} converter=${adapter.needsConverter}`);
  console.log(`  ${adapter.recommendation}`);
}

console.log('\n=== electronics_adapter_checker (US → GB) ===');
const adapter2 = await electronicsAdapterCheckerTool.handler(
  { fromCountryCode: 'US', toCountryCode: 'GB' } as never,
  ctx
);
if (adapter2.status === 'ok') {
  console.log(`  adapter=${adapter2.needsAdapter} converter=${adapter2.needsConverter}`);
  console.log(`  ${adapter2.recommendation}`);
}
