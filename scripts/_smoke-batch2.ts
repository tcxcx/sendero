#!/usr/bin/env bun
/**
 * Smoke: B1+B2+B4 pure-only tools (no CSE/Places/Vertex required).
 *
 *   bun run scripts/_smoke-batch2.ts
 */

import 'dotenv/config';

import {
  runSourceConfidenceScorer,
  runResearchAuditTrail,
  runSourceCacheManager,
  runResearchGapRouter,
  runRecommendationExplainer,
} from '../packages/tools/src/anticipation/b1-research-infra';
import { runNetworkingIntroStrategy } from '../packages/tools/src/anticipation/b2-networking-closure';
import {
  businessDressCodeBriefTool,
  expensePolicyCheckerTool,
  receiptCollectionAssistantTool,
  meetingCommutePlannerTool,
} from '../packages/tools/src/anticipation/b4-corporate';
import type { ToolContext } from '../packages/tools/src/types';

const ctx: ToolContext = {
  traveler: { tenantId: 'org_smoke', userId: 'usr_smoke' },
  caller: { effectiveKeyType: 'sandbox', keyType: 'sandbox', scopes: ['*'] },
};

console.log('\n=== source_confidence_scorer ===');
const conf = await runSourceConfidenceScorer(
  {
    sources: [
      { url: 'https://guide.michelin.com/ar/buenos-aires-region/restaurant/don-julio', publishedAtIso: '2024-12-01T00:00:00Z' },
      { url: 'https://www.tripadvisor.com/Restaurant_Review-don-julio.html', publishedAtIso: '2020-01-15T00:00:00Z' },
      { url: 'https://reuters.com/business/lifestyle/parrillas-buenos-aires.html', publishedAtIso: '2025-08-01T00:00:00Z' },
    ],
    countryCode: 'AR',
    category: 'restaurant',
  } as never,
  ctx
);
if (conf.status === 'ok' && conf.ranked) for (const s of conf.ranked) console.log(`  ${s.combined.toFixed(2)}  ${s.url} — ${s.rationale}`);

console.log('\n=== research_gap_router (blocking + low) ===');
const route = await runResearchGapRouter(
  {
    intent: 'where can I get specialty coffee in a tiny niche neighborhood',
    currentConfidence: 'low',
    attemptedTools: ['specialty_coffee_finder'],
    isBlockingTraveler: true,
  } as never,
  ctx
);
if (route.status === 'ok' && route.route) {
  console.log(`  → ${route.route.action}: ${route.route.reasoning}`);
}

console.log('\n=== networking_intro_strategy (demo day, founder, fundraise) ===');
const strat = await runNetworkingIntroStrategy(
  {
    event: { name: 'YC Demo Day W26', kind: 'demo_day', expectedAttendance: '300_plus' },
    travelerProfile: { role: 'founder', isFirstTime: false, extroversion: 'medium', desiredOutcome: 'fundraise' },
  } as never,
  ctx
);
if (strat.status === 'ok' && strat.strategy) {
  const s = strat.strategy;
  console.log(`  worth attending: ${s.worthAttending} — ${s.worthAttendingReason}`);
  console.log(`  arrival:  ${s.arrivalTiming}`);
  console.log(`  opener:   ${s.introOpener}`);
  console.log(`  exit:     ${s.exitStrategy}`);
}

console.log('\n=== business_dress_code_brief (JP / banking / client_pitch) ===');
const dress = await businessDressCodeBriefTool.handler(
  { countryCode: 'JP', industry: 'banking', meetingType: 'client_pitch', climate: 'cool' } as never,
  ctx
);
if (dress.status === 'ok' && dress.brief) {
  console.log(`  formality: ${dress.brief.formality}`);
  console.log(`  men:       ${dress.brief.men}`);
  console.log(`  women:     ${dress.brief.women}`);
  console.log(`  layering:  ${dress.brief.layering}`);
}

