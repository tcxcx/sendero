/**
 * @sendero/arize-phoenix/experiments — Phoenix dataset queries for
 * `find_resolved_gap` (PR3) and future tool-performance lookups.
 *
 * Reads examples from the `sendero-resolved-gaps` Phoenix dataset.
 * Each row stores:
 *   - `input`:  the hypothesis text from a prior `report_knowledge_gap`
 *   - `output`: a short fix summary (1-2 sentences for the agent to act on)
 *   - `metadata.toolName`, `metadata.kind`, `metadata.resolutionPrUrl`,
 *     `metadata.mustMention` (string[]), `metadata.provenance`
 *
 * v0.1 recall: token-overlap similarity. Each of the 4 seeded bugs has
 * a distinctive identifier (`documentImageUrl`, `PASSPORT_VAULT_KEK`,
 * etc.) so lexical match works for the hackathon demo. v0.2 upgrades
 * to embedding similarity via Vertex `text-embedding-005`.
 *
 * Fail-soft: any non-2xx / timeout / dataset-not-found returns
 * `{ available: false }` so the agent falls through to the standard
 * `report_knowledge_gap` escalation path (the cold path before PR3).
 */

import { getPhoenixApiKey, getPhoenixCollectorEndpoint, isPhoenixEnabled } from './client';
import type { Provenance } from './types';

export interface FindResolvedGapArgs {
  /** Agent's diagnosis of what went wrong — typically the same shape as `report_knowledge_gap`'s hypothesis field. */
  hypothesis: string;
  /** Optional tool name the agent was trying to call. Boosts match when present. */
  toolName?: string;
  /** Optional kind filter — same enum as `report_knowledge_gap`. */
  kind?: string;
  /** Minimum similarity score (0..1) to count as a hit. Default 0.35. */
  minScore?: number;
}

export interface ResolvedGapHit {
  /** Phoenix example id. */
  exampleId: string;
  /** Original hypothesis text (the seed). */
  hypothesis: string;
  /** Fix summary the agent should apply. */
  fixSummary: string;
  toolName?: string;
  kind?: string;
  resolutionPrUrl?: string;
  /** Tokens / phrases the agent should incorporate when retrying. */
  mustMention: string[];
  provenance: Provenance;
  /** Match score (0..1) — for observability, not for filtering downstream. */
  score: number;
}

export interface FindResolvedGapResult {
  available: boolean;
  reason?: string;
  /** Top match when `available: true && found`. */
  hit?: ResolvedGapHit;
  /** Inline candidates the matcher considered (for debugging — top 3). */
  candidates?: Array<{ exampleId: string; score: number }>;
}

const DATASET_NAME = 'sendero-resolved-gaps';
const DEFAULT_MIN_SCORE = 0.35;
const FETCH_TIMEOUT_MS = 4000;
const MAX_EXAMPLES = 200;

interface PhoenixDatasetRow {
  id: string;
  input?: Record<string, unknown> | string;
  output?: Record<string, unknown> | string;
  metadata?: Record<string, unknown>;
}

let _datasetIdCache: string | null = null;

export async function findResolvedGap(args: FindResolvedGapArgs): Promise<FindResolvedGapResult> {
  if (!isPhoenixEnabled()) {
    return { available: false, reason: 'phoenix-not-configured' };
  }

  const collector = getPhoenixCollectorEndpoint().replace(/\/$/, '');
  const apiKey = getPhoenixApiKey();
  const minScore = args.minScore ?? DEFAULT_MIN_SCORE;
  const headers: Record<string, string> = {
    accept: 'application/json',
    ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
  };

  try {
    // Resolve dataset id (cached after first call).
    const datasetId = await resolveDatasetId(collector, headers);
    if (!datasetId) {
      return { available: false, reason: 'dataset-not-seeded' };
    }

    const examples = await fetchExamples(collector, headers, datasetId);
    if (examples.length === 0) {
      return { available: false, reason: 'dataset-empty' };
    }

    const hypothesisTokens = tokenize(args.hypothesis);
    const toolBoost = args.toolName ? Array.from(tokenize(args.toolName)) : [];

    const scored = examples
      .map(ex => scoreExample(ex, hypothesisTokens, toolBoost, args.kind))
      .filter((s): s is { hit: ResolvedGapHit; score: number } => s !== null)
      .sort((a, b) => b.score - a.score);

    const candidates = scored.slice(0, 3).map(s => ({
      exampleId: s.hit.exampleId,
      score: s.score,
    }));

    const top = scored[0];
    if (!top || top.score < minScore) {
      return { available: true, candidates };
    }

    return { available: true, hit: top.hit, candidates };
  } catch (err) {
    // phoenixFetch normally swallows network errors; this catch covers
    // post-fetch processing (json shape, scoring) that can still throw.
    return {
      available: false,
      reason: err instanceof Error ? `phoenix-process-${err.name}` : 'phoenix-process-error',
    };
  }
}

