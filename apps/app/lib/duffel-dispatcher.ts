/**
 * Given a verified Duffel webhook event, find the matching Booking
 * and resume its paused workflow run. The resolution merged into the
 * scratchpad lives under the pause step's id so the next branch step
 * can read `$('await_duffel_ticket.status')`.
 *
 * Matching: Booking.duffelOrderId (global unique) → booking row →
 * Booking.metadata.workflow.snapshot → resume.
 *
 * If no booking matches the orderId, we return matched:false. The
 * route treats that as 200 so Duffel stops retrying.
 */

import { prisma } from '@sendero/database';
import { bookFlightWorkflow, guestPrefundWorkflow } from '@sendero/workflows/catalog';
import { resumeRun, type ToolRegistry, type WorkflowRun } from '@sendero/workflows';
import type { DuffelAirlineCreditWire, DuffelWebhookEvent } from '@sendero/duffel';
import { getAirlineCredit } from '@sendero/duffel';
import { notifier } from '@sendero/notifications';
import { env } from '@sendero/env';

import { upsertAirlineCredit } from './airline-credits-sync';
import { makeToolRegistry } from './tool-registry';
import { persistPausedRun, readPausedRun } from './workflow-pause';
import { getTenantNotificationEmail } from './tenant-notification-email';

export async function dispatchDuffelEvent(args: {
  event: DuffelWebhookEvent;
  /**
   * Optional tool-registry override. Production leaves this unset so the
   * default @sendero/tools handlers (which return encoded on-chain calls)
   * are used — downstream infra is responsible for submission. Smoke
   * tests inject a submitting registry so the full chain can be exercised
   * in one run. See scripts/smoke-webhook-resume-settle.ts.
   */
  tools?: ToolRegistry;
}): Promise<{ matched: boolean; runId?: string; run?: WorkflowRun }> {
  // Airline credit lifecycle hits a different resource type (acd_…).
  // Snapshot it into our Prisma cache first — and short-circuit before
  // the booking lookup so we don't log `no booking for acd_…`.
  if (args.event.type === 'service.refunded' || args.event.orderId.startsWith('acd_')) {
    try {
      const wire = (await getAirlineCredit(args.event.orderId)) as DuffelAirlineCreditWire;
      await upsertAirlineCredit(wire);
    } catch (err) {
      console.warn('[duffel-dispatcher] airline credit sync failed', err);
    }
    if (args.event.orderId.startsWith('acd_')) {
      return { matched: true };
    }
  }

  const booking = await prisma.booking.findUnique({
    where: { duffelOrderId: args.event.orderId },
    select: { id: true, tenantId: true, tripId: true, metadata: true },
  });
  if (!booking) {
    console.warn('[duffel-dispatcher] no booking for duffelOrderId', args.event.orderId);
    return { matched: false };
  }

  const paused = readPausedRun(booking.metadata);
  if (!paused) {
    console.warn('[duffel-dispatcher] booking has no paused workflow', booking.id);
    return { matched: false };
  }

  const workflow =
    paused.workflowId === bookFlightWorkflow.id
      ? bookFlightWorkflow
      : paused.workflowId === guestPrefundWorkflow.id
        ? guestPrefundWorkflow
        : null;
  if (!workflow) {
    console.warn('[duffel-dispatcher] unknown workflow id', paused.workflowId);
    return { matched: false, runId: paused.runId };
  }

  // Canonical mapping from Duffel webhook status → workflow resolution.
  // 'ticketed' happy path; 'schedule_changed' and 'cancelled' are new
  // lifecycle branches that paused workflows can opt into. 'refunded'
  // and 'pending' collapse to 'failed' (so the default book_flight
  // workflow routes through cancel_booking); dedicated
  // cancellation/change workflows read the richer `status` directly.
  const resolutionStatus =
    args.event.status === 'ticketed'
      ? 'ticketed'
      : args.event.status === 'cancelled'
        ? 'cancelled'
        : args.event.status === 'schedule_changed'
          ? 'schedule_changed'
          : args.event.status === 'refunded'
            ? 'refunded'
            : 'failed';
  const resumed = await resumeRun({
    workflow,
    run: paused.snapshot,
    resolution: {
      status: resolutionStatus,
      duffelOrderId: args.event.orderId,
      eventType: args.event.type,
    },
    tools: args.tools ?? makeToolRegistry(),
  });

  // Persist the resumed snapshot so the booking metadata reflects the
  // completed (or failed) run. Consumers can inspect the trail for the
  // tool outputs (onchainCall encodings) without having to replay.
  await persistPausedRun({
    bookingId: booking.id,
    workflow,
    run: resumed,
  });

  // Email the traveler (and cc the tenant admin) on a successful
  // ticketing. Slack-installed tenants get the same data via the
  // approval card resolution; this covers email-only tenants and
  // ticketings that came through without an operator approval (e.g.
  // auto-approved under-cap holds). Fails-soft: a Resend error
  // never blocks the webhook ack.
  if (resolutionStatus === 'ticketed') {
    void emailBookingConfirmed({
      bookingId: booking.id,
      tenantId: booking.tenantId,
      duffelOrderId: args.event.orderId,
    });
    // D2: WhatsApp BOOKING_CONFIRMED template + kick off the BoardingPass
    // stamp WDK workflow. Both are fire-and-forget; the WhatsApp template
    // gives the traveler immediate native confirmation, the stamp
    // workflow eventually surfaces a deep-link to the on-chain proof.
    void notifyWhatsAppOnBooking({
      bookingId: booking.id,
      tenantId: booking.tenantId,
      duffelOrderId: args.event.orderId,
    });
    void kickOffBoardingPassStamp({
      bookingId: booking.id,
      tripId: booking.tripId,
    });
  }

  return { matched: true, runId: paused.runId, run: resumed };
}

