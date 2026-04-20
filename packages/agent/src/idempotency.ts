/**
 * Idempotent meter writes.
 *
 * Every turn emits exactly one `chat_reply` meter event — retries of
 * the same `turnId` MUST be no-ops. The consuming app enforces this
 * via a unique index on `(tenantId, idempotencyKey)` — adding that
 * column + constraint is the job of Phase 8's Prisma migration.
 *
 * The key derives from the channel + turnId + event kind so the same
 * turnId can still emit distinct events ("search paid" + "reply paid"
 * hanging off one inbound message).
 */

export interface IdempotencyKeyParts {
  tenantId: string;
  channel: string;
  turnId: string;
  eventKind: string;
}

export function buildIdempotencyKey(parts: IdempotencyKeyParts): string {
  const safe = (s: string) => s.replace(/[^a-zA-Z0-9_.:-]/g, '_');
  return [safe(parts.channel), safe(parts.turnId), safe(parts.eventKind)].join(':').slice(0, 128);
}

/**
 * Returns true if this Prisma error indicates a duplicate-key write
 * (idempotency hit). Callers should treat that as success.
 */
export function isDuplicateKeyError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const code = (err as { code?: string }).code;
  return code === 'P2002';
}
