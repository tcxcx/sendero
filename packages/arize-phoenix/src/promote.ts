/**
 * @sendero/arize-phoenix/promote — auto-curation primitives.
 *
 * Two compound functions powering the demand-driven loop without
 * human work per turn:
 *
 *   - `promoteResolutions` — Postgres `KnowledgeGap` rows with
 *     `status='resolved'` AND `resolutionPrUrl` set get pushed to the
 *     Phoenix `sendero-resolved-gaps` dataset, where `find_resolved_gap`
 *     reads them at agent runtime.
 *
 *   - `promoteSuccesses` — Recent confirmed bookings (Postgres
 *     `Booking.status='confirmed'` within window) get pushed to the
 *     Phoenix `sendero-recall` dataset as positive examples for
 *     `recall_similar_turns`. Intentionally minimal v0.1 — eval-score
 *     filtering happens at recall time (not promotion time) so we
 *     don't lose data when Langfuse evaluators are slow.
 *
 * **Idempotency.** Each Phoenix example carries `metadata.sendero_id`
 * (`gapId` for resolutions, `bookingId` for successes). Before insert
 * we fetch existing example metadata and skip ids we've already
 * pushed. Re-firing the cron after a partial run is safe.
 *
 * **Anti-injection (resolutions).** Only `provenance: 'human-curated'`
 * lands here — these are gaps a human PR closed. Auto-curated recall
 * candidates use `'auto-promoted'` and are filtered separately.
 *
 * Both functions are pure orchestration. The Phoenix REST calls fail
 * soft; partial results are reported in the return shape.
 */

import { phoenixFetch } from './_fetch';
import { getPhoenixApiKey, getPhoenixCollectorEndpoint, isPhoenixEnabled } from './client';
import type { Provenance } from './types';

export interface KnowledgeGapRow {
  id: string;
  hypothesis: string;
  toolName: string | null;
  kind: string;
  resolvedAt: Date | null;
  resolutionNote: string | null;
  suggestedFix: string | null;
  resolutionPrUrl: string;
}

export interface BookingRow {
  id: string;
  intent: string;
  route: string | null;
  tenantId: string;
  traceId: string | null;
  bookingRef: string | null;
  confirmedAt: Date | null;
}

export interface PromoteResolutionsArgs {
  /** Postgres rows fetched by the caller (ApplicationContext keeps Prisma out of @sendero/arize-phoenix). */
  rows: KnowledgeGapRow[];
}

export interface PromoteSuccessesArgs {
  rows: BookingRow[];
}

export interface PromoteReport {
  available: boolean;
  reason?: string;
  attempted: number;
  pushed: number;
  skipped: number;
  errors: number;
  /** Per-row outcomes — included when `attempted <= 50`. */
  details?: Array<{ id: string; outcome: 'pushed' | 'skipped' | 'error' }>;
}

const RESOLUTIONS_DATASET = 'sendero-resolved-gaps';
const RECALL_DATASET = 'sendero-recall';
const FETCH_TIMEOUT_MS = 6000;

export async function promoteResolutions(args: PromoteResolutionsArgs): Promise<PromoteReport> {
  if (!isPhoenixEnabled()) {
    return {
      available: false,
      reason: 'phoenix-not-configured',
      attempted: 0,
      pushed: 0,
      skipped: 0,
      errors: 0,
    };
  }
  if (args.rows.length === 0) {
    return { available: true, attempted: 0, pushed: 0, skipped: 0, errors: 0 };
  }

  const ctx = makeRestCtx();
  const existing = await fetchExistingSenderoIds(ctx, RESOLUTIONS_DATASET);
  if (!existing.ok) {
    return {
      available: false,
      reason: existing.reason,
      attempted: 0,
      pushed: 0,
      skipped: 0,
      errors: 0,
    };
  }

  const candidates = args.rows.filter(r => !existing.ids.has(r.id)).map(toResolvedGapExample);

  if (candidates.length === 0) {
    return {
      available: true,
      attempted: args.rows.length,
      pushed: 0,
      skipped: args.rows.length,
      errors: 0,
    };
  }

  const upload = await uploadAppendExamples(ctx, RESOLUTIONS_DATASET, candidates);
  return {
    available: true,
    attempted: args.rows.length,
    pushed: upload.ok ? candidates.length : 0,
    skipped: args.rows.length - candidates.length,
    errors: upload.ok ? 0 : candidates.length,
    ...(upload.ok ? {} : { reason: upload.reason }),
  };
}

