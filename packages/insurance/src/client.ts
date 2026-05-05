/** PARKED — see packages/insurance/package.json header. */

import type { InsurancePlan, OrderArgs, OrderResult, QuoteArgs } from './types';

export interface InsuranceProvider {
  readonly slug: string;
  quote(args: QuoteArgs): Promise<InsurancePlan | null>;
  listPlans(args: QuoteArgs & { limit?: number }): Promise<InsurancePlan[]>;
  order(args: OrderArgs): Promise<OrderResult>;
}
