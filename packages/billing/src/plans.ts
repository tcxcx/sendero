/**
 * Plan tiers for Clerk-billed orgs.
 *
 * One workspace is free. More than one requires a paid plan. The plan
 * also yields a discount on nanopayment unit prices and the booking
 * take rate. Enterprise pricing is negotiated — we model it here as a
 * default config so code paths always resolve, but real enterprise
 * orgs override via Clerk metadata or a per-tenant record.
 *
 * Plan slugs MUST match the Clerk Billing plan slugs so `has({ plan })`
 * and `<Protect plan=…>` resolve correctly.
 */

import type { PriceCell, PricedAction } from './pricing';
import { DEFAULT_PRICING, gmvMicroCharge, priceFor } from './pricing';

export type PlanTier = 'free' | 'basic' | 'pro' | 'enterprise';

/**
 * Clerk Billing feature slugs. Attach these to paid plans in the Clerk
 * dashboard so `has({ feature })` returns true for subscribers.
 *
 * Two categories:
 *   - Commerce discounts (nanopayment, booking take rate) — the *bps*
 *     live in `PlanConfig`, these flags are just so UI can render
 *     "Discount: ON" badges without re-deriving from the tier.
 *   - Capability gates (additional_workspaces, production_api_keys,
 *     channel_*, mcp_server_public, etc.) — `has({ feature })` is the
 *     source of truth; our code branches on it.
 *
 * Numeric limits (workspace count, API key count, spend cap ceiling)
 * are NOT Clerk features — they're fields on `PlanConfig` so we can
 * model "3 keys" vs "unlimited" without creating 3+ features.
 */
export const BILLING_FEATURES = {
  ADDITIONAL_WORKSPACES: 'additional_workspaces',
  PRODUCTION_API_KEYS: 'production_api_keys',
  NANOPAYMENT_DISCOUNT: 'nanopayment_discount',
  BOOKING_TAKE_RATE_DISCOUNT: 'booking_take_rate_discount',
  /**
   * SaaS-included nanopayment credit grant. Numeric envelope per tier
   * lives in `PlanConfig.monthlyIncludedCreditsMicro`. The flag exists
   * so UI can render "Includes $X/mo" badges from `has({ feature })`
   * without re-deriving from the tier.
   */
  INCLUDED_CREDITS: 'included_credits',
  CHANNEL_WHATSAPP: 'channel_whatsapp',
  CHANNEL_SLACK: 'channel_slack',
  MCP_SERVER_PUBLIC: 'mcp_server_public',
  CUSTOM_WEBHOOKS: 'custom_webhooks',
  AUDIT_LOG_EXPORT: 'audit_log_export',
  PRIORITY_SUPPORT: 'priority_support',
  SSO_SAML: 'sso_saml',
  WHITE_LABEL: 'white_label',
  CUSTOM_SLA: 'custom_sla',
} as const;

export type BillingFeature = (typeof BILLING_FEATURES)[keyof typeof BILLING_FEATURES];

