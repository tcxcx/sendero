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

    // Reconstruct UIMessage[] for AI SDK's useChat.
    //
    // Two shape mismatches to bridge:
    //  1. Roles — DB stores tool-results as standalone rows with
    //     role='tool', but convertToModelMessages (v6) only accepts
    //     user/assistant/system. We fold each tool-row onto the
    //     preceding assistant message.
    //  2. Parts — DB has v4-style `tool-call` + `tool-result` parts
    //     keyed by toolCallId; v6 expects ONE merged part of type
    //     `tool-${toolName}` carrying state, input, and output.
    //     We rewrite each call/result pair in-place.
    //
    // For older rows that pre-date the parts column, fall back to a
    // single text part built from the denormalized `content` column.
    type OutMsg = { id: string; role: 'user' | 'assistant' | 'system'; parts: PartsLike[] };
    const out: OutMsg[] = [];
    for (const m of row.messages) {
      const rawParts = Array.isArray(m.parts) ? (m.parts as PartsLike[]) : null;
      const parts =
        rawParts && rawParts.length > 0 ? rawParts : [{ type: 'text', text: m.content ?? '' }];

      if (m.role === 'tool') {
        const last = out[out.length - 1];
        if (last && last.role === 'assistant') {
          last.parts.push(...parts);
        }
        continue;
      }
      if (m.role !== 'user' && m.role !== 'assistant' && m.role !== 'system') {
        continue;
      }
      out.push({
        id: m.id,
        role: m.role as 'user' | 'assistant' | 'system',
        parts,
      });
    }

    // Pass 2 — merge legacy tool-call / tool-result parts into v6
    // `tool-${name}` parts. Index by toolCallId so out-of-order pairs
    // still resolve. A tool-call with no matching tool-result becomes
    // a part with state='input-available' (the model treats it as a
    // pending call); operators almost never hit this because every
    // assistant turn writes both the call and its result before the
    // row is persisted.
    type CallLike = { toolCallId?: unknown; toolName?: unknown; input?: unknown };
    type ResultLike = { toolCallId?: unknown; toolName?: unknown; output?: unknown };
    for (const msg of out) {
      const merged: PartsLike[] = [];
      const seenCallIds = new Set<string>();
      // Map tool-result parts by toolCallId for lookup.
      const resultsById = new Map<string, ResultLike>();
      for (const p of msg.parts) {
        if (p.type === 'tool-result') {
          const id = (p as ResultLike).toolCallId;
          if (typeof id === 'string') resultsById.set(id, p as ResultLike);
        }
      }
      for (const p of msg.parts) {
        if (p.type === 'tool-call') {
          const call = p as CallLike;
          const id = typeof call.toolCallId === 'string' ? call.toolCallId : null;
          const name = typeof call.toolName === 'string' ? call.toolName : null;
          if (!id || !name) continue;
          seenCallIds.add(id);
          const result = resultsById.get(id);
          merged.push({
            type: `tool-${name}`,
            toolCallId: id,
            input: call.input ?? {},
            ...(result
              ? { state: 'output-available', output: result.output }
              : { state: 'input-available' }),
          });
          continue;
        }
        if (p.type === 'tool-result') {
          const id = (p as ResultLike).toolCallId;
          if (typeof id === 'string' && seenCallIds.has(id)) continue;
          // Orphan result (call lives on a different message) — drop it.
          continue;
        }
        merged.push(p);
      }
      msg.parts = merged;
    }
    const messages = out;

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
