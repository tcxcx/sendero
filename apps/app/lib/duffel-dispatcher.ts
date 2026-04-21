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
import { resumeRun } from '@sendero/workflows';
import type { DuffelWebhookEvent } from '@sendero/duffel';

import { makeToolRegistry } from './tool-registry';
import { readPausedRun } from './workflow-pause';

export async function dispatchDuffelEvent(args: {
  event: DuffelWebhookEvent;
}): Promise<{ matched: boolean; runId?: string }> {
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

  const status = args.event.status === 'ticketed' ? 'ticketed' : 'failed';
  await resumeRun({
    workflow,
    run: paused.snapshot,
    resolution: { status, duffelOrderId: args.event.orderId },
    tools: makeToolRegistry(),
  });

  return { matched: true, runId: paused.runId };
}
