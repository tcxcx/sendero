/**
 * eventbrite_event_discovery — HP-adjacent Tool 49 (B2 / events).
 *
 * Spec: docs/experimental-tools-wip/sendero_final_experimental_tool_roadmap.md §B2.
 *
 * Eventbrite's public Events Search API was permanently removed in 2020:
 *   - GET /v3/events/search/ → 404
 *   - GET /v3/destination/events/search/ requires `event_id` and is
 *     not a discovery endpoint despite the name
 *
 * Public discovery now happens via Google Custom Search scoped to
 * `site:eventbrite.com`. That's the primary path here. The
 * EVENTBRITE_PRIVATE_TOKEN stays useful for future enrichment via
 * `/v3/events/<id>/` (single-event detail) when we extract the id
 * from the Eventbrite URL pattern.
 *
 * Same shape as `web_search`'s grounding pattern: pure HTTP, no LLM
 * round-trip. Returns `EventbriteEventHit[]` so the downstream
 * `professional_networking_scanner` aggregator can compose with Luma /
 * Meetup later without caring which leg fired.
 *
 * **Experimental** (`experimental: true`). Dev-only gate at handler-time.
 */

import { z } from 'zod';

import { cseSearch } from '@sendero/web-search';

import { assertDevOnlyToolAllowed } from '../dev-gate';
import type { ToolContext, ToolDef } from '../types';

const inputSchema = z.object({
  city: z.string().min(1).max(120),
  countryCode: z.string().length(2).optional(),
  /**
   * Free-form keywords. Examples: 'startup founder', 'AI', 'web3',
   * 'language exchange', 'design'. Stays out of the URL when omitted.
   */
  keywords: z.string().max(200).optional(),
  /**
   * Limit results. Eventbrite's destination endpoint paginates at 50;
   * CSE caps at 10. We cap the public surface at 15 either way to
   * keep the agent's tool-use budget bounded.
   */
  limit: z.number().int().min(1).max(15).default(8),
  languageCode: z.string().max(10).default('en'),
});

export type EventbriteEventDiscoveryInput = z.infer<typeof inputSchema>;

export interface EventbriteEventHit {
  id: string;
  name: string;
  url: string;
  startsAtIso?: string;
  endsAtIso?: string;
  venueName?: string;
  city?: string;
  /** Free / paid signal. Eventbrite-API path only — CSE path leaves null. */
  isFree?: boolean;
  /** Short snippet — from API description or CSE snippet. */
  summary?: string;
  /** Path that surfaced this row. */
  source: 'eventbrite_api' | 'cse';
}

export type EventbriteEventDiscoveryResult =
  | {
      status: 'ok';
      city: string;
      events: EventbriteEventHit[];
      via: 'eventbrite_api' | 'cse' | 'mixed';
      message: string;
    }
  | { status: 'production_refused'; message: string }
  | { status: 'unavailable'; reason: string; message: string };

// ── Deps ─────────────────────────────────────────────────────────────

export interface EventbriteEventDiscoveryDeps {
  cse: typeof cseSearch;
  /**
   * Optional per-event detail fetcher. Given an Eventbrite event id
   * (extracted from the URL slug `…-<id>`), returns the structured
   * detail payload — used to enrich CSE hits with start time + venue
   * + free/paid signal. Failing-soft.
   */
  fetchEventDetail?: (eventId: string) => Promise<Partial<EventbriteEventHit> | null>;
}

const DETAIL_ENDPOINT = 'https://www.eventbriteapi.com/v3/events';

