/**
 * Disruption run write-through — one `disruption_runs` row per triggering
 * event (delay, cancellation, schedule change). Called by:
 *   - Duffel webhook on order.updated / order_change_requests
 *   - Workflow handlers in the rebook/refund path
 *   - Ops tools that open a manual run
 *
 * Thin audit layer only — the canonical rebook/refund state lives in Duffel
 * and the workflow runner. Finance uses this table to scan "how many
 * disruptions this quarter" without replaying runs.
 */

import { prisma } from '@sendero/database';
import type { DisruptionRun, Prisma } from '@sendero/database';

export type DisruptionKind = 'delay' | 'cancellation' | 'schedule_changed';
export type DisruptionSource = 'traveler' | 'webhook' | 'agent' | 'ops';
export type DisruptionStatus =
  | 'open'
  | 'awaiting_decision'
  | 'rebooking'
  | 'refunding'
  | 'resolved'
  | 'failed';

export interface DisruptionRunOpenInput {
  tenantId: string;
  tripId: string;
  bookingId?: string;
  kind: DisruptionKind;
  source: DisruptionSource;
  workflowRunId?: string;
}

export interface DisruptionRunUpdateInput {
  id: string;
  status: DisruptionStatus;
  /// Merged into the existing resolution JSON — prior keys are preserved.
  resolution?: Record<string, unknown>;
}

const TERMINAL: ReadonlySet<DisruptionStatus> = new Set(['resolved', 'failed']);

export async function openDisruptionRun(params: DisruptionRunOpenInput): Promise<DisruptionRun> {
  return prisma.disruptionRun.create({
    data: {
      tenantId: params.tenantId,
      tripId: params.tripId,
      bookingId: params.bookingId,
      kind: params.kind,
      source: params.source,
      workflowRunId: params.workflowRunId,
      status: 'open',
    },
  });
}

export async function updateDisruptionStatus(
  params: DisruptionRunUpdateInput
): Promise<DisruptionRun> {
  const existing = await prisma.disruptionRun.findUnique({
    where: { id: params.id },
    select: { resolution: true },
  });
  if (!existing) {
    throw new Error(`disruption-sync: run ${params.id} not found`);
  }

  const prior = (existing.resolution ?? {}) as Record<string, unknown>;
  const merged: Record<string, unknown> | undefined = params.resolution
    ? { ...prior, ...params.resolution }
    : undefined;

  const data: Prisma.DisruptionRunUpdateInput = {
    status: params.status,
  };
  if (merged !== undefined) {
    data.resolution = merged as Prisma.InputJsonValue;
  }
  if (TERMINAL.has(params.status)) {
    data.resolvedAt = new Date();
  }

  return prisma.disruptionRun.update({
    where: { id: params.id },
    data,
  });
}
