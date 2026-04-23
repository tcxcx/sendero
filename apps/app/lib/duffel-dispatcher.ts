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

import { upsertAirlineCredit } from './airline-credits-sync';
import { makeToolRegistry } from './tool-registry';
import { persistPausedRun, readPausedRun } from './workflow-pause';

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
    select: { id: true, tenantId: true, metadata: true },
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

  return { matched: true, runId: paused.runId, run: resumed };
}
