/**
 * Shared pause persistence. Call `persistPausedRun` after a workflow
 * `startRun()` returns with status === 'paused' AND the booking row
 * already exists. The snapshot lives on `Booking.metadata.workflow`
 * so the Duffel webhook dispatcher (see ./duffel-dispatcher.ts) can
 * resume the run by looking up the booking via its `duffelOrderId`.
 *
 * Workflows that pause BEFORE a booking exists (e.g. guestPrefund's
 * await_guest_claim) need a different stash — not in scope for
 * phase-11a since the Duffel pause is always after commit_booking.
 */

import { prisma } from '@sendero/database';
import type { WorkflowDef, WorkflowRun } from '@sendero/workflows';

export interface PausedWorkflowSnapshot {
  workflowId: string;
  runId: string;
  snapshot: WorkflowRun;
  pausedAt: string;
  pausedStepId?: string;
}

/**
 * Persist a full WorkflowRun snapshot onto the referenced booking.
 * Merges into existing `metadata` (preserves non-workflow keys).
 */
export async function persistPausedRun(args: {
  bookingId: string;
  workflow: WorkflowDef;
  run: WorkflowRun;
}): Promise<void> {
  const existing = await prisma.booking.findUnique({
    where: { id: args.bookingId },
    select: { metadata: true },
  });
  const base = (existing?.metadata as Record<string, unknown> | null) ?? {};
  const snapshot: PausedWorkflowSnapshot = {
    workflowId: args.workflow.id,
    runId: args.run.runId,
    snapshot: args.run,
    pausedAt: new Date().toISOString(),
    pausedStepId: args.run.nextStepId,
  };
  await prisma.booking.update({
    where: { id: args.bookingId },
    data: { metadata: { ...base, workflow: snapshot } as object },
  });
}

/** Read the paused snapshot off a booking row, if any. */
export function readPausedRun(metadata: unknown): PausedWorkflowSnapshot | null {
  const m = metadata as { workflow?: PausedWorkflowSnapshot } | null | undefined;
  if (!m || !m.workflow) return null;
  return m.workflow;
}
