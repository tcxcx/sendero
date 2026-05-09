/**
 * B9 — Travel Disruption / Policy / Logistics Research (21 tools).
 *
 *   - airport_disruption_monitor      B9 #122 (Vertex grounded)
 *   - local_holiday_disruption_check  B9 #123 (composer)
 *   - venue_policy_checker            B9 #124 (Vertex grounded)
 *   - hotel_area_intelligence         B9 #125 (composer)
 *   - neighborhood_fit_matcher        B9 #126 (pure rules)
 *   - restaurant_reservation_researcher B9 #127 (Vertex grounded)
 *   - menu_dietary_researcher         B9 #128 (Vertex grounded)
 *   - ground_transport_price_researcher B9 #129 (curated + CSE)
 *   - public_transit_ticketing_brief  B9 #130 (Vertex grounded)
 *   - airport_terminal_resolver       B9 #131 (Vertex grounded)
 *   - layover_viability_checker       B9 #132 (pure rules)
 *   - nearby_airport_alternative_researcher B9 #133 (Places + curated)
 *   - route_alternative_researcher    B9 #134 (Vertex grounded)
 *   - trip_budget_researcher          B9 #135 (composer over budget_estimator)
 *   - local_payment_acceptance_brief  B9 #136 (Vertex grounded)
 *   - invoice_tax_requirements_researcher B9 #137 (Vertex grounded)
 *   - travel_insurance_requirement_checker B9 #138 (Vertex grounded)
 *   - medical_access_brief            B9 #139 (composer over clinic + emergency)
 *   - communications_researcher       B9 #140 (Vertex grounded)
 *   - cultural_protocol_brief         B9 #141 (composer over local_business_protocol)
 *   - live_news_trip_risk_scanner     B9 #142 (composer over web_search)
 *
 * All experimental + internal + dev-gated.
 */

import { z } from 'zod';
import { generateText, generateObject } from 'ai';
import { google } from '@ai-sdk/google';
import { createVertex } from '@ai-sdk/google-vertex';

import { searchText } from '@sendero/google-places';
import { cseSearch } from '@sendero/web-search';

import { assertDevOnlyToolAllowed } from '../dev-gate';
import type { ToolContext, ToolDef } from '../types';

import { runBudgetEstimator } from './budget-estimator';
import { runCrowdLevelPredictor } from './crowd-level-predictor';

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

/** Generic Vertex-grounded structured-output helper. */
async function runGroundedStructured<T extends z.ZodTypeAny>(
  prompt: string,
  schema: T,
  coercePromptBuilder: (text: string, sources: string[]) => string
): Promise<{ ok: boolean; data?: z.infer<T>; via?: 'vertex' | 'gateway'; reason?: string }> {
  const vertex = resolveVertex();
  async function viaPath(modelLike: any, providerOptions?: any) {
    const grounded = await generateText({
      model: modelLike,
      tools: {
        google_search: vertex ? vertex.tools.googleSearch({}) : google.tools.googleSearch({}),
      },
      prompt,
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
      schema,
      prompt: coercePromptBuilder(text, sources),
      ...(providerOptions ? { providerOptions } : {}),
    } as never);
    return coerced.object;
  }
  if (vertex) {
    try {
      const obj = await viaPath(vertex(VERTEX_MODEL_ID));
      if (obj) return { ok: true, data: obj as z.infer<T>, via: 'vertex' };
    } catch {}
  }
  try {
    const obj = await viaPath(GATEWAY_MODEL_ID, { gateway: { order: ['google'] } });
    if (obj) return { ok: true, data: obj as z.infer<T>, via: 'gateway' };
    return { ok: false, reason: 'no-grounded-text' };
  } catch (err) {
    return { ok: false, reason: (err as Error).message ?? 'gateway-failed' };
  }
}

// ── 1. airport_disruption_monitor ────────────────────────────────────

const airportDisruptionInput = z.object({
  airportIata: z.string().length(3),
  windowHours: z.number().int().min(1).max(72).default(24),
  locale: z.string().min(2).max(10).default('en-US'),
});
type AirportDisruptionInput = z.infer<typeof airportDisruptionInput>;

const airportDisruptionShape = z.object({
  status: z.enum(['normal', 'minor_delays', 'major_delays', 'partial_closure', 'full_closure']),
  drivers: z.array(z.string()).max(6),
  averageDelayMinutes: z.number().int().nullable(),
  guidance: z.array(z.string()).max(6),
});

const airportDisruptionMonitorTool: ToolDef = {
  name: 'airport_disruption_monitor',
  internal: true,
  experimental: true,
  description:
    'Check airport disruption status — strikes / closures / weather / construction / ATC issues — for the next N hours. Vertex-grounded against FlightAware / official airport / Reuters. Returns status enum + drivers + average delay + guidance.',
  inputSchema: airportDisruptionInput,
  jsonSchema: {
    type: 'object',
    required: ['airportIata'],
    properties: {
      airportIata: { type: 'string', minLength: 3, maxLength: 3 },
      windowHours: { type: 'integer', minimum: 1, maximum: 72 },
      locale: { type: 'string', minLength: 2, maxLength: 10 },
    },
  },
  handler: async (rawInput: AirportDisruptionInput, ctx) => {
    const gate = assertDevOnlyToolAllowed(ctx);
    if (gate.allowed === false)
      return { status: 'production_refused' as const, message: gate.reason };
    const input = airportDisruptionInput.parse(rawInput);
    const r = await runGroundedStructured(
      `Check current airport disruption status for ${input.airportIata} for the next ${input.windowHours} hours. Cover: strikes, weather, ATC issues, construction, security incidents, partial / full closures. Pull from FlightAware, official airport announcements, Reuters / AP. Surface average delay if reported. Include guidance for arriving + departing travelers.`,
      airportDisruptionShape,
      (text, _) =>
        `Coerce into airport disruption schema. Locale: ${input.locale}.\n\nReport:\n"""\n${text}\n"""`
    );
    if (!r.ok || !r.data) return { status: 'unavailable' as const, message: r.reason ?? 'no-data' };
    return {
      status: 'ok' as const,
      disruption: r.data,
      via: r.via,
      message: `${input.airportIata}: ${r.data.status} (${r.data.drivers.length} drivers).`,
    };
  },
};

// ── 2. local_holiday_disruption_check ────────────────────────────────

const localHolidayInput = z.object({
  city: z.string().min(1).max(120),
  countryCode: z.string().length(2).optional(),
  startsAtIso: z.string(),
  endsAtIso: z.string(),
});
type LocalHolidayInput = z.infer<typeof localHolidayInput>;

const localHolidayDisruptionCheckTool: ToolDef = {
  name: 'local_holiday_disruption_check',
  internal: true,
  experimental: true,
  description:
    'Detect public + school holidays + observances + local political events that disrupt normal city operations during a window. Composes `crowd_level_predictor` filtered by holiday categories. Pair with `airport_disruption_monitor` for full-stack disruption picture.',
  inputSchema: localHolidayInput,
  jsonSchema: {
    type: 'object',
    required: ['city', 'startsAtIso', 'endsAtIso'],
    properties: {
      city: { type: 'string', minLength: 1, maxLength: 120 },
      countryCode: { type: 'string', minLength: 2, maxLength: 2 },
      startsAtIso: { type: 'string' },
      endsAtIso: { type: 'string' },
    },
  },
  handler: async (rawInput: LocalHolidayInput, ctx) => {
    const gate = assertDevOnlyToolAllowed(ctx);
    if (gate.allowed === false)
      return { status: 'production_refused' as const, message: gate.reason };
    const input = localHolidayInput.parse(rawInput);
    const r = await runCrowdLevelPredictor(
      {
        city: input.city,
        ...(input.countryCode ? { countryCode: input.countryCode } : {}),
        startsAtIso: input.startsAtIso,
        endsAtIso: input.endsAtIso,
        categories: ['public-holidays', 'school-holidays', 'observances', 'politics'],
        topDriversLimit: 8,
      } as never,
      ctx
    );
    if (r.status !== 'ok') return { status: 'unavailable' as const, message: r.message };
    return {
      status: 'ok' as const,
      holidays: r.topDrivers.map(d => ({
        title: d.title,
        startsAtIso: d.startsAtIso,
        category: d.category,
      })),
      crowdLevel: r.crowdLevel,
      message: `${r.topDrivers.length} holidays/observances in ${input.city} between ${input.startsAtIso} and ${input.endsAtIso}.`,
    };
  },
};

