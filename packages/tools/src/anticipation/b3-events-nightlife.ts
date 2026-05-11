/**
 * B3 close-out — 9 events / culture / nightlife tools.
 *
 *   - cultural_attractions_finder   B3 #59
 *   - museum_ticketing_researcher   B3 #60
 *   - nightlife_fit_finder          B3 #61
 *   - family_friendly_event_finder  B3 #62
 *   - exhibition_calendar_researcher B3 #63
 *   - free_events_finder            B3 #65
 *   - last_minute_tickets_finder    B3 #66
 *   - venue_nearby_plan_builder     B3 #67
 *   - rainy_day_plan_finder         B3 #69
 *
 * Mix of CSE+Places finders, Vertex-grounded researchers, and pure
 * composers over existing event tools. All experimental + internal +
 * dev-gated.
 */

import { google } from '@ai-sdk/google';
import { createVertex } from '@ai-sdk/google-vertex';
import { searchText } from '@sendero/google-places';
import { cseSearch } from '@sendero/web-search';
import { generateObject, generateText } from 'ai';
import { z } from 'zod';

import { assertDevOnlyToolAllowed } from '../dev-gate';
import type { ToolContext, ToolDef } from '../types';
import {
  type GroundedFinderConfig,
  type GroundedShopHit,
  liveFinderDeps,
  runGroundedFinder,
} from './_grounded-place-finder';
import { runEventbriteEventDiscovery } from './eventbrite-event-discovery';
import { runMainstreamEventDiscovery } from './mainstream-event-discovery';

const baseInput = z.object({
  city: z.string().min(1).max(120),
  countryCode: z.string().length(2).optional(),
  languageCode: z.string().max(10).default('en'),
  limit: z.number().int().min(1).max(15).default(8),
});
type BaseInput = z.infer<typeof baseInput>;

type FinderResult =
  | { status: 'ok'; city: string; shops: GroundedShopHit[]; message: string }
  | { status: 'production_refused'; message: string }
  | { status: 'unavailable'; reason: string; message: string };

async function runCfgFinder(
  cfg: GroundedFinderConfig,
  input: BaseInput,
  ctx?: ToolContext
): Promise<FinderResult> {
  const gate = assertDevOnlyToolAllowed(ctx);
  if (gate.allowed === false) return { status: 'production_refused', message: gate.reason };
  const r = await runGroundedFinder(
    cfg,
    {
      city: input.city,
      ...(input.countryCode ? { countryCode: input.countryCode } : {}),
      languageCode: input.languageCode,
      limit: input.limit,
    },
    liveFinderDeps
  );
  if (r.status === 'unavailable') return r;
  return { status: 'ok', city: r.city, shops: r.shops, message: r.message };
}

// ── 1. cultural_attractions_finder ───────────────────────────────────

const CULTURE_WEIGHTS: Record<string, number> = {
  'lonelyplanet.com': 0.85,
  'atlasobscura.com': 0.85,
  'cntraveler.com': 0.7,
  'monocle.com': 0.75,
  'theguardian.com': 0.65,
  'natgeo.com': 0.85,
  'nationalgeographic.com': 0.85,
  'timeout.com': 0.55,
  'tripadvisor.com': 0.4,
};
const CULTURE_TYPES = new Set([
  'museum',
  'art_gallery',
  'tourist_attraction',
  'monument',
  'historical_landmark',
  'church',
  'mosque',
  'synagogue',
  'temple_hindu',
  'place_of_worship',
  'archaeological_site',
  'park',
]);
const culturalAttractionsFinderTool: ToolDef<BaseInput, FinderResult> = {
  name: 'cultural_attractions_finder',
  internal: true,
  description:
    'Find museums, galleries, monuments, cultural landmarks. Editorial via Atlas Obscura / Lonely Planet / Monocle / NatGeo + Places (museum / monument / historical_landmark / archaeological_site). Use for "what to see in <city>", "monumentos <ciudad>", "must-see culture".',
  inputSchema: baseInput,
  jsonSchema: {
    type: 'object',
    required: ['city'],
    properties: {
      city: { type: 'string', minLength: 1, maxLength: 120 },
      countryCode: { type: 'string', minLength: 2, maxLength: 2 },
      languageCode: { type: 'string', maxLength: 10 },
      limit: { type: 'integer', minimum: 1, maximum: 15 },
    },
  },
  handler: (input, ctx) =>
    runCfgFinder(
      {
        composeCseQuery: city =>
          input.languageCode === 'es'
            ? `mejores atracciones culturales ${city}`
            : `best cultural attractions monuments ${city}`,
        composePlacesQuery: city => `museums monuments in ${city}`,
        sourceWeights: CULTURE_WEIGHTS,
        defaultSourceWeight: 0.25,
        isRelevantPlaceType: place => {
          const all = [...(place.types ?? []), place.primaryType].filter(Boolean) as string[];
          return all.some(t => CULTURE_TYPES.has(t));
        },
        cseSnippetMustMatch: /\b(museum|monument|cathedral|landmark|sitio arqueológico)\b/i,
      },
      input,
      ctx
    ),
};

