/**
 * @sendero/arize-phoenix/recall — Phoenix span search for the
 * `recall_similar_turns` tool (PR2).
 *
 * Reads spans tagged with `sendero.tenant_id` (PR1 stamp) from Phoenix
 * REST API. Filters by tenant, agent_type, time bounds, and minimum
 * eval score. Sorts by score and returns top-N. **Fail-soft** — any
 * non-2xx response or fetch error returns `{ available: false }` so
 * the agent falls through to plan-from-scratch (cold path).
 *
 * v0.1 scope:
 *   - Lexical (filter expression) match — no embedding similarity yet
 *   - 30-day window with min-age guard (anti-injection: trace must be
 *     ≥ 1h old before recall picks it up)
 *   - Tenant-scoped, agent-turn spans only (not OCR / embedding child spans)
 *
 * v0.2: switch to embedding similarity when @arizeai/phoenix-client
 * for Node ships, OR roll our own via Vertex `text-embedding-005`.
 */

import { phoenixFetch } from './_fetch';
import {
  getPhoenixApiKey,
  getPhoenixCollectorEndpoint,
  getPhoenixProjectName,
  isPhoenixEnabled,
} from './client';
import type { Provenance } from './types';

export interface RecallSimilarTurnsArgs {
  /** Required — recall is tenant-scoped at the data layer. */
  tenantId: string;
  /** User intent / question driving the planning. Used for lexical match. */
  query: string;
  /** Optional route restrictor, e.g. `'SFO-LHR'`. */
  route?: string;
  /** Top-N to return (after score filter + sort). Default 3, max 10. */
  limit?: number;
  /** Minimum eval score to include. Default 0.7 — anti-injection guard. */
  minEvalScore?: number;
  /**
   * Minimum age in seconds before a trace is recall-eligible. Default
   * 3600 (1h). Blocks zero-day pollution: an attacker with a key on
   * tenant X can't plant a "successful" trace and have it bias the
   * very next turn.
   */
  minAgeSeconds?: number;
}

export interface RecallSimilarTurn {
  traceId: string;
  /** Truncated input value (≤ 200 chars) for the agent to read. */
  summary: string;
  outcome: 'completed' | 'errored' | 'unknown';
  latencyMs: number;
  evalScore?: number;
  appliedTools: string[];
  /** Provenance source — always `'live-trace'` from the spans endpoint. */
  provenance: Provenance | 'live-trace';
  /** ISO timestamp of when the original turn happened. */
  occurredAt: string;
}

export interface RecallSimilarTurnsResult {
  available: boolean;
  /** Reason when `available: false`. */
  reason?: string;
  results: RecallSimilarTurn[];
}

const DEFAULT_LIMIT = 3;
const DEFAULT_MIN_EVAL = 0.7;
const DEFAULT_MIN_AGE_SECONDS = 3600;
const RECALL_WINDOW_DAYS = 30;
const FETCH_TIMEOUT_MS = 4000;