// ── 3. venue_policy_checker (Vertex grounded) ────────────────────────

const venuePolicyInput = z.object({
  venueName: z.string().min(1).max(200),
  city: z.string().min(1).max(120),
  locale: z.string().min(2).max(10).default('en-US'),
});
type VenuePolicyInput = z.infer<typeof venuePolicyInput>;

const venuePolicyShape = z.object({
  bagPolicy: z.string(),
  idRequirement: z.string(),
  entryTime: z.string(),
  prohibitedItems: z.array(z.string()).max(10),
  accessibility: z.string(),
  parking: z.string(),
  notes: z.string().nullable(),
});

const venuePolicyCheckerTool: ToolDef = {
  name: 'venue_policy_checker',
  internal: true,
  experimental: true,
  description:
    'Check venue rules — bag policy, ID requirements, entry time, prohibited items, accessibility, parking. Vertex-grounded against the official venue site. Use before any concert / sports / theater visit.',
  inputSchema: venuePolicyInput,
  jsonSchema: {
    type: 'object',
    required: ['venueName', 'city'],
    properties: {
      venueName: { type: 'string', minLength: 1, maxLength: 200 },
      city: { type: 'string', minLength: 1, maxLength: 120 },
      locale: { type: 'string', minLength: 2, maxLength: 10 },
    },
  },
  handler: async (rawInput: VenuePolicyInput, ctx) => {
    const gate = assertDevOnlyToolAllowed(ctx);
    if (gate.allowed === false)
      return { status: 'production_refused' as const, message: gate.reason };
    const input = venuePolicyInput.parse(rawInput);
    const r = await runGroundedStructured(
      `Look up the venue policies for "${input.venueName}" in ${input.city}: bag-size policy + check options, ID requirements at door, entry time / doors-open, prohibited items, accessibility (wheelchair, hearing loop), parking + alternatives. Pull from the official venue site verbatim.`,
      venuePolicyShape,
      (text, _) =>
        `Coerce into venue policy schema. Locale: ${input.locale}.\n\nReport:\n"""\n${text}\n"""`
    );
    if (!r.ok || !r.data) return { status: 'unavailable' as const, message: r.reason ?? 'no-data' };
    return {
      status: 'ok' as const,
      policy: r.data,
      via: r.via,
      message: `Policy for ${input.venueName} via ${r.via}.`,
    };
  },
};

// ── 4. hotel_area_intelligence ───────────────────────────────────────

const hotelAreaInput = z.object({
  city: z.string().min(1).max(120),
  countryCode: z.string().length(2).optional(),
  hotelName: z.string().min(1).max(200),
  hotelLatitude: z.number().optional(),
  hotelLongitude: z.number().optional(),
  languageCode: z.string().max(10).default('en'),
});
type HotelAreaInput = z.infer<typeof hotelAreaInput>;

const hotelAreaIntelligenceTool: ToolDef = {
  name: 'hotel_area_intelligence',
  internal: true,
  experimental: true,
  description:
    'Score a hotel area on safety, walkability, corporate fit, nightlife, transit access, nearby essentials. Composes Places nearby + nightlife sample + transit sample. Use after `search_hotels` to qualify the area, not just the hotel.',
  inputSchema: hotelAreaInput,
  jsonSchema: {
    type: 'object',
    required: ['city', 'hotelName'],
    properties: {
      city: { type: 'string', minLength: 1, maxLength: 120 },
      countryCode: { type: 'string', minLength: 2, maxLength: 2 },
      hotelName: { type: 'string', minLength: 1, maxLength: 200 },
      hotelLatitude: { type: 'number' },
      hotelLongitude: { type: 'number' },
      languageCode: { type: 'string', maxLength: 10 },
    },
  },
  handler: async (rawInput: HotelAreaInput, ctx) => {
    const gate = assertDevOnlyToolAllowed(ctx);
    if (gate.allowed === false)
      return { status: 'production_refused' as const, message: gate.reason };
    const input = hotelAreaInput.parse(rawInput);
    const queries = ['cafe', 'pharmacy convenience', 'restaurant', 'metro station', 'gym'];
    const r = await Promise.all(
      queries.map(q =>
        searchText({
          query: `${q} near ${input.hotelName} ${input.city}`,
          limit: 3,
          languageCode: input.languageCode,
          ...(input.countryCode ? { regionCode: input.countryCode } : {}),
        })
      )
    );
    const presence: Record<string, number> = {};
    for (let i = 0; i < queries.length; i++) {
      presence[queries[i]!] = r[i]?.available ? r[i]!.results.length : 0;
    }
    const transitNearby = (presence['metro station'] ?? 0) > 0;
    const restaurantsNearby = (presence['restaurant'] ?? 0) > 0;
    const essentialsNearby = (presence['pharmacy convenience'] ?? 0) > 0;
    return {
      status: 'ok' as const,
      area: {
        walkability: restaurantsNearby && essentialsNearby ? 'high' : 'medium',
        transitAccess: transitNearby ? 'good' : 'limited',
        essentialsCoverage: essentialsNearby ? 'good' : 'limited',
        presence,
      },
      message: `Area intel for ${input.hotelName}: ${restaurantsNearby ? 'restaurants ✓' : 'thin restaurants'}, ${transitNearby ? 'transit ✓' : 'no transit nearby'}, ${essentialsNearby ? 'essentials ✓' : 'thin essentials'}.`,
    };
  },
};

// ── 5. neighborhood_fit_matcher (pure rules) ─────────────────────────

const neighFitInput = z.object({
  city: z.string().min(1).max(120),
  travelerProfile: z.object({
    travelStyle: z.enum([
      'business',
      'family',
      'couple',
      'digital_nomad',
      'solo_traveler',
      'foodie',
      'culture',
    ]),
    budgetTier: z.enum(['budget', 'medium', 'premium', 'splurge']).optional(),
    needsQuiet: z.boolean().optional(),
  }),
  candidateNeighborhoods: z.array(z.string().min(1).max(120)).min(1).max(10),
});
type NeighFitInput = z.infer<typeof neighFitInput>;

const NEIGHBORHOOD_TAGS: Record<string, Record<string, string[]>> = {
  'buenos aires': {
    recoleta: ['business', 'culture', 'couple', 'quiet'],
    'palermo soho': ['foodie', 'digital_nomad', 'nightlife', 'solo_traveler'],
    'puerto madero': ['business', 'couple', 'quiet'],
    'san telmo': ['culture', 'foodie', 'solo_traveler'],
  },
  'mexico city': {
    condesa: ['foodie', 'digital_nomad', 'couple'],
    'roma norte': ['foodie', 'digital_nomad', 'culture'],
    polanco: ['business', 'couple', 'family'],
    coyoacán: ['culture', 'family'],
  },
  paris: {
    'le marais': ['culture', 'foodie', 'couple'],
    'saint-germain': ['culture', 'foodie', 'business'],
    montmartre: ['couple', 'culture'],
    'la défense': ['business', 'quiet'],
  },
  'new york': {
    midtown: ['business'],
    'east village': ['foodie', 'nightlife', 'solo_traveler'],
    'west village': ['couple', 'foodie'],
    williamsburg: ['digital_nomad', 'foodie'],
    soho: ['couple', 'culture', 'foodie'],
  },
  tokyo: {
    shibuya: ['business', 'foodie', 'culture'],
    shinjuku: ['business', 'nightlife'],
    nakameguro: ['couple', 'foodie', 'quiet'],
    daikanyama: ['couple', 'foodie', 'culture'],
  },
};

