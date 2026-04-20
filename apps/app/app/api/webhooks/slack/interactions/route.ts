/**
 * Slack interactivity endpoint — Block Kit button + modal callbacks.
 *
 * Verifies HMAC, parses the URL-encoded `payload` field, then dispatches
 * via the InteractionRouter. Currently wires the `sendero_approval`
 * prefix to the corporate-travel approval resolver; everything else
 * returns ok so Slack doesn't retry.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { env } from '@sendero/env';
import { prisma } from '@sendero/database';
import {
  InteractionRouter,
  createSlackClient,
  parseApprovalAction,
  parseInteractionBody,
  respondToInteraction,
  updateMessage,
  verifySlackSignature,
  buildResolvedBlocks,
  type BlockActionsPayload,
} from '@sendero/slack';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 15;

const router = new InteractionRouter().register('sendero_approval', async (payload, action) => {
  const parsed = parseApprovalAction(action);
  if (!parsed) return;

  // Only `approve`/`reject` mutate state; `open` is a link-out.
  if (parsed.decision === 'open') return;

  const install = await prisma.slackInstall.findFirst({
    where: {
      teamId: payload.team?.id ?? '',
      ...(payload.enterprise?.id ? { enterpriseId: payload.enterprise.id } : {}),
    },
    select: { tenantId: true, botToken: true },
  });
  if (!install || install.tenantId !== parsed.tenantId) {
    await respondToInteraction(payload.response_url, {
      text: 'This approval is not linked to your Sendero workspace.',
      response_type: 'ephemeral',
      replace_original: false,
    });
    return;
  }

  // Flip the booking status + persist the approver's decision. The
  // actual booking + settlement is async (Phase 3) — here we just
  // record the signal and swap the card.
  await prisma.booking.update({
    where: { id: parsed.bookingId },
    data: {
      status: parsed.decision === 'approve' ? 'confirmed' : 'canceled',
      metadata: {
        approvedBy: payload.user.id,
        decision: parsed.decision,
        decidedAt: new Date().toISOString(),
      },
    },
  });

  const booking = await prisma.booking.findUnique({
    where: { id: parsed.bookingId },
    select: {
      totalUsd: true,
      segments: true,
      tenantId: true,
    },
  });

  if (payload.channel && payload.message) {
    const client = createSlackClient(install.botToken);
    await updateMessage(client, {
      channel: payload.channel.id,
      ts: payload.message.ts,
      blocks: buildResolvedBlocks(
        {
          tenantId: parsed.tenantId,
          tripId: parsed.tripId,
          bookingId: parsed.bookingId,
          travelerName: 'Traveler',
          route: '—',
          departAt: '—',
          amountUsd: booking ? Number(booking.totalUsd) : 0,
          fareClass: '—',
        },
        parsed.decision,
        payload.user.id
      ),
    });
  }
});

export async function POST(req: NextRequest) {
  const signingSecret = env.slackSigningSecret();
  if (!signingSecret) {
    return NextResponse.json({ error: 'slack_not_configured' }, { status: 503 });
  }

  const rawBody = await req.text();
  const verify = verifySlackSignature(
    rawBody,
    {
      'x-slack-request-timestamp': req.headers.get('x-slack-request-timestamp'),
      'x-slack-signature': req.headers.get('x-slack-signature'),
    },
    { signingSecret }
  );
  if (verify.ok === false) {
    return NextResponse.json({ error: verify.reason }, { status: 401 });
  }

  const payload: BlockActionsPayload | null = parseInteractionBody(rawBody);
  if (!payload || payload.type !== 'block_actions') {
    return NextResponse.json({ ok: true });
  }

  try {
    await router.dispatch(payload);
  } catch (err) {
    console.error('[slack/interactions] dispatch failed:', err);
    await respondToInteraction(payload.response_url, {
      text: 'Something went wrong processing that action. The engineering team has been notified.',
      response_type: 'ephemeral',
      replace_original: false,
    });
  }

  return NextResponse.json({ ok: true });
}
