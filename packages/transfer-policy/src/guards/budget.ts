/**
 * BudgetGuard — daily/weekly/monthly spend ceilings.
 *
 * Reads `spentInWindow` from an injected `BudgetStore` (no DB
 * dependency in this package) and rejects when proposed + spent
 * crosses the cap. Hard caps reject; soft caps allow but mark the
 * result with a "soft cap exceeded" reason so the caller can fire
 * an alert webhook.
 *
 * Window math is UTC. Daily window starts at 00:00 UTC; weekly is
 * the trailing 7×24h; monthly is the start of the current calendar
 * month. Soft caps that go over still resolve `allowed: true` —
 * "soft" means observability, not blocking.
 */

import type { PaymentContext, PolicyGuard, PolicyResult, PolicyScope } from '../types';

export type BudgetPeriod = 'daily' | 'weekly' | 'monthly';

export interface BudgetStore {
  /**
   * Sum of paid amounts in [windowStartedAt, now()] for the given
   * scope tuple. Implementations should treat undefined fields as
   * "any". Return value is in micro-USDC.
   */
  spentInWindow(args: {
    tenantId: string;
    travelerId?: string;
    toolName?: string;
    windowStartedAt: Date;
  }): Promise<bigint>;
}

export interface BudgetGuardOptions {
  /** Which window to evaluate. */
  period: BudgetPeriod;
  /** Cap amount in micro-USDC. */
  capMicroUsdc: bigint;
  /** Hard caps reject; soft caps annotate but allow. */
  hardCap: boolean;
  /** Tenant | traveler | tool. Drives which fields to project from ctx. */
  scope: PolicyScope;
  /** Where the budget reads its window-spent total from. */
  store: BudgetStore;
  /** Override window-start for tests. */
  startOfWindow?: (period: BudgetPeriod, at: Date) => Date;
}

export class BudgetGuard implements PolicyGuard {
  readonly name: string;

  constructor(private readonly opts: BudgetGuardOptions) {
    this.name = `budget:${opts.scope}:${opts.period}`;
  }

  async check(ctx: PaymentContext): Promise<PolicyResult> {
    if (!this.appliesToScope(ctx)) {
      return { allowed: true, reason: 'budget guard not in scope' };
    }
    const at = ctx.at ?? new Date();
    const windowStartedAt = (this.opts.startOfWindow ?? defaultStartOfWindow)(this.opts.period, at);
    const spent = await this.opts.store.spentInWindow({
      tenantId: ctx.tenantId,
      travelerId: this.opts.scope === 'traveler' ? ctx.travelerId : undefined,
      toolName: this.opts.scope === 'tool' ? ctx.toolName : undefined,
      windowStartedAt,
    });
    const projected = spent + ctx.amountMicroUsdc;
    if (projected <= this.opts.capMicroUsdc) {
      return {
        allowed: true,
        reason: 'within budget',
        detail: this.detail(spent, projected),
      };
    }
    if (this.opts.hardCap) {
      return {
        allowed: false,
        reason: `${this.opts.scope} ${this.opts.period} budget exceeded`,
        detail: this.detail(spent, projected),
      };
    }
    return {
      allowed: true,
      reason: `${this.opts.scope} ${this.opts.period} soft cap exceeded`,
      detail: { ...this.detail(spent, projected), softCap: true },
    };
  }

  private appliesToScope(ctx: PaymentContext): boolean {
    if (this.opts.scope === 'traveler' && !ctx.travelerId) return false;
    if (this.opts.scope === 'tool' && !ctx.toolName) return false;
    return true;
  }

  private detail(spent: bigint, projected: bigint): Record<string, unknown> {
    return {
      period: this.opts.period,
      scope: this.opts.scope,
      capMicro: this.opts.capMicroUsdc.toString(),
      spentMicro: spent.toString(),
      projectedMicro: projected.toString(),
      remainingMicro: (this.opts.capMicroUsdc - projected).toString(),
    };
  }
}

export function defaultStartOfWindow(period: BudgetPeriod, at: Date): Date {
  if (period === 'daily') {
    const d = new Date(at);
    d.setUTCHours(0, 0, 0, 0);
    return d;
  }
  if (period === 'weekly') {
    return new Date(at.getTime() - 7 * 24 * 60 * 60 * 1000);
  }
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1));
}
