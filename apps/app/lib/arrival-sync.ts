/**
 * Arrival playbook write-through — one `arrival_playbook_runs` row per
 * trip/airport combo. Called by:
 *   - Arrival playbook workflow when it composes the share payload
 *   - Channel handlers that mark the traveler actioned a step
 *
 * Stores the fully composed share payload so the web view can re-render
 * the exact playbook the traveler saw on WhatsApp/Slack without re-calling
 * metered providers (transfers, restaurants, static maps).
 */

import { prisma } from '@sendero/database';
import type { ArrivalPlaybookRun, Prisma } from '@sendero/database';

export interface ArrivalPlaybookRecordInput {
  tenantId: string;
  tripId: string;
  bookingId?: string;
  airportIata: string;
  transferOptionId?: string;
  restaurantIds?: string[];
  routeMapCid?: string;
  playbook: Record<string, unknown>;
  workflowRunId?: string;
}

export interface ArrivalPlaybookActionInput {
  id: string;
}

export async function recordArrivalPlaybook(
  params: ArrivalPlaybookRecordInput
): Promise<ArrivalPlaybookRun> {
  const iata = params.airportIata.toUpperCase();
  if (iata.length !== 3) {
    throw new Error(`arrival-sync: airportIata must be 3 chars, got "${params.airportIata}"`);
  }

  return prisma.arrivalPlaybookRun.create({
    data: {
      tenantId: params.tenantId,
      tripId: params.tripId,
      bookingId: params.bookingId,
      airportIata: iata,
      transferOptionId: params.transferOptionId,
      restaurantIds: (params.restaurantIds ?? []) as Prisma.InputJsonValue,
      routeMapCid: params.routeMapCid,
      playbook: params.playbook as Prisma.InputJsonValue,
      workflowRunId: params.workflowRunId,
    },
  });
}

export async function markPlaybookActioned(
  params: ArrivalPlaybookActionInput
): Promise<ArrivalPlaybookRun> {
  return prisma.arrivalPlaybookRun.update({
    where: { id: params.id },
    data: { actionedAt: new Date() },
  });
}
