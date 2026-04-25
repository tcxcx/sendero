/**
 * POST /api/pay-link/send — agent-driven pay-link delivery.
 *
 * Internal route: thin wrapper around `deliverPayLinkForBooking` so
 * the `send_pay_link` tool in `@sendero/tools` (which can't reach
 * into apps/app) has a stable HTTP surface to call. Auth is the
 * `AGENT_DISPATCH_SECRET` / `CRON_SECRET` shared secret pattern,
 * the same one `/api/agent/dispatch` uses for internal callers.
 *
 * The body MUST carry `tenantId` because the route trusts the secret
 * holder to scope the delivery — there's no Clerk session to read.
 * Anyone with the secret can dispatch a link for any tenant; rotate
 * the secret on leak.
 *
 * Returns the discriminated `DeliverPayLinkResult` verbatim so the
 * caller (tool / operator script) can shape it however it wants.
 */

import crypto from 'node:crypto';

import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { deliverPayLinkForBooking } from '@/lib/pay-link/deliver';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const InputSchema = z.object({
  tenantId: z.string().min(1),
  bookingId: z.string().min(1),
  ttlMinutes: z.number().int().min(1).max(24 * 60).optional(),
});

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

function authorize(req: NextRequest): boolean {
  const secret = process.env.AGENT_DISPATCH_SECRET ?? process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get('authorization') ?? '';
  const presented = header.replace(/^Bearer\s+/i, '').trim();
  return Boolean(presented) && safeEqual(presented, secret);
}

export async function POST(req: NextRequest) {
  if (!authorize(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const parsed = InputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_input', issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const { tenantId, bookingId, ttlMinutes } = parsed.data;
  try {
    const result = await deliverPayLinkForBooking({ tenantId, bookingId, ttlMinutes });
    const status = result.kind === 'rejected' ? 422 : 200;
    return NextResponse.json(result, { status });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[pay-link/send] delivery threw', { message });
    return NextResponse.json({ error: 'internal', message: message.slice(0, 200) }, { status: 500 });
  }
}