// ── 2. museum_ticketing_researcher (Vertex grounded) ─────────────────

const VERTEX_MODEL_ID = 'gemini-3-flash-preview';
const GATEWAY_MODEL_ID = 'google/gemini-3-flash';

function resolveVertex() {
  const project = process.env.GOOGLE_CLOUD_PROJECT ?? process.env.GOOGLE_VERTEX_PROJECT ?? null;
  const location = process.env.GOOGLE_CLOUD_LOCATION ?? 'global';
  const saJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
  if (!project || !saJson) return null;
  try {
    return createVertex({
      project,
      location,
      googleAuthOptions: { credentials: JSON.parse(saJson) },
    });
  } catch {
    return null;
  }
}

const museumTicketingInput = z.object({
  museumName: z.string().min(1).max(200),
  city: z.string().min(1).max(120),
  locale: z.string().min(2).max(10).default('en-US'),
});
type MuseumTicketingInput = z.infer<typeof museumTicketingInput>;

const museumTicketingShape = z.object({
  hours: z.string().describe('Verbatim hours by day, in the locale.'),
  closedDays: z.array(z.string()).max(7),
  ticketPrices: z
    .array(
      z.object({
        category: z.string(),
        price: z.string(),
        notes: z.string().nullable(),
      })
    )
    .max(8),
  freeEntryDays: z.array(z.string()).max(8).nullable(),
  bookingUrl: z.string().nullable(),
  currentExhibitions: z.array(z.string().max(180)).max(6),
  reservationRequired: z.boolean().nullable(),
  notes: z.string().nullable(),
});

async function runMuseumTicketingResearcher(
  rawInput: MuseumTicketingInput,
  ctx?: ToolContext
): Promise<{
  status: 'ok' | 'unavailable' | 'production_refused';
  message: string;
  ticketing?: z.infer<typeof museumTicketingShape>;
  via?: 'vertex' | 'gateway';
}> {
  const gate = assertDevOnlyToolAllowed(ctx);
  if (gate.allowed === false) return { status: 'production_refused', message: gate.reason };

  const input = museumTicketingInput.parse(rawInput);
  const groundingPrompt = `Look up current ticketing details for "${input.museumName}" in ${input.city}: opening hours, closed days, ticket prices (general / student / senior / family), free-entry days, official booking URL, and the most relevant current exhibitions. Cite the official museum site verbatim.`;
  const coercePrompt = (
    text: string,
    sources: string[]
  ) => `Coerce this grounded report into the schema. Locale for narrative fields: ${input.locale}.

Grounded report:
"""
${text}
"""

Sources cited (use for bookingUrl when matching official site):
${sources
  .slice(0, 6)
  .map((u, i) => `${i + 1}. ${u}`)
  .join('\n')}

Rules: never invent prices. Use null when a field isn't reliably reported.`;

  const vertex = resolveVertex();

  async function via(modelLike: any, providerOptions?: any) {
    const grounded = await generateText({
      model: modelLike,
      tools: {
        google_search: (vertex
          ? vertex.tools.googleSearch({})
          : google.tools.googleSearch({})) as any,
      },
      prompt: groundingPrompt,
      ...(providerOptions ? { providerOptions } : {}),
    });
    const text = grounded.text?.trim() ?? '';
    const meta = grounded.providerMetadata as
      | { google?: { groundingMetadata?: { groundingChunks?: Array<{ web?: { uri?: string } }> } } }
      | undefined;
    const sources = (meta?.google?.groundingMetadata?.groundingChunks ?? [])
      .map(c => c.web?.uri)
      .filter((u): u is string => !!u);
    if (!text) return null;
    const coerced = await generateObject({
      model: modelLike,
      schema: museumTicketingShape,
      prompt: coercePrompt(text, sources),
      ...(providerOptions ? { providerOptions } : {}),
    });
    return coerced.object;
  }

  if (vertex) {
    try {
      const obj = await via(vertex(VERTEX_MODEL_ID));
      if (obj)
        return {
          status: 'ok',
          ticketing: obj,
          via: 'vertex',
          message: `Ticketing for ${input.museumName} via Vertex.`,
        };
    } catch (err) {
      console.warn(
        '[museum_ticketing_researcher] Vertex direct failed, falling back:',
        (err as Error).message ?? err
      );
    }
  }
  try {
    const obj = await via(GATEWAY_MODEL_ID, { gateway: { order: ['google'] } });
    if (obj)
      return {
        status: 'ok',
        ticketing: obj,
        via: 'gateway',
        message: `Ticketing for ${input.museumName} via Gateway.`,
      };
    return { status: 'unavailable', message: 'No grounded data returned.' };
  } catch (err) {
    return {
      status: 'unavailable',
      message: `Vertex + gateway both failed: ${(err as Error).message ?? 'unknown'}.`,
    };
  }
}

