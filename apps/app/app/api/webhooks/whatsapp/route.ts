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

import { after, type NextRequest, NextResponse } from 'next/server';

import { prisma } from '@sendero/database';
import { env } from '@sendero/env';
import { detectLocale, localeForPhone } from '@sendero/locale';
import {
  handleVerifyHandshake,
  identityKey,
  isAllowedMimeType,
  MAX_MEDIA_BYTES,
  mergeIdentity,
  type NormalizedIdentityChange,
  type NormalizedInboundMessage,
  type NormalizedStatusUpdate,
  normalizeWebhookPayload,
  verifyWebhookSignature,
  WhatsAppClient,
  type WhatsAppIdentity,
  type WhatsAppMedia,
} from '@sendero/whatsapp';

import { newTraceId } from '@/lib/api-errors';
import { resolveActiveTripForChannelIdentity } from '@/lib/trip-events';
import {
  logMetaCall,
  logOutboundMessage,
  logWebhookEvent,
  reconcileOutboundStatus,
} from '@/lib/whatsapp-audit';
import { claimWhatsAppMessage, isWithinReplayWindow } from '@/lib/whatsapp-dedup';
import { recordInboundForTyping } from '@/lib/typing-heartbeat';

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
  const startTime = Date.now();
  const receivedAt = new Date();

  const appSecret = env.whatsappAppSecret();
  const kapsoSecret = env.kapsoGlobalWebhookSecret();
  const hasMetaSignature = Boolean(req.headers.get('x-hub-signature-256'));
  const hasKapsoSignature = Boolean(req.headers.get('x-webhook-signature'));
  if (!appSecret && !kapsoSecret) {
    return NextResponse.json(
      {
        error: 'whatsapp_not_configured',
        message: 'WHATSAPP_APP_SECRET or KAPSO_GLOBAL_WEBHOOK_SECRET unset',
      },
      { status: 503 }
    );
  }

  const rawBody = await req.text();
  const signature =
    req.headers.get('x-hub-signature-256') ?? req.headers.get('x-webhook-signature') ?? null;

  const signatureSecret =
    hasMetaSignature && appSecret
      ? appSecret
      : hasKapsoSignature && kapsoSecret
        ? kapsoSecret
        : (appSecret ?? kapsoSecret);

  if (!signatureSecret || !verifyWebhookSignature(rawBody, signature, signatureSecret)) {
    // Audit the rejected request for forensics — somebody hit our
    // public endpoint with a bad sig, ops should be able to grep for
    // these without wading through Vercel logs.
    after(() =>
      logWebhookEvent({
        tenantId: null,
        receivedAt,
        rawBody,
        signatureValid: false,
        replayWindowOk: null,
        messageCount: 0,
        identityChangeCount: 0,
        statusUpdateCount: 0,
        droppedReplayCount: 0,
        droppedDuplicateCount: 0,
        dispatchedCount: 0,
        durationMs: Date.now() - startTime,
        traceId: newTraceId(),
      })
    );
    return NextResponse.json({ error: 'bad_signature' }, { status: 401 });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const { messages, identityChanges, statusUpdates } = normalizeWebhookPayload(
    parsed as Parameters<typeof normalizeWebhookPayload>[0],
    { defaultCountry: env.whatsappDefaultCountry() }
  );

  const traceId = newTraceId();
  console.log('[wa/webhook] inbound', {
    traceId,
    messageCount: messages.length,
    identityChangeCount: identityChanges.length,
    statusUpdateCount: statusUpdates.length,
  });

  // Apply identity changes FIRST so downstream message routing sees the
  // reconciled ChannelIdentity rows.
  for (const change of identityChanges) {
    try {
      await applyIdentityChange(change);
    } catch (err) {
      console.error('[wa/webhook] identity-change failed:', { traceId, error: err });
    }
  }

  // Apply outbound delivery-status updates. Today these only fan out to
  // OtpDeliveryAttempt rows (the one outbound surface that persists
  // providerMessageId). Adding other outbound surfaces — booking
  // confirmations, trip nudges — would route through the same loop with
  // a tagged provider id.
  let statusUpdated = 0;
  for (const status of statusUpdates) {
    try {
      const updated = await applyOtpStatusUpdate(status);
      statusUpdated += updated;
    } catch (err) {
      console.error('[wa/webhook] status-update failed:', {
        traceId,
        wamid: status.messageId,
        status: status.status,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Ensure every sender has a ChannelIdentity row + fire agent dispatch
  // for each text-or-media message. Dispatch is best-effort; a failure in
  // the agent turn must not cause Meta to retry the webhook.
  let dispatched = 0;
  let droppedReplay = 0;
  let droppedDuplicate = 0;
  for (const msg of messages) {
    // Replay-window: Meta's signature only signs the body, so freshness
    // gating happens per-message off the server-stamped timestamp.
    if (!isWithinReplayWindow(msg.timestamp)) {
      droppedReplay++;
      console.warn('[wa/webhook] dropping stale message outside replay window', {
        traceId,
        messageId: msg.messageId,
        timestamp: msg.timestamp.toISOString(),
      });
      continue;
    }
    // Dedup: Meta retries the same wamid on non-200 acks, and rare
    // network blips can deliver twice even after our 200. SETNX in
    // Redis with 1h TTL covers both. Fail-open if Redis is down.
    const fresh = await claimWhatsAppMessage(msg.messageId);
    if (!fresh) {
      droppedDuplicate++;
      console.log('[wa/webhook] duplicate message, skipping', {
        traceId,
        messageId: msg.messageId,
      });
      continue;
    }
    try {
      const identity = await upsertChannelIdentity(msg);
      if (!identity) continue;

      // UX polish: mark the inbound as read and show a typing indicator
      // immediately, in parallel with everything else. The typing
      // presence auto-clears when the reply is sent (or after 25s).
      // Fire-and-forget — failures here must never block dispatch.
      void markReadAndTyping(msg);

      // Stamp the most recent inbound wamid for this (tenant, traveler)
      // into Redis so Sendero-initiated outbound flows (post-ticket
      // fanout, NFT mint workflow) can re-tick the typing indicator
      // every 20s via `withTypingHeartbeat`. Kapso owns its own typing
      // for inbound→outbound on the agent path; this wiring covers
      // the gap where Sendero sends without Kapso in the loop.
      const externalUserIdForTyping =
        msg.identity.phone ?? msg.identity.phoneRaw ?? null;
      if (externalUserIdForTyping) {
        void recordInboundForTyping({
          tenantId: identity.tenantId,
          externalUserId: externalUserIdForTyping,
          messageId: msg.messageId,
        });
      }

      // First-touch greeting — when we just provisioned the User row
      // for this traveler AND they opened with a greeting, send a
      // deterministic localized welcome instead of burning a turn.
      // Subsequent inbounds (or non-greeting first inbounds) flow
      // through the full agent.
      const kind = msg.message.type;
      const text = kind === 'text' ? (msg.message.text?.body ?? '') : mediaCaption(msg.message);
      if (kind === 'text' && identity.provisional && isGreeting(text)) {
        void sendWhatsAppReply(msg, greetingFor(identity.locale));
        dispatched++;
        continue;
      }

      // Pre-booking ancillary picker tap — interactive list reply
      // whose row id encodes
      // `select_seat:<tripId>:<offerId>:<passengerId>:<svcId>:<designator>`
      // or `add_bag:<tripId>:<offerId>:<passengerId>:<svcId>:<label>`.
      // Route directly to the matching Sendero tool over the internal
      // surface so the agent doesn't burn tokens routing taps. Same
      // pattern as the Slack `sendero_select_seat` / `sendero_add_bag`
      // handler. Falls through to normal agent dispatch when row id
      // doesn't match (e.g. a quick-reply the agent should consume).
      if (kind === 'interactive') {
        const interactive = msg.message.interactive;
        const rowId = interactive?.list_reply?.id ?? interactive?.button_reply?.id ?? '';
        if (rowId.startsWith('select_seat:') || rowId.startsWith('add_bag:')) {
          const handled = await routeAncillaryRowId({
            rowId,
            tenantId: identity.tenantId,
            travelerPhone: msg.identity.phone ?? msg.identity.phoneRaw ?? null,
          });
          if (handled) {
            dispatched++;
            continue;
          }
          // Fall through if parse failed — agent gets a chance to
          // handle the tap as free-form text.
        }
      }

      // Resolve an active trip for this traveler so the dispatch route
      // can append inbound + outbound events to the canonical Trip
      // ledger. Null when the traveler has no in-flight trip — dispatch
      // skips the ledger write and the agent processes the message
      // anyway (it may create a trip via tool calls).
      const tripId = await resolveActiveTripForChannelIdentity({
        tenantId: identity.tenantId,
        channelIdentityId: identity.id,
      });

      // Durable multi-step workflow resume: if the traveler has a
      // paused workflow Session (started via `start_workflow` on a
      // prior turn), feed the user's reply in as the resolution and
      // continue the runner. Skips the normal agent-turn fan-out so
      // the workflow's deterministic step ordering is preserved. The
      // trip context flows in so each resumed step appends to the
      // trip ledger.
      if (kind === 'text' && text) {
        const handled = await tryResumePausedWorkflow({
          tenantId: identity.tenantId,
          channelIdentityId: identity.id,
          travelerPhone: msg.identity.phone ?? msg.identity.phoneRaw ?? null,
          userId: identity.userId,
          userInput: text,
          tripId,
          msg,
        });
        if (handled) {
          dispatched++;
          continue;
        }
      }

      if (kind === 'text' && text) {
        void dispatchAgent({
          tenantId: identity.tenantId,
          userId: identity.userId ?? identity.id,
          text,
          locale: identity.locale,
          turnId: `whatsapp:${msg.messageId}`,
          tripId,
          channelIdentityId: identity.id,
          travelerPhone: msg.identity.phone ?? msg.identity.phoneRaw ?? null,
          req,
        })
          .then(async result => {
            if (result?.reply) {
              if (result.shareCards && result.shareCards.length > 0) {
                await sendShareCards(msg, result.shareCards).catch(err => {
                  console.warn('[wa/webhook] share-card render failed', {
                    messageId: msg.messageId,
                    error: err instanceof Error ? err.message : String(err),
                  });
                });
              }
              void sendWhatsAppReply(msg, result.reply);
            } else {
              // Dispatch returned null. Stay silent — Kapso already
              // 200-ack'd, retrying with a "having trouble" message
              // floods the user. Operator surfaces the failure via the
              // webhook audit log.
              console.warn('[wa/webhook] dispatch returned no reply', {
                messageId: msg.messageId,
              });
            }
          })
          .catch(err => {
            console.error('[wa/webhook] dispatch failed:', {
              messageId: msg.messageId,
              error: err instanceof Error ? err.message : String(err),
            });
          });
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
          tripId,
          phoneNumberId: msg.tenantPhoneNumberId,
          media: msg.message[kind] as WhatsAppMedia,
          caption: text,
          attachmentKind: kind,
          req,
        })
          .then(async result => {
            if (result?.reply) {
              if (result.shareCards && result.shareCards.length > 0) {
                await sendShareCards(msg, result.shareCards).catch(err => {
                  console.warn('[wa/webhook] share-card render failed', {
                    messageId: msg.messageId,
                    error: err instanceof Error ? err.message : String(err),
                  });
                });
              }
              void sendWhatsAppReply(msg, result.reply);
            } else {
              console.warn('[wa/webhook] media dispatch returned no reply', {
                messageId: msg.messageId,
              });
            }
          })
          .catch(err => {
            console.error('[wa/webhook] media dispatch failed:', {
              messageId: msg.messageId,
              error: err instanceof Error ? err.message : String(err),
            });
          });
        dispatched++;
      }
    } catch (err) {
      console.error('[wa/webhook] upsert failed:', err);
    }
  }

  const replayWindowOk = messages.length === 0 ? null : droppedReplay < messages.length;

  // Resolve the most-likely tenantId from the first inbound message.
  // For pure-status payloads with no inbound message, we can't infer a
  // tenant (status updates carry phone_number_id; we'd have to look up
  // the install). Acceptable to leave null on those rows.
  let auditTenantId: string | null = null;
  if (messages[0]) {
    auditTenantId = await resolveTenantIdForPhoneNumberId(messages[0].tenantPhoneNumberId);
  }

  // Persist webhook audit row past the 200 ack so a slow Prisma write
  // never extends Meta's wait. Same pattern as identity-change apply.
  const traceIdForAudit = traceId;
  const totalDurationMs = Date.now() - startTime;
  after(() =>
    logWebhookEvent({
      tenantId: auditTenantId,
      receivedAt,
      rawBody,
      signatureValid: true,
      replayWindowOk,
      messageCount: messages.length,
      identityChangeCount: identityChanges.length,
      statusUpdateCount: statusUpdates.length,
      droppedReplayCount: droppedReplay,
      droppedDuplicateCount: droppedDuplicate,
      dispatchedCount: dispatched,
      durationMs: totalDurationMs,
      traceId: traceIdForAudit,
    })
  );

  return NextResponse.json({
    received: messages.length,
    identityChanges: identityChanges.length,
    dispatched,
    droppedReplay,
    droppedDuplicate,
    statusUpdated,
  });
}

// ─── Agent dispatch + outbound reply ──────────────────────────────────

async function dispatchAgent(args: {
  tenantId: string;
  userId: string;
  text: string;
  locale: string;
  turnId: string;
  tripId: string | null;
  channelIdentityId: string;
  travelerPhone: string | null;
  req: NextRequest;
}): Promise<DispatchReply | null> {
  return postToDispatch(args.req, {
    tenantId: args.tenantId,
    userId: args.userId,
    channel: 'whatsapp',
    text: args.text,
    locale: args.locale,
    turnId: args.turnId,
    channelIdentityId: args.channelIdentityId,
    ...(args.travelerPhone ? { travelerPhone: args.travelerPhone } : {}),
    ...(args.tripId ? { tripId: args.tripId } : {}),
  });
}

interface DispatchShareCard {
  toolName: string;
  share: {
    title: string;
    body: string;
    bullets?: string[];
    primaryCta?: { label: string; kind: string };
    secondaryCtas?: Array<{ label: string; kind: string }>;
    imageUrl?: string;
  };
}

interface DispatchReply {
  reply: string;
  shareCards?: DispatchShareCard[];
}

async function dispatchMediaTurn(args: {
  tenantId: string;
  userId: string;
  locale: string;
  turnId: string;
  tripId: string | null;
  phoneNumberId: string;
  media: WhatsAppMedia;
  caption: string;
  attachmentKind: 'image' | 'document';
  req: NextRequest;
}): Promise<DispatchReply | null> {
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
    ...(args.tripId ? { tripId: args.tripId } : {}),
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
): Promise<DispatchReply | null> {
  // `req.nextUrl.origin` is the public-facing host the request arrived
  // on (e.g. the ngrok tunnel). Routing internal dispatch through that
  // is a round-trip back through the public edge for no benefit. Prefer
  // an explicit internal base URL, then localhost on the configured
  // port; fall through to the request origin only if neither is set.
  const internalBase =
    process.env.AGENT_INTERNAL_BASE_URL ||
    `http://127.0.0.1:${process.env.PORT ?? '3010'}` ||
    req.nextUrl.origin;
  const dispatchUrl = new URL('/api/agent/dispatch', internalBase);
  let response: Response;
  try {
    response = await fetch(dispatchUrl, {
      method: 'POST',
      headers: agentDispatchHeaders(),
      body: JSON.stringify(body),
    });
  } catch (err) {
    console.error('[wa/webhook] dispatch fetch threw', {
      url: dispatchUrl.toString(),
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    console.error('[wa/webhook] dispatch returned non-OK', {
      status: response.status,
      body: errText.slice(0, 400),
    });
    return null;
  }
  const json = (await response.json().catch(() => null)) as {
    text?: string;
    shareCards?: DispatchShareCard[];
  } | null;
  if (!json?.text) return null;
  return {
    reply: json.text,
    ...(json.shareCards && json.shareCards.length > 0 ? { shareCards: json.shareCards } : {}),
  };
}

function mediaCaption(msg: NormalizedInboundMessage['message']): string {
  if (msg.type === 'image' && msg.image?.caption) return msg.image.caption;
  if (msg.type === 'document' && msg.document?.caption) return msg.document.caption;
  return '';
}

function agentDispatchHeaders() {
  const secret = process.env.AGENT_DISPATCH_SECRET ?? process.env.CRON_SECRET ?? '';
  if (!secret) {
    console.error(
      '[wa/webhook] AGENT_DISPATCH_SECRET / CRON_SECRET unset — dispatch will 401. Set one before customer traffic.'
    );
  }
  return {
    'Content-Type': 'application/json',
    'x-sendero-dispatch-secret': secret,
  };
}

async function sendWhatsAppReply(msg: NormalizedInboundMessage, reply: string): Promise<void> {
  const accessToken = whatsappOutboundAccessToken();
  if (!accessToken) return;
  const {
    formatForWhatsApp,
    isOutsideSessionWindowError,
    SENDERO_TEMPLATES,
    buildTemplateComponents,
    resolveTemplateLocale,
  } = await import('@sendero/whatsapp');

  // Resolve the tenant once so every audit row carries the correct
  // tenantId. Skip auditing entirely when we can't resolve (dev with
  // no install row) — better a missing audit row than a broken FK.
  const auditTenantId = await resolveTenantIdForPhoneNumberId(msg.tenantPhoneNumberId);

  const client = new WhatsAppClient({
    phoneNumberId: msg.tenantPhoneNumberId,
    accessToken,
    apiBaseUrl: whatsappOutboundApiBaseUrl(),
    ...(auditTenantId
      ? {
          onSent: event =>
            logOutboundMessage({
              tenantId: auditTenantId,
              phoneNumberId: msg.tenantPhoneNumberId,
              source: 'agent_reply',
              event,
            }),
          // Audit every Meta API call (success + failure + each retry)
          // so the inbox UI's "outbound API" tab can show p95 latency,
          // 429 rate, and failed-only views per tenant.
          onApiCall: event =>
            logMetaCall({
              tenantId: auditTenantId,
              method: event.method,
              endpoint: event.endpoint,
              statusCode: event.statusCode,
              durationMs: event.durationMs,
              ok: event.ok,
              ...(event.errorMessage ? { errorMessage: event.errorMessage } : {}),
            }),
        }
      : {}),
  });
  const recipient = msg.identity.phoneRaw ?? msg.identity.phone ?? '';
  if (!recipient) return;
  const chunks = formatForWhatsApp(reply);
  for (const chunk of chunks) {
    try {
      await client.sendText(recipient, chunk);
    } catch (err) {
      // Outside the 24h customer-service window — Meta rejects free-form
      // with `(#131047)`. Fall back to the ACTION_REQUIRED HSM template
      // (registered + approved per `SENDERO_TEMPLATES`) so the traveler
      // still gets the message; the body summarizes the agent's reply
      // and the link drops them into Sendero where the full thread
      // resumes inside-window.
      if (!isOutsideSessionWindowError(err)) throw err;
      console.warn('[wa/webhook] free-form rejected outside 24h window; sending template', {
        recipient,
        error: err instanceof Error ? err.message : String(err),
      });
      const def = SENDERO_TEMPLATES.ACTION_REQUIRED;
      const components = buildTemplateComponents(def, {
        senderName: 'Sendero',
        actionSummary: chunk.slice(0, 240),
        actionLink: `${env.kapsoWebhookBaseUrl() ?? 'https://app.sendero.travel'}/dashboard`,
      });
      await client.sendTemplate({
        to: recipient,
        templateName: def.name,
        languageCode: resolveTemplateLocale(def, undefined),
        components,
      });
      // Don't try the remaining chunks — one template send replaces the
      // entire free-form payload outside the window.
      break;
    }
  }
}

/**
 * Resume the traveler's paused workflow with their latest message as
 * the resolution payload. Returns `true` when a paused workflow was
 * found + resumed (caller should skip the normal agent-turn dispatch);
 * `false` when no paused workflow exists for this channel identity.
 *
 * Failures are caught and downgrade to `false` so the inbound falls
 * through to a fresh agent turn rather than dropping silently.
 */
async function tryResumePausedWorkflow(args: {
  tenantId: string;
  channelIdentityId: string;
  travelerPhone: string | null;
  userId: string;
  userInput: string;
  tripId: string | null;
  msg: NormalizedInboundMessage;
}): Promise<boolean> {
  try {
    const { loadPausedAgentWorkflow, resumeAgentWorkflow } = await import(
      '@/lib/agent-workflow-session'
    );
    const paused = await loadPausedAgentWorkflow({
      tenantId: args.tenantId,
      channel: 'whatsapp',
      channelIdentityId: args.channelIdentityId,
    });
    if (!paused) return false;

    const snapshot = await resumeAgentWorkflow({
      tenantId: args.tenantId,
      paused,
      userInput: args.userInput,
      toolCtx: {
        traveler: {
          tenantId: args.tenantId,
          userId: args.userId,
          ...(args.travelerPhone ? { phone: args.travelerPhone } : {}),
        },
        channelIdentityId: args.channelIdentityId,
      },
      userId: args.userId,
      ...(args.tripId ? { tripId: args.tripId } : {}),
    });

    const reply =
      snapshot.pausePrompt ||
      (snapshot.status === 'completed'
        ? `Done. ${paused.def.label} finished — anything else I can help with?`
        : 'Sorry, that step did not complete. Let me know how to proceed.');
    void sendWhatsAppReply(args.msg, reply);
    return true;
  } catch (err) {
    console.error('[wa/webhook] paused-workflow resume failed', {
      messageId: args.msg.messageId,
      channelIdentityId: args.channelIdentityId,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

function whatsappOutboundAccessToken(): string | null {
  return env.whatsappAccessToken() ?? env.kapsoApiKey();
}

function whatsappOutboundApiBaseUrl(): string | undefined {
  return (
    env.whatsappApiBaseUrl() ??
    (env.kapsoApiKey() ? `${env.kapsoApiBaseUrl()}/meta/whatsapp/v24.0` : undefined)
  );
}

/**
 * Surface tool-emitted share cards as native WhatsApp interactive
 * payloads. Delegates to the channel-agnostic dispatcher in
 * `@/lib/channel-send/agent-share-cards`; this wrapper just resolves
 * the install row + recipient + Kapso-mediated credential overrides.
 *
 * Sent BEFORE the agent's text reply so the card is the visible
 * primary; the prose is follow-up commentary. Failures here are
 * non-fatal — the text reply still goes out via `sendWhatsAppReply`.
 */
async function sendShareCards(
  msg: NormalizedInboundMessage,
  cards: DispatchShareCard[]
): Promise<void> {
  const accessToken = whatsappOutboundAccessToken();
  if (!accessToken) return;
  const auditTenantId = await resolveTenantIdForPhoneNumberId(msg.tenantPhoneNumberId);
  if (!auditTenantId) return;

  const install = await prisma.whatsAppInstall.findUnique({
    where: { tenantId: auditTenantId },
  });
  if (!install || install.status === 'disabled' || !install.phoneNumberId) return;
  const recipient = msg.identity.phoneRaw ?? msg.identity.phone ?? '';
  if (!recipient) return;

  const { dispatchAgentShareCardsWhatsApp } = await import('@/lib/channel-send');
  const apiBaseUrl = whatsappOutboundApiBaseUrl();
  const result = await dispatchAgentShareCardsWhatsApp({
    install,
    recipient,
    cards,
    idPrefix: `tr_${msg.messageId}`,
    accessToken,
    ...(apiBaseUrl ? { apiBaseUrl } : {}),
  });
  for (const skip of result.skipped) {
    console.warn('[wa/webhook] share-card send skipped', skip);
  }
}

/**
 * Mark the inbound message as read AND show the typing indicator on
 * the traveler's WhatsApp thread while the agent runs. Cosmetic — any
 * failure here is swallowed so the dispatch path is never blocked.
 *
 * Meta's typing presence auto-clears when the bot's reply lands or
 * after 25s, so we don't need to explicitly turn it off.
 */
async function markReadAndTyping(msg: NormalizedInboundMessage): Promise<void> {
  const accessToken = whatsappOutboundAccessToken();
  if (!accessToken) return;
  try {
    const client = new WhatsAppClient({
      phoneNumberId: msg.tenantPhoneNumberId,
      accessToken,
      apiBaseUrl: whatsappOutboundApiBaseUrl(),
    });
    await client.markReadAndTyping(msg.messageId);
  } catch (err) {
    console.warn('[wa/webhook] markReadAndTyping failed', {
      messageId: msg.messageId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Greeting heuristic for first-touch UX. Matches short greetings only
 * — anything substantive (e.g. "hola, busco vuelo a Lima") flows
 * through the agent so the traveler's actual request is handled.
 */
// biome-ignore lint/suspicious/noMisleadingCharacterClass: emoji ZWJ sequences (🙋‍♂️ / 🙋‍♀️) intentionally combined as optional variants.
const GREETING_PATTERNS =
  /^\s*(hi|hello|hey|hola|buenas?|buen[oa]s?\s+(d[ií]as|tardes|noches)|holi|qué onda|que onda|q[uúù]bo|oi|ol[aá]|bom dia|boa tarde|boa noite|hej|salut|bonjour|ciao|👋|🙋(?:‍♂️|‍♀️)?)\s*[!?.\s]*$/i;

function isGreeting(text: string): boolean {
  return text.length <= 32 && GREETING_PATTERNS.test(text);
}

/** First-touch welcome localized to the traveler's inferred locale. */
function greetingFor(locale: string): string {
  const lang = locale.toLowerCase().slice(0, 2);
  switch (lang) {
    case 'es':
      return '¡Hola! Soy Sendero, tu agente de viajes. Decime a dónde vamos y yo me encargo: vuelos, hoteles, traslados.';
    case 'pt':
      return 'Olá! Sou o Sendero, seu agente de viagens. Diga para onde vamos e eu cuido de tudo: voos, hotéis, traslados.';
    case 'fr':
      return 'Bonjour ! Je suis Sendero, votre agent de voyage. Dites-moi où nous allons : vols, hôtels, transferts.';
    default:
      return "Hi! I'm Sendero, your travel agent. Tell me where we're headed — flights, stays, ground transport, all sorted.";
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

async function upsertChannelIdentity(msg: NormalizedInboundMessage): Promise<{
  id: string;
  tenantId: string;
  userId: string;
  locale: string;
  /** True when the User row was created on this turn — drives first-touch UX. */
  provisional: boolean;
} | null> {
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

  let row: { id: string; tenantId: string; userId: string | null; metadata: unknown } | null = null;
  if (bsuid) {
    row = await prisma.channelIdentity.upsert({
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
  } else if (externalUserId) {
    row = await prisma.channelIdentity.upsert({
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
  }
  if (!row) return null;

  // Auto-provision a Sendero User on first inbound — meter_events.userId
  // is FK'd to users.id, and a brand-new traveler's ChannelIdentity row
  // has userId: null. Mirrors slack-user-mapping's provisional User
  // pattern (`source: 'whatsapp'`, placeholder email, clerkUserId left
  // null until the human signs up).
  let provisional = false;
  let userId = row.userId;
  if (!userId) {
    userId = await ensureUserForWhatsAppIdentity(row.id, msg.identity, bsuid);
    provisional = true;
  }
  return {
    id: row.id,
    tenantId: row.tenantId,
    userId,
    locale: localeFromMetadata(row.metadata, inferredLocale),
    provisional,
  };
}

async function ensureUserForWhatsAppIdentity(
  channelIdentityId: string,
  identity: WhatsAppIdentity,
  bsuid: string | null | undefined
): Promise<string> {
  const handle = (bsuid ?? identity.phone ?? identity.phoneRaw ?? channelIdentityId)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
  const placeholderEmail = `wa-${handle}@whatsapp-provisional.sendero.travel`;
  let userId: string;
  try {
    const created = await prisma.user.create({
      data: { email: placeholderEmail, source: 'whatsapp' },
      select: { id: true },
    });
    userId = created.id;
  } catch {
    // Race: another concurrent inbound provisioned this user already.
    // User.email is globally @unique — re-read.
    const existing = await prisma.user.findUnique({
      where: { email: placeholderEmail },
      select: { id: true },
    });
    if (!existing) throw new Error('whatsapp_user_provision_failed');
    userId = existing.id;
  }
  await prisma.channelIdentity.update({
    where: { id: channelIdentityId },
    data: { userId },
  });
  return userId;
}

function localeFromMetadata(metadata: unknown, fallback: string): string {
  if (metadata && typeof metadata === 'object' && 'locale' in metadata) {
    const locale = (metadata as Record<string, unknown>).locale;
    if (typeof locale === 'string' && locale) return locale;
  }
  return fallback;
}

/**
 * Match a status update to its outbound row(s) and reconcile.
 *
 * The wamid (`status.messageId`) is what we wrote into
 * `OtpDeliveryAttempt.providerMessageId` when we dispatched the OTP, so
 * `updateMany` on that column fans out to all matching audit rows
 * (typically one). Returns the count for the response payload's
 * `statusUpdated` counter.
 *
 * `failed` carries a non-null `failureReason`; non-failed updates leave
 * the prior `failureReason` alone (it might still be informative — e.g.
 * a partial-failure in a batch). We do NOT downgrade — Meta's status
 * stream is roughly monotonic (sent → delivered → read, or sent →
 * failed), and stale 'sent' updates after a 'delivered' would be rare;
 * if they happen we accept the noise rather than read-then-write each
 * row. Worth revisiting if ops sees flapping.
 */
async function applyOtpStatusUpdate(status: NormalizedStatusUpdate): Promise<number> {
  const data: { deliveryStatus: string; failureReason?: string } = {
    deliveryStatus: status.status,
  };
  if (status.failureReason) data.failureReason = status.failureReason;

  const [otpResult, outboundCount] = await Promise.all([
    prisma.otpDeliveryAttempt.updateMany({
      where: {
        providerMessageId: status.messageId,
        channel: 'whatsapp',
      },
      data,
    }),
    // Also reconcile the canonical outbound audit row. A given wamid
    // appears in OtpDeliveryAttempt OR WhatsAppOutboundMessage (or both
    // during the migration window), so we update both unconditionally.
    reconcileOutboundStatus({
      wamid: status.messageId,
      status: status.status,
      failureReason: status.failureReason,
      at: status.timestamp,
    }),
  ]);
  // Return the maximum of the two counts so the response payload's
  // `statusUpdated` counter reflects "at least one row was reconciled".
  return Math.max(otpResult.count, outboundCount);
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

/**
 * Pre-booking ancillary picker tap routing — WhatsApp interactive list
 * reply whose row id encodes seat or bag staging payload. Decodes the
 * id, POSTs to `/api/tools/select_seat` or `/api/tools/add_baggage`
 * with `travelerPhone` so the tools route resolves the Sendero User
 * via the existing phone-based path. Returns true when the tap was
 * routed (caller skips agent dispatch); false when the row id was
 * unrecognized or malformed (caller falls through to the agent).
 */
async function routeAncillaryRowId(args: {
  rowId: string;
  tenantId: string;
  travelerPhone: string | null;
}): Promise<boolean> {
  const parts = args.rowId.split(':');
  if (parts.length < 5) return false;
  const [kind, tripId, offerId, passengerId, serviceId, ...rest] = parts;
  if (!tripId || !offerId || !passengerId || !serviceId) return false;
  // Final segment(s) carry the human-readable label/designator. WhatsApp
  // row ids don't contain colons themselves, but we joined with `:` so
  // splice back in case the label contained one.
  const label = rest.join(':');

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3010';
  const secret = process.env.AGENT_DISPATCH_SECRET ?? process.env.CRON_SECRET ?? '';
  if (!secret) return false;

  const headers = {
    'Content-Type': 'application/json',
    'x-sendero-dispatch-secret': secret,
  };

  if (kind === 'select_seat') {
    await fetch(`${baseUrl.replace(/\/$/, '')}/api/tools/select_seat`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        tenantId: args.tenantId,
        ...(args.travelerPhone ? { travelerPhone: args.travelerPhone } : {}),
        input: {
          tripId,
          offerId,
          passengerId,
          seatServiceId: serviceId,
          ...(label ? { designator: label } : {}),
        },
      }),
    }).catch(err => console.warn('[wa/webhook] select_seat tap failed', err));
    return true;
  }

  if (kind === 'add_bag') {
    await fetch(`${baseUrl.replace(/\/$/, '')}/api/tools/add_baggage`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        tenantId: args.tenantId,
        ...(args.travelerPhone ? { travelerPhone: args.travelerPhone } : {}),
        input: {
          tripId,
          offerId,
          passengerId,
          bagServiceId: serviceId,
          quantity: 1,
          ...(label ? { label } : {}),
        },
      }),
    }).catch(err => console.warn('[wa/webhook] add_baggage tap failed', err));
    return true;
  }

  return false;
}
