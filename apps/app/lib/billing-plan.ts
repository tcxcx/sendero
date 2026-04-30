import { auth } from '@clerk/nextjs/server';

import { prisma } from '@sendero/database';
import {
  BILLING_FEATURES,
  PLANS,
  resolvePlan,
  type BillingFeature,
  type PlanConfig,
  type PlanTier,
} from '@sendero/billing/plans';
import { requireCurrentTenant } from './tenant-context';

/**
 * Resolve the current organization's plan tier from Clerk Billing.
 *
 * Uses `has({ plan: slug })` against each tier slug, highest to
 * lowest. Returns the richest plan the org has. Falls back to free.
 *
 * Requires the matching plan slugs to exist in Clerk Billing →
 * Organization plans. See `@sendero/billing/plans` for the source of
 * truth on slugs.
 */
export async function currentOrgPlan(): Promise<PlanConfig> {
  const { has, orgId } = await auth();
  if (!orgId) return PLANS.free;
  const order: PlanTier[] = ['enterprise', 'pro', 'basic', 'free'];
  for (const tier of order) {
    if (has({ plan: PLANS[tier].slug })) return PLANS[tier];
  }
  try {
    const { tenant } = await requireCurrentTenant();
    const legacy = tenant.billingTier?.toLowerCase();
    if (legacy === 'enterprise') return PLANS.enterprise;
    if (legacy === 'pro') return PLANS.pro;
    if (legacy === 'business' || legacy === 'basic') return PLANS.basic;
  } catch {
    // Authenticated plan pages can render before tenant provisioning finishes.
  }
  return PLANS.free;
}

/** Ergonomic wrapper: plan tier only. */
export async function currentOrgPlanTier(): Promise<PlanTier> {
  return (await currentOrgPlan()).tier;
}

/**
 * Feature-gate helper. True when the current org's plan includes the
 * given Clerk Billing feature. Prefer this over tier checks for
 * capability gates (e.g. `additional_workspaces`) so upgrades don't
 * require code changes.
 */
export async function hasBillingFeature(feature: BillingFeature): Promise<boolean> {
  const { has, orgId } = await auth();
  if (!orgId) return false;
  return Boolean(has({ feature }));
}

/** Shortcut for the workspace-count gate. */
export async function canCreateAdditionalWorkspace(): Promise<boolean> {
  return hasBillingFeature(BILLING_FEATURES.ADDITIONAL_WORKSPACES);
}

/**
 * Snapshot of the current tenant's credit envelope. Drives the
 * `<CreditBadge />` burn-down meter and any future cap-hit copy.
 *
 * Math is *retrospective consumed*, not predictive — the Subscription
 * row's `meterBalanceMicro` is the running balance, decremented on
 * every successful preflight credit deduction. `consumedMicro` is
 * derived as `monthlyGrant - balance` so a never-used cycle reads
 * "$0 of $X consumed" cleanly.
 *
 * Values for tenants without a credit grant (free tier) come back as
 * `null` so the badge can render nothing instead of a "$0 of $0" row.
 */
export interface CurrentCreditUsage {
  tier: PlanTier;
  /** Per-cycle grant in micro-USDC, or null if the tenant has no credits. */
  monthlyGrantMicro: bigint | null;
  /** Remaining balance in micro-USDC, or null if no credits. */
  balanceMicro: bigint | null;
  /**
   * Consumed micro-USDC this cycle (`monthlyGrant - balance`, floored
   * at 0 for safety). null when there's no grant.
   */
  consumedMicro: bigint | null;
  /** Fraction consumed in [0, 1]. null when there's no grant. */
  consumedFraction: number | null;
  /** Daily-window counter from Subscription. null when no grant. */
  dailyConsumedMicro: bigint | null;
  /** Daily sub-cap from PlanConfig. null when no grant. */
  dailyCapMicro: bigint | null;
  /** When the current cycle ends. `null` if not populated yet. */
  currentPeriodEnd: Date | null;
}

export async function currentCreditUsage(): Promise<CurrentCreditUsage> {
  const { tenant } = await requireCurrentTenant();
  const plan = await currentOrgPlan();
  const grant = plan.monthlyIncludedCreditsMicro;
  const dailyCap = plan.dailyCreditCapMicro;

  // Free tier (or any tier with no grant) — short-circuit. The badge
  // component renders null in this case.
  if (grant === null) {
    return {
      tier: plan.tier,
      monthlyGrantMicro: null,
      balanceMicro: null,
      consumedMicro: null,
      consumedFraction: null,
      dailyConsumedMicro: null,
      dailyCapMicro: null,
      currentPeriodEnd: null,
    };
  }

  const sub = await prisma.subscription.findUnique({
    where: { tenantId: tenant.id },
    select: {
      meterBalanceMicro: true,
      dailyCreditBurnMicro: true,
      currentPeriodEnd: true,
    },
  });

  // No Subscription row yet — show full grant unconsumed. The Clerk
  // `subscription.created` webhook lands subsequently and seeds the row.
  const balance = sub?.meterBalanceMicro ?? grant;
  const consumed = balance >= grant ? 0n : grant - balance;
  // Clamp the fraction to [0, 1] in case `balance > grant` (cycle
  // renewal during a read race).
  const fraction = grant === 0n ? 0 : Math.max(0, Math.min(1, Number(consumed) / Number(grant)));

  return {
    tier: plan.tier,
    monthlyGrantMicro: grant,
    balanceMicro: balance,
    consumedMicro: consumed,
    consumedFraction: fraction,
    dailyConsumedMicro: sub?.dailyCreditBurnMicro ?? 0n,
    dailyCapMicro: dailyCap,
    currentPeriodEnd: sub?.currentPeriodEnd ?? null,
  };
}

export { BILLING_FEATURES, resolvePlan };