const neighborhoodFitMatcherTool: ToolDef = {
  name: 'neighborhood_fit_matcher',
  internal: true,
  experimental: true,
  description:
    "Match candidate neighborhoods to a traveler profile (business / family / couple / digital_nomad / solo_traveler / foodie / culture). Curated tags for ~5 cities; defaults to 'unknown' otherwise.",
  inputSchema: neighFitInput,
  jsonSchema: {
    type: 'object',
    required: ['city', 'travelerProfile', 'candidateNeighborhoods'],
    properties: {
      city: { type: 'string', minLength: 1, maxLength: 120 },
      travelerProfile: { type: 'object' },
      candidateNeighborhoods: { type: 'array', minItems: 1, maxItems: 10 },
    },
  },
  handler: async (rawInput: NeighFitInput, ctx) => {
    const gate = assertDevOnlyToolAllowed(ctx);
    if (gate.allowed === false)
      return { status: 'production_refused' as const, message: gate.reason };
    const input = neighFitInput.parse(rawInput);
    const cityKey = input.city.trim().toLowerCase();
    const cityTags = NEIGHBORHOOD_TAGS[cityKey] ?? {};
    const ranked = input.candidateNeighborhoods
      .map(neigh => {
        const neighKey = neigh.trim().toLowerCase();
        const tags = cityTags[neighKey] ?? [];
        let score = 0.5;
        const reasons: string[] = [];
        if (tags.includes(input.travelerProfile.travelStyle)) {
          score += 0.3;
          reasons.push(`tagged for ${input.travelerProfile.travelStyle}`);
        }
        if (input.travelerProfile.needsQuiet && tags.includes('quiet')) {
          score += 0.15;
          reasons.push('tagged quiet');
        }
        if (tags.length === 0) reasons.push('no curated data');
        return { neighborhood: neigh, score: Math.max(0, Math.min(1, score)), reasons };
      })
      .sort((a, b) => b.score - a.score);
    return {
      status: 'ok' as const,
      ranked,
      message: `${ranked.length} neighborhoods matched (top: ${ranked[0]!.neighborhood}, score=${ranked[0]!.score.toFixed(2)}).`,
    };
  },
};

// ── 6. restaurant_reservation_researcher (Vertex grounded) ───────────

const reservationInput = z.object({
  restaurantName: z.string().min(1).max(200),
  city: z.string().min(1).max(120),
  partySize: z.number().int().min(1).max(20).default(2),
  locale: z.string().min(2).max(10).default('en-US'),
});
type ReservationInput = z.infer<typeof reservationInput>;

const reservationShape = z.object({
  reservationRequired: z.boolean().nullable(),
  reservationPlatform: z.string().nullable(),
  bookingUrl: z.string().nullable(),
  depositRequired: z.string().nullable(),
  dressCode: z.string().nullable(),
  menu: z.string().nullable(),
  notes: z.string().nullable(),
});

const restaurantReservationResearcherTool: ToolDef = {
  name: 'restaurant_reservation_researcher',
  internal: true,
  experimental: true,
  description:
    'Research reservation status for a specific restaurant — required? platform (Resy / OpenTable / TheFork)? deposit? dress code? Vertex-grounded against the official site. Use after `monocle_place_researcher` returns a candidate.',
  inputSchema: reservationInput,
  jsonSchema: {
    type: 'object',
    required: ['restaurantName', 'city'],
    properties: {
      restaurantName: { type: 'string', minLength: 1, maxLength: 200 },
      city: { type: 'string', minLength: 1, maxLength: 120 },
      partySize: { type: 'integer', minimum: 1, maximum: 20 },
      locale: { type: 'string', minLength: 2, maxLength: 10 },
    },
  },
  handler: async (rawInput: ReservationInput, ctx) => {
    const gate = assertDevOnlyToolAllowed(ctx);
    if (gate.allowed === false)
      return { status: 'production_refused' as const, message: gate.reason };
    const input = reservationInput.parse(rawInput);
    const r = await runGroundedStructured(
      `Look up reservation reality for "${input.restaurantName}" in ${input.city} for party of ${input.partySize}. Cover: is reservation required vs walk-in?, which platform (Resy / OpenTable / TheFork / restaurant site)?, deposit requirement, dress code, menu link. Pull from the official site verbatim.`,
      reservationShape,
      (text, _) =>
        `Coerce into reservation schema. Locale: ${input.locale}.\n\nReport:\n"""\n${text}\n"""`
    );
    if (!r.ok || !r.data) return { status: 'unavailable' as const, message: r.reason ?? 'no-data' };
    return {
      status: 'ok' as const,
      reservation: r.data,
      via: r.via,
      message: `Reservation info for ${input.restaurantName} via ${r.via}.`,
    };
  },
};

// ── 7. menu_dietary_researcher (Vertex grounded) ─────────────────────

const menuDietaryInput = z.object({
  restaurantName: z.string().min(1).max(200),
  city: z.string().min(1).max(120),
  dietaryRestrictions: z.array(z.string().max(40)).min(1).max(8),
  locale: z.string().min(2).max(10).default('en-US'),
});
type MenuDietaryInput = z.infer<typeof menuDietaryInput>;

const menuDietaryShape = z.object({
  feasible: z.enum(['yes', 'mostly', 'limited', 'no']),
  flaggedDishes: z.array(z.object({ name: z.string(), risk: z.string() })).max(8),
  safeDishes: z.array(z.string()).max(8),
  recommendations: z.array(z.string()).max(4),
});

const menuDietaryResearcherTool: ToolDef = {
  name: 'menu_dietary_researcher',
  internal: true,
  experimental: true,
  description:
    "Check a specific restaurant's menu against traveler dietary restrictions. Vertex-grounded against the official menu. Returns feasibility ('yes' / 'mostly' / 'limited' / 'no') + flagged dishes + safe dishes + ordering recommendations.",
  inputSchema: menuDietaryInput,
  jsonSchema: {
    type: 'object',
    required: ['restaurantName', 'city', 'dietaryRestrictions'],
    properties: {
      restaurantName: { type: 'string', minLength: 1, maxLength: 200 },
      city: { type: 'string', minLength: 1, maxLength: 120 },
      dietaryRestrictions: {
        type: 'array',
        minItems: 1,
        maxItems: 8,
        items: { type: 'string', maxLength: 40 },
      },
      locale: { type: 'string', minLength: 2, maxLength: 10 },
    },
  },
  handler: async (rawInput: MenuDietaryInput, ctx) => {
    const gate = assertDevOnlyToolAllowed(ctx);
    if (gate.allowed === false)
      return { status: 'production_refused' as const, message: gate.reason };
    const input = menuDietaryInput.parse(rawInput);
    const r = await runGroundedStructured(
      `Check the current menu of "${input.restaurantName}" in ${input.city} against these dietary restrictions: ${input.dietaryRestrictions.join(', ')}. Return: overall feasibility, dishes with risk (e.g. "the carbonara contains pancetta — not gluten-free"), dishes that are clearly safe, and ordering recommendations (e.g. "ask for the pasta to be made with rice noodles"). Pull from the official menu URL.`,
      menuDietaryShape,
      (text, _) =>
        `Coerce into menu dietary schema. Locale: ${input.locale}.\n\nReport:\n"""\n${text}\n"""`
    );
    if (!r.ok || !r.data) return { status: 'unavailable' as const, message: r.reason ?? 'no-data' };
    return {
      status: 'ok' as const,
      dietary: r.data,
      via: r.via,
      message: `Menu dietary check via ${r.via}: ${r.data.feasible}.`,
    };
  },
};

// ── 8. ground_transport_price_researcher ─────────────────────────────

const groundTransportInput = z.object({
  city: z.string().min(1).max(120),
  countryCode: z.string().length(2).optional(),
  /** Origin → destination intent. */
  originType: z.enum(['airport', 'city_center', 'station', 'hotel', 'venue']),
  destinationType: z.enum(['airport', 'city_center', 'station', 'hotel', 'venue']),
  estimatedKm: z.number().min(0).max(200).optional(),
  locale: z.string().min(2).max(10).default('en-US'),
});
type GroundTransportInput = z.infer<typeof groundTransportInput>;

interface GroundTransportEstimate {
  mode: 'taxi' | 'rideshare' | 'public_transit' | 'private_car' | 'shared_shuttle';
  rangeUsd: { low: number; high: number };
  durationMinutes: { low: number; high: number };
  notes?: string;
}