interface BookingForEmail {
  pnr: string | null;
  totalUsd: { toFixed: (n: number) => string } | string | number | null;
  currency: string;
  segments: unknown;
  trip: {
    id: string;
    intent: unknown;
    traveler: { email: string | null; displayName: string | null } | null;
  } | null;
}

async function emailBookingConfirmed(args: {
  bookingId: string;
  tenantId: string;
  duffelOrderId: string;
}): Promise<void> {
  try {
    const row = (await prisma.booking.findUnique({
      where: { id: args.bookingId },
      select: {
        pnr: true,
        totalUsd: true,
        currency: true,
        segments: true,
        trip: {
          select: {
            id: true,
            intent: true,
            traveler: { select: { email: true, displayName: true } },
          },
        },
      },
    })) as BookingForEmail | null;
    if (!row || !row.trip) return;

    const travelerEmail = row.trip.traveler?.email ?? null;
    const intent = (row.trip.intent ?? null) as { tripSummary?: string } | null;
    const tripSummary = intent?.tripSummary ?? `Trip ${row.trip.id.slice(0, 12)}…`;
    const totalAmount =
      typeof row.totalUsd === 'object' && row.totalUsd && 'toFixed' in row.totalUsd
        ? row.totalUsd.toFixed(2)
        : String(row.totalUsd ?? '0.00');
    const segments = Array.isArray(row.segments)
      ? (row.segments as Array<Record<string, unknown>>)
      : [];
    const linkOrigin = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3010';
    const tripUrl = `${linkOrigin.replace(/\/$/, '')}/dashboard/console?tripId=${encodeURIComponent(row.trip.id)}`;

    const recipients = new Set<string>();
    if (travelerEmail) recipients.add(travelerEmail);
    const adminEmail = await getTenantNotificationEmail(args.tenantId);
    if (adminEmail && adminEmail !== travelerEmail) recipients.add(adminEmail);
    if (recipients.size === 0) return;

    const n = notifier();
    for (const to of recipients) {
      await n
        .sendBookingConfirmed(to, {
          travelerName: row.trip.traveler?.displayName ?? 'Traveler',
          tripSummary,
          pnr: row.pnr ?? args.duffelOrderId,
          total: totalAmount,
          currency: row.currency || 'USD',
          segments: segments.map(s => ({
            carrier: String(s.carrier ?? s.flightNumber ?? ''),
            origin: String(s.origin ?? s.originIata ?? ''),
            destination: String(s.destination ?? s.destinationIata ?? ''),
            departAt: String(s.departureAt ?? s.departure_at ?? s.departAt ?? ''),
            arriveAt: s.arrivalAt
              ? String(s.arrivalAt)
              : s.arrival_at
                ? String(s.arrival_at)
                : s.arriveAt
                  ? String(s.arriveAt)
                  : undefined,
            cabin: s.cabin ? String(s.cabin) : undefined,
          })),
          tripUrl,
        })
        .catch(err => console.warn('[duffel-dispatcher] sendBookingConfirmed failed', to, err));
    }
  } catch (err) {
    console.warn('[duffel-dispatcher] emailBookingConfirmed outer failure', err);
  }
}

/**
 * D2 — send the BOOKING_CONFIRMED HSM template on the traveler's
 * WhatsApp thread the moment Duffel confirms ticketing.
 *
 * Looks up the traveler's WhatsApp ChannelIdentity (auto-provisioned
 * by the resolver on first inbound — see `apps/app/lib/agent-traveler-resolver.ts`).
 * Skips silently when the traveler has no WhatsApp identity (web /
 * Slack / API booking) or when no WhatsApp install is wired for the
 * tenant. Fails-soft on any send error — email already covers the
 * baseline confirmation path.
 */