const museumTicketingResearcherTool: ToolDef = {
  name: 'museum_ticketing_researcher',
  internal: true,
  experimental: true,
  description:
    'Look up current museum ticketing — hours, closed days, prices, free-entry days, booking URL, current exhibitions. Vertex direct → AI Gateway fallback (two grounded LLM passes per call). Use when traveler is about to visit a specific museum and needs the current price + reservation status.',
  inputSchema: museumTicketingInput,
  jsonSchema: {
    type: 'object',
    required: ['museumName', 'city'],
    properties: {
      museumName: { type: 'string', minLength: 1, maxLength: 200 },
      city: { type: 'string', minLength: 1, maxLength: 120 },
      locale: { type: 'string', minLength: 2, maxLength: 10 },
    },
  },
  handler: runMuseumTicketingResearcher,
};

// ── 3. nightlife_fit_finder ──────────────────────────────────────────

const NIGHT_WEIGHTS: Record<string, number> = {
  'residentadvisor.net': 0.95,
  'monocle.com': 0.8,
  'punchdrink.com': 0.85,
  'eater.com': 0.65,
  'timeout.com': 0.6,
  'cntraveler.com': 0.55,
  'theguardian.com': 0.55,
  'theworlds50best.com': 0.85,
};
const NIGHT_TYPES = new Set([
  'bar',
  'night_club',
  'cocktail_bar',
  'wine_bar',
  'pub',
  'jazz_club',
  'lounge',
  'speakeasy',
]);

const nightlifeFitInput = baseInput.extend({
  fit: z
    .enum(['cocktail_bar', 'rooftop', 'speakeasy', 'jazz_club', 'club', 'wine_bar', 'lounge'])
    .default('cocktail_bar'),
});
type NightlifeFitInput = z.infer<typeof nightlifeFitInput>;

const nightlifeFitFinderTool: ToolDef<NightlifeFitInput, FinderResult> = {
  name: 'nightlife_fit_finder',
  internal: true,
  description:
    "Find bars / jazz clubs / rooftops / speakeasies / lounges / clubs by `fit`. Editorial via Resident Advisor / Punch / Monocle / 50 Best Bars + Places. Use when traveler asks 'cocktail bar <city>', 'rooftop bar', 'jazz club <city>', 'club techno <city>'.",
  inputSchema: nightlifeFitInput,
  jsonSchema: {
    type: 'object',
    required: ['city'],
    properties: {
      city: { type: 'string', minLength: 1, maxLength: 120 },
      countryCode: { type: 'string', minLength: 2, maxLength: 2 },
      languageCode: { type: 'string', maxLength: 10 },
      limit: { type: 'integer', minimum: 1, maximum: 15 },
      fit: {
        type: 'string',
        enum: ['cocktail_bar', 'rooftop', 'speakeasy', 'jazz_club', 'club', 'wine_bar', 'lounge'],
      },
    },
  },
  handler: (input, ctx) =>
    runCfgFinder(
      {
        composeCseQuery: city =>
          input.languageCode === 'es'
            ? `mejores ${input.fit.replace(/_/g, ' ')} ${city}`
            : `best ${input.fit.replace(/_/g, ' ')} ${city}`,
        composePlacesQuery: city => `${input.fit.replace(/_/g, ' ')} in ${city}`,
        sourceWeights: NIGHT_WEIGHTS,
        defaultSourceWeight: 0.25,
        isRelevantPlaceType: place => {
          const all = [...(place.types ?? []), place.primaryType].filter(Boolean) as string[];
          return all.some(t => NIGHT_TYPES.has(t));
        },
        cseSnippetMustMatch: new RegExp(input.fit.replace(/_/g, ' '), 'i'),
      },
      input,
      ctx
    ),
};

// ── 4. family_friendly_event_finder ──────────────────────────────────

const familyEventInput = baseInput.extend({
  ageRange: z.enum(['under_5', '5_10', '10_15', 'all_ages']).default('all_ages'),
});
type FamilyEventInput = z.infer<typeof familyEventInput>;

