/**
 * RecipientGuard — allow / deny lists of destination addresses.
 *
 * Two complementary modes:
 *   - allow: only addresses in the list are accepted; everything
 *     else is rejected.  Right for treasury controls where the agent
 *     should ONLY ever pay a curated set of vendor wallets.
 *   - deny: addresses in the list are rejected; everything else is
 *     allowed.  Right for sanction/blocklists.
 *
 * Comparisons are case-insensitive (EVM addresses are mixed-case
 * checksum encoded but logically lowercase). x402 charges with no
 * recipient are passed through with a "no-recipient" allow.
 */

import type { PaymentContext, PolicyGuard, PolicyResult } from '../types';

export interface RecipientGuardOptions {
  mode: 'allow' | 'deny';
  /** Address strings (e.g. 0x… EVM, sol… Solana). */
  list: string[];
}

export class RecipientGuard implements PolicyGuard {
  readonly name: string;
  private readonly normalized: Set<string>;

  constructor(private readonly opts: RecipientGuardOptions) {
    this.name = `recipient:${opts.mode}`;
    this.normalized = new Set(opts.list.map(a => a.trim().toLowerCase()));
  }

  async check(ctx: PaymentContext): Promise<PolicyResult> {
    if (!ctx.recipient) {
      return { allowed: true, reason: 'no recipient (e.g. x402)' };
    }
    const target = ctx.recipient.trim().toLowerCase();
    const inList = this.normalized.has(target);
    if (this.opts.mode === 'allow') {
      if (inList) return { allowed: true, reason: 'recipient on allow list' };
      return {
        allowed: false,
        reason: 'recipient not on allow list',
        detail: { recipient: ctx.recipient },
      };
    }
    if (inList) {
      return {
        allowed: false,
        reason: 'recipient on deny list',
        detail: { recipient: ctx.recipient },
      };
    }
    return { allowed: true, reason: 'recipient not on deny list' };
  }
}
