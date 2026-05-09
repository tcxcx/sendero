/**
 * crowd_level_predictor — HP-adjacent Tool 68 (B3 / events).
 *
 * Spec: docs/experimental-tools-wip/sendero_final_experimental_tool_roadmap.md §B3 #68.
 *
 * Wraps PredictHQ Events API to estimate crowd / demand pressure on a
 * city for a given date window. Surfaces top "demand drivers" so the
 * agent can warn about a hotel-rate spike or recommend that the
 * traveler shift dates.
 *
 * Endpoint: https://api.predicthq.com/v1/events/
 *   - GET, auth `Authorization: Bearer ${PREDICTHQ_ACCESS_TOKEN}`
 *   - Filters: `q`, `place.scope` (city geoname or slug),
 *     `country`, `category`, `active.gte`, `active.lte`,
 *     `rank.gte`, `local_rank.gte`, `limit`.
 *   - Each event has a `phq_attendance` (predicted attendees), `rank`
 *     (0–100 demand intensity), `local_rank` (0–100 city-level intensity).
 *
 * We aggregate:
 *   - sum(phq_attendance) over the window → estimated incremental demand.
 *   - max(local_rank) → "peak day" pressure score.
 *   - top 5 events by rank → the demand drivers.
 *
 * Crowd level mapping (heuristic, conservative):
 *   - peak local_rank ≥ 80 → 'extreme'
 *   - peak local_rank ≥ 60 → 'high'
 *   - peak local_rank ≥ 35 → 'moderate'
 *   - else → 'low'
 *
 * **Experimental** (`experimental: true`). Dev-only gate at handler-time.
 */

import { z } from 'zod';

import { assertDevOnlyToolAllowed } from '../dev-gate';
import type { ToolContext, ToolDef } from '../types';

const inputSchema = z.object({
  city: z.string().min(1).max(120),
  countryCode: z.string().length(2).optional(),
  /** ISO-8601 start of the window. Defaults to today. */
  startsAtIso: z.string().optional(),
  /** ISO-8601 end of the window. Defaults to start + 7 days. */
  endsAtIso: z.string().optional(),
  /** Optional category filter — narrows demand drivers. */
  categories: z
    .array(
      z.enum([
        'concerts',
        'conferences',
        'expos',
        'festivals',
        'performing-arts',
        'sports',
        'community',
        'public-holidays',
        'school-holidays',
        'observances',
        'politics',
        'severe-weather',
        'airport-delays',
        'disasters',
        'terror',
        'health-warnings',
        'academic',
      ])
    )
    .max(8)
    .optional(),
  /** PredictHQ rank floor 0-100. Default 30 (drops noise). */
  minRank: z.number().int().min(0).max(100).default(30),
  /** Max top-rank events to surface as demand drivers. */
  topDriversLimit: z.number().int().min(1).max(15).default(5),
});

export type CrowdLevelPredictorInput = z.infer<typeof inputSchema>;

export type CrowdLevel = 'low' | 'moderate' | 'high' | 'extreme';

export interface CrowdDriver {
  id: string;
  title: string;
  category: string;
  startsAtIso?: string;
  endsAtIso?: string;
  predictedAttendance?: number;
  rank?: number;
  localRank?: number;
  description?: string;
}

export type CrowdLevelPredictorResult =
  | {
      status: 'ok';
      city: string;
      window: { startsAtIso: string; endsAtIso: string };
      crowdLevel: CrowdLevel;
      peakLocalRank: number;
      totalEvents: number;
      totalPredictedAttendance: number;
      topDrivers: CrowdDriver[];
      message: string;
    }
  | { status: 'production_refused'; message: string }
  | { status: 'unavailable'; reason: string; message: string };

// ── Deps ─────────────────────────────────────────────────────────────

export interface CrowdLevelPredictorDeps {
  fetchPredictHq?: (
    input: CrowdLevelPredictorInput,
    window: { startsAtIso: string; endsAtIso: string }
  ) => Promise<{ ok: boolean; events: PhqEvent[]; reason?: string }>;
}

interface PhqEvent {
  id: string;
  title: string;
  category: string;
  start?: string;
  end?: string;
  phq_attendance?: number;
  rank?: number;
  local_rank?: number;
  description?: string;
}

const ENDPOINT = 'https://api.predicthq.com/v1/events/';

function defaultWindow(input: CrowdLevelPredictorInput): {
  startsAtIso: string;
  endsAtIso: string;
} {
  const now = new Date();
  const start = input.startsAtIso ? new Date(input.startsAtIso) : now;
  const end = input.endsAtIso
    ? new Date(input.endsAtIso)
    : new Date(start.getTime() + 7 * 86_400_000);
  // PredictHQ accepts plain ISO date or full datetime. Use date-only
  // for cleaner cache keys.
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { startsAtIso: fmt(start), endsAtIso: fmt(end) };
}

async function fetchPredictHqLive(
  input: CrowdLevelPredictorInput,
  window: { startsAtIso: string; endsAtIso: string }
): Promise<{ ok: boolean; events: PhqEvent[]; reason?: string }> {
  const token = process.env.PREDICTHQ_ACCESS_TOKEN;
  if (!token) return { ok: false, events: [], reason: 'no-access-token' };

  const url = new URL(ENDPOINT);
  url.searchParams.set('q', input.city);
  url.searchParams.set('active.gte', window.startsAtIso);
  url.searchParams.set('active.lte', window.endsAtIso);
  url.searchParams.set('rank.gte', String(input.minRank));
  url.searchParams.set('limit', '50');
  url.searchParams.set('sort', 'rank');
  if (input.countryCode) url.searchParams.set('country', input.countryCode);
  if (input.categories?.length) {
    url.searchParams.set('category', input.categories.join(','));
  }

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 8000);
  try {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'User-Agent': 'sendero-predicthq-crowd/0.1',
      },
      signal: ac.signal,
    });
    if (!res.ok) {
      return { ok: false, events: [], reason: `http-${res.status}` };
    }
    const body = (await res.json()) as { results?: PhqEvent[] };
    return { ok: true, events: body.results ?? [] };
  } catch (err) {
    return { ok: false, events: [], reason: (err as Error).message ?? 'fetch-failed' };
  } finally {
    clearTimeout(timer);
  }
}