interface EventResultLite {
  id: string;
  name: string;
  url: string;
  startsAtIso?: string;
  source: string;
  summary?: string;
}
type EventListResult =
  | { status: 'ok'; city: string; events: EventResultLite[]; message: string }
  | { status: 'unavailable'; reason: string; message: string }
  | { status: 'production_refused'; message: string };

async function runFamilyFriendlyEventFinder(
  rawInput: FamilyEventInput,
  ctx?: ToolContext
): Promise<EventListResult> {
  const gate = assertDevOnlyToolAllowed(ctx);
  if (gate.allowed === false) return { status: 'production_refused', message: gate.reason };

  const input = familyEventInput.parse(rawInput);

  // Source 1: Ticketmaster Family / Misc segments.
  const tmP = runMainstreamEventDiscovery(
    {
      city: input.city,
      ...(input.countryCode ? { countryCode: input.countryCode } : {}),
      keyword: 'family',
      segment: 'Miscellaneous',
      limit: input.limit,
    } as never,
    ctx
  );
  // Source 2: Eventbrite "kids" / "family" CSE.
  const ebP = runEventbriteEventDiscovery(
    {
      city: input.city,
      ...(input.countryCode ? { countryCode: input.countryCode } : {}),
      keywords: input.ageRange === 'under_5' ? 'kids family children' : 'family kids',
      limit: input.limit,
      languageCode: input.languageCode,
    } as never,
    ctx
  );

  const [tm, eb] = await Promise.all([tmP, ebP]);
  const events: EventResultLite[] = [];
  if (tm.status === 'ok') {
    for (const e of tm.events) {
      events.push({
        id: e.id,
        name: e.name,
        url: e.url,
        ...(e.startsAtIso ? { startsAtIso: e.startsAtIso } : {}),
        source: 'ticketmaster',
        ...(e.venueName ? { summary: e.venueName } : {}),
      });
    }
  }
  if (eb.status === 'ok') {
    for (const e of eb.events) {
      events.push({
        id: e.id,
        name: e.name,
        url: e.url,
        ...(e.startsAtIso ? { startsAtIso: e.startsAtIso } : {}),
        source: e.source === 'eventbrite_api' ? 'eventbrite' : 'eventbrite_cse',
        ...(e.summary ? { summary: e.summary } : {}),
      });
    }
  }
  if (events.length === 0) {
    return {
      status: 'unavailable',
      reason: 'no-events',
      message: `No family-friendly events surfaced for ${input.city}.`,
    };
  }
  return {
    status: 'ok',
    city: input.city,
    events: events.slice(0, input.limit),
    message: `${events.length} family-friendly events in ${input.city} (age=${input.ageRange}).`,
  };
}

const familyFriendlyEventFinderTool: ToolDef<FamilyEventInput, EventListResult> = {
  name: 'family_friendly_event_finder',
  internal: true,
  experimental: true,
  description:
    "Find family-friendly events. Composes `mainstream_event_discovery({segment:'Miscellaneous',keyword:'family'})` + `eventbrite_event_discovery({keywords:'family kids'})`. Filter by age range. Use when traveler is travelling with kids and asks 'family events <city>', 'kids activities <city> this weekend'.",
  inputSchema: familyEventInput,
  jsonSchema: {
    type: 'object',
    required: ['city'],
    properties: {
      city: { type: 'string', minLength: 1, maxLength: 120 },
      countryCode: { type: 'string', minLength: 2, maxLength: 2 },
      languageCode: { type: 'string', maxLength: 10 },
      limit: { type: 'integer', minimum: 1, maximum: 15 },
      ageRange: { type: 'string', enum: ['under_5', '5_10', '10_15', 'all_ages'] },
    },
  },
  handler: runFamilyFriendlyEventFinder,
};

// ── 5. exhibition_calendar_researcher (Vertex grounded) ──────────────

const exhibitionInput = z.object({
  city: z.string().min(1).max(120),
  countryCode: z.string().length(2).optional(),
  /** Window — defaults to next 60d. */
  startsAfterIso: z.string().optional(),
  startsBeforeIso: z.string().optional(),
  locale: z.string().min(2).max(10).default('en-US'),
});
type ExhibitionInput = z.infer<typeof exhibitionInput>;

const exhibitionShape = z.object({
  exhibitions: z
    .array(
      z.object({
        title: z.string(),
        venue: z.string(),
        opensIso: z.string().nullable(),
        closesIso: z.string().nullable(),
        ticketUrl: z.string().nullable(),
        summary: z.string().max(280),
      })
    )
    .max(12),
  notes: z.string().nullable(),
});

