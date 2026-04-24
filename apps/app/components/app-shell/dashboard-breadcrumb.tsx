'use client';

import { Fragment, useEffect, useState } from 'react';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@sendero/ui/breadcrumb';

const LABELS: Record<string, string> = {
  dashboard: 'Dashboard',
  console: 'Console',
  inbox: 'Inbox',
  trips: 'Trips',
  ops: 'Ops',
  caps: 'Caps',
  spend: 'Spend',
  billing: 'Billing',
  settings: 'Settings',
  channels: 'Channels',
  whatsapp: 'WhatsApp',
  slack: 'Slack',
  integrations: 'Integrations',
  mcp: 'MCP',
  profile: 'Profile',
  'admin-retries': 'Admin · Retries',
  invoices: 'Invoices',
  branding: 'Branding',
  org: 'Organization',
  'api-keys': 'API keys',
  plans: 'Plans',
};

const TRIP_PARENT_SEGMENTS = new Set(['inbox', 'trips']);
// Matches cuid, uuid, 0x-hex, or any long opaque-looking id. Known labels
// from LABELS never reach this check.
const TRIP_ID_RE = /^(0x[a-f0-9]{20,}|c[a-z0-9]{20,30}|[a-z0-9-]{16,})$/i;

// Module-scope cache so PNRs survive navigation + re-renders.
const pnrCache = new Map<string, string | null>();

function pretty(seg: string): string {
  if (LABELS[seg]) return LABELS[seg];
  if (/^[a-z0-9]{12,}$/i.test(seg)) return `${seg.slice(0, 6)}…`;
  return seg.charAt(0).toUpperCase() + seg.slice(1).replace(/-/g, ' ');
}

/**
 * Returns the tripId from a dashboard path, or null if the path isn't
 * a trip detail view. Matches /dashboard/{inbox,trips}/{cuid}[/...].
 */
function tripIdFromPath(segs: string[]): string | null {
  if (segs[0] !== 'dashboard' || segs.length < 3) return null;
  const parent = segs[1];
  const id = segs[2];
  if (!TRIP_PARENT_SEGMENTS.has(parent)) return null;
  if (LABELS[id]) return null;
  if (!TRIP_ID_RE.test(id)) return null;
  return id;
}

export function DashboardBreadcrumb() {
  const pathname = usePathname() ?? '';
  const segs = pathname.split('/').filter(Boolean);
  const tripId = tripIdFromPath(segs);

  const [pnr, setPnr] = useState<string | null>(tripId ? (pnrCache.get(tripId) ?? null) : null);

  useEffect(() => {
    if (!tripId) return;
    if (pnrCache.has(tripId)) {
      setPnr(pnrCache.get(tripId) ?? null);
      return;
    }
    let cancelled = false;
    fetch(`/api/trips/${tripId}/pnr`, { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null))
      .then(j => {
        if (cancelled) return;
        const next = (j?.pnr as string | null | undefined) ?? null;
        pnrCache.set(tripId, next);
        setPnr(next);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [tripId]);

  if (!pathname.startsWith('/dashboard')) return null;
  if (segs.length <= 1) return null;

  const crumbs = segs.map((seg, i) => {
    const href = '/' + segs.slice(0, i + 1).join('/');
    const isTripSeg = tripId === seg;
    const label = isTripSeg && pnr ? `PNR ${pnr}` : pretty(seg);
    return { label, href, last: i === segs.length - 1 };
  });

  return (
    <div className="dashboard-crumbs">
      <Breadcrumb>
        <BreadcrumbList className="gap-1 text-[10px] tracking-[0.08em] uppercase font-[family-name:var(--font-mono)]">
          {crumbs.map((c, i) => (
            <Fragment key={c.href}>
              <BreadcrumbItem>
                {c.last ? (
                  <BreadcrumbPage className="text-[color:var(--text)] font-medium">
                    {c.label}
                  </BreadcrumbPage>
                ) : (
                  <BreadcrumbLink asChild>
                    <Link
                      href={c.href}
                      className="text-[color:var(--text-dim)] hover:text-[color:var(--text)] transition-colors"
                    >
                      {c.label}
                    </Link>
                  </BreadcrumbLink>
                )}
              </BreadcrumbItem>
              {i < crumbs.length - 1 && (
                <BreadcrumbSeparator className="[&>svg]:size-3 text-[color:var(--text-faint)]" />
              )}
            </Fragment>
          ))}
        </BreadcrumbList>
      </Breadcrumb>
    </div>
  );
}