export interface PlanConfig {
  tier: PlanTier;
  /** Clerk Billing plan slug. Must match what's configured in Clerk. */
  slug: string;
  /** Monthly list price in USD (pay-as-you-go monthly). `null` for enterprise. */
  monthlyUsd: number | null;
  /**
   * Discounted **monthly-equivalent** rate when billed annually. Matches
   * the Clerk dashboard "Annual base fee" field, which Clerk validates
   * as `≤ monthlyUsd`. The actual annual total the customer pays is
   * `annualMonthlyUsd × 12`. `null` for free (no annual option) and
   * enterprise (custom).
   */
  annualMonthlyUsd: number | null;
  /** Max workspaces (orgs) on this plan. `null` = unlimited. */
  workspaceLimit: number | null;
  /**
   * Production API keys allowed. Free gets 0 production keys (only a
   * sandbox key, rate-limited, mock-settled). `null` = unlimited.
   */
  productionApiKeyLimit: number | null;
  /**
   * Ceiling on how high a tenant can raise its monthly spend cap, in
   * micro-USDC. `null` = unlimited. Enforced in the caps form.
   */
  monthlySpendCapCeilingMicro: bigint | null;
  /**
   * Discount applied to per-call nanopayment `micro` price. Basis
   * points off the list. e.g. `1500` = 15% off.
   */
  nanopaymentDiscountBps: number;
  /**
   * Discount applied to the GMV take-rate on bookings. Basis points
   * off the list rate. e.g. `500` = 5% off the take rate (not 5% of
   * gross).
   */
  bookingTakeRateDiscountBps: number;
  /**
   * SaaS-included nanopayment credit grant per billing cycle, in
   * micro-USDC. Refilled by the Clerk `subscription.created` and
   * `subscription.updated` webhooks. Use-it-or-lose-it: no rollover.
   * `null` for tenants without a credit envelope (free tier).
   *
   * Locked envelope: Free $0 / Basic $5 / Pro $25 / Enterprise $250
   * floor + 50% overage discount (`nanopaymentDiscountBps`).
   */
  monthlyIncludedCreditsMicro: bigint | null;
  /**
   * Daily sub-cap on credit burn, in micro-USDC. Defaults to 25% of
   * `monthlyIncludedCreditsMicro` per the eng review's runaway-loop
   * defense — without this, a single bad agent loop on opus drains
   * the monthly grant in an afternoon. Reset every 24h by preflight
   * when wall clock crosses `Subscription.dailyWindowStartedAt + 24h`.
   * `null` for tenants without a credit envelope.
   */
  dailyCreditCapMicro: bigint | null;
  /**
   * Per-turn COGS ceiling in micro-USDC. Server-side model gating
   * compares `cogsPerTurnMicro(model)` from `@sendero/billing/cogs`
   * against this cap. Models above the cap are visible in the UI
   * picker but rendered locked with an upgrade CTA — visibility is
   * the upsell vector, not punishment.
   *
   * Tier on price-band, NOT model name (per the autoplan eng review).
   * When a new model ships (GPT-5.5, Sonnet 5, fine-tuned travel
   * models), the allowlist resolves dynamically against the COGS
   * registry. No quarterly maintenance.
   *
   * `null` = no per-turn ceiling (Enterprise: any model in the registry).
   */
  maxCostPerTurnMicro: bigint | null;
  /**
   * Clerk Billing feature slugs this plan should have attached in the
   * dashboard. Informational — the source of truth for runtime gating
   * is `has({ feature })`. Keep this list in sync with the dashboard
   * config so a failing check is easy to diagnose.
   */
  features: BillingFeature[];
  /**
   * Whether this plan appears in Clerk's `<PricingTable />`. Free,
   * Basic, and Pro are public. Enterprise is private — sales assigns
   * the plan to the org via Clerk API after a discovery call. Our
   * marketing + `/app/billing/plans` preview still renders Enterprise
   * with "Contact sales" copy regardless of this flag.
   */
  publiclyListed: boolean;
}

const USD = (dollars: number): bigint => BigInt(dollars) * 1_000_000n;

