/**
 * ConfirmGuard — pause for human approval.
 *
 * Returns `allowed: true, requiresApproval: true` for every payment
 * unless the caller flagged the context as `preApproved` (i.e. an
 * operator has already clicked "Approve" in the UI).
 *
 * Optionally narrowed to amounts above `triggerAtMicroUsdc` so small
 * autonomous spends keep flowing while large ones pause for review.
 */

import type { PaymentContext, PolicyGuard, PolicyResult } from '../types';

export interface ConfirmGuardOptions {
  /** Only require approval when amount ≥ this value. Defaults to 0 (every payment). */
  triggerAtMicroUsdc?: bigint;
  /** Optional explanation surfaced in the UI when approval is requested. */
  reason?: string;
}

export class ConfirmGuard implements PolicyGuard {
  readonly name = 'confirm';

  constructor(private readonly opts: ConfirmGuardOptions = {}) {}

  async check(ctx: PaymentContext): Promise<PolicyResult> {
    const trigger = this.opts.triggerAtMicroUsdc ?? 0n;
    if (ctx.amountMicroUsdc < trigger) {
      return { allowed: true, reason: 'below approval threshold' };
    }
    if (ctx.preApproved) {
      return { allowed: true, reason: 'pre-approved by operator' };
    }
    return {
      allowed: true,
      requiresApproval: true,
      reason: this.opts.reason ?? 'manual approval required',
      detail: {
        amountMicro: ctx.amountMicroUsdc.toString(),
        triggerMicro: trigger.toString(),
      },
    };
  }
}
