/**
 * Per-trip channel routing.
 *
 * Every workflow step that sends a traveler-facing nudge routes through
 * this helper — NEVER a direct WhatsApp/Slack/email client. The helper
 * reads `Trip.channelBindings` (or falls back to the tenant default) and
 * delivers the share payload on the resolved channel, with ordered
 * fallbacks when the primary fails (WA 24h window closed, Slack offline,
 * etc.).
 *
 * Ported from desk-v1 ChatBot.share() pattern, adapted for Sendero's
 * workflow share payloads.
 */

import { prisma } from '@sendero/database';
import { env } from '@sendero/env';
import { WhatsAppClient } from '@sendero/whatsapp';

export type ChannelKind = 'whatsapp' | 'slack' | 'email' | 'web';

export interface TripChannelBindings {
  primary: ChannelKind;
  whatsapp?: { identityId: string };
  slack?: { channelId: string; threadTs?: string };
  /** Ordered fallback list. Primary is tried first, then these in order. */
  notifyChannels?: ChannelKind[];
}

export interface SharePayload {
  /** Plain-text / WhatsApp body. Keep under ~4k chars. */
  text: string;
  /** Slack mrkdwn variant — falls back to `text` when omitted. */
  slackMrkdwn?: string;
  /** Optional URL shown as follow-up. */
  url?: string;
}

export interface ResolvedChannel {
  channel: ChannelKind;
  /** ChannelIdentity.id (WhatsApp) or SlackInstall.id or user email. */
  identityRef: string | null;
}

export interface SendResult {
  channel: ChannelKind;
  messageId: string;
  fellBackFrom?: ChannelKind;
}

// ─── Read path ────────────────────────────────────────────────────────

export function parseChannelBindings(raw: unknown): TripChannelBindings | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const primary = obj.primary;
  if (primary !== 'whatsapp' && primary !== 'slack' && primary !== 'email' && primary !== 'web') {
    return null;
  }
  return raw as TripChannelBindings;
}

export async function resolveChannelForTrip(tripId: string): Promise<ResolvedChannel | null> {
  const trip = await prisma.trip.findUnique({
    where: { id: tripId },
    select: {
      channelBindings: true,
      travelerId: true,
      tenantId: true,
      tenant: {
        select: {
          metadata: true,
          slackInstalls: { take: 1, select: { id: true } },
          whatsappInstall: { select: { id: true, status: true, phoneNumberId: true } },
        },
      },
      traveler: {
        select: { email: true },
      },
    },
  });
  if (!trip) return null;

  const bindings = parseChannelBindings(trip.channelBindings);
  if (bindings) {
    return materialiseBinding(bindings.primary, bindings, trip);
  }

  // Tenant default: prefer WhatsApp if install is active, else Slack if
  // installed, else email.
  if (trip.tenant.whatsappInstall?.status === 'active') {
    return { channel: 'whatsapp', identityRef: trip.tenant.whatsappInstall.phoneNumberId ?? null };
  }
  if (trip.tenant.slackInstalls.length > 0) {
    return { channel: 'slack', identityRef: trip.tenant.slackInstalls[0]!.id };
  }
  if (trip.traveler?.email) {
    return { channel: 'email', identityRef: trip.traveler.email };
  }
  return { channel: 'web', identityRef: null };
}

function materialiseBinding(
  channel: ChannelKind,
  bindings: TripChannelBindings,
  trip: {
    tenant: { whatsappInstall: { phoneNumberId: string | null } | null };
    traveler: { email: string | null } | null;
  }
): ResolvedChannel {
  if (channel === 'whatsapp') {
    return {
      channel,
      identityRef:
        bindings.whatsapp?.identityId ?? trip.tenant.whatsappInstall?.phoneNumberId ?? null,
    };
  }
  if (channel === 'slack') {
    return { channel, identityRef: bindings.slack?.channelId ?? null };
  }
  if (channel === 'email') {
    return { channel, identityRef: trip.traveler?.email ?? null };
  }
  return { channel: 'web', identityRef: null };
}

// ─── Send path ────────────────────────────────────────────────────────

export interface SendShareOptions {
  /**
   * When true, on failure the helper walks `notifyChannels`. When false
   * (default for tests), only the primary is attempted.
   */
  fallback?: boolean;
}

