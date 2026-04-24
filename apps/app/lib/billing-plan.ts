import { auth } from '@clerk/nextjs/server';

import {
  BILLING_FEATURES,
  PLANS,
  resolvePlan,
  type BillingFeature,
  type PlanConfig,
  type PlanTier,
} from '@sendero/billing/plans';

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

export { BILLING_FEATURES, resolvePlan };
