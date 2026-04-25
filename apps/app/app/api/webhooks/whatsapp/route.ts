/**
 * WhatsApp Business Cloud API webhook endpoint.
 *
 * GET  — Meta subscription verification (`hub.challenge` echo).
 * POST — Inbound messages + identity-change events. HMAC-verified,
 *        normalized via @sendero/whatsapp, then persisted against the
 *        Prisma ChannelIdentity table.
 *
 * This route is intentionally thin: it hands normalized messages to
 * the shared /api/agent/dispatch fan-in (which runs `runAgentTurn`
 * from `@sendero/agent` — cap preflight, session lookup, workflow
 * catalog injection, idempotent meter write), and applies BSUID
 * identity changes to keep ChannelIdentity in sync. No LLM call
 * happens here — keeps p95 latency predictable.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { env } from '@sendero/env';
import { prisma } from '@sendero/database';
import { detectLocale, localeForPhone } from '@sendero/locale';
import {
  handleVerifyHandshake,
  identityKey,
  isAllowedMimeType,
  MAX_MEDIA_BYTES,
  mergeIdentity,
  normalizeWebhookPayload,
  verifyWebhookSignature,
  WhatsAppClient,
  type NormalizedIdentityChange,
  type NormalizedInboundMessage,
  type WhatsAppIdentity,
  type WhatsAppMedia,
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
  // for each text-or-media message. Dispatch is best-effort; a failure in
  // the agent turn must not cause Meta to retry the webhook.
  let dispatched = 0;
  for (const msg of messages) {
    try {
      const identity = await upsertChannelIdentity(msg);
      if (!identity) continue;

      const kind = msg.message.type;
      const text = kind === 'text' ? (msg.message.text?.body ?? '') : mediaCaption(msg.message);

      if (kind === 'text' && text) {
        void dispatchAgent({
          tenantId: identity.tenantId,
          userId: identity.userId ?? identity.id,
          text,
          locale: identity.locale,
          turnId: `whatsapp:${msg.messageId}`,
          req,
        })
          .then(result => {
            if (result?.reply) void sendWhatsAppReply(msg, result.reply);
          })
          .catch(err => console.error('[wa/webhook] dispatch failed:', err));
        dispatched++;
      } else if ((kind === 'image' || kind === 'document') && msg.message[kind]) {
        // Process media turns async — downloading can be slow, Meta
        // only gives us a 30s ack window and we must respond BEFORE
        // the download finishes.
        void dispatchMediaTurn({
          tenantId: identity.tenantId,
          userId: identity.userId ?? identity.id,
          locale: identity.locale,
          turnId: `whatsapp:${msg.messageId}`,
          phoneNumberId: msg.tenantPhoneNumberId,
          media: msg.message[kind] as WhatsAppMedia,
          caption: text,
          attachmentKind: kind,
          req,
        })
          .then(result => {
            if (result?.reply) void sendWhatsAppReply(msg, result.reply);
          })
          .catch(err => console.error('[wa/webhook] media dispatch failed:', err));
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
  locale: string;
  turnId: string;
  req: NextRequest;
}): Promise<{ reply: string } | null> {
  return postToDispatch(args.req, {
    tenantId: args.tenantId,
    userId: args.userId,
    channel: 'whatsapp',
    text: args.text,
    locale: args.locale,
    turnId: args.turnId,
  });
}

async function dispatchMediaTurn(args: {
  tenantId: string;
  userId: string;
  locale: string;
  turnId: string;
  phoneNumberId: string;
  media: WhatsAppMedia;
  caption: string;
  attachmentKind: 'image' | 'document';
  req: NextRequest;
}): Promise<{ reply: string } | null> {
  if (!isAllowedMimeType(args.media.mime_type)) {
    console.warn('[wa/webhook] disallowed media mime-type:', args.media.mime_type);
    return null;
  }

  const accessToken = env.whatsappAccessToken();
  if (!accessToken) {
    console.warn('[wa/webhook] cannot download media without WHATSAPP_ACCESS_TOKEN');
    return null;
  }
  const client = new WhatsAppClient({
    phoneNumberId: args.phoneNumberId,
    accessToken,
    apiBaseUrl: env.whatsappApiBaseUrl() ?? undefined,
  });
  let buf: ArrayBuffer;
  try {
    buf = await client.downloadMedia(args.media.id);
  } catch (err) {
    console.error('[wa/webhook] downloadMedia failed:', err);
    return null;
  }
  if (buf.byteLength > MAX_MEDIA_BYTES) {
    console.warn(
      `[wa/webhook] media ${args.media.id} (${buf.byteLength} bytes) exceeds ${MAX_MEDIA_BYTES} cap`
    );
    return null;
  }
  const base64 = Buffer.from(buf).toString('base64');

  return postToDispatch(args.req, {
    tenantId: args.tenantId,
    userId: args.userId,
    channel: 'whatsapp',
    text: args.caption,
    locale: args.locale,
    turnId: args.turnId,
    attachments: [
      {
        kind: args.attachmentKind,
        mediaType: args.media.mime_type,
        data: base64,
        size: buf.byteLength,
        ...(args.media.filename ? { filename: args.media.filename } : {}),
      },
    ],
  });
}

async function postToDispatch(
  req: NextRequest,
  body: Record<string, unknown>
): Promise<{ reply: string } | null> {
  const dispatchUrl = new URL('/api/agent/dispatch', req.nextUrl.origin);
  const response = await fetch(dispatchUrl, {
    method: 'POST',
    headers: agentDispatchHeaders(),
    body: JSON.stringify(body),
  });
  if (!response.ok) return null;
  const json = (await response.json()) as { text?: string };
  return json.text ? { reply: json.text } : null;
}

function mediaCaption(msg: NormalizedInboundMessage['message']): string {
  if (msg.type === 'image' && msg.image?.caption) return msg.image.caption;
  if (msg.type === 'document' && msg.document?.caption) return msg.document.caption;
  return '';
}

function agentDispatchHeaders() {
  const secret = process.env.AGENT_DISPATCH_SECRET ?? process.env.CRON_SECRET ?? '';
  return {
    'Content-Type': 'application/json',
    'x-sendero-dispatch-secret': secret,
  };
}

async function sendWhatsAppReply(msg: NormalizedInboundMessage, reply: string): Promise<void> {
  const accessToken = env.whatsappAccessToken();
  if (!accessToken) return;
  const { formatForWhatsApp } = await import('@sendero/whatsapp');
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

/**
 * Canonical reply path: send a `ChannelMessage` (any kind the WhatsApp
 * renderer supports) to the inbound message's traveler. Mirrors
 * `sendWhatsAppReply` for the plain-text path; this one runs the message
 * through `renderForWhatsApp` so card / interactive / template payloads
 * all flow through the same wire-edge primitive.
 *
 * Looks up the per-tenant `WhatsAppInstall` row to honor BYO Meta
 * numbers (Phase 11h). Falls back gracefully when the install is
 * missing or disabled.
 */
