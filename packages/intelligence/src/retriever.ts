/**
 * Pluggable retriever. Phase 1 uses an in-process trigram/substring matcher
 * over records fetched via Prisma; swap for pgvector-backed retrieval in
 * Phase 2 by implementing the same interface.
 *
 * Keeping this as an interface means the memory store and the retriever
 * evolve independently.
 */

import type { MemoryHit, MemoryRecord } from './types';

export interface Retriever {
  /**
   * Score candidates against a query string. Called with records already
   * filtered by tenant / subject / kind from the DB layer.
   */
  rank(query: string, candidates: MemoryRecord[]): MemoryHit[];
}

/** Simple trigram Jaccard over lowercased summary + body. Good enough <10k docs. */
export class TrigramRetriever implements Retriever {
  rank(query: string, candidates: MemoryRecord[]): MemoryHit[] {
    const qgrams = trigrams(query);
    if (!qgrams.size) {
      return candidates.map(c => ({ ...c, score: 0 }));
    }
    return candidates
      .map(record => {
        const haystack = `${record.summary} ${record.body ?? ''}`.toLowerCase();
        const dgrams = trigrams(haystack);
        const overlap = jaccard(qgrams, dgrams);
        return { ...record, score: overlap };
      })
      .filter(hit => hit.score > 0)
      .sort((a, b) => b.score - a.score);
  }
}

function trigrams(s: string): Set<string> {
  const padded = `  ${s.toLowerCase().trim()}  `;
  const out = new Set<string>();
  for (let i = 0; i < padded.length - 2; i++) {
    out.add(padded.slice(i, i + 3));
  }
  return out;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const g of a) if (b.has(g)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

/** Reserved for Phase 2 — pgvector-backed retriever. */
export interface VectorRetrieverConfig {
  /** Dimensions of the embedding model (768 for text-embedding-3-small reduced). */
  dimensions: number;
  /** Cosine / L2 / inner product. */
  metric: 'cosine' | 'l2' | 'ip';
  /** Threshold below which matches are dropped. */
  minSimilarity: number;
}
