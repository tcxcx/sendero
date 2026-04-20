/**
 * Prisma-backed memory CRUD + recall.
 *
 * The consuming app passes a Prisma client via `@sendero/database`. The
 * `agentMemory` model is expected to carry columns matching MemoryRecord.
 * The schema migration for Sendero will be added in a follow-up PR — for
 * now this module is typed against the record shape and the caller
 * supplies a narrow `MemoryStore` implementation.
 */

import type { MemoryCreateInput, MemoryHit, MemoryQuery, MemoryRecord } from './types';
import { TrigramRetriever, type Retriever } from './retriever';

export interface MemoryStore {
  create: (input: MemoryCreateInput) => Promise<MemoryRecord>;
  list: (query: Omit<MemoryQuery, 'text' | 'minScore'>) => Promise<MemoryRecord[]>;
  /** Fire-and-forget. Increments accessCount + sets accessedAt. */
  touch: (id: string) => Promise<void>;
}

export interface RecallOptions {
  query: MemoryQuery;
  retriever?: Retriever;
}

/**
 * Pull candidates from the store, rank them with the retriever, and
 * fire-and-forget bump their access counters so recently-useful memories
 * surface more often.
 */
export async function recallMemories(
  store: MemoryStore,
  opts: RecallOptions
): Promise<MemoryHit[]> {
  const retriever = opts.retriever ?? new TrigramRetriever();
  const candidates = await store.list({
    tenantId: opts.query.tenantId,
    subjectId: opts.query.subjectId,
    agentId: opts.query.agentId,
    kind: opts.query.kind,
    limit: Math.max(opts.query.limit ?? 10, 50), // overfetch; retriever narrows
  });

  const qText = opts.query.text?.trim();
  const hits = qText
    ? retriever.rank(qText, candidates)
    : candidates.map(c => ({ ...c, score: 1 }));

  const minScore = opts.query.minScore ?? 0;
  const filtered = hits.filter(h => h.score >= minScore).slice(0, opts.query.limit ?? 10);

  // Touch accessed memories (non-blocking)
  for (const hit of filtered) {
    store.touch(hit.id).catch(() => {
      /* never block recall on telemetry */
    });
  }

  return filtered;
}

/** Format recalled memories for LLM system-prompt injection. */
export function renderMemoriesPrompt(hits: MemoryHit[], opts: { header?: string } = {}): string {
  if (hits.length === 0) return '';
  const header = opts.header ?? '## Agent memory';
  return `${header}\n${hits.map(h => `- [${h.kind}] ${h.summary}`).join('\n')}`;
}

/** Convenience helper to create + return a memory in one call. */
export async function rememberFact(
  store: MemoryStore,
  input: MemoryCreateInput
): Promise<MemoryRecord> {
  return store.create(input);
}
