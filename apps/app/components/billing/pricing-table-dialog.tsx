'use client';

import type { ReactNode } from 'react';
import { PricingTable } from '@clerk/nextjs';

import type { PlanTier } from '@sendero/billing/plans';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@sendero/ui/dialog';

type Benefit = { label: string; value: string };
type Pitch = { headline: string; sub: string; benefits: Benefit[] };

const PLAN_PITCH: Record<Exclude<PlanTier, 'free'>, Pitch> = {
  basic: {
    headline: 'Get $5 in agent credits, auto-refilled every month.',
    sub: 'Credits fill your wallet on every billing cycle — no top-up needed. Stack them with the nano discount and every tool call costs less from day one.',
    benefits: [
      { value: '$5 / mo', label: 'Credits auto-filled' },
      { value: '15% off', label: 'Every agent call' },
      { value: '5% off', label: 'Booking take rate' },
      { value: '5 workspaces · 3 API keys', label: 'Team headroom' },
    ],
  },
  pro: {
    headline: '$25 in credits auto-filled. 30% off every call. Premium models.',
    sub: 'Pro fills your wallet with $25 of nanopayment credits each cycle — roughly 3,500 cached Sonnet turns. The 30% discount stacks on top, so heavy usage compounds into serious savings. GPT-5, Sonnet, and Opus 4.1 all unlock.',
    benefits: [
      { value: '$25 / mo', label: 'Credits auto-filled' },
      { value: '30% off', label: 'Every agent call' },
      { value: '10% off', label: 'Booking take rate' },
      { value: 'GPT-5 · Sonnet · Opus 4.1', label: 'Models unlocked' },
    ],
  },
  enterprise: {
    headline: '$250 in credits auto-filled. 50% off. Every model. No ceilings.',
    sub: 'Enterprise fills $250 of nanopayment credits each cycle — the largest auto-fill grant on the platform. Opus 4.7 and every future model unlock on day one. No spend cap ceiling, unlimited workspaces and API keys, plus SSO, white-label, and a custom SLA.',
    benefits: [
      { value: '$250 / mo', label: 'Credits auto-filled' },
      { value: '50% off', label: 'Every agent call' },
      { value: '15% off', label: 'Booking take rate' },
      { value: 'SSO · White label · SLA', label: 'Enterprise features' },
    ],
  },
};

type PricingTableDialogProps = {
  children: ReactNode;
  tier?: PlanTier;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

export function PricingTableDialog({
  children,
  tier,
  open,
  onOpenChange,
}: PricingTableDialogProps) {
  const pitch = tier && tier !== 'free' ? PLAN_PITCH[tier] : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="max-h-[90vh] max-w-5xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
            {pitch ? `Upgrade to ${tier}` : 'Plans'}
          </DialogTitle>
          <DialogDescription className="sr-only">
            Choose a plan for your organization. Subscription is managed through Clerk Billing.
          </DialogDescription>
        </DialogHeader>

        {pitch && (
          <div className="mb-1 overflow-hidden rounded-[var(--radius-md)] border border-[color:color-mix(in_oklab,var(--ink)_28%,transparent)]">
            <div className="bg-[color:color-mix(in_oklab,var(--ink)_6%,white)] px-5 py-4">
              <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:var(--ink)]">
                {tier}
              </div>
              <p className="mt-1.5 max-w-xl text-[15px] font-semibold leading-snug text-foreground">
                {pitch.headline}
              </p>
              <p className="mt-1.5 max-w-xl text-[13px] leading-relaxed text-muted-foreground">
                {pitch.sub}
              </p>
            </div>

            <div className="grid grid-cols-2 divide-x divide-y divide-[color:color-mix(in_oklab,var(--ink)_15%,transparent)] border-t border-[color:color-mix(in_oklab,var(--ink)_15%,transparent)] sm:grid-cols-4 sm:divide-y-0">
              {pitch.benefits.map(b => (
                <div key={b.label} className="flex flex-col gap-1 bg-white px-4 py-3">
                  <div
                    className="font-mono text-[14px] font-semibold text-[color:var(--ink)]"
                    style={{ fontVariantNumeric: 'tabular-nums' }}
                  >
                    {b.value}
                  </div>
                  <div className="font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground">
                    {b.label}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <PricingTable for="organization" />
      </DialogContent>
    </Dialog>
  );
}
