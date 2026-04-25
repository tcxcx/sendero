/**
 * `GET /api/chats/list` — operator's recent ChatSession list for the
 * CHAT MODE tab in MetaInbox.
 *
 * Tenant-scoped. Defaults to the calling operator's own sessions but
 * accepts `?scope=tenant` for an org-wide view (useful for handoffs).
 * Limit caps at 50 — the rail is for last-N recall, not full audit.
 */

import { NextResponse } from 'next/server';

import { auth } from '@clerk/nextjs/server';
import { prisma } from '@sendero/database';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const session = await auth();
    if (!session.orgId) {
      return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
    }

    const tenant = await prisma.tenant.findUnique({
      where: { clerkOrgId: session.orgId },
      select: { id: true },
    });
    if (!tenant) {
      return NextResponse.json({ ok: false, error: 'tenant_not_found' }, { status: 404 });
    }

    const url = new URL(req.url);
    const scope = url.searchParams.get('scope') === 'tenant' ? 'tenant' : 'mine';
    const limit = Math.min(50, Math.max(1, Number(url.searchParams.get('limit') ?? 30)));

    let userId: string | null = null;
    if (session.userId) {
      const u = await prisma.user.findUnique({
        where: { clerkUserId: session.userId },
        select: { id: true },
      });
      userId = u?.id ?? null;
    }

    // Defensive: if the Prisma client doesn't have chatSession yet
    // (dev server holding a stale client), return an empty list with
    // a hint instead of 500'ing. The dev server restart picks up the
    // generated client; production deploys regen on every build.
    const client = prisma as typeof prisma & { chatSession?: typeof prisma.chatSession };
    if (!client.chatSession) {
      console.warn('[chats/list] Prisma client missing chatSession — restart the dev server.');
      return NextResponse.json({
        ok: true,
        sessions: [],
        warning: 'prisma_client_stale',
      });
    }

    const sessions = await prisma.chatSession.findMany({
      where: {
        tenantId: tenant.id,
        ...(scope === 'mine' && userId ? { userId } : {}),
      },
      orderBy: { updatedAt: 'desc' },
      take: limit,
      select: {
        id: true,
        title: true,
        tripId: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { messages: true } },
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { content: true, role: true, createdAt: true },
        },
      },
    });

    return NextResponse.json({
      ok: true,
      sessions: sessions.map(s => ({
        id: s.id,
        title: s.title ?? 'Untitled chat',
        tripId: s.tripId,
        messageCount: s._count.messages,
        lastMessage: s.messages[0]
          ? {
              role: s.messages[0].role,
              content: (s.messages[0].content ?? '').slice(0, 140),
              at: s.messages[0].createdAt.toISOString(),
            }
          : null,
        createdAt: s.createdAt.toISOString(),
        updatedAt: s.updatedAt.toISOString(),
      })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown_error';
    console.error('[chats/list] failed:', message, err);
    const isProd = process.env.NODE_ENV === 'production';
    return NextResponse.json(
      {
        ok: false,
        error: 'internal_server_error',
        // Surface the message in dev so we can see what's broken
        // without trawling server logs. Hidden in prod.
        ...(isProd ? {} : { detail: message }),
      },
      { status: 500 }
    );
  }
}
