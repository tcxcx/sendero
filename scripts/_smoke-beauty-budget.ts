#!/usr/bin/env bun
/**
 * Smoke: beauty_budget_ranker (pure).
 *
 *   bun run scripts/_smoke-beauty-budget.ts
 *
 * Exercises the score = aesthetic^1.2 / (1 + log10(spend+1)) shape on
 * 6 synthetic Tokyo candidates. Verifies the ranker correctly prefers
 * "lovely + $40" over "stunning + $400".
 */

import 'dotenv/config';

import { runBeautyBudgetRanker } from '../packages/tools/src/anticipation/beauty-budget-ranker';
import type { ToolContext } from '../packages/tools/src/types';

const ctx: ToolContext = {
  traveler: { tenantId: 'org_smoke', userId: 'usr_smoke' },
  caller: { effectiveKeyType: 'sandbox', keyType: 'sandbox', scopes: ['*'] },
};

const r = await runBeautyBudgetRanker(
  {
    candidates: [
      {
        name: 'Tasting Menu Stunner',
        category: 'tasting_menu',
        aestheticScore: 0.95,
        typicalSpend: 380,
      },
      {
        name: 'Mid-tier Beauty',
        category: 'mid_restaurant',
        aestheticScore: 0.85,
        typicalSpend: 45,
      },
      { name: 'Cute Wine Bar', category: 'wine_bar', aestheticScore: 0.75, typicalSpend: 30 },
      {
        name: 'Fine but Generic',
        category: 'fine_restaurant',
        aestheticScore: 0.5,
        typicalSpend: 110,
      },
      { name: 'Cheap + Lovely Counter', category: 'ramen', aestheticScore: 0.7, typicalSpend: 16 },
      {
        name: 'Flashy Tourist Trap',
        category: 'casual_restaurant',
        aestheticScore: 0.3,
        typicalSpend: 35,
      },
    ],
    budgetCapUsd: 80,
    preferredTier: 'medium',
    limit: 6,
  } as never,
  ctx
);

if (r.status !== 'ok') {
  console.log(`status: ${r.status}`);
  console.log(`message: ${r.message}`);
  process.exit(0);
}

console.log(`${r.message}\n`);
for (const item of r.ranked) {
  console.log(
    `  ${item.beautyBudgetScore.toFixed(3)}  ${item.budgetTier!.padEnd(7)}  ${item.name.padEnd(28)}  ${item.reason}`
  );
}
