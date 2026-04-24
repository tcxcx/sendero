import { PricingTable } from '@clerk/nextjs';
import { env } from '@sendero/env';

import { PLANS, type PlanTier } from '@sendero/billing/plans';

import { PageHeader } from '@/components/app-shell/page-header';

export const metadata = { title: 'Plans · Sendero' };

export default function PlansPage() {
  const order: PlanTier[] = ['free', 'basic', 'pro', 'enterprise'];
  const isBeta = env.isTestnetBeta();

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Plans & pricing"
        description="One workspace is free. Paid plans unlock more workspaces, production API keys, and discounted nanopayments."
      />

      {isBeta ? (
        <section className="rounded-[var(--radius-lg)] border border-[color:color-mix(in_oklab,var(--ink)_35%,transparent)] bg-[color:color-mix(in_oklab,var(--ink)_5%,white)] p-5">
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between md:gap-6">
            <div>
              <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-[color:var(--ink)]">
                Testnet beta · no charges
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                Sendero runs on Arc Testnet while Circle finalizes mainnet. Plan subscriptions are
                configured end-to-end but <strong>Clerk is in development mode</strong> — no real
                cards are charged. Pick a plan now to preview feature gating; we&apos;ll promote you
                to the same plan on production billing the day Arc mainnet ships.
              </p>
            </div>
            <a
              href="https://docs.arc.network"
              target="_blank"
              rel="noreferrer"
              className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[color:var(--ink)] px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-white hover:bg-[color:color-mix(in_oklab,var(--ink)_92%,black)]"
            >
              Arc roadmap ↗
            </a>
          </div>
        </section>
      ) : null}

      <section className="grid gap-4 md:grid-cols-4">
        {order.map(tier => {
          const p = PLANS[tier];
          return (
            <div
              key={tier}
              className="flex flex-col gap-3 rounded-[var(--radius-lg)] bg-white p-5 shadow-[var(--shadow-sm)]"
            >
              <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                {p.tier}
              </div>
              <div className="text-2xl font-semibold tracking-tight">
                {p.tier === 'enterprise'
                  ? 'Custom'
                  : p.monthlyUsd === 0
                    ? 'Free'
                    : `$${p.monthlyUsd}/mo`}
              </div>
              {p.annualMonthlyUsd !== null && p.tier !== 'enterprise' ? (
                <div className="text-xs text-muted-foreground">
                  or ${p.annualMonthlyUsd}/mo billed annually
                </div>
              ) : null}
              <ul className="flex flex-col gap-1 text-sm text-muted-foreground">
                <li>
                  {p.workspaceLimit === null
                    ? 'Unlimited workspaces'
                    : `${p.workspaceLimit} workspace${p.workspaceLimit === 1 ? '' : 's'}`}
                </li>
                <li>
                  {p.productionApiKeyLimit === null
                    ? 'Unlimited API keys'
                    : p.productionApiKeyLimit === 0
                      ? 'Sandbox API key only'
                      : `${p.productionApiKeyLimit} production API keys`}
                </li>
                <li>
                  {p.nanopaymentDiscountBps > 0
                    ? `${p.nanopaymentDiscountBps / 100}% off nanopayments`
                    : 'Baseline nanopayments'}
                </li>
                <li>
                  {p.bookingTakeRateDiscountBps > 0
                    ? `${p.bookingTakeRateDiscountBps / 100}% off booking take rate`
                    : 'Baseline booking take rate'}
                </li>
              </ul>
            </div>
          );
        })}
      </section>

      <section className="flex flex-col gap-3 rounded-[var(--radius-lg)] bg-white p-6 shadow-[var(--shadow-md)]">
        <h3 className="text-[15px] font-semibold tracking-normal text-foreground">Choose a plan</h3>
        <p className="text-sm text-muted-foreground">
          Subscription and feature access are managed through Clerk. Enterprise is by invitation —{' '}
          <a className="underline" href="mailto:sales@sendero.travel">
            talk to sales
          </a>
          .
        </p>
        <PricingTable for="organization" />
      </section>
    </div>
  );
}
