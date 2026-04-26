/**
 * `GET /api/chats/[id]` — full message history for one ChatSession.
 *
 * Tenant-scoped. The CHAT MODE rail uses this to resume a past
 * session: clicking a row updates `?cs=<id>`, MetaInboxLive fetches
 * here, and seeds useChat's setMessages so the conversation rehydrates
 * inline without a server round-trip or page reload.
 *
 * Returns the original UIMessage parts when present so the AI Elements
 * renderers (Tool*, Reasoning, MessageContent) reproduce tool calls
 * and rich payloads exactly as they streamed the first time.
 */

import { NextResponse } from 'next/server';

import { auth } from '@clerk/nextjs/server';
import { prisma } from '@sendero/database';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface PartsLike {
  type?: string;
  text?: string;
  [k: string]: unknown;
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    if (!id || typeof id !== 'string') {
      return NextResponse.json({ ok: false, error: 'invalid_id' }, { status: 400 });
    }

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

    const row = await prisma.chatSession.findFirst({
      where: { id, tenantId: tenant.id },
      select: {
        id: true,
        title: true,
        tripId: true,
        createdAt: true,
        updatedAt: true,
        messages: {
          orderBy: { createdAt: 'asc' },
          select: { id: true, role: true, content: true, parts: true, createdAt: true },
        },
      },
    });
    if (!row) {
      return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
    }

    // Reconstruct UIMessage[] for AI SDK's useChat. When `parts` was
    // stored, prefer it (preserves tool calls, reasoning, sources).
    // Fallback to a single text part built from the denormalized
    // `content` column for older rows that pre-date the parts column.
    const messages = row.messages.map(m => {
      const partsArray = Array.isArray(m.parts) ? (m.parts as PartsLike[]) : null;
      return {
        id: m.id,
        role: m.role as 'user' | 'assistant' | 'system',
        parts:
          partsArray && partsArray.length > 0
            ? partsArray
            : [{ type: 'text', text: m.content ?? '' }],
      };
    });

    return NextResponse.json({
      ok: true,
      session: {
        id: row.id,
        title: row.title,
        tripId: row.tripId,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      },
      messages,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown_error';
    console.error('[chats/[id]] failed:', message, err);
    const isProd = process.env.NODE_ENV === 'production';
    return NextResponse.json(
      {
        ok: false,
        error: 'internal_server_error',
        ...(isProd ? {} : { detail: message }),
      },
      { status: 500 }
    );
  }
}
