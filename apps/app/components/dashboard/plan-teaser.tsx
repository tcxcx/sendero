'use client';

/**
 * PlanTeaser — current-plan strip + four tier cards on the dashboard home.
 *
 * Two click surfaces, two dialogs:
 *  - "Manage plan" → Clerk OrganizationProfile overlay
 *    (`useClerk().openOrganizationProfile()`). Built-in Billing tab covers
 *    subscription management for the active plan.
 *  - Tier cards → Clerk PricingTable wrapped in our Radix dialog
 *    (`<PricingTableDialog />`). PricingTable has no Clerk-JS modal
 *    helper, so we mount the component itself inside `@sendero/ui/dialog`.
 *
 * Kept client-only — both pathways need Clerk-JS in the browser.
 *
 * Hover choreography (Emil-style): tier cards use `group/plan` + a small
 * arrow translate and letter-spacing easing on "Upgrade →".
 */

import { useClerk } from '@clerk/nextjs';

import { PLANS, type PlanTier } from '@sendero/billing/plans';
import { Button } from '@sendero/ui/button';

import { PricingTableDialog } from '@/components/billing/pricing-table-dialog';

export function PlanTeaser({ tier }: { tier: PlanTier }) {
  const { openOrganizationProfile } = useClerk();
  const plan = PLANS[tier];
  const order: PlanTier[] = ['free', 'basic', 'pro', 'enterprise'];

  const openBilling = () => openOrganizationProfile();

  return (
    <section className="flex flex-col gap-4 rounded-[var(--radius-lg)] bg-[color:var(--surface-raised)] p-6 shadow-[var(--shadow-md)]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
            Current plan
          </div>
          <h3 className="mt-1 text-lg font-semibold tracking-normal capitalize text-foreground">
            {plan.tier}
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              {plan.workspaceLimit === null
                ? 'unlimited workspaces'
                : `${plan.workspaceLimit} workspace${plan.workspaceLimit === 1 ? '' : 's'}`}
              {plan.nanopaymentDiscountBps > 0
                ? ` · ${plan.nanopaymentDiscountBps / 100}% off nanopayments`
                : ''}
            </span>
          </h3>
        </div>
        <Button variant="outline" size="sm" className="!rounded-md" onClick={openBilling}>
          Manage plan
        </Button>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        {order.map(t => {
          const p = PLANS[t];
          const active = t === tier;
          const trialHint = active && tier === 'pro' ? 'Trial · ends in 14d' : null;
          const discountPct = p.nanopaymentDiscountBps / 100;
          const takeRatePct = p.bookingTakeRateDiscountBps / 100;
          const chrome = active
            ? 'border-[color:var(--ink)] bg-[color:color-mix(in_oklab,var(--ink)_6%,white)]'
            : 'border-[color:var(--border)] bg-[color:var(--surface-floating)] hover:border-[color:var(--ink)]';
          return (
            <PricingTableDialog key={t}>
              <button
                type="button"
                className={
                  'group/plan flex flex-col gap-1 rounded-[var(--radius-md)] border p-4 text-left transition-colors ' +
                  chrome
                }
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                    {p.tier}
                  </div>
                  {(discountPct > 0 || takeRatePct > 0) && (
                    <div className="text-right font-mono text-[9px] uppercase tracking-[0.1em] text-[color:var(--accent-green)]">
                      {discountPct > 0 ? `-${discountPct}% nano` : null}
                      {discountPct > 0 && takeRatePct > 0 ? <br /> : null}
                      {takeRatePct > 0 ? `-${takeRatePct}% booking` : null}
                    </div>
                  )}
                </div>
                <div className="text-lg font-semibold text-foreground">
                  {p.monthlyUsd === null
                    ? 'Custom'
                    : p.monthlyUsd === 0
                      ? 'Free'
                      : `$${p.monthlyUsd}/mo`}
                </div>
                <div className="text-xs text-muted-foreground">
                  {p.workspaceLimit === null
                    ? 'Unlimited workspaces'
                    : `${p.workspaceLimit} workspace${p.workspaceLimit === 1 ? '' : 's'}`}
                </div>
                {active ? (
                  <div className="mt-auto flex flex-col gap-0.5 pt-1 font-mono text-[11px] uppercase tracking-[0.12em] text-[color:var(--ink)]">
                    <span>Current</span>
                    {trialHint && (
                      <span className="text-[9px] tracking-[0.1em] text-[color:var(--text-faint)]">
                        {trialHint}
                      </span>
                    )}
                  </div>
                ) : (
                  <div className="mt-auto flex items-center gap-1 pt-1 font-mono text-[11px] uppercase tracking-[0.12em] text-[color:var(--ink)]">
                    <span className="transition-[letter-spacing] duration-200 ease-out group-hover/plan:tracking-[0.16em]">
                      Upgrade
                    </span>
                    <span
                      aria-hidden="true"
                      className="inline-block transition-transform duration-200 ease-out group-hover/plan:translate-x-1"
                    >
                      →
                    </span>
                  </div>
                )}
              </button>
            </PricingTableDialog>
          );
        })}
      </div>
    </section>
  );
}
