/**
 * Provider interface — the contract every concrete eSIM aggregator
 * implements. `book_esim` calls only this surface; per-provider
 * differences (auth, pagination, rate sheet shape) stay behind the
 * implementation.
 */

import type { EsimPlan, OrderArgs, OrderResult, QuoteArgs } from './types';

export interface EsimProvider {
  /** Provider slug — used as the `Esim.provider` discriminator. */
  readonly slug: string;
  /** Find the cheapest single plan matching the trip's countries +
   *  duration + data. Used by `book_esim` for the one-shot path. */
  quote(args: QuoteArgs): Promise<EsimPlan | null>;
  /** Return up to N matching plans (cheapest → richest). Used by
   *  `search_esim` to populate the WhatsApp interactive list — the
   *  traveler picks; then `book_esim({planId})` orders that exact
   *  bundle. Implementations may return fewer than `limit` when the
   *  catalogue is thin for the destination. */
  listPlans(args: QuoteArgs & { limit?: number }): Promise<EsimPlan[]>;
  /** Place an order. Idempotent per `idempotencyKey`. */
  order(args: OrderArgs): Promise<OrderResult>;
}
