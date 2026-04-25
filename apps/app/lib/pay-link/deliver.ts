/**
 * Pay-link delivery orchestrator.
 *
 * Steps 4 + 5 of the traveler-wallet queue. Issues a fresh
 * `BookingPayToken` (Step 4 helper) and pushes the resulting magic
 * link to whichever traveler-side channels we have an identity on
 * — WhatsApp first, email always. Each channel send is best-effort
 * and isolated: a WhatsApp failure does NOT prevent the email send,
 * and vice versa, so the operator-facing UI can report partial
 * success rather than collapse to "delivery failed".
 *
 * Channel resolution:
 *   - WhatsApp: `ChannelIdentity` row keyed on (tenantId, userId,
 *     kind='whatsapp'); send via `sendChannelMessageWhatsApp` with
 *     a canonical card. Skip when the tenant has no `WhatsAppInstall`
 *     active or the traveler has no WA identity.
 *   - Email: `User.email` (always present). Send via
 *     `notifier().sendPayLink`. Skip when notifications are not
 *     configured.
 *
 * This module never decides *whether* to issue a link — that's the
 * caller's policy (typically post-prefund). It just turns "deliver
 * a pay link for booking X" into actual outbound notifications.
 */

import { prisma } from '@sendero/database';
import {
  createNotifier,
  notificationsConfigured,
  type SendResult,
} from '@sendero/notifications';

import { sendChannelMessageWhatsApp } from '@/lib/channel-send/whatsapp';
import type { ChannelMessage } from '@/lib/channel-render';

import { issueBookingPayToken, type IssuedPayToken } from './issue';

export interface DeliverPayLinkArgs {
  tenantId: string;
  bookingId: string;
  /** Override the default 30-minute TTL when caller wants longer / shorter. */
  ttlMinutes?: number;
}

export interface ChannelDeliveryResult {
  channel: 'whatsapp' | 'email';
  ok: boolean;
  /** Provider message id when ok. */
  id?: string;
  /** Why this channel was skipped or failed. */
  reason?: string;
}

export interface DeliverPayLinkResult {
  kind: 'delivered' | 'no_channels' | 'rejected';
  token?: IssuedPayToken;
  channels: ChannelDeliveryResult[];
  /** Populated when kind === 'rejected'. */
  message?: string;
}

interface BookingContext {
  id: string;
  totalUsd: import('@prisma/client').Prisma.Decimal;
  currency: string;
  supplier: { name: string | null } | null;
  trip: {
    id: string;
    travelerId: string | null;
    intent: unknown;
    traveler: { id: string; displayName: string | null; email: string; phone: string | null } | null;
  };
  tenant: { id: string; displayName: string };
}

export async function deliverPayLinkForBooking(
  args: DeliverPayLinkArgs
): Promise<DeliverPayLinkResult> {
  const ctx = await loadBookingContext(args.tenantId, args.bookingId);
  if (!ctx) {
    return {
      kind: 'rejected',
      channels: [],
      message: 'Booking not found in this tenant.',
    };
  }
  if (!ctx.trip.traveler) {
    return {
      kind: 'rejected',
      channels: [],
      message: 'Booking has no traveler — cannot deliver a pay link.',
    };
  }

  const token = await issueBookingPayToken({
    tenantId: ctx.tenant.id,
    bookingId: ctx.id,
    ttlMinutes: args.ttlMinutes,
  });

  const amount = ctx.totalUsd.toFixed(2);
  const currency = ctx.currency;
  const supplierName = ctx.supplier?.name ?? 'your travel supplier';
  const tripSummary = summarizeTrip(ctx.trip.intent) ?? 'your trip';

  const [whatsappResult, emailResult] = await Promise.all([
    deliverWhatsApp({ ctx, token, amount, currency, supplierName, tripSummary }),
    deliverEmail({ ctx, token, amount, currency, supplierName, tripSummary }),
  ]);

  const channels = [whatsappResult, emailResult].filter(
    (r): r is ChannelDeliveryResult => r !== null
  );
  const anyOk = channels.some(c => c.ok);

  return {
    kind: anyOk ? 'delivered' : 'no_channels',
    token,
    channels,
  };
}