export const PLANS: Record<PlanTier, PlanConfig> = {
  free: {
    tier: 'free',
    slug: 'free',
    monthlyUsd: 0,
    annualMonthlyUsd: null,
    workspaceLimit: 1,
    productionApiKeyLimit: 0,
    monthlySpendCapCeilingMicro: USD(100),
    nanopaymentDiscountBps: 0,
    bookingTakeRateDiscountBps: 0,
    monthlyIncludedCreditsMicro: null,
    dailyCreditCapMicro: null,
    // Cap at ~$0.007/turn — covers gemini-2.5-flash and gpt-5-mini.
    // Free tenants only have a sandbox key, so credit deduction never
    // fires; the cap exists to keep the model picker honest about
    // which models would be allowed once they upgrade to Basic.
    maxCostPerTurnMicro: 7_000n,
    features: [],
    publiclyListed: true,
  },
  basic: {
    tier: 'basic',
    slug: 'basic',
    monthlyUsd: 19,
    annualMonthlyUsd: 15,
    workspaceLimit: 5,
    productionApiKeyLimit: 3,
    monthlySpendCapCeilingMicro: USD(2_000),
    nanopaymentDiscountBps: 1_500,
    bookingTakeRateDiscountBps: 500,
    // $5/mo of metered usage. Sized below the worst-case sonnet COGS
    // envelope so a runaway loop can't go upside-down on Basic margin.
    monthlyIncludedCreditsMicro: 5_000_000n,
    // 25% of monthly = $1.25/day. Hard ceiling against single-day burn.
    dailyCreditCapMicro: 1_250_000n,
    // Same band as Free — Basic differentiates by giving you the credit
    // grant, not a wider model picker. Sonnet/Opus stay locked.
    maxCostPerTurnMicro: 7_000n,
    features: [
      BILLING_FEATURES.ADDITIONAL_WORKSPACES,
      BILLING_FEATURES.PRODUCTION_API_KEYS,
      BILLING_FEATURES.NANOPAYMENT_DISCOUNT,
      BILLING_FEATURES.BOOKING_TAKE_RATE_DISCOUNT,
      BILLING_FEATURES.INCLUDED_CREDITS,
      BILLING_FEATURES.CHANNEL_WHATSAPP,
      BILLING_FEATURES.CHANNEL_SLACK,
    ],
    publiclyListed: true,
  },
  pro: {
    tier: 'pro',
    slug: 'pro',
    monthlyUsd: 60,
    annualMonthlyUsd: 50,
    workspaceLimit: null,
    productionApiKeyLimit: 25,
    monthlySpendCapCeilingMicro: USD(20_000),
    nanopaymentDiscountBps: 3_000,
    bookingTakeRateDiscountBps: 1_000,
    // $25/mo of metered usage. Sized for ~3,500 cached sonnet turns
    // or ~5k cached gpt-5 turns. Margin floor at full burn ~58%.
    monthlyIncludedCreditsMicro: 25_000_000n,
    // 25% of monthly = $6.25/day.
    dailyCreditCapMicro: 6_250_000n,
    // Cap at $0.21/turn — unlocks gpt-5, gemini-2.5-pro, all sonnet
    // variants, and claude-opus-4-1. Opus 4.7 ($0.29+/turn) stays
    // Enterprise-only. Nanopayment pass-through bounds Sendero exposure.
    maxCostPerTurnMicro: 210_000n,
    features: [
      BILLING_FEATURES.ADDITIONAL_WORKSPACES,
      BILLING_FEATURES.PRODUCTION_API_KEYS,
      BILLING_FEATURES.NANOPAYMENT_DISCOUNT,
      BILLING_FEATURES.BOOKING_TAKE_RATE_DISCOUNT,
      BILLING_FEATURES.INCLUDED_CREDITS,
      BILLING_FEATURES.CHANNEL_WHATSAPP,
      BILLING_FEATURES.CHANNEL_SLACK,
      BILLING_FEATURES.MCP_SERVER_PUBLIC,
      BILLING_FEATURES.CUSTOM_WEBHOOKS,
      BILLING_FEATURES.AUDIT_LOG_EXPORT,
      BILLING_FEATURES.PRIORITY_SUPPORT,
    ],
    publiclyListed: true,
  },
  enterprise: {
    tier: 'enterprise',
    slug: 'enterprise',
    /**
     * Not null even though the plan is marketed as "Custom" — Clerk
     * requires a numeric base fee. This is the internal list price we
     * invoice at if a deal closes at list. Private in Clerk dashboard
     * so `<PricingTable />` doesn't expose it; sales assigns the plan
     * to orgs via Clerk API after the discovery call.
     */
    monthlyUsd: 1_500,
    annualMonthlyUsd: 1_250,
    workspaceLimit: null,
    productionApiKeyLimit: null,
    monthlySpendCapCeilingMicro: null,
    nanopaymentDiscountBps: 5_000,
    bookingTakeRateDiscountBps: 1_500,
    // $250/mo floor with overage continuing at 50% off list (the
    // existing `nanopaymentDiscountBps: 5_000`). Procurement-friendly:
    // big credit grant, predictable overage rate, never hard-blocked.
    monthlyIncludedCreditsMicro: 250_000_000n,
    // 25% of monthly = $62.50/day.
    dailyCreditCapMicro: 62_500_000n,
    // No per-turn ceiling. Opus and any future expensive model is
    // available. The daily-cap + monthly-cap combo bounds abuse.
    maxCostPerTurnMicro: null,
    features: [
      BILLING_FEATURES.ADDITIONAL_WORKSPACES,
      BILLING_FEATURES.PRODUCTION_API_KEYS,
      BILLING_FEATURES.NANOPAYMENT_DISCOUNT,
      BILLING_FEATURES.BOOKING_TAKE_RATE_DISCOUNT,
      BILLING_FEATURES.INCLUDED_CREDITS,
      BILLING_FEATURES.CHANNEL_WHATSAPP,
      BILLING_FEATURES.CHANNEL_SLACK,
      BILLING_FEATURES.MCP_SERVER_PUBLIC,
      BILLING_FEATURES.CUSTOM_WEBHOOKS,
      BILLING_FEATURES.AUDIT_LOG_EXPORT,
      BILLING_FEATURES.PRIORITY_SUPPORT,
      BILLING_FEATURES.SSO_SAML,
      BILLING_FEATURES.WHITE_LABEL,
      BILLING_FEATURES.CUSTOM_SLA,
    ],
    publiclyListed: false,
  },
};