async function runExhibitionCalendarResearcher(
  rawInput: ExhibitionInput,
  ctx?: ToolContext
): Promise<{
  status: 'ok' | 'unavailable' | 'production_refused';
  message: string;
  exhibitions?: z.infer<typeof exhibitionShape>;
  via?: 'vertex' | 'gateway';
}> {
  const gate = assertDevOnlyToolAllowed(ctx);
  if (gate.allowed === false) return { status: 'production_refused', message: gate.reason };

  const input = exhibitionInput.parse(rawInput);
  const groundingPrompt = `List the most notable temporary exhibitions in ${input.city}${input.countryCode ? ` (${input.countryCode})` : ''} happening between ${input.startsAfterIso ?? 'today'} and ${input.startsBeforeIso ?? 'in 60 days'}. For each exhibition give: title, venue (museum/gallery name), open + close dates, official ticket URL, and a 1-2 sentence summary. Pull from Artforum / Frieze / official venue sites; never invent dates.`;
  const coercePrompt = (
    text: string,
    sources: string[]
  ) => `Coerce this grounded report into the schema. Locale for summary fields: ${input.locale}.

Report:
"""
${text}
"""

Sources cited:
${sources
  .slice(0, 8)
  .map((u, i) => `${i + 1}. ${u}`)
  .join('\n')}`;

  const vertex = resolveVertex();
  async function viaPath(modelLike: any, providerOptions?: any) {
    const grounded = await generateText({
      model: modelLike,
      tools: {
        google_search: (vertex
          ? vertex.tools.googleSearch({})
          : google.tools.googleSearch({})) as any,
      },
      prompt: groundingPrompt,
      ...(providerOptions ? { providerOptions } : {}),
    });
    const text = grounded.text?.trim() ?? '';
    const meta = grounded.providerMetadata as
      | { google?: { groundingMetadata?: { groundingChunks?: Array<{ web?: { uri?: string } }> } } }
      | undefined;
    const sources = (meta?.google?.groundingMetadata?.groundingChunks ?? [])
      .map(c => c.web?.uri)
      .filter((u): u is string => !!u);
    if (!text) return null;
    const coerced = await generateObject({
      model: modelLike,
      schema: exhibitionShape,
      prompt: coercePrompt(text, sources),
      ...(providerOptions ? { providerOptions } : {}),
    });
    return coerced.object;
  }

  if (vertex) {
    try {
      const obj = await viaPath(vertex(VERTEX_MODEL_ID));
      if (obj)
        return {
          status: 'ok',
          exhibitions: obj,
          via: 'vertex',
          message: `${obj.exhibitions.length} exhibitions in ${input.city} via Vertex.`,
        };
    } catch {
      // fall through
    }
  }
  try {
    const obj = await viaPath(GATEWAY_MODEL_ID, { gateway: { order: ['google'] } });
    if (obj)
      return {
        status: 'ok',
        exhibitions: obj,
        via: 'gateway',
        message: `${obj.exhibitions.length} exhibitions via gateway.`,
      };
    return { status: 'unavailable', message: 'No grounded exhibition data returned.' };
  } catch (err) {
    return {
      status: 'unavailable',
      message: `Vertex + gateway both failed: ${(err as Error).message ?? 'unknown'}.`,
    };
  }
}

const exhibitionCalendarResearcherTool: ToolDef = {
  name: 'exhibition_calendar_researcher',
  internal: true,
  experimental: true,
  description:
    'Find notable temporary exhibitions in a city + window. Vertex direct → Gateway fallback grounded research. Returns title + venue + open/close dates + ticket URL + summary per exhibition. Pair with `museum_ticketing_researcher` to add price + hours.',
  inputSchema: exhibitionInput,
  jsonSchema: {
    type: 'object',
    required: ['city'],
    properties: {
      city: { type: 'string', minLength: 1, maxLength: 120 },
      countryCode: { type: 'string', minLength: 2, maxLength: 2 },
      startsAfterIso: { type: 'string' },
      startsBeforeIso: { type: 'string' },
      locale: { type: 'string', minLength: 2, maxLength: 10 },
    },
  },
  handler: runExhibitionCalendarResearcher,
};

// ── 6. free_events_finder ────────────────────────────────────────────