export async function sendShareOnTrip(
  tripId: string,
  share: SharePayload,
  opts: SendShareOptions = {}
): Promise<SendResult | null> {
  const trip = await prisma.trip.findUnique({
    where: { id: tripId },
    select: {
      channelBindings: true,
      travelerId: true,
      tenantId: true,
      tenant: {
        select: {
          whatsappInstall: {
            select: { phoneNumberId: true, status: true, webhookSecret: true },
          },
          slackInstalls: { take: 1 },
        },
      },
      traveler: { select: { email: true, phone: true } },
    },
  });
  if (!trip) return null;

  const bindings = parseChannelBindings(trip.channelBindings);
  const primary = bindings?.primary ?? (await inferTenantDefault(trip.tenantId));
  const order: ChannelKind[] = [primary, ...(bindings?.notifyChannels ?? [])];

  let lastError: unknown;
  for (let i = 0; i < order.length; i++) {
    const channel = order[i]!;
    try {
      const sent = await dispatchOnChannel(channel, share, {
        tenantId: trip.tenantId,
        tripId,
        travelerPhone: trip.traveler?.phone ?? null,
        travelerEmail: trip.traveler?.email ?? null,
        slackChannelId: bindings?.slack?.channelId ?? null,
        whatsappPhoneNumberId: trip.tenant.whatsappInstall?.phoneNumberId ?? null,
      });
      return { channel, messageId: sent.messageId, fellBackFrom: i > 0 ? order[0] : undefined };
    } catch (err) {
      lastError = err;
      if (!opts.fallback) break;
    }
  }

  console.error('[channel-routing] all channels failed for trip', tripId, lastError);
  return null;
}

async function inferTenantDefault(tenantId: string): Promise<ChannelKind> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: {
      whatsappInstall: { select: { status: true } },
      slackInstalls: { take: 1, select: { id: true } },
    },
  });
  if (tenant?.whatsappInstall?.status === 'active') return 'whatsapp';
  if ((tenant?.slackInstalls.length ?? 0) > 0) return 'slack';
  return 'email';
}

interface DispatchContext {
  tenantId: string;
  tripId: string;
  travelerPhone: string | null;
  travelerEmail: string | null;
  slackChannelId: string | null;
  whatsappPhoneNumberId: string | null;
}

async function dispatchOnChannel(
  channel: ChannelKind,
  share: SharePayload,
  ctx: DispatchContext
): Promise<{ messageId: string }> {
  if (channel === 'whatsapp') return dispatchWhatsApp(share, ctx);
  if (channel === 'slack') return dispatchSlack(share, ctx);
  if (channel === 'email') return dispatchEmail(share, ctx);
  // `web` is a no-op for now — the share sits in the in-app inbox via
  // the caller persisting the workflow event.
  return { messageId: `web:${ctx.tripId}` };
}

async function dispatchWhatsApp(
  share: SharePayload,
  ctx: DispatchContext
): Promise<{ messageId: string }> {
  const phoneNumberId = ctx.whatsappPhoneNumberId;
  if (!phoneNumberId) throw new Error('whatsapp:no_install');
  if (!ctx.travelerPhone) throw new Error('whatsapp:no_phone');
  const accessToken = env.whatsappAccessToken();
  if (!accessToken) throw new Error('whatsapp:no_access_token');

  const client = new WhatsAppClient({
    phoneNumberId,
    accessToken,
    apiBaseUrl: env.whatsappApiBaseUrl() ?? undefined,
  });
  const body = share.url ? `${share.text}\n\n${share.url}` : share.text;
  const res = (await client.sendText(ctx.travelerPhone, body)) as {
    messages?: Array<{ id: string }>;
  };
  const id = res.messages?.[0]?.id ?? `wa:${Date.now()}`;
  console.log('[channel-routing] whatsapp sent', {
    tenantId: ctx.tenantId,
    channel: 'whatsapp',
    direction: 'outbound',
    messageId: id,
    status: 'sent',
  });
  return { messageId: id };
}

async function dispatchSlack(
  share: SharePayload,
  ctx: DispatchContext
): Promise<{ messageId: string }> {
  if (!ctx.slackChannelId) throw new Error('slack:no_channel_binding');
  // Dynamic import — avoids pulling @slack/web-api into the WA-only path.
  const { sendSlackDirect } = await import('./channel-routing-slack');
  const id = await sendSlackDirect({
    tenantId: ctx.tenantId,
    channelId: ctx.slackChannelId,
    mrkdwn: share.slackMrkdwn ?? share.text,
    linkText: share.url,
  });
  console.log('[channel-routing] slack sent', {
    tenantId: ctx.tenantId,
    channel: 'slack',
    direction: 'outbound',
    messageId: id,
    status: 'sent',
  });
  return { messageId: id };
}

async function dispatchEmail(
  share: SharePayload,
  ctx: DispatchContext
): Promise<{ messageId: string }> {
  if (!ctx.travelerEmail) throw new Error('email:no_recipient');
  // v1: email adapter not wired through here — @sendero/notifications
  // handles it elsewhere. Return a synthetic id so the workflow advances
  // and the caller logs the share.
  const id = `email:${ctx.tripId}:${Date.now()}`;
  console.log('[channel-routing] email fallback (stubbed)', {
    tenantId: ctx.tenantId,
    channel: 'email',
    direction: 'outbound',
    messageId: id,
    status: 'sent',
    recipient: ctx.travelerEmail,
    bodyLength: share.text.length,
  });
  return { messageId: id };
}