export async function notifyWhatsAppOnBooking(args: {
  bookingId: string;
  tenantId: string;
  duffelOrderId: string;
}): Promise<void> {
  try {
    const booking = await prisma.booking.findUnique({
      where: { id: args.bookingId },
      select: {
        pnr: true,
        currency: true,
        totalUsd: true,
        segments: true,
        trip: {
          select: {
            travelerId: true,
            traveler: { select: { displayName: true } },
          },
        },
      },
    });
    if (!booking?.trip?.travelerId) return;

    // Find the traveler's WhatsApp phone via ChannelIdentity.
    const identity = await prisma.channelIdentity.findFirst({
      where: {
        tenantId: args.tenantId,
        userId: booking.trip.travelerId,
        kind: 'whatsapp',
      },
      select: { externalUserId: true },
    });
    const recipient = identity?.externalUserId;
    if (!recipient) return;

    const install = await prisma.whatsAppInstall.findUnique({
      where: { tenantId: args.tenantId },
      select: { phoneNumberId: true, status: true },
    });
    if (!install?.phoneNumberId || install.status === 'disabled') return;

    const accessToken = env.whatsappAccessToken() ?? env.kapsoApiKey();
    if (!accessToken) return;

    const apiBaseUrl =
      env.whatsappApiBaseUrl() ??
      (env.kapsoApiKey() ? `${env.kapsoApiBaseUrl()}/meta/whatsapp/v24.0` : undefined);

    // Build the template body vars from booking data.
    const segments = Array.isArray(booking.segments)
      ? (booking.segments as Array<Record<string, unknown>>)
      : [];
    const firstSegment = segments[0];
    const route = firstSegment
      ? `${String(firstSegment.origin ?? firstSegment.originIata ?? '')} → ${String(firstSegment.destination ?? firstSegment.destinationIata ?? '')}`
      : 'Trip';
    const departAt = firstSegment
      ? String(
          firstSegment.departureAt ??
            firstSegment.departure_at ??
            firstSegment.departAt ??
            ''
        ).slice(0, 16)
      : '';

    const { WhatsAppClient, SENDERO_TEMPLATES, buildTemplateComponents, resolveTemplateLocale } =
      await import('@sendero/whatsapp');
    const def = SENDERO_TEMPLATES.BOOKING_CONFIRMED;
    const components = buildTemplateComponents(def, {
      pnr: booking.pnr ?? args.duffelOrderId,
      route,
      departAt,
      ticketEmail: booking.trip.traveler?.displayName ?? 'your inbox',
    });

    const client = new WhatsAppClient({
      phoneNumberId: install.phoneNumberId,
      accessToken,
      apiBaseUrl,
    });
    await client.sendTemplate({
      to: recipient,
      templateName: def.name,
      languageCode: resolveTemplateLocale(def, undefined),
      components,
    });
  } catch (err) {
    console.warn('[duffel-dispatcher] notifyWhatsAppOnBooking failed (non-fatal)', {
      bookingId: args.bookingId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * D2 — kick off the WDK BoardingPass stamp workflow. The workflow
 * generates the OG image, uploads to IPFS, mints on Arc via Circle
 * SCP, persists the NftStamp row, and (TODO) sends the
 * NFT_STAMP_READY follow-up template once the on-chain tx confirms.
 *
 * Fire-and-forget HTTP — the WDK workflow runs out-of-band on a
 * separate request lifecycle. We just trigger it; failures are
 * logged but don't affect the Duffel webhook ack.
 */
export async function kickOffBoardingPassStamp(args: {
  bookingId: string;
  tripId: string | null;
}): Promise<void> {
  if (!args.tripId) return;
  const baseUrl =
    process.env.NEXT_PUBLIC_APP_URL ?? process.env.KAPSO_WEBHOOK_BASE_URL ?? 'http://localhost:3010';
  const secret = process.env.AGENT_DISPATCH_SECRET ?? process.env.CRON_SECRET ?? '';
  if (!secret) return;

  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/workflows/stamps/BoardingPass`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-sendero-dispatch-secret': secret,
      },
      body: JSON.stringify({ tripId: args.tripId, bookingId: args.bookingId }),
    });
    if (!res.ok) {
      console.warn('[duffel-dispatcher] stamp workflow kickoff non-OK', {
        bookingId: args.bookingId,
        status: res.status,
      });
    }
  } catch (err) {
    console.warn('[duffel-dispatcher] stamp workflow kickoff failed (non-fatal)', {
      bookingId: args.bookingId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