async function runFreeEventsFinder(
  rawInput: BaseInput,
  ctx?: ToolContext
): Promise<EventListResult> {
  const gate = assertDevOnlyToolAllowed(ctx);
  if (gate.allowed === false) return { status: 'production_refused', message: gate.reason };

  const input = baseInput.parse(rawInput);
  const eb = await runEventbriteEventDiscovery(
    {
      city: input.city,
      ...(input.countryCode ? { countryCode: input.countryCode } : {}),
      keywords: 'free',
      languageCode: input.languageCode,
      limit: input.limit,
    } as never,
    ctx
  );
  if (eb.status !== 'ok') {
    return {
      status: 'unavailable',
      reason:
        eb.status === 'production_refused'
          ? 'refused'
          : eb.status === 'unavailable'
            ? eb.reason
            : 'fail',
      message: eb.message,
    };
  }
  // Heuristic: filter to events the API marked free, OR whose title/snippet contains "free".
  const filtered = eb.events.filter(
    e => e.isFree === true || /\bfree\b|gratis|gratuito/i.test(`${e.name} ${e.summary ?? ''}`)
  );
  if (filtered.length === 0) {
    return {
      status: 'unavailable',
      reason: 'no-free-events',
      message: `No free events surfaced for ${input.city}.`,
    };
  }
  return {
    status: 'ok',
    city: input.city,
    events: filtered.slice(0, input.limit).map(e => ({
      id: e.id,
      name: e.name,
      url: e.url,
      ...(e.startsAtIso ? { startsAtIso: e.startsAtIso } : {}),
      source: 'eventbrite',
      ...(e.summary ? { summary: e.summary } : {}),
    })),
    message: `${filtered.length} free events in ${input.city}.`,
  };
}

const freeEventsFinderTool: ToolDef<BaseInput, EventListResult> = {
  name: 'free_events_finder',
  internal: true,
  experimental: true,
  description:
    'Find free events in a city — community talks, gallery openings, workshops, public lectures. Composes `eventbrite_event_discovery({keywords:"free"})` + heuristic filtering on isFree flag + free / gratis text mentions. Use when traveler asks "free things to do <city>", "eventos gratis <ciudad>".',
  inputSchema: baseInput,
  jsonSchema: {
    type: 'object',
    required: ['city'],
    properties: {
      city: { type: 'string', minLength: 1, maxLength: 120 },
      countryCode: { type: 'string', minLength: 2, maxLength: 2 },
      languageCode: { type: 'string', maxLength: 10 },
      limit: { type: 'integer', minimum: 1, maximum: 15 },
    },
  },
  handler: runFreeEventsFinder,
};

// ── 7. last_minute_tickets_finder ────────────────────────────────────

const lastMinuteInput = baseInput.extend({
  windowHours: z.number().int().min(2).max(48).default(24),
  segment: z.enum(['Music', 'Sports', 'Arts & Theatre', 'Miscellaneous']).optional(),
});
type LastMinuteInput = z.infer<typeof lastMinuteInput>;

async function runLastMinuteTicketsFinder(
  rawInput: LastMinuteInput,
  ctx?: ToolContext
): Promise<EventListResult> {
  const gate = assertDevOnlyToolAllowed(ctx);
  if (gate.allowed === false) return { status: 'production_refused', message: gate.reason };

  const input = lastMinuteInput.parse(rawInput);
  const start = new Date();
  const end = new Date(start.getTime() + input.windowHours * 3600_000);
  const fmt = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');

  const r = await runMainstreamEventDiscovery(
    {
      city: input.city,
      ...(input.countryCode ? { countryCode: input.countryCode } : {}),
      ...(input.segment ? { segment: input.segment } : {}),
      startsAfterIso: fmt(start),
      startsBeforeIso: fmt(end),
      limit: input.limit,
    } as never,
    ctx
  );
  if (r.status !== 'ok') {
    return {
      status: 'unavailable',
      reason:
        r.status === 'production_refused'
          ? 'refused'
          : r.status === 'unavailable'
            ? r.reason
            : 'fail',
      message: r.message,
    };
  }
  if (r.events.length === 0) {
    return {
      status: 'unavailable',
      reason: 'no-tickets',
      message: `No on-sale tickets in ${input.city} within the next ${input.windowHours}h.`,
    };
  }
  return {
    status: 'ok',
    city: input.city,
    events: r.events.map(e => ({
      id: e.id,
      name: e.name,
      url: e.url,
      ...(e.startsAtIso ? { startsAtIso: e.startsAtIso } : {}),
      source: 'ticketmaster',
      ...(e.venueName ? { summary: e.venueName } : {}),
    })),
    message: `${r.events.length} last-minute (${input.windowHours}h) events in ${input.city}.`,
  };
}

const lastMinuteTicketsFinderTool: ToolDef<LastMinuteInput, EventListResult> = {
  name: 'last_minute_tickets_finder',
  internal: true,
  description:
    'Find events with available tickets in the next N hours (default 24). Composes `mainstream_event_discovery` with a tight time window + on-sale filter. Use when traveler asks "tonight\'s events <city>", "last-minute tickets", "tickets tonight <city>".',
  inputSchema: lastMinuteInput,
  jsonSchema: {
    type: 'object',
    required: ['city'],
    properties: {
      city: { type: 'string', minLength: 1, maxLength: 120 },
      countryCode: { type: 'string', minLength: 2, maxLength: 2 },
      languageCode: { type: 'string', maxLength: 10 },
      limit: { type: 'integer', minimum: 1, maximum: 15 },
      windowHours: { type: 'integer', minimum: 2, maximum: 48 },
      segment: { type: 'string', enum: ['Music', 'Sports', 'Arts & Theatre', 'Miscellaneous'] },
    },
  },
  handler: runLastMinuteTicketsFinder,
};

