import { type NextRequest, NextResponse } from 'next/server';

import { auth } from '@clerk/nextjs/server';
import { Liveblocks } from '@liveblocks/node';
import { parseRoomId } from '@sendero/collaboration/server';
import { prisma } from '@sendero/database';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 15;

type FeedBody = {
  roomId?: string;
  feedId?: string;
  metadata?: Record<string, unknown>;
  message?: {
    role: 'user' | 'assistant' | 'system' | 'tool' | 'operator';
    content: string;
    status?: 'queued' | 'running' | 'needs_review' | 'done' | 'failed';
    toolName?: string;
    data?: Record<string, unknown>;
  };
};

export async function POST(req: NextRequest) {
  const { userId, orgId } = await auth();
  if (!userId || !orgId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const secret = process.env.LIVEBLOCKS_SECRET_KEY;
  if (!secret) return NextResponse.json({ error: 'liveblocks_not_configured' }, { status: 503 });

  const body = (await req.json().catch(() => null)) as FeedBody | null;
  if (!body?.roomId || !body.feedId) {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  const parsed = parseRoomId(body.roomId);
  if (!parsed) return NextResponse.json({ error: 'invalid_room' }, { status: 400 });

  const tenant = await prisma.tenant.findUnique({
    where: { clerkOrgId: orgId },
    select: { id: true },
  });
  if (!tenant) return NextResponse.json({ error: 'tenant_not_found' }, { status: 404 });
  if (tenant.id !== parsed.tenantId) {
    return NextResponse.json({ error: 'tenant_forbidden' }, { status: 403 });
  }

  const liveblocks = new Liveblocks({ secret }) as Liveblocks & {
    createFeed?: (args: {
      roomId: string;
      feedId: string;
      metadata?: Record<string, unknown>;
    }) => Promise<unknown>;
    createFeedMessage?: (args: {
      roomId: string;
      feedId: string;
      data: NonNullable<FeedBody['message']>;
    }) => Promise<unknown>;
  };

  if (!liveblocks.createFeed || !liveblocks.createFeedMessage) {
    return NextResponse.json(
      {
        error: 'liveblocks_feeds_sdk_unavailable',
        detail: '@liveblocks/node 2.24.4 is installed; Feeds require the newer SDK API.',
      },
      { status: 501 }
    );
  }

  await liveblocks.createFeed({
    roomId: body.roomId,
    feedId: body.feedId,
    metadata: {
      kind: 'agent_run',
      name: `Agent feed ${body.feedId.slice(0, 8)}`,
      ...body.metadata,
    },
  });

  if (body.message) {
    await liveblocks.createFeedMessage({
      roomId: body.roomId,
      feedId: body.feedId,
      data: body.message,
    });
  }

  return NextResponse.json({ ok: true, feedId: body.feedId });
}
