/**
 * Per-tenant reputation gate. Called from `/api/agent/dispatch` before
 * dispatching any tool that engages with a counterparty (a booking
 * agency talking to an inbound user; a user invoking an agency's
 * tools). Returns `{ ok: false, ... }` when the counterparty fails
 * the tenant's `ReputationPolicy`; the caller short-circuits with a
 * channel-appropriate decline.
 *
 * Three properties baked in:
 *
 *   1. **Default `enforcement = 'warn'`** (locked decision): a policy
 *      violation is logged + surfaced in the dashboard but does NOT
 *      block the engagement. Tenants flip to `'block'` once they've
 *      reviewed surfaced violations. `'allow'` skips the check.
 *
 *   2. **Star floor only kicks in past `minTripCount`**: a fresh
 *      WhatsApp lead with 0 trips would fail `minStars=3.5` trivially
 *      and be blocked from booking — bad UX. Treat new users as
 *      `'unknown'` until they've crossed the agency's minTripCount.
 *
 *   3. **Cache-first reads**: only touches `OnchainIdentity.cached*`
 *      and `ReputationPolicy`. Sub-50ms on the hot path. No chain
 *      RPC fallback here — the dispatch route can't afford the
 *      multi-second hit. Unknown counterparty → `{ ok: 'unknown' }`
 *      and the channel adapter explains why.
 */

import { prisma } from '@sendero/database';

export type GateVerdict =
  | { ok: true; enforcement: 'allow' | 'warn' }
  | {
      ok: 'unknown';
      enforcement: 'block' | 'warn' | 'allow';
      reason: 'no_identity' | 'no_policy' | 'novice';
    }
  | {
      ok: false;
      enforcement: 'block' | 'warn';
      violations: Array<{
        rule: 'min_stars' | 'min_trips' | 'max_dispute_ratio' | 'kyc' | 'kyb';
        threshold: number | boolean;
        actual: number | boolean | null;
      }>;
    };

export async function reputationGate(args: {
  tenantId: string;
  counterpartyKind: 'org' | 'user';
  counterpartyTenantId?: string;
  counterpartyUserId?: string;
}): Promise<GateVerdict> {
  const policy = await prisma.reputationPolicy.findUnique({
    where: { tenantId: args.tenantId },
  });
  if (!policy) {
    // No tenant policy = no gating. Pass through as 'allow'.
    return { ok: 'unknown', enforcement: 'allow', reason: 'no_policy' };
  }
  if (policy.enforcement === 'allow') {
    return { ok: true, enforcement: 'allow' };
  }

  const counterpartyIdentity = await prisma.onchainIdentity.findFirst({
    where:
      args.counterpartyKind === 'org'
        ? { kind: 'org', tenantId: args.counterpartyTenantId }
        : { kind: 'user', userId: args.counterpartyUserId },
    select: {
      cachedStars: true,
      cachedFeedbackCount: true,
      cachedValidationCount: true,
      // Trip count is derived from ReputationFeedback — we don't store
      // it as a column. Subject of feedback ≠ subject of a trip, but
      // close enough for the gate: every settled trip drives both
      // feedback rows (cross-rated). cachedFeedbackCount / 2 is the
      // count of distinct trips approximately.
    },
  });

  if (!counterpartyIdentity) {
    return {
      ok: 'unknown',
      enforcement: policy.enforcement as 'block' | 'warn',
      reason: 'no_identity',
    };
  }

  const stars = counterpartyIdentity.cachedStars;
  const trips = Math.floor(counterpartyIdentity.cachedFeedbackCount / 2);
  const validations = counterpartyIdentity.cachedValidationCount;

  // Novice pass-through: minStars only enforced once minTripCount is met.
  // A first-time traveler can't be blocked by a no-history zero score.
  if (
    policy.minTripCount != null &&
    trips < policy.minTripCount &&
    !policy.requireKyc &&
    !policy.requireKyb
  ) {
    return {
      ok: 'unknown',
      enforcement: policy.enforcement as 'block' | 'warn',
      reason: 'novice',
    };
  }

  const violations: Array<{
    rule: 'min_stars' | 'min_trips' | 'max_dispute_ratio' | 'kyc' | 'kyb';
    threshold: number | boolean;
    actual: number | boolean | null;
  }> = [];

  if (policy.minStars != null && (stars == null || stars < policy.minStars)) {
    violations.push({ rule: 'min_stars', threshold: policy.minStars, actual: stars });
  }
  if (policy.minTripCount != null && trips < policy.minTripCount) {
    violations.push({ rule: 'min_trips', threshold: policy.minTripCount, actual: trips });
  }
  // Dispute ratio: not yet aggregated separately; placeholder until
  // we wire dispute_opened tag aggregation. Skip for now.
  if (policy.requireKyc && validations === 0) {
    violations.push({ rule: 'kyc', threshold: true, actual: false });
  }
  if (policy.requireKyb && validations === 0) {
    violations.push({ rule: 'kyb', threshold: true, actual: false });
  }

  if (violations.length === 0) {
    return { ok: true, enforcement: policy.enforcement as 'warn' | 'allow' };
  }
  return {
    ok: false,
    enforcement: policy.enforcement as 'block' | 'warn',
    violations,
  };
}

/**
 * Compose a channel-appropriate decline string for a `block` verdict.
 * Agents wrap this in a polite preamble ("I appreciate the inquiry,
 * but…"); the rule list itself stays terse so we don't reveal the
 * exact threshold.
 */
export function gateDeclineMessage(verdict: GateVerdict): string {
  if (verdict.ok === true) return '';
  if (verdict.ok === 'unknown') {
    if (verdict.reason === 'no_identity') {
      return "We couldn't find an on-chain identity for this counterparty. Please complete onboarding first.";
    }
    if (verdict.reason === 'novice') {
      return 'New travelers welcome — please complete a KYC check before your first booking.';
    }
    return '';
  }
  // ok === false
  const rules = verdict.violations.map(v => {
    switch (v.rule) {
      case 'min_stars':
        return 'minimum reputation';
      case 'min_trips':
        return 'minimum trip count';
      case 'max_dispute_ratio':
        return 'dispute history';
      case 'kyc':
        return 'KYC verification';
      case 'kyb':
        return 'KYB verification';
    }
  });
  return `Engagement blocked by tenant policy: ${rules.join(', ')}. Please contact the agency for an exception.`;
}