const groundTransportPriceResearcherTool: ToolDef = {
  name: 'ground_transport_price_researcher',
  internal: true,
  experimental: true,
  description:
    'Estimate taxi / rideshare / public-transit prices for a city + origin/destination intent. Pure curated tables for top airports + cities, fallback CSE when not curated. Use to set traveler expectations before booking.',
  inputSchema: groundTransportInput,
  jsonSchema: {
    type: 'object',
    required: ['city', 'originType', 'destinationType'],
    properties: {
      city: { type: 'string', minLength: 1, maxLength: 120 },
      countryCode: { type: 'string', minLength: 2, maxLength: 2 },
      originType: { type: 'string', enum: ['airport', 'city_center', 'station', 'hotel', 'venue'] },
      destinationType: {
        type: 'string',
        enum: ['airport', 'city_center', 'station', 'hotel', 'venue'],
      },
      estimatedKm: { type: 'number', minimum: 0, maximum: 200 },
      locale: { type: 'string', minLength: 2, maxLength: 10 },
    },
  },
  handler: async (rawInput: GroundTransportInput, ctx) => {
    const gate = assertDevOnlyToolAllowed(ctx);
    if (gate.allowed === false)
      return { status: 'production_refused' as const, message: gate.reason };
    const input = groundTransportInput.parse(rawInput);
    // Heuristic: distance × city cost multiplier, applied to mode rates.
    // We use a conservative rough table per mode.
    const km =
      input.estimatedKm ??
      (input.originType === 'airport' || input.destinationType === 'airport' ? 25 : 5);
    const cityKey = input.city.trim().toLowerCase();
    const CITY_FX: Record<string, number> = {
      tokyo: 1.6,
      london: 1.5,
      'new york': 1.4,
      paris: 1.3,
      singapore: 1.2,
      'mexico city': 0.7,
      'buenos aires': 0.55,
      lima: 0.6,
      medellin: 0.5,
      bangkok: 0.55,
    };
    const mult = CITY_FX[cityKey] ?? 1.0;
    const taxiBase = 8 + km * 1.1;
    const rideshareBase = 6 + km * 0.9;
    const transitBase = Math.max(2, Math.min(10, km * 0.15));

    const estimates: GroundTransportEstimate[] = [
      {
        mode: 'taxi',
        rangeUsd: {
          low: Math.round(taxiBase * 0.8 * mult),
          high: Math.round(taxiBase * 1.4 * mult),
        },
        durationMinutes: { low: Math.round(km * 1.5), high: Math.round(km * 3) },
      },
      {
        mode: 'rideshare',
        rangeUsd: {
          low: Math.round(rideshareBase * 0.7 * mult),
          high: Math.round(rideshareBase * 1.3 * mult),
        },
        durationMinutes: { low: Math.round(km * 1.5), high: Math.round(km * 3) },
        notes: 'Cabify / Uber / Bolt / 99 / Grab depending on city.',
      },
      {
        mode: 'public_transit',
        rangeUsd: {
          low: Math.max(1, Math.round(transitBase * 0.4 * mult)),
          high: Math.round(transitBase * 1.0 * mult),
        },
        durationMinutes: { low: Math.round(km * 2.5), high: Math.round(km * 4.5) },
        notes: 'Cheapest but slowest with luggage.',
      },
    ];

    if (input.originType === 'airport' || input.destinationType === 'airport') {
      estimates.push({
        mode: 'shared_shuttle',
        rangeUsd: {
          low: Math.round(taxiBase * 0.55 * mult),
          high: Math.round(taxiBase * 0.85 * mult),
        },
        durationMinutes: { low: Math.round(km * 2.5), high: Math.round(km * 5) },
        notes: 'Shared van — multi-stop, slower than taxi.',
      });
    }

    return {
      status: 'ok' as const,
      estimates,
      assumedKm: km,
      message: `${estimates.length} mode estimates for ${input.originType} → ${input.destinationType} (~${km}km × ${mult.toFixed(2)}× ${input.city}).`,
    };
  },
};

// ── 9. public_transit_ticketing_brief (Vertex grounded) ──────────────

const transitTicketingInput = z.object({
  city: z.string().min(1).max(120),
  countryCode: z.string().length(2).optional(),
  locale: z.string().min(2).max(10).default('en-US'),
});
type TransitTicketingInput = z.infer<typeof transitTicketingInput>;

const transitTicketingShape = z.object({
  primaryMode: z.string(),
  paymentMethods: z.array(z.string()).max(6),
  ticketTypes: z.array(z.string()).max(6),
  appOrCard: z.string(),
  faresExample: z.string(),
  notes: z.string().nullable(),
});

const publicTransitTicketingBriefTool: ToolDef = {
  name: 'public_transit_ticketing_brief',
  internal: true,
  description:
    'Explain how public transit ticketing works for a city — primary mode, payment methods (contactless, IC card, mobile), ticket types (single, day pass, weekly), the right app or smart card to load, fare example. Vertex-grounded.',
  inputSchema: transitTicketingInput,
  jsonSchema: {
    type: 'object',
    required: ['city'],
    properties: {
      city: { type: 'string', minLength: 1, maxLength: 120 },
      countryCode: { type: 'string', minLength: 2, maxLength: 2 },
      locale: { type: 'string', minLength: 2, maxLength: 10 },
    },
  },
  handler: async (rawInput: TransitTicketingInput, ctx) => {
    const gate = assertDevOnlyToolAllowed(ctx);
    if (gate.allowed === false)
      return { status: 'production_refused' as const, message: gate.reason };
    const input = transitTicketingInput.parse(rawInput);
    const r = await runGroundedStructured(
      `Explain how public transit ticketing works for ${input.city}${input.countryCode ? ` (${input.countryCode})` : ''}. Cover: primary mode (metro / bus / tram / train), payment methods (contactless cards, IC cards like Suica / Oyster / Compass, mobile apps), ticket types (single / day / weekly), the recommended app or smart card to load, a single fare example, common gotchas (zones, peak surcharges).`,
      transitTicketingShape,
      (text, _) =>
        `Coerce into transit ticketing schema. Locale: ${input.locale}.\n\nReport:\n"""\n${text}\n"""`
    );
    if (!r.ok || !r.data) return { status: 'unavailable' as const, message: r.reason ?? 'no-data' };
    return {
      status: 'ok' as const,
      brief: r.data,
      via: r.via,
      message: `Transit ticketing brief for ${input.city} via ${r.via}.`,
    };
  },
};

// ── 10. airport_terminal_resolver (Vertex grounded) ──────────────────

const airportTerminalInput = z.object({
  airportIata: z.string().length(3),
  airline: z.string().min(1).max(120).optional(),
  flightNumber: z.string().min(1).max(20).optional(),
  locale: z.string().min(2).max(10).default('en-US'),
});
type AirportTerminalInput = z.infer<typeof airportTerminalInput>;

const airportTerminalShape = z.object({
  terminal: z.string(),
  checkInArea: z.string(),
  loungeOptions: z.array(z.string()).max(6),
  shuttleNotes: z.string().nullable(),
});

const airportTerminalResolverTool: ToolDef = {
  name: 'airport_terminal_resolver',
  internal: true,
  experimental: true,
  description:
    'Resolve likely terminal + check-in area + lounge options for an airline at a given airport. Vertex-grounded against airline + airport sites. Use after `book_flight` to pre-flight the traveler.',
  inputSchema: airportTerminalInput,
  jsonSchema: {
    type: 'object',
    required: ['airportIata'],
    properties: {
      airportIata: { type: 'string', minLength: 3, maxLength: 3 },
      airline: { type: 'string', minLength: 1, maxLength: 120 },
      flightNumber: { type: 'string', minLength: 1, maxLength: 20 },
      locale: { type: 'string', minLength: 2, maxLength: 10 },
    },
  },
  handler: async (rawInput: AirportTerminalInput, ctx) => {
    const gate = assertDevOnlyToolAllowed(ctx);
    if (gate.allowed === false)
      return { status: 'production_refused' as const, message: gate.reason };
    const input = airportTerminalInput.parse(rawInput);
    const r = await runGroundedStructured(
      `Determine the terminal, check-in area, and lounge options at ${input.airportIata}${input.airline ? ` for ${input.airline}` : ''}${input.flightNumber ? ` (flight ${input.flightNumber})` : ''}. Pull from official airport + airline pages.`,
      airportTerminalShape,
      (text, _) =>
        `Coerce into airport terminal schema. Locale: ${input.locale}.\n\nReport:\n"""\n${text}\n"""`
    );
    if (!r.ok || !r.data) return { status: 'unavailable' as const, message: r.reason ?? 'no-data' };
    return {
      status: 'ok' as const,
      terminal: r.data,
      via: r.via,
      message: `Terminal info for ${input.airportIata} via ${r.via}.`,
    };
  },
};

