'use client';

/**
 * Pathname-driven page header for every `/dashboard/*` route.
 *
 * Mounted once in `app-chrome.tsx` directly under `DashboardBreadcrumb`,
 * so every page gets a consistent title + subtitle without each route
 * wiring its own. Copy lives in `DASHBOARD_PAGE_COPY` below; dynamic
 * segments (trip ids, invoice ids) match a small set of regexes and
 * fall back to a generic label.
 *
 * Action buttons are not hardcoded here. Pages publish transient
 * actions through `usePageHeaderStore` via the `<PageActions>` slot
 * (see `components/dashboard/page-actions.tsx`), so the title + action
 * row still renders on the same visual line when a page needs it.
 *
 * Returns `null` outside `/dashboard/*` and for routes that have their
 * own full-bleed hero (console, inbox) to avoid doubled headers.
 */

import { usePathname } from 'next/navigation';

import { usePageHeaderStore } from '@/components/dashboard/page-header-store';

type Copy = { title: string; description?: string };

const DASHBOARD_PAGE_COPY: Record<string, Copy> = {
  '/dashboard': {
    title: 'Home',
    description: 'Control workspace · recent trips, spend, and plan at a glance.',
  },
  '/dashboard/scan': {
    title: 'Scan document',
    description: 'Extract structured fields from receipts, invoices, and boarding passes.',
  },
  '/dashboard/trips': {
    title: 'Trips',
    description: 'Active and recent bookings across every channel.',
  },
  '/dashboard/caps': {
    title: 'Caps',
    description: 'Hard and soft nanopayment spend caps for this tenant.',
  },
  '/dashboard/spend': {
    title: 'Spend',
    description: 'Nanopayment spend, caps usage, and recent settlement batches.',
  },
  '/dashboard/billing/invoices': {
    title: 'Invoices',
    description: 'Platform + guest invoices for this tenant.',
  },
  '/dashboard/channels/whatsapp': {
    title: 'WhatsApp channel',
    description: 'Connect a Business number for white-label traveler DMs.',
  },
  '/dashboard/channels/slack': {
    title: 'Slack channel',
    description: 'Install approvals and employee travel DMs.',
  },
  '/dashboard/integrations/mcp': {
    title: 'API keys & MCP',
    description: 'One key powers HTTP dispatch, MCP server, and direct tool calls.',
  },
  '/dashboard/settings': {
    title: 'Settings',
    description: 'Workspace configuration.',
  },
  '/dashboard/settings/api-keys': {
    title: 'API keys',
    description: 'Credentials for external agents and MCP clients.',
  },
  '/dashboard/settings/branding': {
    title: 'Branding',
    description: 'Logo, colors, and tenant display name.',
  },
  '/dashboard/settings/org': {
    title: 'Organization',
    description: 'Members, roles, and workspace metadata.',
  },
  '/dashboard/passport': {
    title: 'Passport vault',
    description: 'Envelope-encrypted traveler documents for eligibility checks.',
  },
  '/dashboard/admin-retries': {
    title: 'Admin · Retries',
    description: 'Stuck-webhook sweep and manual replay controls.',
  },
};

const DYNAMIC_MATCHERS: Array<{ re: RegExp; copy: Copy }> = [
  {
    re: /^\/dashboard\/trips\/[^/]+$/,
    copy: { title: 'Trip detail', description: 'Guest invite, booking, and settlement state.' },
  },
  {
    re: /^\/dashboard\/inbox\/[^/]+$/,
    copy: { title: 'Trip inbox', description: 'Support thread tied to this trip.' },
  },
  {
    re: /^\/dashboard\/billing\/invoices\/[^/]+$/,
    copy: { title: 'Invoice', description: 'Invoice detail view.' },
  },
];

// Routes that own their own hero / full-bleed layout. The shared
// header stays off these to avoid two headers on one page.
const SUPPRESS_PREFIXES = [
  '/dashboard/console',
  '/dashboard/inbox',
  '/dashboard/scan',
  '/dashboard/passport',
  '/dashboard/trips',
  '/dashboard/billing/invoices',
  '/dashboard/spend',
  '/dashboard/caps',
  '/dashboard/channels',
];

function resolveCopy(pathname: string): Copy | null {
  const exact = DASHBOARD_PAGE_COPY[pathname];
  if (exact) return exact;
  for (const m of DYNAMIC_MATCHERS) {
    if (m.re.test(pathname)) return m.copy;
  }
  return null;
}

export function DashboardPageHeader() {
  const pathname = usePathname() ?? '';
  const actions = usePageHeaderStore(s => s.actions);

  if (!pathname.startsWith('/dashboard')) return null;
  if (SUPPRESS_PREFIXES.some(p => pathname === p || pathname.startsWith(p + '/'))) return null;

  const copy = resolveCopy(pathname);
  if (!copy) return null;

  return (
    <div className="px-6 pt-0">
      <div className="mb-4 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-normal">{copy.title}</h1>
          {copy.description ? (
            <p className="text-sm text-muted-foreground">{copy.description}</p>
          ) : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </div>
  );
}