async function fetchEventDetailLive(eventId: string): Promise<Partial<EventbriteEventHit> | null> {
  const token = process.env.EVENTBRITE_PRIVATE_TOKEN;
  if (!token) return null;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 5000);
  try {
    const url = `${DETAIL_ENDPOINT}/${encodeURIComponent(eventId)}/?expand=venue`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'User-Agent': 'sendero-eventbrite-detail/0.1',
      },
      signal: ac.signal,
    });
    if (!res.ok) return null;
    const e = (await res.json()) as {
      id?: string;
      name?: { text?: string } | string;
      start?: { utc?: string };
      end?: { utc?: string };
      is_free?: boolean;
      venue?: { name?: string; address?: { city?: string } };
    };
    return {
      ...(e.start?.utc ? { startsAtIso: e.start.utc } : {}),
      ...(e.end?.utc ? { endsAtIso: e.end.utc } : {}),
      ...(e.venue?.name ? { venueName: e.venue.name } : {}),
      ...(e.venue?.address?.city ? { city: e.venue.address.city } : {}),
      ...(typeof e.is_free === 'boolean' ? { isFree: e.is_free } : {}),
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const liveDeps: EventbriteEventDiscoveryDeps = {
  cse: cseSearch,
  fetchEventDetail: fetchEventDetailLive,
};

export const liveDependencies = liveDeps;

/**
 * Eventbrite URLs follow `/e/<slug>-<numericId>` — extract the trailing
 * id so we can enrich with /v3/events/<id>/.
 */
function extractEventbriteId(url: string): string | null {
  const m = /\/e\/[^/?#]*?-(\d{8,})(?:[/?#]|$)/.exec(url);
  return m?.[1] ?? null;
}

// ── CSE fallback ─────────────────────────────────────────────────────

async function discoverViaCse(
  input: EventbriteEventDiscoveryInput,
  cse: EventbriteEventDiscoveryDeps['cse']
): Promise<EventbriteEventHit[]> {
  const q = [input.keywords, 'events', input.city].filter(Boolean).join(' ');
  const res = await cse({
    query: q,
    site: 'eventbrite.com',
    limit: Math.min(input.limit, 10),
    lang: input.languageCode,
    ...(input.countryCode ? { country: input.countryCode } : {}),
    freshness: 'd30',
  });
  if (!res.available) return [];
  return res.results.slice(0, input.limit).map(hit => ({
    id: hit.cacheId ?? hit.link,
    name: hit.title.replace(/\s+\| Eventbrite$/i, '').trim(),
    url: hit.link,
    ...(hit.snippet ? { summary: hit.snippet } : {}),
    source: 'cse' as const,
  }));
}

// ── Orchestrator ─────────────────────────────────────────────────────

export async function runEventbriteEventDiscovery(
  rawInput: EventbriteEventDiscoveryInput,
  ctx?: ToolContext,
  deps: EventbriteEventDiscoveryDeps = liveDeps
): Promise<EventbriteEventDiscoveryResult> {
  const gate = assertDevOnlyToolAllowed(ctx);
  if (gate.allowed === false) {
    return { status: 'production_refused', message: gate.reason };
  }

  const input = inputSchema.parse(rawInput);

  // CSE site:eventbrite.com is the only working public-discovery path
  // (Eventbrite removed all third-party event search endpoints in 2020).
  const cseHits = await discoverViaCse(input, deps.cse);

  if (cseHits.length === 0) {
    return {
      status: 'unavailable',
      reason: 'cse-empty',
      message: `No Eventbrite hits surfaced for ${input.city} via CSE. CSE may be unconfigured (GOOGLE_CUSTOM_SEARCH_API_KEY) or the query may need different keywords.`,
    };
  }

  // Best-effort enrichment: when the URL has an extractable event id
  // and the token is bound, hit /v3/events/<id>/ to fill in start time,
  // venue, free/paid. Bounded by min(limit, 5) so we don't blow rate
  // limit on a wide CSE response.
  let apiEnriched = 0;
  if (deps.fetchEventDetail) {
    const enrichLimit = Math.min(cseHits.length, 5);
    await Promise.all(
      cseHits.slice(0, enrichLimit).map(async (hit, idx) => {
        const id = extractEventbriteId(hit.url);
        if (!id) return;
        const detail = await deps.fetchEventDetail!(id);
        if (!detail) return;
        cseHits[idx] = { ...hit, ...detail, source: 'eventbrite_api' };
        apiEnriched += 1;
      })
    );
  }

  const limited = cseHits.slice(0, input.limit);
  const apiHits = limited.filter(e => e.source === 'eventbrite_api').length;
  const cseCount = limited.length - apiHits;
  const via: 'eventbrite_api' | 'cse' | 'mixed' =
    apiHits > 0 && cseCount > 0 ? 'mixed' : apiHits > 0 ? 'eventbrite_api' : 'cse';

  return {
    status: 'ok',
    city: input.city,
    events: limited,
    via,
    message: `${limited.length} Eventbrite events in ${input.city} (cse:${cseCount}, enriched:${apiEnriched}).`,
  };
}

// ── Tool registration ────────────────────────────────────────────────

export const eventbriteEventDiscoveryTool: ToolDef<
  EventbriteEventDiscoveryInput,
  EventbriteEventDiscoveryResult
> = {
  name: 'eventbrite_event_discovery',
  internal: true,
  experimental: true,
  description:
    "Find Eventbrite events in a city — community / professional / free events. Tries the Eventbrite destination API first, falls back to CSE site:eventbrite.com when the token doesn't have public-discovery scope or the API returns thin. Use when the traveler asks 'free events in <city>', 'community events', 'classes / workshops in <city>'. For mainstream concerts/sports/theater use `mainstream_event_discovery` (Ticketmaster). For founder/AI/web3 use `professional_networking_scanner` (which composes this tool with Luma/Meetup).",
  inputSchema,
  jsonSchema: {
    type: 'object',
    required: ['city'],
    properties: {
      city: { type: 'string', minLength: 1, maxLength: 120 },
      countryCode: { type: 'string', minLength: 2, maxLength: 2 },
      keywords: { type: 'string', maxLength: 200 },
      limit: { type: 'integer', minimum: 1, maximum: 15 },
      languageCode: { type: 'string', maxLength: 10 },
    },
  },
  handler: runEventbriteEventDiscovery,
};