/**
 * Reset the cached dataset id — used by tests and the seeding script
 * after fresh dataset creation.
 */
export function resetResolvedGapsDatasetCache(): void {
  _datasetIdCache = null;
}

// ── Phoenix REST helpers ────────────────────────────────────────────

async function resolveDatasetId(
  collector: string,
  headers: Record<string, string>
): Promise<string | null> {
  if (_datasetIdCache) return _datasetIdCache;

  const url = new URL(`${collector}/v1/datasets`);
  url.searchParams.set('name', DATASET_NAME);

  const res = await fetchWithTimeout(url.toString(), { headers });
  if (!res.ok) return null;

  const data = (await res.json()) as { data?: Array<{ id?: string; name?: string }> };
  const list = Array.isArray(data?.data) ? data.data : [];
  const match = list.find(d => d.name === DATASET_NAME) ?? list[0];
  if (!match?.id) return null;

  _datasetIdCache = match.id;
  return _datasetIdCache;
}

async function fetchExamples(
  collector: string,
  headers: Record<string, string>,
  datasetId: string
): Promise<PhoenixDatasetRow[]> {
  const url = new URL(`${collector}/v1/datasets/${encodeURIComponent(datasetId)}/examples`);
  url.searchParams.set('limit', String(MAX_EXAMPLES));

  const res = await fetchWithTimeout(url.toString(), { headers });
  if (!res.ok) return [];

  const data = (await res.json()) as { data?: PhoenixDatasetRow[] };
  return Array.isArray(data?.data) ? data.data : [];
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const handle = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(handle);
  }
}

// ── Scoring (token-overlap, v0.1) ───────────────────────────────────

const STOPWORDS = new Set([
  'the',
  'a',
  'an',
  'and',
  'or',
  'is',
  'to',
  'of',
  'in',
  'on',
  'for',
  'i',
  'it',
  'this',
  'that',
  'with',
  'as',
  'by',
  'be',
  'are',
  'was',
  'tool',
  'failed',
  'error',
  'not',
  'no',
  'but',
  'if',
  'when',
  'than',
]);

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9_\s]/g, ' ')
      .split(/\s+/)
      .filter(t => t.length >= 3 && !STOPWORDS.has(t))
  );
}

function scoreExample(
  row: PhoenixDatasetRow,
  hypothesisTokens: Set<string>,
  toolBoostTokens: string[],
  kindFilter?: string
): { hit: ResolvedGapHit; score: number } | null {
  const meta = row.metadata ?? {};
  const kind = typeof meta.kind === 'string' ? meta.kind : undefined;
  if (kindFilter && kind && kind !== kindFilter) return null;

  const hypothesis = readTextField(row.input, 'hypothesis') ?? '';
  if (!hypothesis) return null;

  const exampleTokens = tokenize(hypothesis);
  if (exampleTokens.size === 0) return null;

  // Jaccard-ish: intersect / min(size) — biases toward agreement on
  // distinctive tokens (env var names, tool names) without penalizing
  // long examples.
  let intersect = 0;
  for (const t of hypothesisTokens) {
    if (exampleTokens.has(t)) intersect += 1;
  }
  const denom = Math.max(1, Math.min(hypothesisTokens.size, exampleTokens.size));
  let score = intersect / denom;

  // Tool-name match is a high-signal boost (specific tool tokens are unique).
  if (toolBoostTokens.length > 0) {
    const exampleToolName = typeof meta.toolName === 'string' ? meta.toolName : undefined;
    if (exampleToolName && toolBoostTokens.includes(exampleToolName.toLowerCase())) {
      score = Math.min(1, score + 0.25);
    }
  }

  const fixSummary = readTextField(row.output, 'fixSummary') ?? '';
  const mustMention = Array.isArray(meta.mustMention)
    ? meta.mustMention.filter((m): m is string => typeof m === 'string')
    : [];
  const provenance = meta.provenance === 'auto-promoted' ? 'auto-promoted' : 'human-curated';

  return {
    score,
    hit: {
      exampleId: row.id,
      hypothesis,
      fixSummary,
      ...(typeof meta.toolName === 'string' ? { toolName: meta.toolName } : {}),
      ...(kind ? { kind } : {}),
      ...(typeof meta.resolutionPrUrl === 'string'
        ? { resolutionPrUrl: meta.resolutionPrUrl }
        : {}),
      mustMention,
      provenance,
      score,
    },
  };
}

function readTextField(
  field: Record<string, unknown> | string | undefined,
  preferredKey: string
): string | null {
  if (typeof field === 'string') return field;
  if (!field || typeof field !== 'object') return null;
  const direct = field[preferredKey];
  if (typeof direct === 'string') return direct;
  // Fall back to any string field.
  for (const v of Object.values(field)) {
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return null;
}
