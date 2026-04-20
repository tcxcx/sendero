/**
 * WhatsApp Business Cloud API webhook endpoint.
 *
 * GET  — Meta subscription verification (`hub.challenge` echo).
 * POST — Inbound messages + identity-change events. HMAC-verified,
 *        normalized via @sendero/whatsapp, then persisted against the
 *        Prisma ChannelIdentity table.
 *
 * This route is intentionally thin: it hands normalized messages to a
 * downstream agent router (TODO: wire the per-trip agent in Phase 3),
 * and applies BSUID identity changes to keep ChannelIdentity in sync.
 * No LLM call happens here — keeps p95 latency predictable.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { env } from '@sendero/env';
import { prisma } from '@sendero/database';
import {
  handleVerifyHandshake,
  identityKey,
  mergeIdentity,
  normalizeWebhookPayload,
  verifyWebhookSignature,
  type NormalizedIdentityChange,
  type NormalizedInboundMessage,
  type WhatsAppIdentity,
} from '@sendero/whatsapp';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// ─── GET: Meta subscription verify ─────────────────────────────────────

export async function GET(req: NextRequest) {
  const verifyToken = env.whatsappVerifyToken();
  if (!verifyToken) {
    return NextResponse.json(
      { error: 'whatsapp_not_configured', message: 'WHATSAPP_VERIFY_TOKEN unset' },
      { status: 503 }
    );
  }
  const result = handleVerifyHandshake(req.nextUrl.searchParams, verifyToken);
  if (result.ok === false) {
    return new NextResponse(`verify failed: ${result.reason}`, { status: 403 });
  }
  return new NextResponse(result.challenge, {
    status: 200,
    headers: { 'Content-Type': 'text/plain' },
  });
}

// ─── POST: Inbound messages + identity changes ─────────────────────────

export async function POST(req: NextRequest) {
  const appSecret = env.whatsappAppSecret();
  if (!appSecret) {
    return NextResponse.json(
      { error: 'whatsapp_not_configured', message: 'WHATSAPP_APP_SECRET unset' },
      { status: 503 }
    );
  }

  const rawBody = await req.text();
  const signature =
    req.headers.get('x-hub-signature-256') ?? req.headers.get('x-webhook-signature') ?? null;

  if (!verifyWebhookSignature(rawBody, signature, appSecret)) {
    return NextResponse.json({ error: 'bad_signature' }, { status: 401 });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const { messages, identityChanges } = normalizeWebhookPayload(
    parsed as Parameters<typeof normalizeWebhookPayload>[0],
    { defaultCountry: env.whatsappDefaultCountry() }
  );

  // Apply identity changes FIRST so downstream message routing sees the
  // reconciled ChannelIdentity rows.
  for (const change of identityChanges) {
    try {
      await applyIdentityChange(change);
    } catch (err) {
      console.error('[wa/webhook] identity-change failed:', err);
    }
  }

  // Ensure every sender has a ChannelIdentity row + fire agent dispatch
  // for each text message. Dispatch is best-effort; a failure in the
  // agent turn must not cause Meta to retry the webhook.
  let dispatched = 0;
  for (const msg of messages) {
    try {
      const identity = await upsertChannelIdentity(msg);
      if (identity && msg.message.type === 'text' && msg.message.text?.body) {
        void dispatchAgent({
          tenantId: identity.tenantId,
          userId: identity.userId ?? identity.id,
          text: msg.message.text.body,
          req,
        })
          .then(result => {
            if (result?.reply) {
              void sendWhatsAppReply(msg, result.reply);
            }
          })
          .catch(err => {
            console.error('[wa/webhook] dispatch failed:', err);
          });
        dispatched++;
      }
    } catch (err) {
      console.error('[wa/webhook] upsert failed:', err);
    }
  }

  return NextResponse.json({
    received: messages.length,
    identityChanges: identityChanges.length,
    dispatched,
  });
}

// ─── Agent dispatch + outbound reply ──────────────────────────────────

async function dispatchAgent(args: {
  tenantId: string;
  userId: string;
  text: string;
  req: NextRequest;
}): Promise<{ reply: string } | null> {
  const dispatchUrl = new URL('/api/agent/dispatch', args.req.nextUrl.origin);
  const response = await fetch(dispatchUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tenantId: args.tenantId,
      userId: args.userId,
      channel: 'whatsapp',
      text: args.text,
    }),
  });
  if (!response.ok) return null;
  const json = (await response.json()) as { text?: string };
  return json.text ? { reply: json.text } : null;
}

async function sendWhatsAppReply(msg: NormalizedInboundMessage, reply: string): Promise<void> {
  const accessToken = env.whatsappAccessToken();
  if (!accessToken) return;
  const { WhatsAppClient, formatForWhatsApp } = await import('@sendero/whatsapp');
  const client = new WhatsAppClient({
    phoneNumberId: msg.tenantPhoneNumberId,
    accessToken,
    apiBaseUrl: env.whatsappApiBaseUrl() ?? undefined,
  });
  const chunks = formatForWhatsApp(reply);
  for (const chunk of chunks) {
    await client.sendText(msg.identity.phoneRaw ?? msg.identity.phone ?? '', chunk);
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────

async function resolveTenantIdForPhoneNumberId(phoneNumberId: string): Promise<string | null> {
  // TODO (Phase 3): query an `app_connections` table keyed on phoneNumberId.
  // For Phase 2 we fall back to the single-tenant env var so the demo works
  // without a full multi-tenant config UI.
  void phoneNumberId;
  return env.whatsappDefaultTenantId();
}

async function upsertChannelIdentity(
  msg: NormalizedInboundMessage
): Promise<{ id: string; tenantId: string; userId: string | null } | null> {
  const tenantId = await resolveTenantIdForPhoneNumberId(msg.tenantPhoneNumberId);
  if (!tenantId) return null;

  const bsuid = msg.identity.businessScopedUserId;
  const externalUserId = msg.identity.phone ?? msg.identity.phoneRaw ?? null;

  if (bsuid) {
    const row = await prisma.channelIdentity.upsert({
      where: {
        tenantId_kind_businessScopedUserId: {
          tenantId,
          kind: 'whatsapp',
          businessScopedUserId: bsuid,
        },
      },
      create: {
        tenantId,
        kind: 'whatsapp',
        businessScopedUserId: bsuid,
        parentBusinessScopedUserId: msg.identity.parentBusinessScopedUserId,
        externalUserId,
        username: msg.identity.username,
      },
      update: {
        parentBusinessScopedUserId: msg.identity.parentBusinessScopedUserId,
        externalUserId: externalUserId ?? undefined,
        username: msg.identity.username,
      },
      select: { id: true, tenantId: true, userId: true },
    });
    return row;
  }

  if (externalUserId) {
    const row = await prisma.channelIdentity.upsert({
      where: {
        tenantId_kind_externalUserId: {
          tenantId,
          kind: 'whatsapp',
          externalUserId,
        },
      },
      create: {
        tenantId,
        kind: 'whatsapp',
        externalUserId,
        username: msg.identity.username,
      },
      update: { username: msg.identity.username },
      select: { id: true, tenantId: true, userId: true },
    });
    return row;
  }
  return null;
}

async function applyIdentityChange(change: NormalizedIdentityChange): Promise<void> {
  const tenantId = await resolveTenantIdForPhoneNumberId(change.tenantPhoneNumberId);
  if (!tenantId) return;

  // Find the previous ChannelIdentity record (by whichever key we have)
  // and merge the new identity onto it. Keeps one logical traveler row
  // across a Meta user_id_update / user_changed_user_id event.
  const previous = await findByIdentity(tenantId, change.previous);
  if (!previous) return;

  const merged: WhatsAppIdentity = mergeIdentity(
    {
      phone: previous.externalUserId,
      phoneRaw: previous.externalUserId,
      businessScopedUserId: previous.businessScopedUserId,
      parentBusinessScopedUserId: previous.parentBusinessScopedUserId,
      username: previous.username,
    },
    change.current
  );

  await prisma.channelIdentity.update({
    where: { id: previous.id },
    data: {
      businessScopedUserId: merged.businessScopedUserId,
      parentBusinessScopedUserId: merged.parentBusinessScopedUserId,
      externalUserId: merged.phone ?? merged.phoneRaw,
      username: merged.username,
    },
  });
}

async function findByIdentity(
  tenantId: string,
  id: WhatsAppIdentity
): Promise<{
  id: string;
  externalUserId: string | null;
  businessScopedUserId: string | null;
  parentBusinessScopedUserId: string | null;
  username: string | null;
} | null> {
  const key = identityKey(id);
  if (!key) return null;

  // Try BSUID first.
  if (id.businessScopedUserId) {
    const byBsuid = await prisma.channelIdentity.findFirst({
      where: {
        tenantId,
        kind: 'whatsapp',
        businessScopedUserId: id.businessScopedUserId,
      },
      select: {
        id: true,
        externalUserId: true,
        businessScopedUserId: true,
        parentBusinessScopedUserId: true,
        username: true,
      },
    });
    if (byBsuid) return byBsuid;
  }

  // Fall back to phone.
  const phone = id.phone ?? id.phoneRaw;
  if (phone) {
    const byPhone = await prisma.channelIdentity.findFirst({
      where: {
        tenantId,
        kind: 'whatsapp',
        externalUserId: phone,
      },
      select: {
        id: true,
        externalUserId: true,
        businessScopedUserId: true,
        parentBusinessScopedUserId: true,
        username: true,
      },
    });
    if (byPhone) return byPhone;
  }

  return null;
}
