/**
 * RateLimitGuard — N transactions per rolling window.
 *
 * Reads `countInWindow` from an injected `RateLimitStore` and
 * rejects when count + 1 (the proposed payment) exceeds `maxCount`.
 * Designed to slow runaway agents — pair with BudgetGuard for value
 * caps, RateLimitGuard for frequency caps.
 *
 * Window is a trailing duration in ms (e.g. 60_000 for one minute).
 */

import type { PaymentContext, PolicyGuard, PolicyResult, PolicyScope } from '../types';

export interface RateLimitStore {
  countInWindow(args: {
    tenantId: string;
    travelerId?: string;
    toolName?: string;
    windowStartedAt: Date;
  }): Promise<number>;
}

export interface RateLimitGuardOptions {
  /** Max number of transactions in the window (proposed call counts toward this). */
  maxCount: number;
  /** Trailing window in milliseconds. */
  windowMs: number;
  scope: PolicyScope;
  store: RateLimitStore;
}

export class RateLimitGuard implements PolicyGuard {
  readonly name: string;

  constructor(private readonly opts: RateLimitGuardOptions) {
    this.name = `rate_limit:${opts.scope}`;
  }

  async check(ctx: PaymentContext): Promise<PolicyResult> {
    if (this.opts.scope === 'traveler' && !ctx.travelerId) {
      return { allowed: true, reason: 'rate-limit guard not in scope' };
    }
    if (this.opts.scope === 'tool' && !ctx.toolName) {
      return { allowed: true, reason: 'rate-limit guard not in scope' };
    }
    const at = ctx.at ?? new Date();
    const windowStartedAt = new Date(at.getTime() - this.opts.windowMs);
    const count = await this.opts.store.countInWindow({
      tenantId: ctx.tenantId,
      travelerId: this.opts.scope === 'traveler' ? ctx.travelerId : undefined,
      toolName: this.opts.scope === 'tool' ? ctx.toolName : undefined,
      windowStartedAt,
    });
    if (count + 1 <= this.opts.maxCount) {
      return {
        allowed: true,
        reason: 'within rate limit',
        detail: this.detail(count),
      };
    }
    return {
      allowed: false,
      reason: `${this.opts.scope} rate limit exceeded`,
      detail: this.detail(count),
    };
  }

  private detail(count: number): Record<string, unknown> {
    return {
      scope: this.opts.scope,
      windowMs: this.opts.windowMs,
      maxCount: this.opts.maxCount,
      observedCount: count,
    };
  }
}
