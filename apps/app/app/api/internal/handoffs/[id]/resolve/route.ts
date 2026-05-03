/**
 * POST /api/internal/handoffs/[id]/resolve
 *
 * Operator's answer for a queued `ChannelHandoff`. Tenant-scoped via
 * Clerk session. Closes the loop:
 *   1. Validates the handoff belongs to the operator's active tenant.
 *   2. Stamps `answer`, `answeredByUserId`, `answeredAt`, status='answered'.
 *   3. Appends a `handoff_answered` event to `Trip.events` (so MetaInbox
 *      and trip inbox render the resolution inline).
 *   4. Sends the operator's answer to the originating channel (today:
 *      WhatsApp via the existing `sendWhatsAppReply` primitive).
 *
 * Failure modes are tenant-leak-safe: a handoff from another tenant
 * returns 404 (not 403) so an operator probing ids can't enumerate
 * cross-tenant rows.
 */

import { NextResponse } from 'next/server';

import { auth } from '@clerk/nextjs/server';
import { type Prisma, prisma } from '@sendero/database';
import { env } from '@sendero/env';
import { WhatsAppClient } from '@sendero/whatsapp';

import { logMetaCall, logOutboundMessage } from '@/lib/whatsapp-audit';
import { requireCurrentTenant } from '@/lib/tenant-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_ANSWER_LEN = 4000;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { tenant } = await requireCurrentTenant();
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: { answer?: string };
  try {
    body = (await req.json()) as { answer?: string };
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  const answer = (body.answer ?? '').trim();
  if (!answer) return NextResponse.json({ error: 'answer_required' }, { status: 400 });
  if (answer.length > MAX_ANSWER_LEN) {
    return NextResponse.json({ error: 'answer_too_long' }, { status: 400 });
  }

  const operator = await prisma.user.findUnique({
    where: { clerkUserId },
    select: { id: true },
  });
  if (!operator) return NextResponse.json({ error: 'operator_not_provisioned' }, { status: 401 });

  const handoff = await prisma.channelHandoff.findFirst({
    where: { id, tenantId: tenant.id },
    select: {
      id: true,
      tenantId: true,
      tripId: true,
      channelIdentityId: true,
      channel: true,
      status: true,
      question: true,
    },
  });
  if (!handoff) return NextResponse.json({ error: 'handoff_not_found' }, { status: 404 });
  if (handoff.status !== 'pending') {
    return NextResponse.json(
      { error: 'handoff_already_resolved', status: handoff.status },
      { status: 409 }
    );
  }

  const identity = await prisma.channelIdentity.findUnique({
    where: { id: handoff.channelIdentityId },
    select: { externalUserId: true, kind: true, tenantId: true },
  });
  if (!identity || identity.tenantId !== tenant.id) {
    return NextResponse.json({ error: 'handoff_identity_invalid' }, { status: 409 });
  }
  const recipient = identity.externalUserId;
  if (!recipient) {
    return NextResponse.json({ error: 'handoff_identity_no_address' }, { status: 409 });
  }

  // Persist the answer FIRST so it survives even if the WhatsApp send
  // throws — the operator can re-trigger delivery later, but we never
  // want to lose the typed answer.
  await prisma.channelHandoff.update({
    where: { id: handoff.id },
    data: {
      answer,
      answeredByUserId: operator.id,
      answeredAt: new Date(),
      status: 'answered',
    },
  });

  if (handoff.tripId) {
    await appendTripEvent({
      tenantId: tenant.id,
      tripId: handoff.tripId,
      handoffId: handoff.id,
      channel: handoff.channel,
      answer,
      answeredByUserId: operator.id,
    });
  }

  let delivery: { ok: true; wamid?: string } | { ok: false; error: string };
  if (handoff.channel === 'whatsapp') {
    delivery = await sendWhatsAppAnswer({
      tenantId: tenant.id,
      recipient,
      answer,
    });
  } else {
    // Other channels not wired yet — answer is persisted; operator
    // surfaces still see status=answered.
    delivery = { ok: true };
  }

  return NextResponse.json({
    ok: delivery.ok,
    handoffId: handoff.id,
    delivery,
  });
}

async function appendTripEvent(args: {
  tenantId: string;
  tripId: string;
  handoffId: string;
  channel: string;
  answer: string;
  answeredByUserId: string;
}): Promise<void> {
  const entry: Prisma.InputJsonObject = {
    id: `ho_${args.handoffId}_handoff_answered`,
    kind: 'handoff_answered',
    handoffId: args.handoffId,
    channel: args.channel,
    direction: 'outbound',
    text: args.answer,
    answeredByUserId: args.answeredByUserId,
    createdAt: new Date().toISOString(),
  };
  await prisma.$executeRaw`
    UPDATE trips
       SET events = COALESCE(events, '[]'::jsonb) || ${entry as unknown as Prisma.JsonValue}::jsonb
     WHERE id = ${args.tripId} AND "tenantId" = ${args.tenantId}
  `;
}

async function sendWhatsAppAnswer(args: {
  tenantId: string;
  recipient: string;
  answer: string;
}): Promise<{ ok: true; wamid?: string } | { ok: false; error: string }> {
  const accessToken = env.whatsappAccessToken() ?? env.kapsoApiKey();
  if (!accessToken) return { ok: false, error: 'wa_outbound_not_configured' };

  const install = await prisma.whatsAppInstall.findUnique({
    where: { tenantId: args.tenantId },
    select: { phoneNumberId: true, status: true },
  });
  if (!install?.phoneNumberId || install.status === 'disabled') {
    return { ok: false, error: 'wa_install_unavailable' };
  }

  const baseUrl =
    env.whatsappApiBaseUrl() ??
    (env.kapsoApiKey() ? `${env.kapsoApiBaseUrl()}/meta/whatsapp/v24.0` : undefined);

  const client = new WhatsAppClient({
    phoneNumberId: install.phoneNumberId,
    accessToken,
    apiBaseUrl: baseUrl,
    onSent: event =>
      logOutboundMessage({
        tenantId: args.tenantId,
        phoneNumberId: install.phoneNumberId!,
        source: 'agent_reply',
        event,
      }),
    onApiCall: event =>
      logMetaCall({
        tenantId: args.tenantId,
        method: event.method,
        endpoint: event.endpoint,
        statusCode: event.statusCode,
        durationMs: event.durationMs,
        ok: event.ok,
        ...(event.errorMessage ? { errorMessage: event.errorMessage } : {}),
      }),
  });

  try {
    const result = (await client.sendText(args.recipient, args.answer)) as {
      messages?: Array<{ id?: string }>;
    };
    const wamid = result?.messages?.[0]?.id;
    return wamid ? { ok: true, wamid } : { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[handoffs/resolve] wa send failed', { recipient: args.recipient, message });
    return { ok: false, error: message };
  }
}
