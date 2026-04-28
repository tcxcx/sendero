/**
 * POST /api/agent/feedback
 *
 * Operator-facing thumbs up / thumbs down for an agent reply. Emits a
 * Langfuse `user-feedback` BOOLEAN score on the trace produced by the
 * `/api/agent/chat` turn.
 *
 * The trace id flows from server → client → server:
 *   1. /api/agent/chat surfaces the live OTel trace id via
 *      `messageMetadata({ part: 'start' })` as `senderoTraceId`.
 *   2. The agent-chat client reads it from `message.metadata.senderoTraceId`.
 *   3. The thumbs button POSTs `{ traceId, rating }` here.
 *   4. We call `scoreGeneration(traceId, 'up' | 'down', comment?)`.
 *
 * Auth: Clerk session only. The thumbs UI is operator-facing — there is
 * no API-key path. Tenant scoping isn't enforced on the trace id (Langfuse
 * project-scoped writes), but the route requires a signed-in operator so
 * anonymous traffic can't spam scores.
 */

import { auth } from '@clerk/nextjs/server';
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { flushLangfuse, scoreGeneration } from '@sendero/langfuse';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BodySchema = z.object({
  traceId: z.string().min(1).max(256),
  rating: z.enum(['up', 'down']),
  comment: z.string().max(2000).optional(),
});

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_body', issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const { traceId, rating, comment } = parsed.data;

  await scoreGeneration(traceId, rating, comment);
  // Flush before returning so the operator sees the score in the
  // Langfuse UI on next refresh — this surface is interactive, not
  // hot-path, so the extra round-trip is fine.
  await flushLangfuse();

  return NextResponse.json({ ok: true });
}
