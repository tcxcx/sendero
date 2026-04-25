/**
 * SingleTxGuard — per-transaction maximum.
 *
 * Cheapest possible guard: rejects when amount alone exceeds the
 * configured ceiling.  Keeps an agent that hallucinates a 10 BTC
 * transfer from accidentally moving anything large.
 */

import type { PaymentContext, PolicyGuard, PolicyResult } from '../types';

export interface SingleTxGuardOptions {
  /** Max micro-USDC for any single payment. */
  maxMicroUsdc: bigint;
}

export class SingleTxGuard implements PolicyGuard {
  readonly name = 'single_tx';

  constructor(private readonly opts: SingleTxGuardOptions) {}

  async check(ctx: PaymentContext): Promise<PolicyResult> {
    if (ctx.amountMicroUsdc <= this.opts.maxMicroUsdc) {
      return { allowed: true, reason: 'within single-tx ceiling' };
    }
    return {
      allowed: false,
      reason: 'single-tx ceiling exceeded',
      detail: {
        amountMicro: ctx.amountMicroUsdc.toString(),
        maxMicro: this.opts.maxMicroUsdc.toString(),
      },
    };
  }
}
