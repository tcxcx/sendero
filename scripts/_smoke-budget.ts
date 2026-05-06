#!/usr/bin/env bun
/**
 * Smoke: budget_estimator (pure, no API key required).
 *
 *   bun run scripts/_smoke-budget.ts
 *
 * Walks a representative grid: ramen in Tokyo + Buenos Aires (cheaper
 * city), fine dining in NYC + Lisbon, cafe in Mexico City. Verifies
 * the city multiplier shifts the range and the moneyTalk reads naturally.
 */

import 'dotenv/config';

import { runBudgetEstimator } from '../packages/tools/src/anticipation/budget-estimator';
import type { ToolContext } from '../packages/tools/src/types';

const ctx: ToolContext = {
  traveler: { tenantId: 'org_smoke', userId: 'usr_smoke' },
  caller: { effectiveKeyType: 'sandbox', keyType: 'sandbox', scopes: ['*'] },
};

const cases = [
  { category: 'ramen' as const, city: 'Tokyo', countryCode: 'JP' },
  { category: 'ramen' as const, city: 'Buenos Aires', countryCode: 'AR' },
  { category: 'fine_restaurant' as const, city: 'New York', countryCode: 'US', priceLevel: 'PRICE_LEVEL_VERY_EXPENSIVE' as const },
  { category: 'fine_restaurant' as const, city: 'Lisbon', countryCode: 'PT' },
  { category: 'tasting_menu' as const, city: 'Tokyo', countryCode: 'JP', michelinPriceSymbols: '$$$' as const },
  { category: 'cafe' as const, city: 'Mexico City', countryCode: 'MX' },
  { category: 'wine_bar' as const, city: 'Madrid', countryCode: 'ES', reviewMentions: ['copa de vino $9', 'tapas around $12 each'] },
  { category: 'cafe' as const, city: 'Reykjavik', countryCode: 'IS' },
];

for (const c of cases) {
  const r = await runBudgetEstimator(c as never, ctx);
  if (r.status !== 'ok') {
    console.log(`✗ ${c.category} ${c.city} → ${r.status}: ${r.message}`);
    continue;
  }
  console.log(
    `${r.budgetTier!.padEnd(7)}  ${c.category.padEnd(17)} ${c.city.padEnd(15)}  $${r.expectedSpendPerPerson!.low}-${r.expectedSpendPerPerson!.high}/person  ${r.moneyTalk}`
  );
}