// ── 8. venue_nearby_plan_builder ─────────────────────────────────────

const venueNearbyInput = z.object({
  city: z.string().min(1).max(120),
  /** Anchor venue — the event the traveler bought a ticket for. */
  venueName: z.string().min(1).max(200),
  countryCode: z.string().length(2).optional(),
  languageCode: z.string().max(10).default('en'),
  /** Time of the event — drives dinner-before / bar-after suggestions. */
  eventStartsAtIso: z.string().optional(),
  /** Optional tier — drives restaurant picker. */
  budgetTier: z.enum(['budget', 'medium', 'premium', 'splurge']).default('medium'),
});
type VenueNearbyInput = z.infer<typeof venueNearbyInput>;

interface VenueNearbyPlan {
  dinnerBefore?: { name: string; rationale: string; url?: string };
  drinksAfter?: { name: string; rationale: string; url?: string };
  routeNotes: string[];
}

async function runVenueNearbyPlanBuilder(
  rawInput: VenueNearbyInput,
  ctx?: ToolContext
): Promise<{
  status: 'ok' | 'unavailable' | 'production_refused';
  message: string;
  plan?: VenueNearbyPlan;
}> {
  const gate = assertDevOnlyToolAllowed(ctx);
  if (gate.allowed === false) return { status: 'production_refused', message: gate.reason };

  const input = venueNearbyInput.parse(rawInput);

  // Quick Places searches near the venue name.
  const dinnerP = searchText({
    query: `restaurant near ${input.venueName} ${input.city}`,
    limit: 5,
    languageCode: input.languageCode,
    ...(input.countryCode ? { regionCode: input.countryCode } : {}),
  });
  const drinksP = searchText({
    query: `cocktail bar near ${input.venueName} ${input.city}`,
    limit: 5,
    languageCode: input.languageCode,
    ...(input.countryCode ? { regionCode: input.countryCode } : {}),
  });
  const [dinnerR, drinksR] = await Promise.all([dinnerP, drinksP]);

  if (!dinnerR.available && !drinksR.available) {
    return {
      status: 'unavailable',
      message: `Couldn't query Places near ${input.venueName}. ${dinnerR.reason ?? ''} ${drinksR.reason ?? ''}`,
    };
  }

  const dinner = dinnerR.available
    ? (dinnerR.results.find(p => p.rating && p.rating >= 4.0) ?? dinnerR.results[0])
    : undefined;
  const drinks = drinksR.available
    ? (drinksR.results.find(p => p.rating && p.rating >= 4.2) ?? drinksR.results[0])
    : undefined;

  const plan: VenueNearbyPlan = {
    routeNotes: [
      `Anchor: ${input.venueName} (${input.city}).`,
      'Aim to leave dinner 45min before showtime so you arrive early without rushing.',
    ],
    ...(dinner
      ? {
          dinnerBefore: {
            name: dinner.name,
            rationale: `${dinner.rating?.toFixed(1) ?? '?'}★ over ${dinner.userRatingCount ?? 0} reviews · near ${input.venueName}.`,
            ...(dinner.website ? { url: dinner.website } : {}),
          },
        }
      : {}),
    ...(drinks
      ? {
          drinksAfter: {
            name: drinks.name,
            rationale: `${drinks.rating?.toFixed(1) ?? '?'}★ — near venue for a quick post-show drink.`,
            ...(drinks.website ? { url: drinks.website } : {}),
          },
        }
      : {}),
  };

  return {
    status: 'ok',
    plan,
    message: `Nearby plan for ${input.venueName} in ${input.city}.`,
  };
}

const venueNearbyPlanBuilderTool: ToolDef = {
  name: 'venue_nearby_plan_builder',
  internal: true,
  description:
    'Given a venue + event time, propose dinner-before + drinks-after + route notes. Composes Places nearby searches around the venue. Use when traveler bought a ticket and asks "where should we eat before <show>" / "drinks after <concert>".',
  inputSchema: venueNearbyInput,
  jsonSchema: {
    type: 'object',
    required: ['city', 'venueName'],
    properties: {
      city: { type: 'string', minLength: 1, maxLength: 120 },
      venueName: { type: 'string', minLength: 1, maxLength: 200 },
      countryCode: { type: 'string', minLength: 2, maxLength: 2 },
      languageCode: { type: 'string', maxLength: 10 },
      eventStartsAtIso: { type: 'string' },
      budgetTier: { type: 'string', enum: ['budget', 'medium', 'premium', 'splurge'] },
    },
  },
  handler: runVenueNearbyPlanBuilder,
};

