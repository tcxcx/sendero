/**
 * Check-in nudge write-through — one `check_in_nudges` row per
 * (trip, scheduled slot). Called by:
 *   - Trip workflow planner when it schedules a T-24h / T-3h nudge
 *   - Cron catch-up loop (idempotent by design)
 *   - Channel delivery handlers that mark fired / actioned
 *
 * Idempotency note: the schema does not yet have a unique index on
 * (tripId, scheduledAt). `scheduleCheckInNudge` enforces it in query —
 * if a row already exists at that slot it is returned as-is. Cron will
 * re-run; double-booking a slot must be avoided.
 */

import { prisma } from '@sendero/database';
import type { CheckInNudge, Prisma } from '@sendero/database';

export type CheckInChannel = 'whatsapp' | 'slack' | 'email' | 'web';

export interface CheckInNudgeScheduleInput {
  tenantId: string;
  tripId: string;
  bookingId?: string;
  scheduledAt: Date;
  channel: CheckInChannel;
  leaveByIso?: string;
  metadata?: Record<string, unknown>;
}

export interface CheckInNudgeFireInput {
  id: string;
  firedAt?: Date;
}

export interface CheckInNudgeActionInput {
  id: string;
}

export async function scheduleCheckInNudge(
  params: CheckInNudgeScheduleInput
): Promise<CheckInNudge> {
  const existing = await prisma.checkInNudge.findFirst({
    where: { tripId: params.tripId, scheduledAt: params.scheduledAt },
  });
  if (existing) return existing;

  return prisma.checkInNudge.create({
    data: {
      tenantId: params.tenantId,
      tripId: params.tripId,
      bookingId: params.bookingId,
      scheduledAt: params.scheduledAt,
      channel: params.channel,
      leaveByIso: params.leaveByIso,
      metadata: params.metadata as Prisma.InputJsonValue | undefined,
    },
  });
}

export async function markNudgeFired(params: CheckInNudgeFireInput): Promise<CheckInNudge> {
  return prisma.checkInNudge.update({
    where: { id: params.id },
    data: { firedAt: params.firedAt ?? new Date() },
  });
}

export async function markNudgeActioned(params: CheckInNudgeActionInput): Promise<CheckInNudge> {
  return prisma.checkInNudge.update({
    where: { id: params.id },
    data: { actionedAt: new Date() },
  });
}
