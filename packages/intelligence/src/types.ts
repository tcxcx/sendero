/**
 * Agent memory primitive shapes. Kept narrow and serialization-friendly so
 * they can be swapped between Prisma rows, Redis, and vector stores without
 * touching consumers.
 */

export type MemoryKind =
  | 'preference' // "prefers window seats", "always approves < $500"
  | 'observation' // "last trip to GRU ran 3h late"
  | 'fact' // "passport expires 2028-04-12"
  | 'relation' // "traveler Alice is on team Acme Engineering"
  | 'trip_event' // "booking confirmed PNR ABC123"
  | 'policy_note' // "Vale 2026 requires approver over $2k"
  ;

export interface MemoryRecord {
  id: string;
  tenantId: string;
  subjectId: string; // traveler / user / trip id depending on context
  agentId: string; // "sendero", "sendero:booking", etc.
  kind: MemoryKind;
  summary: string; // <= 240 chars, the one-liner the agent reads
  body?: string | null; // longer free-text, optional
  metadata?: Record<string, unknown> | null;
  createdAt: Date;
  accessedAt?: Date | null;
  accessCount?: number;
}

export interface MemoryCreateInput {
  tenantId: string;
  subjectId: string;
  agentId: string;
  kind: MemoryKind;
  summary: string;
  body?: string;
  metadata?: Record<string, unknown>;
}

export interface MemoryQuery {
  tenantId: string;
  subjectId?: string;
  agentId?: string;
  kind?: MemoryKind;
  /** Free text — matched against summary + body via trigram or vector. */
  text?: string;
  limit?: number;
  minScore?: number;
}

export interface MemoryHit extends MemoryRecord {
  score: number;
}