export async function recallSimilarTurns(
  args: RecallSimilarTurnsArgs
): Promise<RecallSimilarTurnsResult> {
  if (!isPhoenixEnabled()) {
    return { available: false, reason: 'phoenix-not-configured', results: [] };
  }

  const collector = getPhoenixCollectorEndpoint().replace(/\/$/, '');
  const apiKey = getPhoenixApiKey();
  const project = getPhoenixProjectName();
  const limit = Math.min(Math.max(args.limit ?? DEFAULT_LIMIT, 1), 10);
  const minEval = args.minEvalScore ?? DEFAULT_MIN_EVAL;
  const minAge = args.minAgeSeconds ?? DEFAULT_MIN_AGE_SECONDS;

  // Time bounds: at least minAge old, at most RECALL_WINDOW_DAYS
  const now = Date.now();
  const endTime = new Date(now - minAge * 1000).toISOString();
  const startTime = new Date(now - RECALL_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();

  // Phoenix `filter_condition` — Python-like expression evaluated on
  // each span. Tenant filter is the primary cross-tenant isolation
  // guard; agent_type filter narrows to actual planning turns (not
  // OCR / embedding child spans).
  // Reference: https://docs.arize.com/phoenix/tracing/concepts-tracing/how-to-query-spans
  const tenantEsc = args.tenantId.replace(/'/g, "\\'");
  const filterParts = [
    `attributes['sendero.tenant_id'] == '${tenantEsc}'`,
    `attributes['sendero.agent_type'] in ('sendero-conversation', 'sendero-slack', 'sendero-whatsapp', 'sendero-mcp')`,
  ];
  const filterCondition = filterParts.join(' and ');

  const url = new URL(`${collector}/v1/spans`);
  url.searchParams.set('project_name', project);
  url.searchParams.set('filter_condition', filterCondition);
  url.searchParams.set('start_time', startTime);
  url.searchParams.set('end_time', endTime);
  // Overfetch — eval-score filter happens client-side because Phoenix
  // attribute filter syntax doesn't reliably express score thresholds
  // across versions.
  url.searchParams.set('limit', String(limit * 4));

  try {
    const res = await phoenixFetch(url.toString(), {
      method: 'GET',
      headers: {
        ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
        accept: 'application/json',
      },
      timeoutMs: FETCH_TIMEOUT_MS,
    });

    if (!res.ok) {
      return {
        available: false,
        reason: `phoenix-http-${res.status}`,
        results: [],
      };
    }

    const data = (await res.json()) as { data?: unknown } | null;
    const spans = Array.isArray(data?.data) ? data.data : [];

    const queryLower = args.query.toLowerCase();
    const routeLower = args.route?.toLowerCase();

    const filtered: RecallSimilarTurn[] = (spans as Array<Record<string, unknown>>)
      .map(s => mapSpanToRecall(s))
      .filter((r): r is RecallSimilarTurn => r !== null)
      .filter(r => (r.evalScore ?? 0) >= minEval)
      .filter(r => {
        // Lexical match — at minimum the summary should mention SOMETHING from query/route
        const haystack = r.summary.toLowerCase();
        if (routeLower && !haystack.includes(routeLower)) return false;
        if (queryLower.length > 4) {
          // Cheap relevance: at least one query token > 3 chars present
          const tokens = queryLower.split(/\W+/).filter(t => t.length > 3);
          if (tokens.length > 0 && !tokens.some(t => haystack.includes(t))) return false;
        }
        return true;
      })
      .sort((a, b) => (b.evalScore ?? 0) - (a.evalScore ?? 0))
      .slice(0, limit);

    return { available: true, results: filtered };
  } catch (err) {
    // phoenixFetch normally swallows errors and returns ok=false, but
    // post-fetch processing (json shape, mapper) can still throw.
    return {
      available: false,
      reason: err instanceof Error ? `phoenix-process-${err.name}` : 'phoenix-process-error',
      results: [],
    };
  }
}

function mapSpanToRecall(span: Record<string, unknown>): RecallSimilarTurn | null {
  const ctx = (span.context ?? span) as Record<string, unknown>;
  const traceIdRaw = ctx.trace_id ?? span.trace_id;
  if (typeof traceIdRaw !== 'string') return null;

  const startTime =
    typeof span.start_time === 'string'
      ? span.start_time
      : typeof (span as { startTime?: string }).startTime === 'string'
        ? (span as { startTime: string }).startTime
        : null;
  const endTime =
    typeof span.end_time === 'string'
      ? span.end_time
      : typeof (span as { endTime?: string }).endTime === 'string'
        ? (span as { endTime: string }).endTime
        : null;

  const startMs = startTime ? new Date(startTime).getTime() : 0;
  const endMs = endTime ? new Date(endTime).getTime() : startMs;
  const latencyMs = Math.max(0, endMs - startMs);

  const attrs = ((span.attributes ?? span['attributes']) as Record<string, unknown>) ?? {};

  const inputValue = attrs['input.value'];
  const inputMessages = attrs['llm.input_messages'];
  const summaryRaw = (
    typeof inputValue === 'string'
      ? inputValue
      : typeof inputMessages === 'string'
        ? inputMessages
        : ''
  ).slice(0, 200);

  const statusCode = (span.status_code ?? span['status']) as string | undefined;
  const outcome: RecallSimilarTurn['outcome'] =
    statusCode === 'OK' ? 'completed' : statusCode === 'ERROR' ? 'errored' : 'unknown';

  const evalRaw = attrs['eval.score'] ?? attrs['score'];
  const evalScore = typeof evalRaw === 'number' ? evalRaw : undefined;

  const toolsRaw = attrs['llm.tools'] ?? attrs['sendero.tools_called'];
  const appliedTools = Array.isArray(toolsRaw) ? toolsRaw.map(String) : [];

  return {
    traceId: traceIdRaw,
    summary: summaryRaw,
    outcome,
    latencyMs,
    evalScore,
    appliedTools,
    provenance: 'live-trace',
    occurredAt: startTime ?? new Date().toISOString(),
  };
}