async function loadBookingContext(
  tenantId: string,
  bookingId: string
): Promise<BookingContext | null> {
  return prisma.booking.findFirst({
    where: { id: bookingId, tenantId },
    select: {
      id: true,
      totalUsd: true,
      currency: true,
      supplier: { select: { name: true } },
      trip: {
        select: {
          id: true,
          travelerId: true,
          intent: true,
          traveler: {
            select: { id: true, displayName: true, email: true, phone: true },
          },
        },
      },
      tenant: { select: { id: true, displayName: true } },
    },
  });
}

interface DeliveryShared {
  ctx: BookingContext;
  token: IssuedPayToken;
  amount: string;
  currency: string;
  supplierName: string;
  tripSummary: string;
}

async function deliverWhatsApp(args: DeliveryShared): Promise<ChannelDeliveryResult | null> {
  const traveler = args.ctx.trip.traveler;
  if (!traveler) return { channel: 'whatsapp', ok: false, reason: 'no_traveler' };

  const identity = await prisma.channelIdentity.findFirst({
    where: {
      tenantId: args.ctx.tenant.id,
      userId: traveler.id,
      kind: 'whatsapp',
      externalUserId: { not: null },
    },
    select: { externalUserId: true },
  });
  if (!identity?.externalUserId) {
    return { channel: 'whatsapp', ok: false, reason: 'no_whatsapp_identity' };
  }

  const install = await prisma.whatsAppInstall.findUnique({
    where: { tenantId: args.ctx.tenant.id },
  });
  if (!install || install.status !== 'active') {
    return { channel: 'whatsapp', ok: false, reason: 'no_active_install' };
  }

  const message: ChannelMessage = {
    kind: 'card',
    id: `pay_link_${args.token.id}`,
    author: {
      role: 'agent',
      name: args.ctx.tenant.displayName,
    },
    title: 'Confirm your booking',
    body: `${args.ctx.tenant.displayName} pre-funded your travel balance. Tap to confirm ${args.currency} ${args.amount} to ${args.supplierName} for ${args.tripSummary}.`,
    bullets: [
      `Amount: ${args.currency} ${args.amount}`,
      `Supplier: ${args.supplierName}`,
      `Single-use link · expires soon`,
    ],
    ctas: [
      {
        label: 'Confirm payment',
        kind: 'open_link',
        href: args.token.url,
        emphasis: 'primary',
      },
    ],
    createdAt: new Date().toISOString(),
  };

  try {
    const sendResult = await sendChannelMessageWhatsApp({
      install,
      recipient: identity.externalUserId,
      message,
    });
    if (sendResult.sent === true) {
      return { channel: 'whatsapp', ok: true };
    }
    return { channel: 'whatsapp', ok: false, reason: sendResult.reason };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.warn('[deliverPayLink] WhatsApp send failed', { reason });
    return { channel: 'whatsapp', ok: false, reason: reason.slice(0, 200) };
  }
}

async function deliverEmail(args: DeliveryShared): Promise<ChannelDeliveryResult | null> {
  const traveler = args.ctx.trip.traveler;
  if (!traveler) return { channel: 'email', ok: false, reason: 'no_traveler' };
  if (!notificationsConfigured()) {
    return { channel: 'email', ok: false, reason: 'notifications_not_configured' };
  }
  const notifier = createNotifier();

  let result: SendResult;
  try {
    result = await notifier.sendPayLink(traveler.email, {
      travelerName: traveler.displayName ?? traveler.email,
      operatorName: args.ctx.tenant.displayName,
      amount: args.amount,
      currency: args.currency,
      supplierName: args.supplierName,
      tripSummary: args.tripSummary,
      expiresAtIso: args.token.expiresAt.toISOString(),
      payUrl: args.token.url,
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.warn('[deliverPayLink] email send threw', { reason });
    return { channel: 'email', ok: false, reason: reason.slice(0, 200) };
  }

  if (!result.ok) {
    return { channel: 'email', ok: false, reason: result.error ?? 'unknown_error' };
  }
  return { channel: 'email', ok: true, id: result.id };
}

function summarizeTrip(intent: unknown): string | null {
  if (!intent || typeof intent !== 'object') return null;
  const it = intent as { origin?: string; dest?: string; destination?: string; dates?: unknown };
  const dest = it.destination ?? it.dest;
  if (it.origin && dest) return `${it.origin} → ${dest}`;
  if (dest) return String(dest);
  return null;
}