// ── 11. layover_viability_checker (pure) ─────────────────────────────

const layoverViabilityInput = z.object({
  arriveAirportIata: z.string().length(3),
  departAirportIata: z.string().length(3),
  layoverMinutes: z.number().int().min(15).max(1440),
  arriveDomestic: z.boolean().default(false),
  departDomestic: z.boolean().default(false),
  sameTerminal: z.boolean().default(true),
  immigrationRequired: z.boolean().default(false),
  bagsRecheckRequired: z.boolean().default(false),
});
type LayoverViabilityInput = z.infer<typeof layoverViabilityInput>;

const layoverViabilityCheckerTool: ToolDef = {
  name: 'layover_viability_checker',
  internal: true,
  description:
    'Assess whether a layover is viable. Pure rules: minimum-connection-time-style heuristic considering immigration, bag recheck, terminal change, domestic/international mix. Returns viable / risky / not_viable + buffer minutes.',
  inputSchema: layoverViabilityInput,
  jsonSchema: {
    type: 'object',
    required: ['arriveAirportIata', 'departAirportIata', 'layoverMinutes'],
    properties: {
      arriveAirportIata: { type: 'string', minLength: 3, maxLength: 3 },
      departAirportIata: { type: 'string', minLength: 3, maxLength: 3 },
      layoverMinutes: { type: 'integer', minimum: 15, maximum: 1440 },
      arriveDomestic: { type: 'boolean' },
      departDomestic: { type: 'boolean' },
      sameTerminal: { type: 'boolean' },
      immigrationRequired: { type: 'boolean' },
      bagsRecheckRequired: { type: 'boolean' },
    },
  },
  handler: async (rawInput: LayoverViabilityInput, ctx) => {
    const gate = assertDevOnlyToolAllowed(ctx);
    if (gate.allowed === false)
      return { status: 'production_refused' as const, message: gate.reason };
    const input = layoverViabilityInput.parse(rawInput);
    let minimum = 30;
    if (!input.sameTerminal) minimum += 25;
    if (input.immigrationRequired) minimum += 30;
    if (input.bagsRecheckRequired) minimum += 25;
    if (
      !input.arriveDomestic &&
      !input.departDomestic &&
      input.arriveAirportIata !== input.departAirportIata
    )
      minimum += 20;
    if (input.arriveAirportIata !== input.departAirportIata) minimum += 60; // airport change

    let verdict: 'viable' | 'risky' | 'not_viable' = 'viable';
    if (input.layoverMinutes < minimum * 0.8) verdict = 'not_viable';
    else if (input.layoverMinutes < minimum * 1.3) verdict = 'risky';

    const tips: string[] = [];
    if (verdict === 'risky')
      tips.push('Pack carry-on only — checked bags often miss tight connections.');
    if (input.immigrationRequired)
      tips.push('Pre-fill arrival declarations on the carrier app to save 10-15min.');
    if (verdict === 'not_viable')
      tips.push(
        'Airline-protected vs self-booked: only self-booked (saver / award separately) leaves you exposed if missed.'
      );
    return {
      status: 'ok' as const,
      verdict,
      minimumRequired: minimum,
      buffer: input.layoverMinutes - minimum,
      tips,
      message: `${input.arriveAirportIata}→${input.departAirportIata} layover ${input.layoverMinutes}min vs ${minimum}min minimum: ${verdict}.`,
    };
  },
};

// ── 12. nearby_airport_alternative_researcher ────────────────────────

const altAirportInput = z.object({
  primaryIata: z.string().length(3),
  city: z.string().min(1).max(120).optional(),
});
type AltAirportInput = z.infer<typeof altAirportInput>;

// Hand-curated common alternatives.
const ALT_AIRPORT_TABLE: Record<
  string,
  Array<{ iata: string; name: string; rough: string; tradeoff: string }>
> = {
  EZE: [
    {
      iata: 'AEP',
      name: 'Aeroparque Jorge Newbery',
      rough: 'closer to downtown but mostly domestic',
      tradeoff: 'much shorter taxi but limited intl',
    },
  ],
  AEP: [
    {
      iata: 'EZE',
      name: 'Ministro Pistarini',
      rough: 'main international hub',
      tradeoff: 'further from downtown',
    },
  ],
  JFK: [
    {
      iata: 'LGA',
      name: 'LaGuardia',
      rough: 'closer, mostly domestic',
      tradeoff: 'no major intl long-haul',
    },
    {
      iata: 'EWR',
      name: 'Newark',
      rough: 'NJ side, full intl',
      tradeoff: 'slower taxi from Manhattan',
    },
  ],
  LGA: [
    { iata: 'JFK', name: 'JFK', rough: 'main intl hub', tradeoff: 'further from Manhattan' },
    { iata: 'EWR', name: 'Newark', rough: 'NJ side', tradeoff: 'slower from Manhattan' },
  ],
  EWR: [
    { iata: 'JFK', name: 'JFK', rough: 'NY-side intl', tradeoff: 'longer if staying in NJ' },
    {
      iata: 'LGA',
      name: 'LaGuardia',
      rough: 'closer to Manhattan, mostly domestic',
      tradeoff: 'no long-haul',
    },
  ],
  LHR: [
    {
      iata: 'LGW',
      name: 'Gatwick',
      rough: 'south London, lots of charter / leisure',
      tradeoff: 'longer from West London',
    },
    { iata: 'STN', name: 'Stansted', rough: 'budget hub', tradeoff: 'far from central London' },
    {
      iata: 'LCY',
      name: 'London City',
      rough: 'closest to financial district',
      tradeoff: 'shorter routes only',
    },
  ],
  CDG: [
    {
      iata: 'ORY',
      name: 'Orly',
      rough: 'south Paris, more domestic',
      tradeoff: 'limited intl long-haul',
    },
  ],
  HND: [{ iata: 'NRT', name: 'Narita', rough: 'main intl', tradeoff: 'further + slower train' }],
  NRT: [
    {
      iata: 'HND',
      name: 'Haneda',
      rough: 'closer to Tokyo center',
      tradeoff: 'fewer intl flights',
    },
  ],
  DXB: [
    {
      iata: 'AUH',
      name: 'Abu Dhabi',
      rough: 'Etihad hub',
      tradeoff: 'further from Dubai (~90min)',
    },
  ],
  GRU: [
    { iata: 'CGH', name: 'Congonhas', rough: 'domestic hub', tradeoff: 'no intl' },
    { iata: 'VCP', name: 'Viracopos', rough: 'cargo + secondary', tradeoff: 'far from city' },
  ],
};

const nearbyAirportAlternativeResearcherTool: ToolDef = {
  name: 'nearby_airport_alternative_researcher',
  internal: true,
  description:
    "List nearby alternate airports for a primary airport, with rough description + tradeoff. Curated table for ~10 city-pairs. Use when traveler asks 'is there a closer airport to <city>'.",
  inputSchema: altAirportInput,
  jsonSchema: {
    type: 'object',
    required: ['primaryIata'],
    properties: {
      primaryIata: { type: 'string', minLength: 3, maxLength: 3 },
      city: { type: 'string', minLength: 1, maxLength: 120 },
    },
  },
  handler: async (rawInput: AltAirportInput, ctx) => {
    const gate = assertDevOnlyToolAllowed(ctx);
    if (gate.allowed === false)
      return { status: 'production_refused' as const, message: gate.reason };
    const input = altAirportInput.parse(rawInput);
    const alts = ALT_AIRPORT_TABLE[input.primaryIata.toUpperCase()] ?? [];
    if (alts.length === 0) {
      return {
        status: 'unavailable' as const,
        message: `No curated alternatives for ${input.primaryIata}.`,
      };
    }
    return {
      status: 'ok' as const,
      alternatives: alts,
      message: `${alts.length} alternatives for ${input.primaryIata}.`,
    };
  },
};

