'use client';

/**
 * OperatorOnboardingCard — sidebar B2B onboarding checklist.
 *
 * User story:
 *   "As a corporate or agency operator who just provisioned a Sendero
 *    workspace, I want one glance at what's still required to get my
 *    team booking trips, so I can complete setup without hunting
 *    through every settings page."
 *
 * Surface:
 *   • Sits between the Channels nav group and the footer Docs · MCP /
 *     Help · Support items (mounted in `app-sidebar.tsx`).
 *   • Compact "egg" pill in the rail: small icon + progress chip.
 *     Hover opens the full checklist in a HoverCard (escapes the
 *     sidebar overflow via Portal).
 *   • Auto-hides once everything in the operator's plan tier is done,
 *     so the rail stays quiet for mature workspaces.
 *
 * Per-plan filtering:
 *   • Free:      core setup (team, channels, caps, sandbox key)
 *   • Basic+:    + production API key
 *   • Pro+:      + MCP wiring
 *   • Enterprise:+ whitelabel branding
 *
 * Per-operator state (best-effort, client-side):
 *   • org existence + member count come from Clerk's `useOrganization`.
 *   • items without a cheap signal use a localStorage flag so the
 *     operator can manually mark them done without round-tripping a DB
 *     write — wire to real telemetry in a follow-up.
 */

import { useEffect, useMemo, useState } from 'react';

import Link from 'next/link';

import { useAuth, useOrganization } from '@clerk/nextjs';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@sendero/ui/hover-card';
import { Check, ListChecks } from 'lucide-react';

import { SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar';

const STORAGE_KEY = 'sendero:operator-onboarding:dismissed';

type ChecklistItem = {
  id: string;
  label: string;
  detail: string;
  href: string;
  /** Minimum plan that surfaces this item. */
  minPlan: 'free' | 'basic' | 'pro' | 'enterprise';
  /** Optional auto-detection. Returns true when the step is already done. */
  isDone?: (ctx: OperatorContext) => boolean;
};

type OperatorContext = {
  organizationName: string | null;
  membersCount: number;
  hasOrg: boolean;
};

const PLAN_RANK = { free: 0, basic: 1, pro: 2, enterprise: 3 } as const;

const ITEMS: ChecklistItem[] = [
  {
    id: 'org',
    label: 'Create your organization',
    detail: 'Set the workspace your team will share.',
    href: '/dashboard/settings/org',
    minPlan: 'free',
    isDone: ctx => ctx.hasOrg,
  },
  {
    id: 'team',
    label: 'Invite your team',
    detail: 'Add at least one teammate so trips can be reviewed by a human.',
    href: '/dashboard/settings/org',
    minPlan: 'free',
    isDone: ctx => ctx.membersCount > 1,
  },
  {
    id: 'caps',
    label: 'Set spend caps',
    detail: 'Per-traveler and per-trip ceilings the agent must respect.',
    href: '/dashboard/caps',
    minPlan: 'free',
  },
  {
    id: 'whatsapp',
    label: 'Connect WhatsApp',
    detail: 'White-label inbound conversations from travelers.',
    href: '/dashboard/channels/whatsapp',
    minPlan: 'free',
  },
  {
    id: 'slack',
    label: 'Connect Slack',
    detail: 'Approvals + employee travel DMs.',
    href: '/dashboard/channels/slack',
    minPlan: 'free',
  },
  {
    id: 'apikey',
    label: 'Mint a production API key',
    detail: 'For programmatic dispatch from your stack.',
    href: '/dashboard/settings/api-keys',
    minPlan: 'basic',
  },
  {
    id: 'mcp',
    label: 'Wire MCP into your host',
    detail: 'Expose your Sendero tools to Claude Desktop, Cursor, or Zed.',
    href: '/dashboard/integrations/mcp',
    minPlan: 'pro',
  },
  {
    id: 'whitelabel',
    label: 'Whitelabel branding',
    detail: 'Custom logo + domain on traveler-facing surfaces.',
    href: '/dashboard/settings/branding',
    minPlan: 'enterprise',
  },
];

function currentPlan(has: ((q: { plan: string }) => boolean) | undefined): keyof typeof PLAN_RANK {
  if (!has) return 'free';
  if (has({ plan: 'enterprise' })) return 'enterprise';
  if (has({ plan: 'pro' })) return 'pro';
  if (has({ plan: 'basic' })) return 'basic';
  return 'free';
}

function readDismissed(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

function writeDismissed(set: Set<string>) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...set]));
  } catch {
    /* ignore quota errors */
  }
}

