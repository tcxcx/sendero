/**
 * Knowledge-gap reads against OA's Drizzle/Postgres knowledgeGaps table.
 */

import { and, asc, desc, eq, ne, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  type KnowledgeGap,
  type KnowledgeGapKind,
  type KnowledgeGapStatus,
  knowledgeGaps,
} from "@/lib/db/schema";
import { normalizeHypothesis, tokenSet } from "./normalize";

const COLUMN_ORDER: KnowledgeGapStatus[] = [
  "open",
  "triaged",
  "in_progress",
  "resolved",
  "wontfix",
];

export type KnowledgeGapBoard = Record<KnowledgeGapStatus, KnowledgeGap[]>;

export async function getBoardState(): Promise<KnowledgeGapBoard> {
  const rows = await db
    .select()
    .from(knowledgeGaps)
    .orderBy(asc(knowledgeGaps.boardPosition), desc(knowledgeGaps.lastSeenAt));

  const board = Object.fromEntries(
    COLUMN_ORDER.map((c) => [c, [] as KnowledgeGap[]]),
  ) as KnowledgeGapBoard;
  for (const row of rows) {
    board[row.boardColumn].push(row);
  }
  return board;
}

export async function findGapByExecutionSession(
  sessionId: string,
): Promise<KnowledgeGap | null> {
  const rows = await db
    .select()
    .from(knowledgeGaps)
    .where(eq(knowledgeGaps.lastExecutionSessionId, sessionId))
    .limit(1);
  return rows[0] ?? null;
}

export async function findResolvedGap(params: {
  hypothesis: string;
  toolName?: string;
  kind?: KnowledgeGapKind;
  minOverlap?: number;
}): Promise<{ hit: KnowledgeGap; score: number } | null> {
  const norm = normalizeHypothesis(params.hypothesis);
  if (!norm) return null;

  const filters = [
    eq(knowledgeGaps.status, "resolved"),
    sql`${knowledgeGaps.fixSummary} IS NOT NULL`,
  ];
  if (params.toolName)
    filters.push(eq(knowledgeGaps.toolName, params.toolName));
  if (params.kind) filters.push(eq(knowledgeGaps.kind, params.kind));

  const candidates = await db
    .select()
    .from(knowledgeGaps)
    .where(and(...filters))
    .limit(50);

  if (candidates.length === 0) return null;

  const queryTokens = tokenSet(norm);
  const minOverlap = params.minOverlap ?? 0.35;

  let best: { row: KnowledgeGap; score: number } | null = null;
  for (const row of candidates) {
    const rowTokens = tokenSet(row.hypothesisNorm);
    if (rowTokens.size === 0) continue;
    let shared = 0;
    for (const tok of queryTokens) {
      if (rowTokens.has(tok)) shared += 1;
    }
    const denom = Math.max(queryTokens.size, rowTokens.size);
    const score = denom === 0 ? 0 : shared / denom;
    if (score >= minOverlap && (best === null || score > best.score)) {
      best = { row, score };
    }
  }

  return best ? { hit: best.row, score: best.score } : null;
}

export async function countOpenByKind(): Promise<Record<string, number>> {
  const rows = await db
    .select({ kind: knowledgeGaps.kind })
    .from(knowledgeGaps)
    .where(
      and(
        ne(knowledgeGaps.status, "resolved"),
        ne(knowledgeGaps.status, "wontfix"),
      ),
    );
  const counts: Record<string, number> = {};
  for (const row of rows) {
    counts[row.kind] = (counts[row.kind] ?? 0) + 1;
  }
  return counts;
}
