/**
 * @sendero/langfuse/scores — Scoring functions for quality tracking
 *
 * Score types:
 *   user-feedback   (BOOLEAN)         — thumbs up/down from operator
 *   hitl-decision   (BOOLEAN)         — booking approval / rejection
 *   response-quality (NUMERIC 1-5)   — LLM judge
 *   hallucination   (BOOLEAN)         — LLM judge
 *   helpfulness     (CATEGORICAL)     — LLM judge
 *   latency-score   (NUMERIC 0-1)     — computed from turn duration
 *   tool-success    (BOOLEAN)         — computed from tool results
 *   cost-usdc       (NUMERIC)         — micro-USDC billed per turn
 */

import { getClient } from './client';
import type { ScoreInput } from './types';

/**
 * Score a generation — thumbs up/down OR HITL booking approve/reject.
 * Backward-compatible with existing callers.
 */
export async function scoreGeneration(
  traceId: string,
  rating: 'up' | 'down' | 'approved' | 'rejected',
  comment?: string
): Promise<void> {
  const client = getClient();
  if (!client) return;

  const isPositive = rating === 'up' || rating === 'approved';
  const scoreName = rating === 'up' || rating === 'down' ? 'user-feedback' : 'hitl-decision';

  try {
    client.score.create({
      id: `${traceId}-${scoreName}`,
      traceId,
      name: scoreName,
      value: isPositive ? 1 : 0,
      dataType: 'BOOLEAN',
      comment: comment ?? `${rating} by user`,
    });
    client.flush().catch(() => {});
  } catch (err) {
    console.warn('[langfuse] scoreGeneration failed:', {
      traceId,
      rating,
      error: err instanceof Error ? err.message : err,
    });
  }
}

/** Attach any score to a trace. */
export async function scoreTrace(
  traceId: string,
  name: string,
  value: number | boolean | string,
  options?: {
    dataType?: 'NUMERIC' | 'BOOLEAN' | 'CATEGORICAL';
    comment?: string;
    observationId?: string;
  }
): Promise<void> {
  const client = getClient();
  if (!client) return;

  const dataType = options?.dataType ?? inferDataType(value);

  try {
    client.score.create({
      id: `${traceId}-${name}`,
      traceId,
      name,
      value: typeof value === 'boolean' ? (value ? 1 : 0) : value,
      dataType,
      comment: options?.comment,
      observationId: options?.observationId,
    });
    client.flush().catch(() => {});
  } catch (err) {
    console.warn('[langfuse] scoreTrace failed:', {
      traceId,
      name,
      error: err instanceof Error ? err.message : err,
    });
  }
}

/**
 * Score response latency — normalized to 0-1 scale.
 * Sub-1s = 1.0, 1–5s linear, 5–10s linear, >10s = 0.0
 */
export async function scoreLatency(traceId: string, durationMs: number): Promise<void> {
  let normalized: number;
  if (durationMs <= 1000) normalized = 1.0;
  else if (durationMs <= 5000) normalized = 1.0 - ((durationMs - 1000) / 4000) * 0.5;
  else if (durationMs <= 10000) normalized = 0.5 - ((durationMs - 5000) / 5000) * 0.5;
  else normalized = 0.0;

  await scoreTrace(traceId, 'latency-score', Math.round(normalized * 100) / 100, {
    dataType: 'NUMERIC',
    comment: `${durationMs}ms`,
  });
}

/** Score tool execution — true if all tools succeeded. */
export async function scoreToolSuccess(
  traceId: string,
  toolResults: Array<{ success: boolean; toolName: string }>
): Promise<void> {
  const allSucceeded = toolResults.length > 0 && toolResults.every(r => r.success);
  await scoreTrace(traceId, 'tool-success', allSucceeded, {
    dataType: 'BOOLEAN',
    comment: `${toolResults.filter(r => r.success).length}/${toolResults.length} tools succeeded`,
  });
}

/** Score USDC cost of a turn (micro-USDC as numeric). */
export async function scoreCost(traceId: string, priceMicroUsdc: bigint | number): Promise<void> {
  await scoreTrace(traceId, 'cost-usdc', Number(priceMicroUsdc) / 1_000_000, {
    dataType: 'NUMERIC',
    comment: `${priceMicroUsdc} micro-USDC`,
  });
}

/** Batch multiple scores in one call. */
export async function batchScore(scores: ScoreInput[]): Promise<void> {
  const client = getClient();
  if (!client) return;

  try {
    for (const score of scores) {
      client.score.create({
        id: `${score.traceId}-${score.name}`,
        traceId: score.traceId,
        name: score.name,
        value: typeof score.value === 'boolean' ? (score.value ? 1 : 0) : score.value,
        dataType: score.dataType,
        comment: score.comment,
        observationId: score.observationId,
      });
    }
    client.flush().catch(() => {});
  } catch (err) {
    console.warn('[langfuse] batchScore failed:', {
      count: scores.length,
      error: err instanceof Error ? err.message : err,
    });
  }
}

function inferDataType(value: number | boolean | string): 'NUMERIC' | 'BOOLEAN' | 'CATEGORICAL' {
  if (typeof value === 'boolean') return 'BOOLEAN';
  if (typeof value === 'number') return 'NUMERIC';
  return 'CATEGORICAL';
}
