/**
 * mainstream_event_discovery — HP-adjacent Tool 58 (B3 / events).
 *
 * Spec: docs/experimental-tools-wip/sendero_final_experimental_tool_roadmap.md §B3 #58.
 *
 * Wraps Ticketmaster Discovery API v2 for mainstream events:
 * concerts, theater, sports, family shows, comedy, festivals.
 *
 * Discovery API: https://app.ticketmaster.com/discovery/v2/events.json
 *   - GET, query string auth via `?apikey=<TICKETMASTER_API_KEY>`
 *   - Filterable by city, countryCode, classificationName, segmentName,
 *     startDateTime / endDateTime (ISO-8601 in UTC),
 *     keyword, size (page_size, max 200), sort.
 *   - Response: `{ _embedded: { events: [...] } }`.
 *
 * The agent uses this for "what concerts in <city>", "Lakers tickets",
 * "Broadway shows next week". For founder/community events use
 * `eventbrite_event_discovery`. For Luma/Meetup pro-network use
 * `professional_networking_scanner`.
 *
 * **Experimental** (`experimental: true`). Dev-only gate at handler-time.
 */

import { z } from 'zod';

import { assertDevOnlyToolAllowed } from '../dev-gate';
import type { ToolContext, ToolDef } from '../types';

const SEGMENTS = [
  'Music',
  'Sports',
  'Arts & Theatre',
  'Film',
  'Miscellaneous',
] as const;

const inputSchema = z.object({
  city: z.string().min(1).max(120),
  countryCode: z.string().length(2).optional(),
  /**
   * Ticketmaster's high-level segment. `Music` for concerts, `Sports`
   * for matches, `Arts & Theatre` for theater/comedy. Omit to scan all.
   */
  segment: z.enum(SEGMENTS).optional(),
  keyword: z.string().max(200).optional(),
  /**
   * ISO-8601 UTC datetime range. Defaults to "today + 30 days" when
   * both omitted. Inclusive lower, exclusive upper.
   */
  startsAfterIso: z.string().optional(),
  startsBeforeIso: z.string().optional(),
  limit: z.number().int().min(1).max(20).default(10),
  /** BCP-47 — Ticketmaster uses `locale` for response strings. */
  locale: z.string().max(10).default('en-us'),
});

export type MainstreamEventDiscoveryInput = z.infer<typeof inputSchema>;

export interface MainstreamEventHit {
  id: string;
  name: string;
  url: string;
  startsAtIso?: string;
  segment?: string;
  genre?: string;
  venueName?: string;
  city?: string;
  /** Lowest-listed face value when Ticketmaster reports it. USD when known. */
  priceMin?: number;
  priceMax?: number;
  currency?: string;
  /** "onsale", "offsale", "rescheduled", etc. */
  saleStatus?: string;
  imageUrl?: string;
}

export type MainstreamEventDiscoveryResult =
  | {
      status: 'ok';
      city: string;
      events: MainstreamEventHit[];
      message: string;
    }
  | { status: 'production_refused'; message: string }
  | { status: 'unavailable'; reason: string; message: string };

// ── Deps ─────────────────────────────────────────────────────────────

export interface MainstreamEventDiscoveryDeps {
  fetchTicketmaster?: (
    input: MainstreamEventDiscoveryInput
  ) => Promise<{ ok: boolean; events: MainstreamEventHit[]; reason?: string }>;
}

const ENDPOINT = 'https://app.ticketmaster.com/discovery/v2/events.json';

function defaultRange(): { start: string; end: string } {
  const now = new Date();
  const end = new Date(now.getTime() + 30 * 86_400_000);
  // Ticketmaster requires "no milliseconds" UTC ISO ("YYYY-MM-DDTHH:mm:ssZ").
  const fmt = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');
  return { start: fmt(now), end: fmt(end) };
}