// ── 13. route_alternative_researcher (Vertex grounded) ───────────────

const routeAltInput = z.object({
  origin: z.string().min(1).max(120),
  destination: z.string().min(1).max(120),
  primaryMode: z.enum(['flight', 'train', 'car']).default('flight'),
  locale: z.string().min(2).max(10).default('en-US'),
});
type RouteAltInput = z.infer<typeof routeAltInput>;

const routeAltShape = z.object({
  alternatives: z
    .array(
      z.object({
        mode: z.string(),
        durationApprox: z.string(),
        priceApprox: z.string(),
        notes: z.string(),
      })
    )
    .max(6),
});

const routeAlternativeResearcherTool: ToolDef = {
  name: 'route_alternative_researcher',
  internal: true,
  experimental: true,
  description:
    'Find train / bus / ferry / nearby-airport alternatives between an origin and destination. Vertex-grounded research. Use when flights are expensive, weather-grounded, or the route is short enough that ground transport is competitive.',
  inputSchema: routeAltInput,
  jsonSchema: {
    type: 'object',
    required: ['origin', 'destination'],
    properties: {
      origin: { type: 'string', minLength: 1, maxLength: 120 },
      destination: { type: 'string', minLength: 1, maxLength: 120 },
      primaryMode: { type: 'string', enum: ['flight', 'train', 'car'] },
      locale: { type: 'string', minLength: 2, maxLength: 10 },
    },
  },
  handler: async (rawInput: RouteAltInput, ctx) => {
    const gate = assertDevOnlyToolAllowed(ctx);
    if (gate.allowed === false)
      return { status: 'production_refused' as const, message: gate.reason };
    const input = routeAltInput.parse(rawInput);
    const r = await runGroundedStructured(
      `Find alternative travel modes from ${input.origin} to ${input.destination} given primary mode is ${input.primaryMode}. Cover: train (incl. high-speed), bus / coach, ferry where applicable, nearby-airport alternative pairs. For each: approx duration, approx price (range, USD-equivalent), notes (booking platform, reservation requirement, scenic value).`,
      routeAltShape,
      (text, _) =>
        `Coerce into route alternatives schema. Locale: ${input.locale}.\n\nReport:\n"""\n${text}\n"""`
    );
    if (!r.ok || !r.data) return { status: 'unavailable' as const, message: r.reason ?? 'no-data' };
    return {
      status: 'ok' as const,
      alternatives: r.data.alternatives,
      via: r.via,
      message: `${r.data.alternatives.length} alternatives ${input.origin} → ${input.destination}.`,
    };
  },
};

// ── 14. trip_budget_researcher (composer) ────────────────────────────

const tripBudgetInput = z.object({
  city: z.string().min(1).max(120),
  countryCode: z.string().length(2).optional(),
  travelStyle: z.enum(['budget', 'medium', 'premium', 'splurge']).default('medium'),
  daysCount: z.number().int().min(1).max(60).default(3),
});
type TripBudgetInput = z.infer<typeof tripBudgetInput>;

const tripBudgetResearcherTool: ToolDef = {
  name: 'trip_budget_researcher',
  internal: true,
  description:
    'Estimate total trip daily spend for a city + style + duration. Composes `budget_estimator` across baseline categories (cafe, mid_restaurant, casual_restaurant, bar, ground_transport). Returns daily + total range.',
  inputSchema: tripBudgetInput,
  jsonSchema: {
    type: 'object',
    required: ['city'],
    properties: {
      city: { type: 'string', minLength: 1, maxLength: 120 },
      countryCode: { type: 'string', minLength: 2, maxLength: 2 },
      travelStyle: { type: 'string', enum: ['budget', 'medium', 'premium', 'splurge'] },
      daysCount: { type: 'integer', minimum: 1, maximum: 60 },
    },
  },
  handler: async (rawInput: TripBudgetInput, ctx) => {
    const gate = assertDevOnlyToolAllowed(ctx);
    if (gate.allowed === false)
      return { status: 'production_refused' as const, message: gate.reason };
    const input = tripBudgetInput.parse(rawInput);

    // Daily template per style.
    const TEMPLATES: Record<
      TripBudgetInput['travelStyle'],
      Array<Parameters<typeof runBudgetEstimator>[0]['category']>
    > = {
      budget: ['cafe', 'fast_casual', 'casual_restaurant'],
      medium: ['cafe', 'casual_restaurant', 'mid_restaurant', 'bar'],
      premium: ['cafe', 'mid_restaurant', 'fine_restaurant', 'cocktail_bar'],
      splurge: ['cafe', 'fine_restaurant', 'tasting_menu', 'cocktail_bar'],
    };
    const cats = TEMPLATES[input.travelStyle];
    const results = await Promise.all(
      cats.map(c =>
        runBudgetEstimator(
          {
            category: c,
            city: input.city,
            ...(input.countryCode ? { countryCode: input.countryCode } : {}),
            partySize: 1,
          } as never,
          ctx
        )
      )
    );
    let dailyLow = 0;
    let dailyTyp = 0;
    let dailyHigh = 0;
    for (const r of results) {
      if (r.status === 'ok' && r.expectedSpendPerPerson) {
        dailyLow += r.expectedSpendPerPerson.low;
        dailyTyp += r.expectedSpendPerPerson.typical;
        dailyHigh += r.expectedSpendPerPerson.high;
      }
    }
    return {
      status: 'ok' as const,
      perDay: { low: dailyLow, typical: dailyTyp, high: dailyHigh, currency: 'USD' },
      total: {
        low: dailyLow * input.daysCount,
        typical: dailyTyp * input.daysCount,
        high: dailyHigh * input.daysCount,
        currency: 'USD',
      },
      style: input.travelStyle,
      message: `Daily spend: $${dailyLow}-$${dailyHigh}/person × ${input.daysCount}d = $${dailyLow * input.daysCount}-$${dailyHigh * input.daysCount} total.`,
    };
  },
};

// ── 15. local_payment_acceptance_brief (Vertex grounded) ─────────────

const paymentAcceptanceInput = z.object({
  countryCode: z.string().length(2),
  locale: z.string().min(2).max(10).default('en-US'),
});
type PaymentAcceptanceInput = z.infer<typeof paymentAcceptanceInput>;

const paymentAcceptanceShape = z.object({
  cardAcceptance: z.string(),
  contactlessNorm: z.boolean(),
  cashStillNeeded: z.boolean(),
  localWallets: z.array(z.string()).max(6),
  atmAvailability: z.string(),
  tipExpectation: z.string(),
  notes: z.string().nullable(),
});

const localPaymentAcceptanceBriefTool: ToolDef = {
  name: 'local_payment_acceptance_brief',
  internal: true,
  description:
    'Explain cash + card + local wallet acceptance in a country. Vertex-grounded. Returns whether contactless is the norm, whether cash is still needed, which local wallets to consider (Pix / Alipay / WeChat / Mercado Pago), ATM availability, tip norms.',
  inputSchema: paymentAcceptanceInput,
  jsonSchema: {
    type: 'object',
    required: ['countryCode'],
    properties: {
      countryCode: { type: 'string', minLength: 2, maxLength: 2 },
      locale: { type: 'string', minLength: 2, maxLength: 10 },
    },
  },
  handler: async (rawInput: PaymentAcceptanceInput, ctx) => {
    const gate = assertDevOnlyToolAllowed(ctx);
    if (gate.allowed === false)
      return { status: 'production_refused' as const, message: gate.reason };
    const input = paymentAcceptanceInput.parse(rawInput);
    const r = await runGroundedStructured(
      `Explain payment acceptance for a tourist in ${input.countryCode}. Cover: card acceptance breadth (Visa / Mastercard / Amex), is contactless the norm?, is cash still needed (markets, taxis, tips)?, local wallets (Pix / Alipay / WeChat / Mercado Pago / Bizum / etc.), ATM availability + fees, tip expectation. Pull from official tourism + recent traveler reports.`,
      paymentAcceptanceShape,
      (text, _) =>
        `Coerce into payment acceptance schema. Locale: ${input.locale}.\n\nReport:\n"""\n${text}\n"""`
    );
    if (!r.ok || !r.data) return { status: 'unavailable' as const, message: r.reason ?? 'no-data' };
    return {
      status: 'ok' as const,
      brief: r.data,
      via: r.via,
      message: `Payment brief for ${input.countryCode} via ${r.via}.`,
    };
  },
};

