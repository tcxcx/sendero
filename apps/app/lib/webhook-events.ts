/**
 * Idempotency-aware upsert for the WebhookEvent table.
 *
 * Webhooks frequently retry — Duffel in particular resends events with
 * the same `id` until we return 2xx. The table's (provider, externalId)
 * unique constraint makes this branchless: first delivery inserts;
 * retries return `alreadyProcessed: true` and the route short-circuits
 * with a 200.
 */

import { prisma } from '@sendero/database';

export interface RecordedWebhookEvent {
  id: string;
  alreadyProcessed: boolean;
}

export async function recordWebhookEvent(args: {
  provider: string;
  externalId: string;
  eventType: string;
  payload: unknown;
}): Promise<RecordedWebhookEvent> {
  const existing = await prisma.webhookEvent.findUnique({
    where: { provider_externalId: { provider: args.provider, externalId: args.externalId } },
    select: { id: true, processedAt: true },
  });
  if (existing) {
    return { id: existing.id, alreadyProcessed: existing.processedAt !== null };
  }
  const row = await prisma.webhookEvent.create({
    data: {
      provider: args.provider,
      externalId: args.externalId,
      eventType: args.eventType,
      payload: args.payload as object,
    },
    select: { id: true },
  });
  return { id: row.id, alreadyProcessed: false };
}

export async function markWebhookEventProcessed(id: string, error?: string): Promise<void> {
  await prisma.webhookEvent.update({
    where: { id },
    data: {
      processedAt: new Date(),
      processingError: error ?? null,
    },
  });
}
