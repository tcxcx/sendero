/**
 * Booking reconciliation post-spend.
 *
 * Step 6 of the traveler-wallet queue. When a `TransferAttempt`
 * flips to `executed` for a row whose `metadata.bookingId` is set,
 * the underlying booking moves from `pending` -> `confirmed`. This
 * keeps `Booking.status` honest for any surface that doesn't poll
 * the on-chain layer (operator console, traveler trip view, invoice
 * generator). The Slack approval flow already does the same flip
 * on operator approval — this is the spend-driven counterpart.
 *
 * Best-effort notifications fan out to the traveler over WhatsApp +
 * email. Notification failures are isolated and logged: the booking
 * flip is the source of truth and never rolls back on a failed
 * email/WA send.
 *
 * The status update uses a *conditional* update (`where: { id,
 * status: 'pending' }`) so two parallel reconciliations for the same
 * booking can't double-confirm — one wins, the other returns `noop`.
 * Idempotent under retry.
 */

import { prisma } from '@sendero/database';
import {
  createNotifier,
  notificationsConfigured,
  type SendResult,
} from '@sendero/notifications';

import { sendChannelMessageWhatsApp } from '@/lib/channel-send/whatsapp';
import type { ChannelMessage } from '@/lib/channel-render';

export interface ReconcileArgs {
  tenantId: string;
  bookingId: string;
  attemptId: string;
  txHash: string | null;
}

export interface ReconcileChannelResult {
  channel: 'whatsapp' | 'email';
  ok: boolean;
  id?: string;
  reason?: string;
}

export type ReconcileResult =
  | {
      kind: 'reconciled';
      bookingId: string;
      previousStatus: 'pending';
      notifications: ReconcileChannelResult[];
    }
  | {
      kind: 'noop';
      bookingId: string;
      reason: 'not_pending' | 'not_found' | 'lost_race';
    }
  | {
      kind: 'failed';
      bookingId: string;
      message: string;
    };

interface BookingContext {
  id: string;
  status: string;
  pnr: string | null;
  totalUsd: import('@prisma/client').Prisma.Decimal;
  metadata: unknown;
  segments: unknown;
  trip: {
    id: string;
    intent: unknown;
    traveler: {
      id: string;
      email: string;
      displayName: string | null;
    } | null;
  };
  tenant: { id: string; displayName: string };
  supplier: { name: string | null } | null;
}

export async function reconcileBookingAfterSpend(
  args: ReconcileArgs
): Promise<ReconcileResult> {
  const ctx = await loadBooking(args.tenantId, args.bookingId);
  if (!ctx) return { kind: 'noop', bookingId: args.bookingId, reason: 'not_found' };
  if (ctx.status !== 'pending') {
    return { kind: 'noop', bookingId: args.bookingId, reason: 'not_pending' };
  }

  // Conditional flip — only the first reconciliation (per booking) wins.
  // Prisma's `updateMany` returns a count; 0 = lost the race to another
  // reconciler that already moved the row out of 'pending'.
  const baseMetadata = (ctx.metadata && typeof ctx.metadata === 'object' ? ctx.metadata : {}) as Record<
    string,
    unknown
  >;
  const merged = {
    ...baseMetadata,
    settledBy: 'transfer_attempt',
    settledAttemptId: args.attemptId,
    settledTxHash: args.txHash,
    settledAt: new Date().toISOString(),
  };

  let writeCount: number;
  try {
    const updated = await prisma.booking.updateMany({
      where: { id: args.bookingId, tenantId: args.tenantId, status: 'pending' },
      data: {
        status: 'confirmed',
        metadata: merged as import('@prisma/client').Prisma.InputJsonValue,
      },
    });
    writeCount = updated.count;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[reconcileBookingAfterSpend] booking flip failed', { message });
    return { kind: 'failed', bookingId: args.bookingId, message };
  }
  if (writeCount === 0) {
    return { kind: 'noop', bookingId: args.bookingId, reason: 'lost_race' };
  }

  const [whatsappResult, emailResult] = await Promise.all([
    notifyWhatsApp(ctx, args),
    notifyEmail(ctx, args),
  ]);

  const notifications = [whatsappResult, emailResult].filter(
    (r): r is ReconcileChannelResult => r !== null
  );

  return {
    kind: 'reconciled',
    bookingId: args.bookingId,
    previousStatus: 'pending',
    notifications,
  };
}