const liveDeps: CrowdLevelPredictorDeps = {
  fetchPredictHq: fetchPredictHqLive,
};

export const liveDependencies = liveDeps;

// ── Aggregation ──────────────────────────────────────────────────────

function classifyCrowd(peakLocalRank: number): CrowdLevel {
  if (peakLocalRank >= 80) return 'extreme';
  if (peakLocalRank >= 60) return 'high';
  if (peakLocalRank >= 35) return 'moderate';
  return 'low';
}

function summarize(level: CrowdLevel, city: string, drivers: CrowdDriver[]): string {
  const top = drivers[0];
  switch (level) {
    case 'extreme':
      return `Extreme demand pressure in ${city}${top ? ` (${top.title})` : ''} — expect hotel rates to spike and venues to be full. Consider shifting dates.`;
    case 'high':
      return `High demand pressure in ${city}${top ? ` (${top.title})` : ''} — book lodging early and reserve restaurants in advance.`;
    case 'moderate':
      return `Moderate demand pressure in ${city} — a few notable events; book popular venues ahead.`;
    case 'low':
      return `Low demand pressure in ${city} — typical conditions, no major drivers.`;
  }
}

// ── Orchestrator ─────────────────────────────────────────────────────

export async function runCrowdLevelPredictor(
  rawInput: CrowdLevelPredictorInput,
  ctx?: ToolContext,
  deps: CrowdLevelPredictorDeps = liveDeps
): Promise<CrowdLevelPredictorResult> {
  const gate = assertDevOnlyToolAllowed(ctx);
  if (gate.allowed === false) {
    return { status: 'production_refused', message: gate.reason };
  }

  const input = inputSchema.parse(rawInput);
  const window = defaultWindow(input);

  if (!deps.fetchPredictHq) {
    return {
      status: 'unavailable',
      reason: 'no-fetcher',
      message: 'PredictHQ fetcher not wired.',
    };
  }

  const r = await deps.fetchPredictHq(input, window);
  if (!r.ok) {
    return {
      status: 'unavailable',
      reason: r.reason ?? 'unknown',
      message: `PredictHQ failed: ${r.reason ?? 'unknown'}.`,
    };
  }

  const events = r.events;
  const peakLocalRank = events.reduce((max, e) => Math.max(max, e.local_rank ?? 0), 0);
  const totalAttendance = events.reduce((sum, e) => sum + (e.phq_attendance ?? 0), 0);

  const drivers: CrowdDriver[] = events
    .slice()
    .sort((a, b) => (b.rank ?? 0) - (a.rank ?? 0))
    .slice(0, input.topDriversLimit)
    .map(e => ({
      id: e.id,
      title: e.title,
      category: e.category,
      ...(e.start ? { startsAtIso: e.start } : {}),
      ...(e.end ? { endsAtIso: e.end } : {}),
      ...(typeof e.phq_attendance === 'number' ? { predictedAttendance: e.phq_attendance } : {}),
      ...(typeof e.rank === 'number' ? { rank: e.rank } : {}),
      ...(typeof e.local_rank === 'number' ? { localRank: e.local_rank } : {}),
      ...(e.description ? { description: e.description.slice(0, 200) } : {}),
    }));

  const level = classifyCrowd(peakLocalRank);

  return {
    status: 'ok',
    city: input.city,
    window,
    crowdLevel: level,
    peakLocalRank,
    totalEvents: events.length,
    totalPredictedAttendance: totalAttendance,
    topDrivers: drivers,
    message: summarize(level, input.city, drivers),
  };
}

// ── Tool registration ────────────────────────────────────────────────

export const crowdLevelPredictorTool: ToolDef<CrowdLevelPredictorInput, CrowdLevelPredictorResult> =
  {
    name: 'crowd_level_predictor',
    internal: true,
    description:
      "Estimate crowd / demand pressure for a city + date window via PredictHQ. Returns `crowdLevel` ('low'/'moderate'/'high'/'extreme'), peak local-rank, total predicted attendance, and the top demand drivers (concerts, conferences, festivals, sports, holidays). Use when the traveler asks 'is <city> busy that week', 'will hotels be expensive', 'should I shift dates', 'why is everything sold out'. Compose with `mainstream_event_discovery` to surface specific tickets a traveler can buy.",
    inputSchema,
    jsonSchema: {
      type: 'object',
      required: ['city'],
      properties: {
        city: { type: 'string', minLength: 1, maxLength: 120 },
        countryCode: { type: 'string', minLength: 2, maxLength: 2 },
        startsAtIso: { type: 'string' },
        endsAtIso: { type: 'string' },
        categories: {
          type: 'array',
          maxItems: 8,
          items: {
            type: 'string',
            enum: [
              'concerts',
              'conferences',
              'expos',
              'festivals',
              'performing-arts',
              'sports',
              'community',
              'public-holidays',
              'school-holidays',
              'observances',
              'politics',
              'severe-weather',
              'airport-delays',
              'disasters',
              'terror',
              'health-warnings',
              'academic',
            ],
          },
        },
        minRank: { type: 'integer', minimum: 0, maximum: 100 },
        topDriversLimit: { type: 'integer', minimum: 1, maximum: 15 },
      },
    },
    handler: runCrowdLevelPredictor,
  };
