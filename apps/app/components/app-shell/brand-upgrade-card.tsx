'use client';

import Image from 'next/image';
import Link from 'next/link';

import { useAuth, useClerk, useOrganization } from '@clerk/nextjs';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@sendero/ui/hover-card';

const SENDERO_LOGO_SRC = '/brand/logo-masters/clean/sendero_icon_vermilion_clean_2048.png';

const PLAN_ORDER = ['enterprise', 'pro', 'basic', 'free'] as const;
type PlanSlug = (typeof PLAN_ORDER)[number];

function currentPlanSlug(has: ((q: { plan: string }) => boolean) | undefined): PlanSlug {
  if (!has) return 'free';
  for (const slug of PLAN_ORDER) {
    if (has({ plan: slug })) return slug;
  }
  return 'free';
}

const PLAN_LABEL: Record<PlanSlug, string> = {
  free: 'Free',
  basic: 'Basic',
  pro: 'Pro',
  enterprise: 'Enterprise',
};

export function BrandUpgradeCard() {
  const { has, isLoaded } = useAuth();
  const { organization } = useOrganization();
  const { openOrganizationProfile } = useClerk();

  const plan = isLoaded ? currentPlanSlug(has) : 'free';
  const isEnterprise = plan === 'enterprise';
  const orgName = organization?.name ?? 'Sendero';

  // Whitelabel on Enterprise: swap the Sendero mark for the org avatar
  // when present. Non-enterprise plans always see the Sendero mark.
  const brandImage =
    isEnterprise && organization?.imageUrl ? organization.imageUrl : SENDERO_LOGO_SRC;
  const brandName = isEnterprise ? orgName : 'Sendero';
  const platformKicker = isEnterprise ? `${orgName} · platform` : 'Sendero Platform';

  const year = new Date().getFullYear();

  return (
    <HoverCard openDelay={120} closeDelay={80}>
      <HoverCardTrigger asChild>
        <Link
          href="/dashboard"
          aria-label={`${brandName} home`}
          className="flex w-full flex-col items-center pt-3 pb-2 cursor-pointer transition-colors hover:bg-[color:color-mix(in_oklab,var(--ink)_6%,transparent)] group-data-[collapsible=icon]:py-1"
        >
          <Image
            src={brandImage}
            alt=""
            width={112}
            height={112}
            className="h-16 w-16 object-contain transition-[width,height] duration-200 group-data-[collapsible=icon]:h-8 group-data-[collapsible=icon]:w-8"
          />
          {/* Wordmark + legal — part of the same hover + click target as
              the image. Hidden when the sidebar is collapsed to icon-only. */}
          <span className="-mt-1 flex flex-col items-center group-data-[collapsible=icon]:hidden">
            <span
              aria-hidden
              className="text-[22px] leading-none tracking-[-0.01em] text-[color:var(--ink)]"
              style={{ fontFamily: 'var(--font-display, var(--font-serif, serif))' }}
            >
              Sendero
            </span>
            <span
              className="mt-0.5 text-center font-mono text-[8.5px] uppercase tracking-[0.18em] text-[color:var(--text-faint)]"
              aria-label={`Fantasmita LLC, registered trademark, ${year}`}
            >
              Fantasmita LLC
              <span className="mx-1" aria-hidden>
                ®
              </span>
              {year}
            </span>
          </span>
        </Link>
      </HoverCardTrigger>
      <HoverCardContent
        side="right"
        align="end"
        sideOffset={14}
        collisionPadding={16}
        className="z-[60] w-80 p-0 border-[color:color-mix(in_oklab,var(--ink)_22%,transparent)] bg-[color:var(--bg-elev)] shadow-[var(--shadow-md)]"
      >
        <div className="flex items-center gap-3 px-4 pt-4 pb-3">
          <Image
            src={brandImage}
            alt=""
            width={36}
            height={36}
            className="h-9 w-9 object-contain rounded-md"
          />
          <div className="min-w-0 flex-1">
            <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-[color:var(--text-dim)]">
              {platformKicker}
            </div>
            <div className="truncate text-sm font-medium text-[color:var(--text)]" title={orgName}>
              {orgName}
            </div>
          </div>
          <span className="shrink-0 rounded-full border border-[color:color-mix(in_oklab,var(--ink)_22%,transparent)] bg-[color:var(--tint-vermillion-soft)] px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.14em] text-[color:var(--ink)]">
            {PLAN_LABEL[plan]}
          </span>
        </div>

        <div className="border-t border-[color:color-mix(in_oklab,var(--ink)_12%,transparent)] px-4 py-3">
          {isEnterprise ? (
            <p className="text-xs leading-relaxed text-[color:var(--text-dim)]">
              <strong className="text-[color:var(--text)]">{orgName}</strong> is on the Enterprise
              plan. Whitelabel branding, SSO, custom SLA, and audit log export are enabled.
            </p>
          ) : (
            <>
              <p className="mb-3 text-xs leading-relaxed text-[color:var(--text-dim)]">
                Upgrade to <strong className="text-[color:var(--text)]">Enterprise</strong> to
                whitelabel the platform with your brand, enable SSO/SAML, custom SLA, and audit log
                export.
              </p>
              <ul className="mb-3 space-y-1.5 font-mono text-[10px] uppercase tracking-[0.08em] text-[color:var(--text-dim)]">
                <li className="flex items-center gap-2">
                  <span className="h-1 w-1 rounded-full bg-[color:var(--ink)]" />
                  Whitelabel branding + custom domain
                </li>
                <li className="flex items-center gap-2">
                  <span className="h-1 w-1 rounded-full bg-[color:var(--ink)]" />
                  SSO / SAML + audit log export
                </li>
                <li className="flex items-center gap-2">
                  <span className="h-1 w-1 rounded-full bg-[color:var(--ink)]" />
                  50% off nanopayments · 15% off take-rate
                </li>
              </ul>
            </>
          )}
        </div>

        {!isEnterprise && (
          <div className="border-t border-[color:color-mix(in_oklab,var(--ink)_12%,transparent)] px-4 py-3">
            <button
              type="button"
              onClick={() => openOrganizationProfile()}
              className="flex w-full items-center justify-center gap-2 rounded-md bg-[color:var(--ink)] px-3 py-2 font-mono text-[11px] uppercase tracking-[0.12em] text-[color:var(--bg-elev)] transition-opacity hover:opacity-90"
            >
              Upgrade →
            </button>
          </div>
        )}
      </HoverCardContent>
    </HoverCard>
  );
}