/** Resolve a plan config by tier or slug, falling back to free. */
export function resolvePlan(tierOrSlug: string | null | undefined): PlanConfig {
  if (!tierOrSlug) return PLANS.free;
  const byTier = (PLANS as Record<string, PlanConfig | undefined>)[tierOrSlug];
  if (byTier) return byTier;
  const bySlug = Object.values(PLANS).find(p => p.slug === tierOrSlug);
  return bySlug ?? PLANS.free;
}

/**
 * Apply a basis-point discount to a micro-USDC value. Floors to 0 to
 * avoid negative charges if a misconfigured plan exceeds 100%.
 */
export function applyBpsDiscount(micro: bigint, discountBps: number): bigint {
  if (discountBps <= 0) return micro;
  const keep = BigInt(Math.max(0, 10_000 - discountBps));
  return (micro * keep) / 10_000n;
}

/** Plan-aware version of `priceFor` — applies nanopayment discount. */
export interface PlanPriceArgs {
  action: PricedAction;
  segment: Parameters<typeof priceFor>[0]['segment'];
  plan: PlanTier | PlanConfig;
  overrides?: Parameters<typeof priceFor>[0]['overrides'];
}

export function planPriceFor(args: PlanPriceArgs): PriceCell {
  const base = priceFor({ action: args.action, segment: args.segment, overrides: args.overrides });
  const plan = typeof args.plan === 'string' ? resolvePlan(args.plan) : args.plan;
  const discountedMicro = applyBpsDiscount(base.micro, plan.nanopaymentDiscountBps);
  if (!base.gmv) return { micro: discountedMicro };
  const discountedBps = Math.max(
    0,
    base.gmv.bps - Math.round((base.gmv.bps * plan.bookingTakeRateDiscountBps) / 10_000)
  );
  return {
    micro: discountedMicro,
    gmv: { bps: discountedBps },
  };
}

/** Plan-aware total including any GMV take-rate on the booking gross. */
export function planTotalMicroFor(args: PlanPriceArgs & { grossMicroUsdc?: bigint }): bigint {
  const cell = planPriceFor(args);
  const gmv = args.grossMicroUsdc
    ? gmvMicroCharge({ grossMicroUsdc: args.grossMicroUsdc, gmv: cell.gmv })
    : 0n;
  return cell.micro + gmv;
}

/** True if an org can create another workspace given its current count. */
export function canCreateWorkspace(plan: PlanTier | PlanConfig, currentCount: number): boolean {
  const p = typeof plan === 'string' ? resolvePlan(plan) : plan;
  if (p.workspaceLimit === null) return true;
  return currentCount < p.workspaceLimit;
}

/** Preview catalog at a given plan for pricing page rendering. */
export function previewCatalog(plan: PlanTier | PlanConfig, segment: PlanPriceArgs['segment']) {
  const p = typeof plan === 'string' ? resolvePlan(plan) : plan;
  return (Object.keys(DEFAULT_PRICING) as PricedAction[]).map(action => ({
    action,
    cell: planPriceFor({ action, segment, plan: p }),
  }));
}