export async function promoteSuccesses(args: PromoteSuccessesArgs): Promise<PromoteReport> {
  if (!isPhoenixEnabled()) {
    return {
      available: false,
      reason: 'phoenix-not-configured',
      attempted: 0,
      pushed: 0,
      skipped: 0,
      errors: 0,
    };
  }
  if (args.rows.length === 0) {
    return { available: true, attempted: 0, pushed: 0, skipped: 0, errors: 0 };
  }

  const ctx = makeRestCtx();
  const existing = await fetchExistingSenderoIds(ctx, RECALL_DATASET);
  if (!existing.ok) {
    return {
      available: false,
      reason: existing.reason,
      attempted: 0,
      pushed: 0,
      skipped: 0,
      errors: 0,
    };
  }

  const candidates = args.rows.filter(r => !existing.ids.has(r.id)).map(toRecallExample);

  if (candidates.length === 0) {
    return {
      available: true,
      attempted: args.rows.length,
      pushed: 0,
      skipped: args.rows.length,
      errors: 0,
    };
  }

  const upload = await uploadAppendExamples(ctx, RECALL_DATASET, candidates);
  return {
    available: true,
    attempted: args.rows.length,
    pushed: upload.ok ? candidates.length : 0,
    skipped: args.rows.length - candidates.length,
    errors: upload.ok ? 0 : candidates.length,
    ...(upload.ok ? {} : { reason: upload.reason }),
  };
}

// ── Mappers ─────────────────────────────────────────────────────────

interface DatasetExample {
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  metadata: Record<string, unknown> & { sendero_id: string; provenance: Provenance };
}

function toResolvedGapExample(row: KnowledgeGapRow): DatasetExample {
  const fixSummary =
    row.resolutionNote?.trim() ||
    row.suggestedFix?.trim() ||
    'Resolved — see resolutionPrUrl for details.';
  return {
    input: { hypothesis: row.hypothesis },
    output: { fixSummary },
    metadata: {
      sendero_id: row.id,
      provenance: 'human-curated',
      kind: row.kind,
      ...(row.toolName ? { toolName: row.toolName } : {}),
      resolutionPrUrl: row.resolutionPrUrl,
      mustMention: extractMustMention(fixSummary, row.toolName),
      ...(row.resolvedAt ? { resolvedAt: row.resolvedAt.toISOString() } : {}),
    },
  };
}

function toRecallExample(row: BookingRow): DatasetExample {
  return {
    input: { intent: row.intent, ...(row.route ? { route: row.route } : {}) },
    output: { bookingRef: row.bookingRef ?? '', outcome: 'completed' },
    metadata: {
      sendero_id: row.id,
      provenance: 'auto-promoted',
      tenantId: row.tenantId,
      ...(row.traceId ? { traceId: row.traceId } : {}),
      ...(row.confirmedAt ? { confirmedAt: row.confirmedAt.toISOString() } : {}),
    },
  };
}

/**
 * Pull identifier-shaped tokens (camelCase, snake_case, ALL_CAPS,
 * tool names) out of the fix summary. These become the `mustMention`
 * tokens the agent should incorporate when retrying after a
 * `find_resolved_gap` hit.
 *
 * Exported under the `_test` suffix so unit tests can assert the
 * heuristic without re-implementing it. Not part of the public API.
 */
export function extractMustMention_test(text: string, toolName?: string | null): string[] {
  return extractMustMention(text, toolName);
}

function extractMustMention(text: string, toolName?: string | null): string[] {
  const out = new Set<string>();
  if (toolName) out.add(toolName);
  // Match identifiers — letters/digits/underscores, ≥4 chars, with mixed case
  // OR all-caps OR snake_case OR camelCase signal.
  const ids = text.match(/\b[A-Za-z][A-Za-z0-9_]{3,}\b/g) ?? [];
  for (const id of ids) {
    if (id.length < 4) continue;
    const isCamel = /[a-z][A-Z]/.test(id);
    const isSnake = id.includes('_');
    const isAllCaps = id === id.toUpperCase() && /[A-Z]{4,}/.test(id);
    if (isCamel || isSnake || isAllCaps) out.add(id);
  }
  return Array.from(out).slice(0, 6);
}

