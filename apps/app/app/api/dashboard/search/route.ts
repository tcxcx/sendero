/**
 * Dashboard command-palette search. Tenant-scoped ILIKE across trips,
 * invoices, bookings, caps, channels, and API keys. No external search
 * service — Neon Postgres handles it in <50ms for dashboard-sized data.
 *
 * Nav routes are matched client-side in search-palette.tsx (constant
 * list, no DB round-trip needed).
 */

import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { prisma } from '@sendero/database';

export const dynamic = 'force-dynamic';

export type SearchResult = {
  id: string;
  title: string;
  subtitle?: string;
  href: string;
};

export type SearchResponse = {
  trips: SearchResult[];
  invoices: SearchResult[];
  bookings: SearchResult[];
  channels: SearchResult[];
};

const EMPTY: SearchResponse = {
  trips: [],
  invoices: [],
  bookings: [],
  channels: [],
};

export async function GET(req: Request) {
  const { orgId } = await auth();
  if (!orgId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const tenant = await prisma.tenant.findUnique({ where: { clerkOrgId: orgId } });
  if (!tenant) return NextResponse.json(EMPTY);

  const url = new URL(req.url);
  // Cap q length to bound ILIKE cost — even authed callers shouldn't be
  // able to trigger a 1MB substring scan against every row.
  const q = (url.searchParams.get('q') ?? '').trim().slice(0, 100);
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 6), 1), 10);

  if (q.length < 1) return NextResponse.json(EMPTY);

  const tenantId = tenant.id;

  const [trips, invoices, bookings, channels] = await Promise.all([
    prisma.trip.findMany({
      where: {
        tenantId,
        OR: [
          { id: { contains: q, mode: 'insensitive' } },
          { intent: { path: ['tripSummary'], string_contains: q } as never },
          { intent: { path: ['origin'], string_contains: q } as never },
          { intent: { path: ['destination'], string_contains: q } as never },
          { metadata: { path: ['tripSummary'], string_contains: q } as never },
        ],
      },
      orderBy: { updatedAt: 'desc' },
      take: limit,
      select: { id: true, status: true, intent: true, metadata: true, updatedAt: true },
    }),
    prisma.invoice.findMany({
      where: {
        tenantId,
        OR: [
          { number: { contains: q, mode: 'insensitive' } },
          { toName: { contains: q, mode: 'insensitive' } },
          { toEmail: { contains: q, mode: 'insensitive' } },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: { id: true, number: true, toName: true, status: true },
    }),
    prisma.booking.findMany({
      where: {
        tenantId,
        OR: [
          { pnr: { contains: q, mode: 'insensitive' } },
          { duffelOrderId: { contains: q, mode: 'insensitive' } },
          { externalId: { contains: q, mode: 'insensitive' } },
          { id: { contains: q, mode: 'insensitive' } },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: { id: true, tripId: true, pnr: true, duffelOrderId: true, status: true },
    }),
    prisma.channelIdentity.findMany({
      where: {
        tenantId,
        OR: [
          { username: { contains: q, mode: 'insensitive' } },
          { externalUserId: { contains: q, mode: 'insensitive' } },
          { businessScopedUserId: { contains: q, mode: 'insensitive' } },
        ],
      },
      take: limit,
      select: {
        id: true,
        kind: true,
        username: true,
        externalUserId: true,
        businessScopedUserId: true,
      },
    }),
  ]);

  const response: SearchResponse = {
    trips: trips.map(trip => {
      const summary =
        getJsonString(trip.metadata, 'tripSummary') ??
        getJsonString(trip.intent, 'tripSummary') ??
        trip.id.slice(0, 12);
      return {
        id: trip.id,
        title: summary,
        subtitle: `${trip.status} · ${timeAgo(trip.updatedAt)}`,
        href: `/dashboard/trips/${trip.id}`,
      };
    }),
    invoices: invoices.map(inv => ({
      id: inv.id,
      title: inv.number,
      subtitle: inv.toName || inv.status,
      href: `/dashboard/billing/invoices/${inv.id}`,
    })),
    bookings: bookings.map(b => ({
      id: b.id,
      title: b.pnr ?? b.duffelOrderId ?? b.id.slice(0, 12),
      subtitle: b.status,
      href: b.tripId ? `/dashboard/trips/${b.tripId}` : `/dashboard/trips`,
    })),
    channels: channels.map(ch => ({
      id: ch.id,
      title: ch.username ?? ch.externalUserId ?? ch.businessScopedUserId ?? ch.kind,
      subtitle: ch.kind,
      href: channelHref(ch.kind),
    })),
  };

  return NextResponse.json(response);
}

function getJsonString(json: unknown, key: string): string | null {
  if (json && typeof json === 'object' && key in (json as Record<string, unknown>)) {
    const value = (json as Record<string, unknown>)[key];
    return typeof value === 'string' && value.length > 0 ? value : null;
  }
  return null;
}

/**
 * Explicit ChannelKind → settings-page mapping. A fallback to
 * `/dashboard/channels` prevents new kinds from silently landing on the
 * Slack page (previous `ch.kind === 'whatsapp' ? 'whatsapp' : 'slack'`
 * misrouted `email` / future kinds).
 */
function channelHref(kind: string): string {
  switch (kind) {
    case 'whatsapp':
      return '/dashboard/channels/whatsapp';
    case 'slack':
      return '/dashboard/channels/slack';
    default:
      return '/dashboard/channels';
  }
}

function timeAgo(date: Date): string {
  const sec = (Date.now() - date.getTime()) / 1000;
  if (sec < 60) return 'just now';
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  if (sec < 2592000) return `${Math.floor(sec / 86400)}d ago`;
  return `${Math.floor(sec / 2592000)}mo ago`;
}