export function OperatorOnboardingCard() {
  const { has, isLoaded } = useAuth();
  const { organization } = useOrganization();
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());

  // Hydrate dismissed set client-side; SSR sees empty.
  useEffect(() => {
    setDismissed(readDismissed());
  }, []);

  const ctx: OperatorContext = useMemo(
    () => ({
      organizationName: organization?.name ?? null,
      membersCount: organization?.membersCount ?? 1,
      hasOrg: !!organization,
    }),
    [organization]
  );

  const plan = isLoaded ? currentPlan(has) : 'free';
  const planRank = PLAN_RANK[plan];

  const visibleItems = useMemo(
    () => ITEMS.filter(item => PLAN_RANK[item.minPlan] <= planRank),
    [planRank]
  );

  const itemsWithStatus = useMemo(
    () =>
      visibleItems.map(item => ({
        ...item,
        done: dismissed.has(item.id) || (item.isDone ? item.isDone(ctx) : false),
      })),
    [visibleItems, dismissed, ctx]
  );

  const completed = itemsWithStatus.filter(i => i.done).length;
  const total = itemsWithStatus.length;
  const allDone = completed >= total && total > 0;

  const toggleManual = (id: string) => {
    setDismissed(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      writeDismissed(next);
      return next;
    });
  };

  // Once every applicable item is done, the rail stays quiet.
  if (allDone) return null;

  return (
    <HoverCard openDelay={120} closeDelay={120}>
      <HoverCardTrigger asChild>
        <SidebarMenuItem>
          <SidebarMenuButton
            asChild
            size="sm"
            tooltip={`Setup ${completed}/${total}`}
            className="flex w-full items-center justify-center gap-2 rounded-none px-3.5 py-6 font-mono text-[11px] uppercase tracking-[0.12em] text-foreground transition-[background-color,color] duration-120 hover:bg-[color:color-mix(in_oklab,var(--ink)_6%,transparent)] hover:text-[color:var(--ink)] group-data-[collapsible=icon]:!size-8 group-data-[collapsible=icon]:!p-0 group-data-[collapsible=icon]:!mx-auto"
          >
            <Link
              href="/dashboard/settings/org"
              aria-label={`Operator setup — ${completed} of ${total} done`}
            >
              <ListChecks className="size-4 text-[color:var(--ink)]" />
              <span className="group-data-[collapsible=icon]:hidden">Setup</span>
              <span
                aria-hidden
                className="rounded-full border border-[color:color-mix(in_oklab,var(--ink)_22%,transparent)] bg-[color:var(--tint-vermillion-soft)] px-1.5 py-0.5 text-[9px] tabular-nums text-[color:var(--ink)] group-data-[collapsible=icon]:hidden"
              >
                {completed}/{total}
              </span>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </HoverCardTrigger>
      <HoverCardContent
        side="right"
        align="start"
        sideOffset={14}
        collisionPadding={16}
        className="z-[60] w-[340px] p-0 border-[color:color-mix(in_oklab,var(--ink)_22%,transparent)] bg-[color:var(--bg-elev)] shadow-[var(--shadow-md)]"
      >
        <div className="flex items-center gap-3 px-4 pt-4 pb-3">
          <div className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-[color:var(--tint-vermillion-soft)] text-[color:var(--ink)]">
            <ListChecks className="size-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-[color:var(--text-dim)]">
              Operator setup
            </div>
            <div className="text-sm font-medium text-[color:var(--text)]">
              {ctx.organizationName ?? 'Your workspace'}
            </div>
          </div>
          <span className="shrink-0 rounded-full border border-[color:color-mix(in_oklab,var(--ink)_22%,transparent)] bg-[color:var(--tint-vermillion-soft)] px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.14em] text-[color:var(--ink)] tabular-nums">
            {completed}/{total}
          </span>
        </div>

        <div className="border-t border-[color:color-mix(in_oklab,var(--ink)_12%,transparent)] px-2 py-1">
          <ul className="flex flex-col">
            {itemsWithStatus.map(item => (
              <li key={item.id}>
                <div className="group/onb flex items-start gap-2.5 rounded-md px-2 py-2 transition-colors hover:bg-[color:color-mix(in_oklab,var(--ink)_5%,transparent)]">
                  <button
                    type="button"
                    onClick={() => toggleManual(item.id)}
                    aria-label={
                      item.done ? `Mark ${item.label} not done` : `Mark ${item.label} done`
                    }
                    className={
                      'mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-[4px] border transition-colors ' +
                      (item.done
                        ? 'border-[color:var(--accent-green)] bg-[color:var(--accent-green)] text-white'
                        : 'border-[color:color-mix(in_oklab,var(--ink)_30%,transparent)] bg-transparent text-transparent hover:border-[color:var(--ink)]')
                    }
                  >
                    <Check className="size-3" strokeWidth={3} />
                  </button>
                  <Link href={item.href} className="min-w-0 flex-1" prefetch={false}>
                    <div
                      className={
                        'text-xs font-medium leading-tight transition-colors ' +
                        (item.done
                          ? 'text-[color:var(--text-dim)] line-through decoration-[color:color-mix(in_oklab,var(--text-dim)_50%,transparent)]'
                          : 'text-[color:var(--text)] group-hover/onb:text-[color:var(--ink)]')
                      }
                    >
                      {item.label}
                    </div>
                    <div className="mt-0.5 text-[11px] leading-snug text-[color:var(--text-dim)]">
                      {item.detail}
                    </div>
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <div className="border-t border-[color:color-mix(in_oklab,var(--ink)_12%,transparent)] px-4 py-2.5 text-center font-mono text-[10px] uppercase tracking-[0.12em] text-[color:var(--text-faint)]">
          Plan: <span className="text-[color:var(--ink)]">{plan}</span> · checks tailored per tier
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}