async function loadBooking(tenantId: string, bookingId: string): Promise<BookingContext | null> {
  return prisma.booking.findFirst({
    where: { id: bookingId, tenantId },
    select: {
      id: true,
      status: true,
      pnr: true,
      totalUsd: true,
      metadata: true,
      segments: true,
      trip: {
        select: {
          id: true,
          intent: true,
          traveler: { select: { id: true, email: true, displayName: true } },
        },
      },
      tenant: { select: { id: true, displayName: true } },
      supplier: { select: { name: true } },
    },
  });
}

async function notifyWhatsApp(
  ctx: BookingContext,
  args: ReconcileArgs
): Promise<ReconcileChannelResult> {
  const traveler = ctx.trip.traveler;
  if (!traveler) return { channel: 'whatsapp', ok: false, reason: 'no_traveler' };

  const identity = await prisma.channelIdentity.findFirst({
    where: {
      tenantId: ctx.tenant.id,
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
    where: { tenantId: ctx.tenant.id },
  });
  if (!install || install.status !== 'active') {
    return { channel: 'whatsapp', ok: false, reason: 'no_active_install' };
  }

  const supplierName = ctx.supplier?.name ?? 'your supplier';
  const amount = ctx.totalUsd.toFixed(2);
  const tripSummary = summarizeTrip(ctx.trip.intent) ?? 'your trip';

  const message: ChannelMessage = {
    kind: 'card',
    id: `booking_confirmed_${args.attemptId}`,
    author: { role: 'agent', name: ctx.tenant.displayName },
    title: 'Booking confirmed',
    body: `Your $${amount} payment to ${supplierName} for ${tripSummary} has been settled. We'll send your itinerary as soon as ticketing completes.`,
    bullets: [
      `Reference: ${ctx.pnr ?? args.bookingId}`,
      args.txHash ? `On-chain: ${args.txHash.slice(0, 16)}…` : `Attempt: ${args.attemptId.slice(0, 12)}`,
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
    console.warn('[reconcile] WhatsApp send failed', { reason });
    return { channel: 'whatsapp', ok: false, reason: reason.slice(0, 200) };
  }
}

async function notifyEmail(
  ctx: BookingContext,
  args: ReconcileArgs
): Promise<ReconcileChannelResult> {
  const traveler = ctx.trip.traveler;
  if (!traveler?.email) return { channel: 'email', ok: false, reason: 'no_traveler_email' };
  if (!notificationsConfigured()) {
    return { channel: 'email', ok: false, reason: 'notifications_not_configured' };
  }

  const tripSummary = summarizeTrip(ctx.trip.intent) ?? 'your upcoming trip';
  const departureSummary = summarizeFirstSegment(ctx.segments) ?? tripSummary;
  const tripUrl = buildTripUrl(ctx.trip.id);
  const notifier = createNotifier();

  let result: SendResult;
  try {
    result = await notifier.sendHoldConfirmed(traveler.email, {
      tripSummary,
      travelerName: traveler.displayName ?? 'Traveler',
      pnr: ctx.pnr ?? args.bookingId,
      departureSummary,
      tripUrl,
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.warn('[reconcile] hold-confirmed email threw', { reason });
    return { channel: 'email', ok: false, reason: reason.slice(0, 200) };
  }
  if (!result.ok) {
    return { channel: 'email', ok: false, reason: result.error ?? 'unknown_error' };
  }
  return { channel: 'email', ok: true, id: result.id };
}

function summarizeTrip(intent: unknown): string | null {
  if (!intent || typeof intent !== 'object') return null;
  const i = intent as { origin?: unknown; dest?: unknown; destination?: unknown };
  const origin = typeof i.origin === 'string' ? i.origin : null;
  const dest =
    typeof i.dest === 'string' ? i.dest : typeof i.destination === 'string' ? i.destination : null;
  if (origin && dest) return `${origin} → ${dest}`;
  if (dest) return String(dest);
  return null;
}

function summarizeFirstSegment(segments: unknown): string | null {
  if (!Array.isArray(segments) || segments.length === 0) return null;
  const first = segments[0] as Record<string, unknown>;
  const origin = typeof first.origin === 'string' ? first.origin : null;
  const dest = typeof first.destination === 'string' ? first.destination : null;
  const depart =
    typeof first.departAt === 'string'
      ? first.departAt
      : typeof first.departingAt === 'string'
        ? first.departingAt
        : null;
  const parts = [origin && dest ? `${origin} → ${dest}` : (origin ?? dest), depart].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}

function buildTripUrl(tripId: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') ?? 'https://app.sendero.travel';
  return `${base}/dashboard/console?tripId=${encodeURIComponent(tripId)}`;
}
