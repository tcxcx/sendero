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

import { randomUUID } from 'node:crypto';

import { prisma } from '@sendero/database';
import { bookFlightWorkflow, guestPrefundWorkflow } from '@sendero/workflows/catalog';
import { resumeRun, type ToolRegistry, type WorkflowRun } from '@sendero/workflows';
import type { DuffelAirlineCreditWire, DuffelWebhookEvent } from '@sendero/duffel';
import { getAirlineCredit, getOrder } from '@sendero/duffel';
import { notifier } from '@sendero/notifications';
import { env } from '@sendero/env';

import { dispatchToTraveler } from './channel-dispatch';
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

  // Phase F — airline-initiated schedule change. Push a server-side
  // card to the traveler with old vs new times + a re-route CTA so
  // they don't find out at the gate. Fail-soft: the workflow resume
  // (above) already completed; this is the user-facing surface.
  if (resolutionStatus === 'schedule_changed') {
    void notifyTravelerOfScheduleChange({
      bookingId: booking.id,
      tenantId: booking.tenantId,
      tripId: booking.tripId,
      duffelOrderId: args.event.orderId,
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

export async function emailBookingConfirmed(args: {
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
        eTicketDocumentUrl: true,
        trip: {
          select: {
            id: true,
            intent: true,
            traveler: { select: { email: true, displayName: true } },
          },
        },
      },
    })) as (BookingForEmail & { eTicketDocumentUrl: string | null }) | null;
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

    // Phase A.4 — attach the airline-issued e-ticket PDF when present.
    // Resend supports remote URLs via `path`, so we hand it the Duffel-
    // hosted URL directly (no buffer fetch needed). When the supplier
    // didn't issue a document the column is null and we skip the
    // attachment block entirely.
    const attachments = row.eTicketDocumentUrl
      ? [
          {
            filename: `eticket-${row.pnr ?? args.duffelOrderId}.pdf`,
            path: row.eTicketDocumentUrl,
            contentType: 'application/pdf',
          },
        ]
      : undefined;

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
          ...(attachments ? { attachments } : {}),
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
          firstSegment.departureAt ?? firstSegment.departure_at ?? firstSegment.departAt ?? ''
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
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.KAPSO_WEBHOOK_BASE_URL ??
    'http://localhost:3010';
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

/**
 * Phase F — schedule-change traveler notify.
 *
 * Triggered from `dispatchDuffelEvent` when a Duffel webhook arrives
 * with `order.airline_initiated_change.detected`. Re-fetches the live
 * order, finds segments whose `departing_at` differs from what we
 * have on `Booking.segments`, and pushes a card to the traveler over
 * their primary channel — old time → new time, plus a CTA to talk to
 * Sendero (where the agent can run `request_order_change` to pick a
 * replacement offer if needed).
 *
 * Fail-soft on every branch (no traveler resolved, Duffel unreachable,
 * dispatcher returns false). The webhook handler already returned 200
 * to Duffel by the time this runs.
 */
async function notifyTravelerOfScheduleChange(args: {
  bookingId: string;
  tenantId: string;
  tripId: string;
  duffelOrderId: string;
}): Promise<void> {
  try {
    const booking = await prisma.booking.findUnique({
      where: { id: args.bookingId },
      select: {
        pnr: true,
        segments: true,
        trip: { select: { travelerId: true } },
      },
    });
    if (!booking?.trip?.travelerId) {
      console.warn('[duffel-dispatcher] schedule-change skip: no traveler', {
        bookingId: args.bookingId,
      });
      return;
    }

    const liveOrder = (await getOrder(args.duffelOrderId)) as unknown as {
      slices?: Array<{
        segments?: Array<{
          id?: string;
          departing_at?: string;
          arriving_at?: string;
          origin?: { iata_code?: string };
          destination?: { iata_code?: string };
          marketing_carrier?: { name?: string; iata_code?: string };
        }>;
      }>;
    };
    const liveSegments = (liveOrder.slices ?? []).flatMap(s => s.segments ?? []);
    const persistedSegs = Array.isArray(booking.segments)
      ? (booking.segments as Array<Record<string, unknown>>)
      : [];

    // Compare per-position: cheapest correct match; multi-leg trips
    // typically share segment count between persistence and the live
    // order. When counts diverge (rare — major re-route by the
    // airline) we surface the live state without delta annotation.
    const changes: Array<{ route: string; was: string | null; now: string | null }> = [];
    for (let i = 0; i < liveSegments.length; i++) {
      const live = liveSegments[i];
      const before = persistedSegs[i];
      const wasIso = typeof before?.departureAt === 'string' ? before.departureAt : null;
      const nowIso = typeof live?.departing_at === 'string' ? live.departing_at : null;
      if (!nowIso) continue;
      if (wasIso && wasIso === nowIso) continue;
      const origin = live.origin?.iata_code ?? '?';
      const dest = live.destination?.iata_code ?? '?';
      changes.push({
        route: `${origin}→${dest}`,
        was: wasIso ? formatIso(wasIso) : null,
        now: formatIso(nowIso),
      });
    }

    const lines = [
      `*La aerolínea movió tu vuelo.* PNR \`${booking.pnr ?? args.duffelOrderId.slice(-6)}\`.`,
    ];
    if (changes.length > 0) {
      for (const c of changes) {
        lines.push(c.was ? `${c.route}: ${c.was} → *${c.now}*` : `${c.route}: ahora *${c.now}*`);
      }
    } else {
      lines.push('Detalles actualizados en tu reserva — confirmá con tu PNR.');
    }
    lines.push('Reply *change flight* if you need Sendero to find a different time.');

    await dispatchToTraveler({
      tripId: args.tripId,
      tenantId: args.tenantId,
      travelerUserId: booking.trip.travelerId,
      message: {
        kind: 'card',
        id: randomUUID(),
        author: { role: 'agent', name: 'Sendero' },
        title: '⚠️ Schedule change',
        body: lines.join('\n'),
        ctas: [
          {
            label: 'Change flight',
            kind: 'reply',
            value: 'change flight',
            emphasis: 'primary',
          },
        ],
        createdAt: new Date().toISOString(),
      },
    });
  } catch (err) {
    console.warn('[duffel-dispatcher] schedule-change notify failed (non-fatal)', {
      bookingId: args.bookingId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

function formatIso(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}
