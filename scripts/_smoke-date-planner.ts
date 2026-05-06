#!/usr/bin/env bun
/**
 * Smoke: date planner suite (pure, no API key required).
 *
 *   bun run scripts/_smoke-date-planner.ts
 *
 * Exercises date_budget_optimizer + date_perfume_advisor + date_game_tips
 * + date_plan_builder end-to-end on a synthetic Buenos Aires medium-tier
 * romantic date.
 */

import 'dotenv/config';

import {
  runDateBudgetOptimizer,
  runDatePerfumeAdvisor,
  runDateGameTips,
  runDatePlanBuilder,
} from '../packages/tools/src/anticipation/date-planner';
import type { ToolContext } from '../packages/tools/src/types';

const ctx: ToolContext = {
  traveler: { tenantId: 'org_smoke', userId: 'usr_smoke' },
  caller: { effectiveKeyType: 'sandbox', keyType: 'sandbox', scopes: ['*'] },
};

console.log('\n› date_budget_optimizer({ vibe: romantic, tier: medium })');
const opt = await runDateBudgetOptimizer(
  { vibe: 'romantic', budgetTier: 'medium', preferredTimeOfDay: 'evening' } as never,
  ctx
);
if (opt.status === 'ok') {
  console.log(`  envelope: ${opt.totalEnvelope}`);
  for (const m of opt.moves!.slice(0, 6)) {
    console.log(`  • ${m.role.padEnd(11)} ${m.category.padEnd(20)} ${m.expectedSpend.padEnd(8)}  ${m.description}`);
  }
}

console.log('\n› date_perfume_advisor({ night, cool, romantic })');
const perf = await runDatePerfumeAdvisor(
  { timeOfDay: 'night', climate: 'cool', vibe: 'romantic', budgetTier: 'medium' } as never,
  ctx
);
if (perf.status === 'ok') {
  console.log(`  family: ${perf.profile!.family}`);
  console.log(`  notes:  ${perf.profile!.notes.join(', ')}`);
  console.log(`  intent: ${perf.profile!.intent}`);
  console.log(`  apply:  ${perf.applicationTip}`);
  console.log(`  rule:   ${perf.guardrail}`);
}

console.log('\n› date_game_tips({ first_date, romantic })');
const tips = await runDateGameTips(
  { context: 'first_date', vibe: 'romantic', venueQuiet: true } as never,
  ctx
);
if (tips.status === 'ok') {
  console.log(`  confidence:`);
  for (const t of tips.confidence!) console.log(`    · ${t}`);
  console.log(`  conversation:`);
  for (const t of tips.conversation!.slice(0, 3)) console.log(`    · ${t}`);
  console.log(`  exit:`);
  console.log(`    · ${tips.gracefulExit![0]}`);
  console.log(`  guardrail: ${tips.guardrail}`);
}

console.log('\n› date_plan_builder({ Buenos Aires, 4 candidates })');
const plan = await runDatePlanBuilder(
  {
    city: 'Buenos Aires',
    vibe: 'romantic',
    budgetTier: 'medium',
    candidates: [
      { name: 'Aldo\'s Vinoteca', category: 'wine_bar', rationale: 'Casual + great by-the-glass list.' },
      { name: 'Don Julio', category: 'mid_restaurant', rationale: 'Top parrilla — book ahead, warm room.' },
      { name: 'Florería Atlántico', category: 'cocktail_bar', rationale: 'Hidden cocktail bar inside a flower shop, second-move energy.' },
      { name: 'Walk along Avenida Alvear', category: 'walk_home', rationale: 'Tree-lined, well-lit, easy graceful exit.' },
    ],
    includeSecondMove: true,
  } as never,
  ctx
);
if (plan.status === 'ok') {
  for (const stop of plan.plan!) {
    console.log(`  ${stop.role.padEnd(12)}  ${stop.name.padEnd(24)}  [${stop.category}]`);
    console.log(`               ${stop.why}`);
  }
  console.log(`\n  fallback: ${plan.fallback}`);
}