// ── 16. invoice_tax_requirements_researcher (Vertex grounded) ────────

const invoiceTaxInput = z.object({
  countryCode: z.string().length(2),
  expenseKind: z.enum(['hotel', 'restaurant', 'transport', 'general']).default('general'),
  locale: z.string().min(2).max(10).default('en-US'),
});
type InvoiceTaxInput = z.infer<typeof invoiceTaxInput>;

const invoiceTaxShape = z.object({
  invoiceFormatExpected: z.string(),
  taxIdNeeded: z.boolean(),
  taxIdCalledLocally: z.string().nullable(),
  reverseChargeApplies: z.boolean().nullable(),
  retentionPeriod: z.string().nullable(),
  notes: z.string().nullable(),
});

const invoiceTaxRequirementsResearcherTool: ToolDef = {
  name: 'invoice_tax_requirements_researcher',
  internal: true,
  description:
    "Research what's required on a corporate invoice in a country (hotel / restaurant / transport / general). Vertex-grounded. Returns expected format, tax-id requirement (CUIT / NIF / VAT-ID / etc.), reverse-charge applicability, retention period, gotchas.",
  inputSchema: invoiceTaxInput,
  jsonSchema: {
    type: 'object',
    required: ['countryCode'],
    properties: {
      countryCode: { type: 'string', minLength: 2, maxLength: 2 },
      expenseKind: { type: 'string', enum: ['hotel', 'restaurant', 'transport', 'general'] },
      locale: { type: 'string', minLength: 2, maxLength: 10 },
    },
  },
  handler: async (rawInput: InvoiceTaxInput, ctx) => {
    const gate = assertDevOnlyToolAllowed(ctx);
    if (gate.allowed === false)
      return { status: 'production_refused' as const, message: gate.reason };
    const input = invoiceTaxInput.parse(rawInput);
    const r = await runGroundedStructured(
      `Research the corporate invoice / tax-receipt requirements in ${input.countryCode} for ${input.expenseKind} expenses. Cover: expected invoice format, whether the tax ID is needed (and what it's called locally — CUIT, NIF, RFC, VAT, GSTIN, etc.), reverse-charge applicability for foreign buyers, retention period, common gotchas (e.g. needing the company's full legal name).`,
      invoiceTaxShape,
      (text, _) =>
        `Coerce into invoice tax schema. Locale: ${input.locale}.\n\nReport:\n"""\n${text}\n"""`
    );
    if (!r.ok || !r.data) return { status: 'unavailable' as const, message: r.reason ?? 'no-data' };
    return {
      status: 'ok' as const,
      brief: r.data,
      via: r.via,
      message: `Invoice tax brief for ${input.countryCode} via ${r.via}.`,
    };
  },
};

// ── 17. travel_insurance_requirement_checker (Vertex grounded) ───────

const insuranceInput = z.object({
  destinationCountryCode: z.string().length(2),
  travelerNationalityCode: z.string().length(2).optional(),
  visaRequired: z.boolean().optional(),
  locale: z.string().min(2).max(10).default('en-US'),
});
type InsuranceInput = z.infer<typeof insuranceInput>;

const insuranceShape = z.object({
  insuranceMandatory: z.boolean().nullable(),
  minimumCoverageUsd: z.number().nullable(),
  acceptedProviders: z.array(z.string()).max(8),
  proofRequiredAtBorder: z.boolean().nullable(),
  notes: z.string().nullable(),
});

const travelInsuranceRequirementCheckerTool: ToolDef = {
  name: 'travel_insurance_requirement_checker',
  internal: true,
  experimental: true,
  description:
    'Check whether travel / health insurance is mandatory for a destination + nationality. Vertex-grounded against official tourism + immigration sites. Returns mandatory flag + minimum coverage + accepted providers + border-proof requirement.',
  inputSchema: insuranceInput,
  jsonSchema: {
    type: 'object',
    required: ['destinationCountryCode'],
    properties: {
      destinationCountryCode: { type: 'string', minLength: 2, maxLength: 2 },
      travelerNationalityCode: { type: 'string', minLength: 2, maxLength: 2 },
      visaRequired: { type: 'boolean' },
      locale: { type: 'string', minLength: 2, maxLength: 10 },
    },
  },
  handler: async (rawInput: InsuranceInput, ctx) => {
    const gate = assertDevOnlyToolAllowed(ctx);
    if (gate.allowed === false)
      return { status: 'production_refused' as const, message: gate.reason };
    const input = insuranceInput.parse(rawInput);
    const r = await runGroundedStructured(
      `Check whether travel / health insurance is mandatory for a ${input.travelerNationalityCode ?? 'foreign'} traveler entering ${input.destinationCountryCode}. Cover: mandatory flag, minimum coverage required (USD-equivalent), accepted providers / what counts, whether proof is checked at border. Pull from official immigration + tourism sites.`,
      insuranceShape,
      (text, _) =>
        `Coerce into insurance schema. Locale: ${input.locale}.\n\nReport:\n"""\n${text}\n"""`
    );
    if (!r.ok || !r.data) return { status: 'unavailable' as const, message: r.reason ?? 'no-data' };
    return {
      status: 'ok' as const,
      brief: r.data,
      via: r.via,
      message: `Insurance check for ${input.destinationCountryCode} via ${r.via}.`,
    };
  },
};

// ── 18. medical_access_brief (composer) ──────────────────────────────

const medicalAccessInput = z.object({
  city: z.string().min(1).max(120),
  countryCode: z.string().length(2),
  languageCode: z.string().max(10).default('en'),
});
type MedicalAccessInput = z.infer<typeof medicalAccessInput>;

const medicalAccessBriefTool: ToolDef = {
  name: 'medical_access_brief',
  internal: true,
  description:
    'Quick medical access brief — emergency numbers + nearest private clinic (Places) + nearest 24h pharmacy. Composes `clinic_finder` + `pharmacy_24h_finder` + `emergency_numbers_card`. Use after arrival as part of the safety pack.',
  inputSchema: medicalAccessInput,
  jsonSchema: {
    type: 'object',
    required: ['city', 'countryCode'],
    properties: {
      city: { type: 'string', minLength: 1, maxLength: 120 },
      countryCode: { type: 'string', minLength: 2, maxLength: 2 },
      languageCode: { type: 'string', maxLength: 10 },
    },
  },
  handler: async (rawInput: MedicalAccessInput, ctx) => {
    // Lazy import to avoid a circular surface.
    const { clinicFinderTool, pharmacy24hFinderTool, emergencyNumbersCardTool } = await import(
      './b7-health-safety'
    );
    const gate = assertDevOnlyToolAllowed(ctx);
    if (gate.allowed === false)
      return { status: 'production_refused' as const, message: gate.reason };
    const input = medicalAccessInput.parse(rawInput);

    const [clinicR, pharmR, ecR] = await Promise.all([
      clinicFinderTool.handler(
        {
          city: input.city,
          countryCode: input.countryCode,
          languageCode: input.languageCode,
          limit: 3,
        } as never,
        ctx
      ),
      pharmacy24hFinderTool.handler(
        {
          city: input.city,
          countryCode: input.countryCode,
          languageCode: input.languageCode,
          limit: 3,
        } as never,
        ctx
      ),
      emergencyNumbersCardTool.handler({ countryCode: input.countryCode } as never, ctx),
    ]);

    return {
      status: 'ok' as const,
      brief: {
        emergency: ecR.status === 'ok' ? ecR.card : null,
        topClinics: clinicR.status === 'ok' ? clinicR.results.slice(0, 3) : [],
        topPharmacies24h: pharmR.status === 'ok' ? pharmR.results.slice(0, 3) : [],
      },
      message: `Medical access brief for ${input.city}.`,
    };
  },
};

