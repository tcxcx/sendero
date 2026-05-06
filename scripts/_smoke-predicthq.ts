#!/usr/bin/env bun
/**
 * Smoke: crowd_level_predictor (PredictHQ Events).
 *
 *   bun run scripts/_smoke-predicthq.ts "Austin"
 *   bun run scripts/_smoke-predicthq.ts "Buenos Aires" 2026-12-01 2026-12-15
 *
 * Env: PREDICTHQ_ACCESS_TOKEN.
 */

import 'dotenv/config';

import { runCrowdLevelPredictor } from '../packages/tools/src/anticipation/crowd-level-predictor';
import type { ToolContext } from '../packages/tools/src/types';

const [city = 'Austin', startsAtIso, endsAtIso] = process.argv.slice(2);

const ctx: ToolContext = {
  traveler: { tenantId: 'org_smoke', userId: 'usr_smoke' },
  caller: { effectiveKeyType: 'sandbox', keyType: 'sandbox', scopes: ['*'] },
};

console.log(`\n› crowd_level_predictor({ city: "${city}"${startsAtIso ? `, startsAtIso: "${startsAtIso}"` : ''}${endsAtIso ? `, endsAtIso: "${endsAtIso}"` : ''} })\n`);

const input: Record<string, unknown> = { city };
if (startsAtIso) input.startsAtIso = startsAtIso;
if (endsAtIso) input.endsAtIso = endsAtIso;

const r = await runCrowdLevelPredictor(input as never, ctx);

if (r.status !== 'ok') {
  console.log(`status: ${r.status}`);
  if (r.status === 'unavailable') console.log(`reason: ${r.reason}`);
  console.log(`message: ${r.message}`);
  process.exit(0);
}

console.log(`window: ${r.window.startsAtIso} → ${r.window.endsAtIso}`);
console.log(`crowd_level: ${r.crowdLevel}`);
console.log(`peak_local_rank: ${r.peakLocalRank}`);
console.log(`total_events: ${r.totalEvents}`);
console.log(`predicted_attendance: ${r.totalPredictedAttendance.toLocaleString()}`);
console.log(`\ntop drivers:`);
for (const d of r.topDrivers) {
  console.log(
    `  • ${d.title}  [${d.category}] rank=${d.rank ?? '?'} local=${d.localRank ?? '?'}${typeof d.predictedAttendance === 'number' ? ` att=${d.predictedAttendance.toLocaleString()}` : ''}`
  );
}
console.log(`\n${r.message}`);