// ── 9. rainy_day_plan_finder ─────────────────────────────────────────

const rainyDayInput = z.object({
  city: z.string().min(1).max(120),
  countryCode: z.string().length(2).optional(),
  languageCode: z.string().max(10).default('en'),
  hoursToFill: z.number().int().min(1).max(12).default(4),
});
type RainyDayInput = z.infer<typeof rainyDayInput>;

interface RainyDayPlan {
  picks: Array<{ category: string; name: string; rationale: string; url?: string }>;
  pacingNotes: string[];
}

async function runRainyDayPlanFinder(
  rawInput: RainyDayInput,
  ctx?: ToolContext
): Promise<{
  status: 'ok' | 'unavailable' | 'production_refused';
  message: string;
  plan?: RainyDayPlan;
}> {
  const gate = assertDevOnlyToolAllowed(ctx);
  if (gate.allowed === false) return { status: 'production_refused', message: gate.reason };

  const input = rainyDayInput.parse(rawInput);

  // Indoor anchors: museums, malls, libraries, cafes, bookstores, theaters.
  const queries = ['museum', 'bookstore', 'specialty coffee', 'theater cinema', 'shopping mall'];
  const allRes = await Promise.all(
    queries.map(q =>
      searchText({
        query: `${q} in ${input.city}`,
        limit: 3,
        languageCode: input.languageCode,
        ...(input.countryCode ? { regionCode: input.countryCode } : {}),
      })
    )
  );

  const picks: RainyDayPlan['picks'] = [];
  for (let i = 0; i < queries.length; i++) {
    const res = allRes[i]!;
    if (!res.available) continue;
    const top = res.results
      .filter(p => p.rating && p.userRatingCount && p.rating >= 4.0 && p.userRatingCount >= 100)
      .sort((a, b) => (b.userRatingCount ?? 0) - (a.userRatingCount ?? 0))[0];
    if (!top) continue;
    picks.push({
      category: queries[i]!,
      name: top.name,
      rationale: `${top.rating?.toFixed(1) ?? '?'}★ over ${top.userRatingCount ?? 0} reviews — indoor option in ${input.city}.`,
      ...(top.website ? { url: top.website } : {}),
    });
  }

  if (picks.length === 0) {
    return {
      status: 'unavailable',
      message: `Couldn't find indoor anchors in ${input.city}. Try a different city or check Places API config.`,
    };
  }

  const pacingNotes: string[] = [];
  if (input.hoursToFill <= 3)
    pacingNotes.push("Pick 1 anchor + 1 transition stop. Don't over-program.");
  else if (input.hoursToFill <= 6)
    pacingNotes.push('Anchor + late lunch/coffee + bookstore browse — natural rainy-day pacing.');
  else
    pacingNotes.push(
      'Spread across 2-3 anchors with long transitions; rainy days reward slowing down.'
    );

  return {
    status: 'ok',
    plan: { picks: picks.slice(0, 5), pacingNotes },
    message: `${picks.length} indoor picks for a rainy ${input.hoursToFill}h in ${input.city}.`,
  };
}

const rainyDayPlanFinderTool: ToolDef = {
  name: 'rainy_day_plan_finder',
  internal: true,
  description:
    'Find indoor plans when weather is bad. Composes Places searches across museum / bookstore / specialty coffee / theater / mall categories, ranks by review weight, returns 3-5 anchors + pacing notes for the requested hour budget. Use when `trip_weather_brief` reports rain / heavy snow / extreme heat.',
  inputSchema: rainyDayInput,
  jsonSchema: {
    type: 'object',
    required: ['city'],
    properties: {
      city: { type: 'string', minLength: 1, maxLength: 120 },
      countryCode: { type: 'string', minLength: 2, maxLength: 2 },
      languageCode: { type: 'string', maxLength: 10 },
      hoursToFill: { type: 'integer', minimum: 1, maximum: 12 },
    },
  },
  handler: runRainyDayPlanFinder,
};

// ─────────────────────────────────────────────────────────────────────

export {
  culturalAttractionsFinderTool,
  museumTicketingResearcherTool,
  nightlifeFitFinderTool,
  familyFriendlyEventFinderTool,
  exhibitionCalendarResearcherTool,
  freeEventsFinderTool,
  lastMinuteTicketsFinderTool,
  venueNearbyPlanBuilderTool,
  rainyDayPlanFinderTool,
  runRainyDayPlanFinder,
};