async function fetchTicketmasterLive(
  input: MainstreamEventDiscoveryInput
): Promise<{ ok: boolean; events: MainstreamEventHit[]; reason?: string }> {
  const apiKey = process.env.TICKETMASTER_API_KEY;
  if (!apiKey) return { ok: false, events: [], reason: 'no-api-key' };

  const { start, end } = defaultRange();
  const url = new URL(ENDPOINT);
  url.searchParams.set('apikey', apiKey);
  url.searchParams.set('city', input.city);
  url.searchParams.set('size', String(Math.min(input.limit, 20)));
  url.searchParams.set('locale', input.locale);
  url.searchParams.set('startDateTime', input.startsAfterIso ?? start);
  url.searchParams.set('endDateTime', input.startsBeforeIso ?? end);
  url.searchParams.set('sort', 'date,asc');
  if (input.countryCode) url.searchParams.set('countryCode', input.countryCode);
  if (input.segment) url.searchParams.set('segmentName', input.segment);
  if (input.keyword) url.searchParams.set('keyword', input.keyword);

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 8000);
  try {
    const res = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'sendero-ticketmaster-discovery/0.1',
      },
      signal: ac.signal,
    });
    if (!res.ok) {
      return { ok: false, events: [], reason: `http-${res.status}` };
    }
    type TmImage = { url?: string; width?: number; ratio?: string };
    type TmEvent = {
      id: string;
      name: string;
      url: string;
      images?: TmImage[];
      dates?: {
        start?: { dateTime?: string; localDate?: string; localTime?: string };
        status?: { code?: string };
      };
      classifications?: Array<{
        segment?: { name?: string };
        genre?: { name?: string };
      }>;
      priceRanges?: Array<{ min?: number; max?: number; currency?: string }>;
      _embedded?: {
        venues?: Array<{
          name?: string;
          city?: { name?: string };
        }>;
      };
    };
    const body = (await res.json()) as { _embedded?: { events?: TmEvent[] } };
    const list: MainstreamEventHit[] = (body._embedded?.events ?? [])
      .slice(0, input.limit)
      .map(e => {
        const venue = e._embedded?.venues?.[0];
        const cls = e.classifications?.[0];
        const price = e.priceRanges?.[0];
        const img = pickBestImage(e.images);
        const startsAtIso =
          e.dates?.start?.dateTime ??
          (e.dates?.start?.localDate && e.dates.start.localTime
            ? `${e.dates.start.localDate}T${e.dates.start.localTime}`
            : e.dates?.start?.localDate);
        return {
          id: e.id,
          name: e.name,
          url: e.url,
          ...(startsAtIso ? { startsAtIso } : {}),
          ...(cls?.segment?.name ? { segment: cls.segment.name } : {}),
          ...(cls?.genre?.name ? { genre: cls.genre.name } : {}),
          ...(venue?.name ? { venueName: venue.name } : {}),
          ...(venue?.city?.name ? { city: venue.city.name } : {}),
          ...(typeof price?.min === 'number' ? { priceMin: price.min } : {}),
          ...(typeof price?.max === 'number' ? { priceMax: price.max } : {}),
          ...(price?.currency ? { currency: price.currency } : {}),
          ...(e.dates?.status?.code ? { saleStatus: e.dates.status.code } : {}),
          ...(img ? { imageUrl: img } : {}),
        };
      });
    return { ok: true, events: list };
  } catch (err) {
    return { ok: false, events: [], reason: (err as Error).message ?? 'fetch-failed' };
  } finally {
    clearTimeout(timer);
  }
}

function pickBestImage(images: Array<{ url?: string; width?: number; ratio?: string }> | undefined): string | undefined {
  if (!images?.length) return undefined;
  // Prefer 16_9 wide hero shots — they unfurl best in WhatsApp / Slack.
  const wide = images.filter(i => i.ratio === '16_9');
  const sortable = wide.length > 0 ? wide : images;
  const sorted = [...sortable].sort((a, b) => (b.width ?? 0) - (a.width ?? 0));
  return sorted[0]?.url;
}

const liveDeps: MainstreamEventDiscoveryDeps = {
  fetchTicketmaster: fetchTicketmasterLive,
};

export const liveDependencies = liveDeps;

// ── Orchestrator ─────────────────────────────────────────────────────

export async function runMainstreamEventDiscovery(
  rawInput: MainstreamEventDiscoveryInput,
  ctx?: ToolContext,
  deps: MainstreamEventDiscoveryDeps = liveDeps
): Promise<MainstreamEventDiscoveryResult> {
  const gate = assertDevOnlyToolAllowed(ctx);
  if (gate.allowed === false) {
    return { status: 'production_refused', message: gate.reason };
  }

  const input = inputSchema.parse(rawInput);

  if (!deps.fetchTicketmaster) {
    return {
      status: 'unavailable',
      reason: 'no-fetcher',
      message: 'Ticketmaster fetcher not wired.',
    };
  }

  const r = await deps.fetchTicketmaster(input);
  if (!r.ok) {
    return {
      status: 'unavailable',
      reason: r.reason ?? 'unknown',
      message: `Ticketmaster Discovery failed: ${r.reason ?? 'unknown'}.`,
    };
  }

  if (r.events.length === 0) {
    return {
      status: 'ok',
      city: input.city,
      events: [],
      message: `No Ticketmaster events in ${input.city} for the requested window.`,
    };
  }

  return {
    status: 'ok',
    city: input.city,
    events: r.events,
    message: `${r.events.length} Ticketmaster events in ${input.city}.`,
  };
}

// ── Tool registration ────────────────────────────────────────────────

export const mainstreamEventDiscoveryTool: ToolDef<
  MainstreamEventDiscoveryInput,
  MainstreamEventDiscoveryResult
> = {
  name: 'mainstream_event_discovery',
  internal: true,
  experimental: true,
  description:
    "Find mainstream events via Ticketmaster Discovery API: concerts, theater, sports, family shows, comedy, festivals. Filter by city + segment (`Music` / `Sports` / `Arts & Theatre`) + optional keyword + ISO date window. For founder/community/free events use `eventbrite_event_discovery`. For curated specialty discovery (Luma + Meetup + accelerators) use `professional_networking_scanner`. Use when the traveler asks 'concerts in <city> next week', 'Lakers tickets', 'Broadway shows', 'comedy <city>'.",
  inputSchema,
  jsonSchema: {
    type: 'object',
    required: ['city'],
    properties: {
      city: { type: 'string', minLength: 1, maxLength: 120 },
      countryCode: { type: 'string', minLength: 2, maxLength: 2 },
      segment: { type: 'string', enum: [...SEGMENTS] },
      keyword: { type: 'string', maxLength: 200 },
      startsAfterIso: { type: 'string' },
      startsBeforeIso: { type: 'string' },
      limit: { type: 'integer', minimum: 1, maximum: 20 },
      locale: { type: 'string', maxLength: 10 },
    },
  },
  handler: runMainstreamEventDiscovery,
};