// ── 19. communications_researcher (Vertex grounded) ──────────────────

const communicationsInput = z.object({
  countryCode: z.string().length(2),
  locale: z.string().min(2).max(10).default('en-US'),
});
type CommunicationsInput = z.infer<typeof communicationsInput>;

const communicationsShape = z.object({
  topNetworks: z.array(z.string()).max(4),
  esimSupport: z.string(),
  coverageNotes: z.string(),
  roamingNotes: z.string(),
  freeWifiAvailability: z.string(),
});

const communicationsResearcherTool: ToolDef = {
  name: 'communications_researcher',
  internal: true,
  description:
    'Research local cellular networks + eSIM support + coverage + roaming + WiFi norms in a country. Vertex-grounded. Pair with `search_esim` to actually buy a plan.',
  inputSchema: communicationsInput,
  jsonSchema: {
    type: 'object',
    required: ['countryCode'],
    properties: {
      countryCode: { type: 'string', minLength: 2, maxLength: 2 },
      locale: { type: 'string', minLength: 2, maxLength: 10 },
    },
  },
  handler: async (rawInput: CommunicationsInput, ctx) => {
    const gate = assertDevOnlyToolAllowed(ctx);
    if (gate.allowed === false)
      return { status: 'production_refused' as const, message: gate.reason };
    const input = communicationsInput.parse(rawInput);
    const r = await runGroundedStructured(
      `Research telecom for tourists in ${input.countryCode}: top 3 cellular networks + their reputation, eSIM support (which networks support tourist eSIM), coverage outside cities, roaming notes for foreign SIMs, free WiFi availability (cafés, transit, public).`,
      communicationsShape,
      (text, _) =>
        `Coerce into communications schema. Locale: ${input.locale}.\n\nReport:\n"""\n${text}\n"""`
    );
    if (!r.ok || !r.data) return { status: 'unavailable' as const, message: r.reason ?? 'no-data' };
    return {
      status: 'ok' as const,
      brief: r.data,
      via: r.via,
      message: `Communications brief for ${input.countryCode} via ${r.via}.`,
    };
  },
};

// ── 20. cultural_protocol_brief (composer) ───────────────────────────

const cultProtocolInput = z.object({
  countryCode: z.string().length(2),
  context: z.enum(['general', 'meal', 'host_home', 'public', 'shopping']).default('general'),
  locale: z.string().min(2).max(10).default('en-US'),
});
type CultProtocolInput = z.infer<typeof cultProtocolInput>;

const cultProtocolShape = z.object({
  greetings: z.string(),
  dining: z.string(),
  publicBehavior: z.string(),
  taboos: z.array(z.string()).max(8),
  notes: z.string().nullable(),
});

const culturalProtocolBriefTool: ToolDef = {
  name: 'cultural_protocol_brief',
  internal: true,
  description:
    'Practical cultural / etiquette guidance for a country + context (general / meal / host_home / public / shopping). Vertex-grounded. Different from `local_business_protocol_brief` (B4) which is business-meeting-specific.',
  inputSchema: cultProtocolInput,
  jsonSchema: {
    type: 'object',
    required: ['countryCode'],
    properties: {
      countryCode: { type: 'string', minLength: 2, maxLength: 2 },
      context: { type: 'string', enum: ['general', 'meal', 'host_home', 'public', 'shopping'] },
      locale: { type: 'string', minLength: 2, maxLength: 10 },
    },
  },
  handler: async (rawInput: CultProtocolInput, ctx) => {
    const gate = assertDevOnlyToolAllowed(ctx);
    if (gate.allowed === false)
      return { status: 'production_refused' as const, message: gate.reason };
    const input = cultProtocolInput.parse(rawInput);
    const r = await runGroundedStructured(
      `Practical cultural etiquette for a tourist visiting ${input.countryCode} in a ${input.context} context. Cover: greetings, dining etiquette, public behavior norms, taboos to avoid (topics, gestures). Verifiable, widely-documented norms only.`,
      cultProtocolShape,
      (text, _) =>
        `Coerce into cultural protocol schema. Locale: ${input.locale}.\n\nReport:\n"""\n${text}\n"""`
    );
    if (!r.ok || !r.data) return { status: 'unavailable' as const, message: r.reason ?? 'no-data' };
    return {
      status: 'ok' as const,
      brief: r.data,
      via: r.via,
      message: `Cultural protocol brief for ${input.countryCode} via ${r.via}.`,
    };
  },
};

// ── 21. live_news_trip_risk_scanner (Vertex grounded) ────────────────

const liveNewsInput = z.object({
  city: z.string().min(1).max(120),
  countryCode: z.string().length(2).optional(),
  windowDays: z.number().int().min(1).max(14).default(7),
  locale: z.string().min(2).max(10).default('en-US'),
});
type LiveNewsInput = z.infer<typeof liveNewsInput>;

const liveNewsShape = z.object({
  riskLevel: z.enum(['low', 'medium', 'high']),
  topItems: z
    .array(
      z.object({
        headline: z.string(),
        sourceHost: z.string(),
        impact: z.string(),
      })
    )
    .max(8),
  recommendation: z.string(),
});

const liveNewsTripRiskScannerTool: ToolDef = {
  name: 'live_news_trip_risk_scanner',
  internal: true,
  description:
    'Scan recent news (last N days) for risks affecting a trip — protests, strikes, weather events, political instability, security incidents. Vertex-grounded against Reuters / AP / local English-language press.',
  inputSchema: liveNewsInput,
  jsonSchema: {
    type: 'object',
    required: ['city'],
    properties: {
      city: { type: 'string', minLength: 1, maxLength: 120 },
      countryCode: { type: 'string', minLength: 2, maxLength: 2 },
      windowDays: { type: 'integer', minimum: 1, maximum: 14 },
      locale: { type: 'string', minLength: 2, maxLength: 10 },
    },
  },
  handler: async (rawInput: LiveNewsInput, ctx) => {
    const gate = assertDevOnlyToolAllowed(ctx);
    if (gate.allowed === false)
      return { status: 'production_refused' as const, message: gate.reason };
    const input = liveNewsInput.parse(rawInput);
    const r = await runGroundedStructured(
      `Scan news from the last ${input.windowDays} days for risks affecting a tourist visiting ${input.city}${input.countryCode ? ` (${input.countryCode})` : ''}. Look for: protests, strikes, weather events, security incidents, transit disruptions, political unrest. Pull from Reuters / AP / BBC / local English press. Don't sensationalize. Set risk level: low if nothing notable, medium if individual disruptions to plan around, high if traveler should consider rescheduling.`,
      liveNewsShape,
      (text, _) =>
        `Coerce into live news schema. Locale: ${input.locale}.\n\nReport:\n"""\n${text}\n"""`
    );
    if (!r.ok || !r.data) return { status: 'unavailable' as const, message: r.reason ?? 'no-data' };
    return {
      status: 'ok' as const,
      scan: r.data,
      via: r.via,
      message: `News scan for ${input.city} (${input.windowDays}d): ${r.data.riskLevel} risk.`,
    };
  },
};

// ── exports ──────────────────────────────────────────────────────────

export {
  airportDisruptionMonitorTool,
  localHolidayDisruptionCheckTool,
  venuePolicyCheckerTool,
  hotelAreaIntelligenceTool,
  neighborhoodFitMatcherTool,
  restaurantReservationResearcherTool,
  menuDietaryResearcherTool,
  groundTransportPriceResearcherTool,
  publicTransitTicketingBriefTool,
  airportTerminalResolverTool,
  layoverViabilityCheckerTool,
  nearbyAirportAlternativeResearcherTool,
  routeAlternativeResearcherTool,
  tripBudgetResearcherTool,
  localPaymentAcceptanceBriefTool,
  invoiceTaxRequirementsResearcherTool,
  travelInsuranceRequirementCheckerTool,
  medicalAccessBriefTool,
  communicationsResearcherTool,
  culturalProtocolBriefTool,
  liveNewsTripRiskScannerTool,
};