console.log('\n=== expense_policy_checker (mixed expenses) ===');
const exp = await expensePolicyCheckerTool.handler(
  {
    expenses: [
      { category: 'flight', amountUsd: 1900, description: 'EZE-JFK economy' },
      { category: 'hotel_per_night', amountUsd: 280, description: 'business hotel' },
      { category: 'meal', amountUsd: 65, description: 'dinner day 1' },
      { category: 'meal', amountUsd: 120, description: 'client dinner day 1' },
      { category: 'entertainment', amountUsd: 200, description: 'theater tickets for client' },
    ],
    policy: {
      flightCabin: 'economy',
      flightCapUsd: 2500,
      hotelPerNightUsd: 220,
      mealPerDayUsd: 80,
      perDiemTotalUsd: 120,
      entertainmentAllowed: false,
    },
    tripDays: 3,
  } as never,
  ctx
);
if (exp.status === 'ok') {
  console.log(`  total $${exp.totalUsd} · within=${exp.withinPolicy}`);
  for (const v of exp.verdicts ?? []) console.log(`    [${v.verdict}] ${v.category}: $${v.amountUsd} — ${v.reason}`);
}

console.log('\n=== meeting_commute_planner (Mexico City, 9am rush) ===');
const cmt = await meetingCommutePlannerTool.handler(
  {
    city: 'Mexico City',
    countryCode: 'MX',
    meetingAtIso: new Date(Date.now() + 86_400_000).toISOString().replace(/T.*$/, 'T09:00:00.000Z'),
    origin: 'hotel',
    drivingKm: 8,
  } as never,
  ctx
);
if (cmt.status === 'ok') {
  console.log(`  leave by ${cmt.leaveByIso} (${cmt.bufferMinutes}min ahead)`);
  console.log(`  mode: ${cmt.modeRecommendation}`);
  for (const n of cmt.notes ?? []) console.log(`  · ${n}`);
}

console.log('\n=== source_cache_manager round-trip ===');
const set = await runSourceCacheManager({ op: 'set', key: 'coffee:Tokyo', value: { count: 8 }, ttlSeconds: 3600 } as never, ctx);
console.log(`  ${set.message}`);
const got = await runSourceCacheManager({ op: 'get', key: 'coffee:Tokyo' } as never, ctx);
console.log(`  ${got.message} value=${JSON.stringify((got as { value?: unknown }).value ?? null)}`);

console.log('\n=== research_audit_trail ===');
const audit = await runResearchAuditTrail(
  {
    recommendation: 'Try Mameya Kakeru — top specialty pour-over in Tokyo.',
    toolsUsed: ['specialty_coffee_finder', 'monocle_place_researcher'],
    sources: [
      { url: 'https://sprudge.com/tokyo-mameya-kakeru.html', confidence: 'high' },
      { url: 'https://eater.com/tokyo-coffee-guide.html', confidence: 'medium' },
    ],
    finalConfidence: 'high',
  } as never,
  ctx
);
if (audit.status === 'ok') console.log(`  auditId=${audit.auditId} — ${audit.message}`);

console.log('\n=== recommendation_explainer (ES) ===');
const explain = await runRecommendationExplainer(
  {
    recommendation: 'Mameya Kakeru — pour-over de especialidad en Tokio.',
    rationaleParts: ['Featured by Sprudge', '4.6★ over 1200 reviews', 'wifi + tomas mencionados en editorial'],
    topSources: [{ url: 'https://sprudge.com/mameya-kakeru' }],
    budgetEnvelope: '~$8-15/persona',
    locale: 'es-AR',
  } as never,
  ctx
);
if (explain.status === 'ok') console.log(`  ${explain.explanation}`);

console.log('\n=== receipt_collection_assistant ===');
const rec = await receiptCollectionAssistantTool.handler(
  {
    bookings: [
      { kind: 'flight', ref: 'PNR-ABC123', date: '2026-05-09', amountUsd: 850, receiptOnFile: true },
      { kind: 'hotel', ref: 'CONF-9999', date: '2026-05-10', amountUsd: 280, receiptOnFile: false },
      { kind: 'restaurant', ref: 'AMEX-Don-Julio', date: '2026-05-11', amountUsd: 95, receiptOnFile: false },
      { kind: 'transport', ref: 'UBER-2x', amountUsd: 35, receiptOnFile: true },
    ],
  } as never,
  ctx
);
if (rec.status === 'ok') {
  console.log(`  ${rec.message}`);
  for (const m of rec.missing ?? []) console.log(`    · [${m.kind}] ${m.ref}: ${m.suggestedAction}`);
}