// ── REST plumbing ───────────────────────────────────────────────────

interface RestCtx {
  collector: string;
  headers: Record<string, string>;
}

function makeRestCtx(): RestCtx {
  const collector = getPhoenixCollectorEndpoint().replace(/\/$/, '');
  const apiKey = getPhoenixApiKey();
  return {
    collector,
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
      ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
    },
  };
}

interface ExistingIdsResult {
  ok: boolean;
  ids: Set<string>;
  reason?: string;
}

async function fetchExistingSenderoIds(
  ctx: RestCtx,
  datasetName: string
): Promise<ExistingIdsResult> {
  try {
    const datasetId = await resolveDatasetIdByName(ctx, datasetName);
    if (!datasetId) {
      // Dataset doesn't exist yet — first promotion creates it.
      return { ok: true, ids: new Set() };
    }

    const url = new URL(`${ctx.collector}/v1/datasets/${encodeURIComponent(datasetId)}/examples`);
    url.searchParams.set('limit', '500');
    const res = await phoenixFetch(url.toString(), {
      headers: ctx.headers,
      timeoutMs: FETCH_TIMEOUT_MS,
    });
    if (!res.ok) {
      return { ok: false, ids: new Set(), reason: `phoenix-http-${res.status}` };
    }
    const data = (await res.json()) as
      | { data?: Array<{ metadata?: Record<string, unknown> }> }
      | null;
    const ids = new Set<string>();
    for (const ex of data?.data ?? []) {
      const id = ex.metadata?.sendero_id;
      if (typeof id === 'string') ids.add(id);
    }
    return { ok: true, ids };
  } catch (err) {
    return {
      ok: false,
      ids: new Set(),
      reason: err instanceof Error ? `phoenix-process-${err.name}` : 'phoenix-process-error',
    };
  }
}

async function resolveDatasetIdByName(ctx: RestCtx, name: string): Promise<string | null> {
  const url = new URL(`${ctx.collector}/v1/datasets`);
  url.searchParams.set('name', name);
  const res = await phoenixFetch(url.toString(), {
    headers: ctx.headers,
    timeoutMs: FETCH_TIMEOUT_MS,
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { data?: Array<{ id?: string; name?: string }> } | null;
  const list = Array.isArray(data?.data) ? data.data : [];
  return list.find(d => d.name === name)?.id ?? null;
}

interface UploadResult {
  ok: boolean;
  reason?: string;
}

async function uploadAppendExamples(
  ctx: RestCtx,
  datasetName: string,
  examples: DatasetExample[]
): Promise<UploadResult> {
  if (examples.length === 0) return { ok: true };

  // Phoenix v15 dataset upload supports `action: 'append' | 'create'`.
  // Append no-ops if the dataset doesn't exist; we let it fall through
  // to create on first call by trying append then create.
  const body = {
    action: 'append',
    name: datasetName,
    inputs: examples.map(e => e.input),
    outputs: examples.map(e => e.output),
    metadata: examples.map(e => e.metadata),
  };

  const url = `${ctx.collector}/v1/datasets/upload?sync=true`;
  try {
    const res = await phoenixFetch(url, {
      method: 'POST',
      headers: ctx.headers,
      body: JSON.stringify(body),
      timeoutMs: FETCH_TIMEOUT_MS,
    });
    if (res.ok) return { ok: true };

    // Append failed — try create (dataset doesn't exist yet).
    if (res.status === 404) {
      const createRes = await phoenixFetch(url, {
        method: 'POST',
        headers: ctx.headers,
        body: JSON.stringify({ ...body, action: 'create' }),
        timeoutMs: FETCH_TIMEOUT_MS,
      });
      return createRes.ok
        ? { ok: true }
        : { ok: false, reason: `phoenix-http-${createRes.status}-on-create` };
    }

    return { ok: false, reason: `phoenix-http-${res.status}` };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? `phoenix-process-${err.name}` : 'phoenix-process-error',
    };
  }
}