async function sendWhatsAppCanonical(
  msg: NormalizedInboundMessage,
  channelMessage: import('@/lib/channel-send').ChannelMessage,
  tenantId: string
): Promise<void> {
  const install = await prisma.whatsAppInstall.findUnique({
    where: { tenantId },
  });
  if (!install || install.status === 'disabled') return;

  const recipient = msg.identity.phoneRaw ?? msg.identity.phone ?? '';
  if (!recipient) return;

  const { sendChannelMessageWhatsApp } = await import('@/lib/channel-send');
  const result = await sendChannelMessageWhatsApp({
    install,
    recipient,
    message: channelMessage,
  });
  if (result.sent === false) {
    console.warn('[wa/webhook] canonical send skipped:', result.reason);
  }
}

// Intentionally not exported. Next.js route files must only export
// HTTP method handlers + runtime config. Callers outside this route
// should compose `sendChannelMessageWhatsApp` from
// `@/lib/channel-send` directly. The wrapper here exists so that, when
// this route's dispatch fan-in evolves to surface canonical messages
// (instead of plain `text` strings), the wire-up is one line away.
void sendWhatsAppCanonical;

// ─── Helpers ───────────────────────────────────────────────────────────

async function resolveTenantIdForPhoneNumberId(phoneNumberId: string): Promise<string | null> {
  // Phase 11h: BYO WhatsApp — every tenant installs their own Meta number
  // through the Kapso setup link, so the phoneNumberId → tenant mapping
  // lives on the `whatsapp_installs` table.
  if (phoneNumberId) {
    const install = await prisma.whatsAppInstall.findUnique({
      where: { phoneNumberId },
      select: { tenantId: true, status: true },
    });
    if (install && install.status !== 'disabled') return install.tenantId;
  }
  // Dev-mode last-resort fallback — leave unset in production.
  return env.whatsappDefaultTenantId();
}

async function upsertChannelIdentity(
  msg: NormalizedInboundMessage
): Promise<{ id: string; tenantId: string; userId: string | null; locale: string } | null> {
  const tenantId = await resolveTenantIdForPhoneNumberId(msg.tenantPhoneNumberId);
  if (!tenantId) return null;

  const bsuid = msg.identity.businessScopedUserId;
  const externalUserId = msg.identity.phone ?? msg.identity.phoneRaw ?? null;
  const inferredLocale =
    localeForPhone(msg.identity.phone ?? msg.identity.phoneRaw) ??
    detectLocale({ country: env.whatsappDefaultCountry() });
  const metadata = {
    locale: inferredLocale,
    localeSource: localeForPhone(msg.identity.phone ?? msg.identity.phoneRaw)
      ? 'phone_prefix'
      : 'tenant_default_country',
    phoneRaw: msg.identity.phoneRaw,
  };

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
        metadata,
      },
      update: {
        parentBusinessScopedUserId: msg.identity.parentBusinessScopedUserId,
        externalUserId: externalUserId ?? undefined,
        username: msg.identity.username,
        metadata,
      },
      select: { id: true, tenantId: true, userId: true, metadata: true },
    });
    return {
      id: row.id,
      tenantId: row.tenantId,
      userId: row.userId,
      locale: localeFromMetadata(row.metadata, inferredLocale),
    };
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
        metadata,
      },
      update: { username: msg.identity.username, metadata },
      select: { id: true, tenantId: true, userId: true, metadata: true },
    });
    return {
      id: row.id,
      tenantId: row.tenantId,
      userId: row.userId,
      locale: localeFromMetadata(row.metadata, inferredLocale),
    };
  }
  return null;
}

function localeFromMetadata(metadata: unknown, fallback: string): string {
  if (metadata && typeof metadata === 'object' && 'locale' in metadata) {
    const locale = (metadata as Record<string, unknown>).locale;
    if (typeof locale === 'string' && locale) return locale;
  }
  return fallback;
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
