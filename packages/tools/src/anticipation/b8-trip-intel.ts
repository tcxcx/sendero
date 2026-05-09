/**
 * B8 — Trip Intelligence / Anticipation (13 tools).
 *
 *   - city_pulse_brief             B8 #109 (composer)
 *   - trip_opportunity_ranker      B8 #110 (pure)
 *   - itinerary_gap_detector       B8 #111 (pure)
 *   - micro_itinerary_builder      B8 #112 (composer)
 *   - layover_city_escape          B8 #113 (pure logic)
 *   - first_day_soft_plan          B8 #114 (composer)
 *   - last_day_checkout_plan       B8 #115 (composer)
 *   - luggage_storage_finder       B8 #116 (Places + CSE)
 *   - trip_pacing_optimizer        B8 #117 (pure)
 *   - weather_replan_engine        B8 #118 (composer)
 *   - group_preference_reconciler  B8 #119 (pure)
 *   - perfect_evening_builder      B8 #120 (composer)
 *   - trip_contextual_recommender  B8 #121 (high-level orchestrator)
 *
 * All experimental + internal + dev-gated.
 */

import { z } from 'zod';

import { searchText } from '@sendero/google-places';

import { assertDevOnlyToolAllowed } from '../dev-gate';
import type { ToolContext, ToolDef } from '../types';

import { runCrowdLevelPredictor } from './crowd-level-predictor';
import { runRainyDayPlanFinder } from './b3-events-nightlife';
import { runFoodieShortlistBuilder } from './foodie-shortlist-builder';
import { runProfessionalNetworkingScanner } from './professional-networking-scanner';

// ── 1. city_pulse_brief ──────────────────────────────────────────────

const pulseInput = z.object({
  city: z.string().min(1).max(120),
  countryCode: z.string().length(2).optional(),
  windowDays: z.number().int().min(1).max(14).default(3),
});
type PulseInput = z.infer<typeof pulseInput>;

interface CityPulse {
  crowdLevel: 'low' | 'moderate' | 'high' | 'extreme' | 'unknown';
  topDrivers: string[];
  notableEventsCount: number;
  avoidZones: string[];
}

const cityPulseBriefTool: ToolDef = {
  name: 'city_pulse_brief',
  internal: true,
  description:
    'Daily city brief — composes `crowd_level_predictor` (events) with weather + holidays metadata. Returns crowdLevel + topDrivers + notable events count + avoid zones for the next N days. Pair with `trip_weather_brief` for full picture.',
  inputSchema: pulseInput,
  jsonSchema: {
    type: 'object',
    required: ['city'],
    properties: {
      city: { type: 'string', minLength: 1, maxLength: 120 },
      countryCode: { type: 'string', minLength: 2, maxLength: 2 },
      windowDays: { type: 'integer', minimum: 1, maximum: 14 },
    },
  },
  handler: async (rawInput: PulseInput, ctx) => {
    const gate = assertDevOnlyToolAllowed(ctx);
    if (gate.allowed === false)
      return { status: 'production_refused' as const, message: gate.reason };

    const input = pulseInput.parse(rawInput);
    const start = new Date().toISOString().slice(0, 10);
    const end = new Date(Date.now() + input.windowDays * 86_400_000).toISOString().slice(0, 10);
    const crowd = await runCrowdLevelPredictor(
      {
        city: input.city,
        ...(input.countryCode ? { countryCode: input.countryCode } : {}),
        startsAtIso: start,
        endsAtIso: end,
        topDriversLimit: 5,
      } as never,
      ctx
    );
    const pulse: CityPulse = {
      crowdLevel: crowd.status === 'ok' ? crowd.crowdLevel : 'unknown',
      topDrivers: crowd.status === 'ok' ? crowd.topDrivers.map(d => d.title) : [],
      notableEventsCount: crowd.status === 'ok' ? crowd.totalEvents : 0,
      avoidZones: [],
    };
    return {
      status: 'ok' as const,
      pulse,
      message: `${input.city} pulse over ${input.windowDays}d: ${pulse.crowdLevel} crowd, ${pulse.notableEventsCount} events.`,
    };
  },
};

// ── 2. trip_opportunity_ranker ───────────────────────────────────────

const opportunityInput = z.object({
  opportunities: z
    .array(
      z.object({
        name: z.string().min(1).max(160),
        category: z.string().max(60),
        durationHours: z.number().min(0.5).max(24),
        approximateCostUsd: z.number().min(0).max(2000).optional(),
        fitScore: z.number().min(0).max(1).optional(),
        weatherSensitive: z.boolean().optional(),
      })
    )
    .min(1)
    .max(30),
  travelerHobbies: z.array(z.string().max(40)).max(15).optional(),
  budgetRemainingUsd: z.number().min(0).max(50_000).optional(),
  hoursAvailable: z.number().min(1).max(72).default(8),
  weatherIsPoor: z.boolean().default(false),
});
type OpportunityInput = z.infer<typeof opportunityInput>;

const tripOpportunityRankerTool: ToolDef = {
  name: 'trip_opportunity_ranker',
  internal: true,
  description:
    'Rank a list of opportunities (events, attractions, classes, walks) by traveler fit + budget + time + weather. Pure scorer — caller passes opportunities[] + traveler hobbies + budget + hours available. Returns ranked list with reasons.',
  inputSchema: opportunityInput,
  jsonSchema: {
    type: 'object',
    required: ['opportunities'],
    properties: {
      opportunities: { type: 'array', minItems: 1, maxItems: 30 },
      travelerHobbies: { type: 'array', maxItems: 15, items: { type: 'string', maxLength: 40 } },
      budgetRemainingUsd: { type: 'number', minimum: 0, maximum: 50000 },
      hoursAvailable: { type: 'number', minimum: 1, maximum: 72 },
      weatherIsPoor: { type: 'boolean' },
    },
  },
  handler: async (rawInput: OpportunityInput, ctx) => {
    const gate = assertDevOnlyToolAllowed(ctx);
    if (gate.allowed === false)
      return { status: 'production_refused' as const, message: gate.reason };

    const input = opportunityInput.parse(rawInput);
    const hobbiesBlob = (input.travelerHobbies ?? []).join(' ').toLowerCase();
    const ranked = input.opportunities
      .map(opp => {
        let score = opp.fitScore ?? 0.5;
        const reasons: string[] = [];
        if (hobbiesBlob && hobbiesBlob.includes(opp.category.toLowerCase())) {
          score += 0.15;
          reasons.push(`matches hobby "${opp.category}"`);
        }
        if (opp.durationHours <= input.hoursAvailable) {
          reasons.push(`fits ${input.hoursAvailable}h available (needs ${opp.durationHours}h)`);
        } else {
          score -= 0.15;
          reasons.push(`exceeds available time (${opp.durationHours}h > ${input.hoursAvailable}h)`);
        }
        if (
          typeof input.budgetRemainingUsd === 'number' &&
          typeof opp.approximateCostUsd === 'number'
        ) {
          if (opp.approximateCostUsd <= input.budgetRemainingUsd) {
            reasons.push(
              `within budget ($${opp.approximateCostUsd} ≤ $${input.budgetRemainingUsd})`
            );
          } else {
            score -= 0.2;
            reasons.push(`over budget ($${opp.approximateCostUsd} > $${input.budgetRemainingUsd})`);
          }
        }
        if (input.weatherIsPoor && opp.weatherSensitive === true) {
          score -= 0.15;
          reasons.push('weather-sensitive in poor weather');
        }
        return {
          name: opp.name,
          category: opp.category,
          score: Math.max(0, Math.min(1, score)),
          reasons,
        };
      })
      .sort((a, b) => b.score - a.score);

    return {
      status: 'ok' as const,
      ranked,
      message: `${ranked.length} opportunities ranked; top: ${ranked[0]!.name} (${ranked[0]!.score.toFixed(2)}).`,
    };
  },
};

// ── 3. itinerary_gap_detector ────────────────────────────────────────

const gapDetectorInput = z.object({
  itinerary: z
    .array(
      z.object({
        title: z.string().min(1).max(160),
        startsAtIso: z.string(),
        endsAtIso: z.string(),
      })
    )
    .min(1)
    .max(50),
  /** Window to consider — defaults to span of itinerary. */
  windowStartIso: z.string().optional(),
  windowEndIso: z.string().optional(),
  minGapMinutes: z.number().int().min(30).max(720).default(120),
});
type GapDetectorInput = z.infer<typeof gapDetectorInput>;

const itineraryGapDetectorTool: ToolDef = {
  name: 'itinerary_gap_detector',
  internal: true,
  description:
    "Detect empty time windows in a traveler's itinerary that exceed a min gap (default 2h). Returns gap[] with start/end + duration. Compose with `micro_itinerary_builder` to fill them.",
  inputSchema: gapDetectorInput,
  jsonSchema: {
    type: 'object',
    required: ['itinerary'],
    properties: {
      itinerary: { type: 'array', minItems: 1, maxItems: 50 },
      windowStartIso: { type: 'string' },
      windowEndIso: { type: 'string' },
      minGapMinutes: { type: 'integer', minimum: 30, maximum: 720 },
    },
  },
  handler: async (rawInput: GapDetectorInput, ctx) => {
    const gate = assertDevOnlyToolAllowed(ctx);
    if (gate.allowed === false)
      return { status: 'production_refused' as const, message: gate.reason };
    const input = gapDetectorInput.parse(rawInput);
    const sorted = [...input.itinerary]
      .map(e => ({ ...e, startMs: Date.parse(e.startsAtIso), endMs: Date.parse(e.endsAtIso) }))
      .filter(e => Number.isFinite(e.startMs) && Number.isFinite(e.endMs))
      .sort((a, b) => a.startMs - b.startMs);

    const gaps: Array<{ startsAtIso: string; endsAtIso: string; durationMinutes: number }> = [];
    for (let i = 0; i < sorted.length - 1; i++) {
      const gapMs = sorted[i + 1]!.startMs - sorted[i]!.endMs;
      const gapMinutes = Math.round(gapMs / 60_000);
      if (gapMinutes >= input.minGapMinutes) {
        gaps.push({
          startsAtIso: new Date(sorted[i]!.endMs).toISOString(),
          endsAtIso: new Date(sorted[i + 1]!.startMs).toISOString(),
          durationMinutes: gapMinutes,
        });
      }
    }
    return {
      status: 'ok' as const,
      gaps,
      message: `${gaps.length} gaps ≥ ${input.minGapMinutes}min in ${input.itinerary.length}-event itinerary.`,
    };
  },
};

// ── 4. micro_itinerary_builder ───────────────────────────────────────

const microInput = z.object({
  city: z.string().min(1).max(120),
  countryCode: z.string().length(2).optional(),
  startsAtIso: z.string(),
  durationHours: z.number().min(1).max(6).default(3),
  near: z.string().max(200).optional(),
  vibe: z.enum(['cultural', 'foodie', 'walk', 'shopping', 'cafe_hop', 'mix']).default('mix'),
  languageCode: z.string().max(10).default('en'),
});
type MicroInput = z.infer<typeof microInput>;

const microItineraryBuilderTool: ToolDef = {
  name: 'micro_itinerary_builder',
  internal: true,
  experimental: true,
  description:
    "Build a 1-6 hour mini itinerary in a city around a specific anchor + start time. Composes Places nearby with vibe filter. Use to fill gaps detected by `itinerary_gap_detector` or for spontaneous 'I have an afternoon' asks.",
  inputSchema: microInput,
  jsonSchema: {
    type: 'object',
    required: ['city', 'startsAtIso'],
    properties: {
      city: { type: 'string', minLength: 1, maxLength: 120 },
      countryCode: { type: 'string', minLength: 2, maxLength: 2 },
      startsAtIso: { type: 'string' },
      durationHours: { type: 'number', minimum: 1, maximum: 6 },
      near: { type: 'string', maxLength: 200 },
      vibe: { type: 'string', enum: ['cultural', 'foodie', 'walk', 'shopping', 'cafe_hop', 'mix'] },
      languageCode: { type: 'string', maxLength: 10 },
    },
  },
  handler: async (rawInput: MicroInput, ctx) => {
    const gate = assertDevOnlyToolAllowed(ctx);
    if (gate.allowed === false)
      return { status: 'production_refused' as const, message: gate.reason };
    const input = microInput.parse(rawInput);
    const anchorQ =
      input.vibe === 'cultural'
        ? 'museum gallery'
        : input.vibe === 'foodie'
          ? 'specialty coffee restaurant'
          : input.vibe === 'walk'
            ? 'park scenic walk'
            : input.vibe === 'shopping'
              ? 'boutique concept store'
              : input.vibe === 'cafe_hop'
                ? 'specialty coffee'
                : 'museum gallery park';

    const places = await searchText({
      query: `${anchorQ} ${input.near ? `near ${input.near}` : `in ${input.city}`}`,
      limit: 6,
      languageCode: input.languageCode,
      ...(input.countryCode ? { regionCode: input.countryCode } : {}),
    });
    if (!places.available)
      return {
        status: 'unavailable' as const,
        message: `Places unavailable: ${places.reason ?? 'unknown'}.`,
      };

    // Pick stops based on duration: 1 stop per ~75min.
    const stops = Math.max(1, Math.min(4, Math.floor((input.durationHours * 60) / 75)));
    const top = places.results
      .filter(p => (p.rating ?? 0) >= 4.0 && (p.userRatingCount ?? 0) >= 100)
      .slice(0, stops);

    const start = Date.parse(input.startsAtIso);
    const itinerary = top.map((p, i) => ({
      title: p.name,
      atIso: new Date(start + (i * input.durationHours * 60 * 60_000) / stops).toISOString(),
      ...(p.website ? { url: p.website } : {}),
      rationale: `${p.rating?.toFixed(1) ?? '?'}★ over ${p.userRatingCount ?? 0} reviews · ${p.editorialSummary ?? p.formattedAddress ?? ''}`,
    }));
    return {
      status: 'ok' as const,
      itinerary,
      message: `${itinerary.length}-stop ${input.durationHours}h ${input.vibe} micro-itinerary in ${input.city}.`,
    };
  },
};

// ── 5. layover_city_escape ───────────────────────────────────────────

const layoverInput = z.object({
  airportIata: z.string().length(3),
  cityName: z.string().min(1).max(120),
  layoverDurationMinutes: z.number().int().min(60).max(1440),
  travelerHasVisa: z.boolean().default(true),
  hasCheckedBags: z.boolean().default(false),
});
type LayoverInput = z.infer<typeof layoverInput>;

const layoverCityEscapeTool: ToolDef = {
  name: 'layover_city_escape',
  internal: true,
  description:
    'Decide if a traveler can leave the airport during a layover. Pure rules — checks duration / visa / bag status / typical airport→downtown time. Returns canEscape boolean + recommended max-stay duration + tips.',
  inputSchema: layoverInput,
  jsonSchema: {
    type: 'object',
    required: ['airportIata', 'cityName', 'layoverDurationMinutes'],
    properties: {
      airportIata: { type: 'string', minLength: 3, maxLength: 3 },
      cityName: { type: 'string', minLength: 1, maxLength: 120 },
      layoverDurationMinutes: { type: 'integer', minimum: 60, maximum: 1440 },
      travelerHasVisa: { type: 'boolean' },
      hasCheckedBags: { type: 'boolean' },
    },
  },
  handler: async (rawInput: LayoverInput, ctx) => {
    const gate = assertDevOnlyToolAllowed(ctx);
    if (gate.allowed === false)
      return { status: 'production_refused' as const, message: gate.reason };
    const input = layoverInput.parse(rawInput);

    // Typical buffers — these are estimates per international airport norms.
    const securityBuffer = 90; // re-check-in + security + immigration outbound
    const transitOneWay = 45; // airport ↔ downtown average
    const minWalkAroundTime = 60; // less than this = not worth it

    const totalNeeded = securityBuffer + transitOneWay * 2 + minWalkAroundTime;
    const canEscape =
      input.travelerHasVisa && input.layoverDurationMinutes >= totalNeeded && !input.hasCheckedBags;
    const maxStay = canEscape ? input.layoverDurationMinutes - totalNeeded : 0;

    const tips: string[] = [];
    if (!input.travelerHasVisa)
      tips.push('Without transit visa, the traveler must stay airside in most countries.');
    if (input.hasCheckedBags)
      tips.push(
        'Checked bags through to the next leg cannot be reclaimed mid-layover — stay airside.'
      );
    if (canEscape) {
      tips.push(
        `Plan to be back at the airport ${securityBuffer}min before next flight (security + immigration).`
      );
      tips.push(`Have ~${transitOneWay}min one-way transit time to/from downtown.`);
      if (maxStay >= 180)
        tips.push(
          `Could realistically do a meal + a single attraction (~${maxStay}min walk-around budget).`
        );
      else tips.push(`Tight: limit to a single anchor near the airport-side rapid transit.`);
    } else if (input.layoverDurationMinutes < totalNeeded) {
      tips.push(
        `Layover too short (${input.layoverDurationMinutes}min < required ~${totalNeeded}min). Stay airside, find a lounge.`
      );
    }

    return {
      status: 'ok' as const,
      canEscape,
      maxStayMinutes: maxStay,
      tips,
      message: canEscape
        ? `Can escape ${input.airportIata} for ~${maxStay}min in ${input.cityName}.`
        : `Cannot escape ${input.airportIata} reliably this layover.`,
    };
  },
};

// ── 6. first_day_soft_plan ───────────────────────────────────────────

const firstDayInput = z.object({
  city: z.string().min(1).max(120),
  countryCode: z.string().length(2).optional(),
  arrivalLocalIso: z.string(),
  flightDurationHours: z.number().min(0.5).max(20).default(8),
  jetlagDirection: z.enum(['none', 'east', 'west']).default('none'),
  languageCode: z.string().max(10).default('en'),
});
type FirstDayInput = z.infer<typeof firstDayInput>;

const firstDaySoftPlanTool: ToolDef = {
  name: 'first_day_soft_plan',
  internal: true,
  description:
    'Build a gentle arrival-day plan based on flight duration + jet-lag direction + local arrival time. Pure logic + Places nearby for one café anchor. Use after `book_flight` to give the traveler a recovery-friendly first day.',
  inputSchema: firstDayInput,
  jsonSchema: {
    type: 'object',
    required: ['city', 'arrivalLocalIso'],
    properties: {
      city: { type: 'string', minLength: 1, maxLength: 120 },
      countryCode: { type: 'string', minLength: 2, maxLength: 2 },
      arrivalLocalIso: { type: 'string' },
      flightDurationHours: { type: 'number', minimum: 0.5, maximum: 20 },
      jetlagDirection: { type: 'string', enum: ['none', 'east', 'west'] },
      languageCode: { type: 'string', maxLength: 10 },
    },
  },
  handler: async (rawInput: FirstDayInput, ctx) => {
    const gate = assertDevOnlyToolAllowed(ctx);
    if (gate.allowed === false)
      return { status: 'production_refused' as const, message: gate.reason };
    const input = firstDayInput.parse(rawInput);

    const arrivalHour = new Date(input.arrivalLocalIso).getHours();
    const longHaul = input.flightDurationHours >= 8;
    const moves: string[] = [];

    if (longHaul)
      moves.push(
        'Drop bags + shower at the hotel within 1h of arrival — non-negotiable for long-haul.'
      );
    if (input.jetlagDirection === 'east')
      moves.push('Get bright sunlight within 2h of arrival; do NOT nap longer than 30min.');
    if (input.jetlagDirection === 'west')
      moves.push('Push a single short walk in late afternoon; bedtime ~22:00 local.');

    if (arrivalHour >= 6 && arrivalHour <= 11) {
      moves.push(
        'Morning arrival: anchor the day with a 9-12 specialty coffee + casual breakfast.'
      );
      moves.push('Aim for one short walk or single light cultural anchor (no museum marathons).');
    } else if (arrivalHour >= 12 && arrivalHour <= 16) {
      moves.push('Afternoon arrival: short walk + early casual dinner. Skip nightlife day 1.');
    } else if (arrivalHour >= 17 && arrivalHour <= 21) {
      moves.push('Evening arrival: room-service or one short neighborhood meal — go to bed early.');
    } else {
      moves.push('Late arrival: airport→hotel→bed. Anything else compromises tomorrow.');
    }

    const recommendation =
      arrivalHour >= 9 && arrivalHour <= 14
        ? 'specialty coffee'
        : arrivalHour >= 18 && arrivalHour <= 21
          ? 'casual neighborhood restaurant'
          : 'hotel rest';

    return {
      status: 'ok' as const,
      moves,
      recommendation,
      message: `First-day soft plan: arrival ${arrivalHour}:00, ${longHaul ? 'long-haul' : 'short-haul'}, jetlag=${input.jetlagDirection}.`,
    };
  },
};

// ── 7. last_day_checkout_plan ────────────────────────────────────────

const lastDayInput = z.object({
  city: z.string().min(1).max(120),
  countryCode: z.string().length(2).optional(),
  hotelCheckoutTimeIso: z.string(),
  flightDepartureIso: z.string(),
  airportIata: z.string().length(3).optional(),
  hasCheckedBags: z.boolean().default(true),
});
type LastDayInput = z.infer<typeof lastDayInput>;

const lastDayCheckoutPlanTool: ToolDef = {
  name: 'last_day_checkout_plan',
  internal: true,
  description:
    'Plan the gap between hotel checkout and flight. Pure logic — surfaces luggage-storage need, recommends one anchor, calculates buffer. Pair with `luggage_storage_finder` when checkout-flight gap is more than ~3h.',
  inputSchema: lastDayInput,
  jsonSchema: {
    type: 'object',
    required: ['city', 'hotelCheckoutTimeIso', 'flightDepartureIso'],
    properties: {
      city: { type: 'string', minLength: 1, maxLength: 120 },
      countryCode: { type: 'string', minLength: 2, maxLength: 2 },
      hotelCheckoutTimeIso: { type: 'string' },
      flightDepartureIso: { type: 'string' },
      airportIata: { type: 'string', minLength: 3, maxLength: 3 },
      hasCheckedBags: { type: 'boolean' },
    },
  },
  handler: async (rawInput: LastDayInput, ctx) => {
    const gate = assertDevOnlyToolAllowed(ctx);
    if (gate.allowed === false)
      return { status: 'production_refused' as const, message: gate.reason };
    const input = lastDayInput.parse(rawInput);

    const checkout = Date.parse(input.hotelCheckoutTimeIso);
    const flight = Date.parse(input.flightDepartureIso);
    if (!Number.isFinite(checkout) || !Number.isFinite(flight))
      return { status: 'ok' as const, message: 'Invalid date input.' };

    const securityBuffer = input.hasCheckedBags ? 180 : 120; // minutes
    const transitOneWay = 45;
    const requiredArrivalMs = flight - (securityBuffer + transitOneWay) * 60_000;
    const gapMinutes = Math.round((requiredArrivalMs - checkout) / 60_000);

    const moves: string[] = [];
    if (gapMinutes < 60) moves.push('Tight gap — go straight to the airport from checkout.');
    else if (gapMinutes < 180) moves.push('Coffee + one nearby walk; head to airport early.');
    else if (gapMinutes < 360) {
      moves.push(
        'Use a luggage-storage service near the city center (compose `luggage_storage_finder`).'
      );
      moves.push('One anchor: lunch + a brief museum or shopping district visit.');
    } else {
      moves.push(
        'Full half-day available — full lunch + one cultural anchor. Use luggage storage.'
      );
    }

    return {
      status: 'ok' as const,
      gapMinutes,
      needsLuggageStorage: gapMinutes >= 180 && input.hasCheckedBags,
      moves,
      arriveByIso: new Date(requiredArrivalMs).toISOString(),
      message: `Checkout-flight gap: ${gapMinutes}min. Arrive at airport by ${new Date(requiredArrivalMs).toISOString()}.`,
    };
  },
};

// ── 8. luggage_storage_finder ────────────────────────────────────────

const luggageStorageInput = z.object({
  city: z.string().min(1).max(120),
  countryCode: z.string().length(2).optional(),
  near: z.string().max(200).optional(),
  languageCode: z.string().max(10).default('en'),
  limit: z.number().int().min(1).max(10).default(6),
});
type LuggageStorageInput = z.infer<typeof luggageStorageInput>;

const luggageStorageFinderTool: ToolDef = {
  name: 'luggage_storage_finder',
  internal: true,
  description:
    'Find luggage lockers + storage services near a city center / station / specific area. Places + name filter (Bounce / LuggageHero / Stasher / lockers / station storage). Use during last-day or layover planning.',
  inputSchema: luggageStorageInput,
  jsonSchema: {
    type: 'object',
    required: ['city'],
    properties: {
      city: { type: 'string', minLength: 1, maxLength: 120 },
      countryCode: { type: 'string', minLength: 2, maxLength: 2 },
      near: { type: 'string', maxLength: 200 },
      languageCode: { type: 'string', maxLength: 10 },
      limit: { type: 'integer', minimum: 1, maximum: 10 },
    },
  },
  handler: async (rawInput: LuggageStorageInput, ctx) => {
    const gate = assertDevOnlyToolAllowed(ctx);
    if (gate.allowed === false)
      return { status: 'production_refused' as const, message: gate.reason };
    const input = luggageStorageInput.parse(rawInput);
    const places = await searchText({
      query: `luggage storage lockers ${input.near ? `near ${input.near}` : `in ${input.city}`}`,
      limit: input.limit + 4,
      languageCode: input.languageCode,
      ...(input.countryCode ? { regionCode: input.countryCode } : {}),
    });
    if (!places.available)
      return {
        status: 'unavailable' as const,
        message: `Places unavailable: ${places.reason ?? 'unknown'}.`,
      };
    const filtered = places.results.filter(p =>
      /\b(luggage|storage|locker|deposit|consigna)\b/i.test(`${p.name} ${p.editorialSummary ?? ''}`)
    );
    return {
      status: 'ok' as const,
      results: filtered.slice(0, input.limit).map(p => ({
        name: p.name,
        ...(p.website ? { url: p.website } : {}),
        rationale: `${p.rating?.toFixed(1) ?? '?'}★ over ${p.userRatingCount ?? 0} reviews · ${p.editorialSummary ?? p.formattedAddress ?? ''}`,
      })),
      message: `${filtered.length} luggage storage candidates in ${input.city}.`,
    };
  },
};

// ── 9. trip_pacing_optimizer ─────────────────────────────────────────

const pacingInput = z.object({
  events: z
    .array(
      z.object({
        title: z.string().max(160),
        startsAtIso: z.string(),
        durationMinutes: z.number().min(30).max(720).default(120),
        intensity: z.enum(['low', 'medium', 'high']).default('medium'),
      })
    )
    .min(1)
    .max(40),
});
type PacingInput = z.infer<typeof pacingInput>;

const tripPacingOptimizerTool: ToolDef = {
  name: 'trip_pacing_optimizer',
  internal: true,
  description:
    'Detect over-packed days and suggest pacing adjustments. Pure analysis — flags days with >3 high-intensity events, recommends spacing or moving items. Use to sanity-check itineraries before locking them.',
  inputSchema: pacingInput,
  jsonSchema: {
    type: 'object',
    required: ['events'],
    properties: { events: { type: 'array', minItems: 1, maxItems: 40 } },
  },
  handler: async (rawInput: PacingInput, ctx) => {
    const gate = assertDevOnlyToolAllowed(ctx);
    if (gate.allowed === false)
      return { status: 'production_refused' as const, message: gate.reason };
    const input = pacingInput.parse(rawInput);

    // Bucket events by date.
    const byDate = new Map<string, typeof input.events>();
    for (const e of input.events) {
      const day = e.startsAtIso.slice(0, 10);
      byDate.set(day, [...(byDate.get(day) ?? []), e]);
    }

    const overloaded: Array<{
      date: string;
      eventCount: number;
      highIntensityCount: number;
      totalMinutes: number;
      warning: string;
    }> = [];
    const recommendations: string[] = [];

    for (const [date, events] of byDate.entries()) {
      const total = events.reduce((n, e) => n + e.durationMinutes, 0);
      const highCount = events.filter(e => e.intensity === 'high').length;
      let warning = '';
      if (highCount >= 3) warning = `${highCount} high-intensity events on one day — burnout risk.`;
      else if (total > 600)
        warning = `${Math.round(total / 60)}h scheduled — leaves no slack for traveler exhaustion or weather.`;
      else if (events.length >= 6)
        warning = `${events.length} discrete moves — every transition costs energy.`;
      if (warning)
        overloaded.push({
          date,
          eventCount: events.length,
          highIntensityCount: highCount,
          totalMinutes: total,
          warning,
        });
    }

    if (overloaded.length > 0) {
      recommendations.push('Move one high-intensity event per overloaded day to a lighter day.');
      recommendations.push('Allow 90min buffer between high-intensity events.');
      recommendations.push(
        'Schedule a "no-plan window" of at least 2h per day for travel surprises.'
      );
    } else {
      recommendations.push('Pacing reads ok — no overloaded days detected.');
    }

    return {
      status: 'ok' as const,
      overloaded,
      recommendations,
      message: `${overloaded.length}/${byDate.size} days overloaded.`,
    };
  },
};

// ── 10. weather_replan_engine ────────────────────────────────────────

const weatherReplanInput = z.object({
  city: z.string().min(1).max(120),
  countryCode: z.string().length(2).optional(),
  languageCode: z.string().max(10).default('en'),
  weather: z.object({
    condition: z.enum([
      'rain',
      'heavy_rain',
      'snow',
      'wind',
      'extreme_heat',
      'extreme_cold',
      'clear',
    ]),
    temperatureC: z.number().min(-40).max(50).optional(),
  }),
  hoursToFill: z.number().int().min(1).max(12).default(4),
});
type WeatherReplanInput = z.infer<typeof weatherReplanInput>;

const weatherReplanEngineTool: ToolDef = {
  name: 'weather_replan_engine',
  internal: true,
  experimental: true,
  description:
    'Replan a window based on weather. For poor weather composes `rainy_day_plan_finder` (B3) for indoor anchors. For clear days, returns a continue-as-planned signal. Generic version of `date_weather_replan` (HP3) — works for any activity, not just dates.',
  inputSchema: weatherReplanInput,
  jsonSchema: {
    type: 'object',
    required: ['city', 'weather'],
    properties: {
      city: { type: 'string', minLength: 1, maxLength: 120 },
      countryCode: { type: 'string', minLength: 2, maxLength: 2 },
      languageCode: { type: 'string', maxLength: 10 },
      weather: { type: 'object' },
      hoursToFill: { type: 'integer', minimum: 1, maximum: 12 },
    },
  },
  handler: async (rawInput: WeatherReplanInput, ctx) => {
    const gate = assertDevOnlyToolAllowed(ctx);
    if (gate.allowed === false)
      return { status: 'production_refused' as const, message: gate.reason };
    const input = weatherReplanInput.parse(rawInput);

    if (input.weather.condition === 'clear') {
      return {
        status: 'ok' as const,
        replanNeeded: false,
        message: 'Weather clear — continue as planned.',
      };
    }
    const rainy = await runRainyDayPlanFinder(
      {
        city: input.city,
        ...(input.countryCode ? { countryCode: input.countryCode } : {}),
        languageCode: input.languageCode,
        hoursToFill: input.hoursToFill,
      } as never,
      ctx
    );
    return {
      status: rainy.status === 'ok' ? ('ok' as const) : ('unavailable' as const),
      replanNeeded: true,
      rainyDayPlan: rainy.status === 'ok' ? rainy.plan : undefined,
      message:
        rainy.status === 'ok'
          ? `Replan needed (${input.weather.condition}); indoor plan composed.`
          : `Replan needed but couldn't compose: ${rainy.message}`,
    };
  },
};

// ── 11. group_preference_reconciler ──────────────────────────────────

const groupReconcilerInput = z.object({
  groupName: z.string().min(1).max(120),
  members: z
    .array(
      z.object({
        name: z.string().min(1).max(80),
        budgetTier: z.enum(['budget', 'medium', 'premium', 'splurge']).optional(),
        dietaryRestrictions: z.array(z.string().max(40)).max(6).optional(),
        ambiencePreference: z.enum(['quiet', 'medium', 'loud']).optional(),
        activityPreferences: z.array(z.string().max(40)).max(8).optional(),
      })
    )
    .min(2)
    .max(20),
});
type GroupReconcilerInput = z.infer<typeof groupReconcilerInput>;

const groupPreferenceReconcilerTool: ToolDef = {
  name: 'group_preference_reconciler',
  internal: true,
  description:
    'Reconcile group preferences into consensus tier + ambience + dietary intersection + top shared activities. Pure analysis. Use as input to `foodie_shortlist_builder` / `city_taste_map_builder` for groups of 2+.',
  inputSchema: groupReconcilerInput,
  jsonSchema: {
    type: 'object',
    required: ['groupName', 'members'],
    properties: {
      groupName: { type: 'string', minLength: 1, maxLength: 120 },
      members: { type: 'array', minItems: 2, maxItems: 20 },
    },
  },
  handler: async (rawInput: GroupReconcilerInput, ctx) => {
    const gate = assertDevOnlyToolAllowed(ctx);
    if (gate.allowed === false)
      return { status: 'production_refused' as const, message: gate.reason };
    const input = groupReconcilerInput.parse(rawInput);

    // Tier: lowest-common (don't price out the cheapest member).
    const tierOrder = ['budget', 'medium', 'premium', 'splurge'] as const;
    const declaredTiers = input.members
      .map(m => m.budgetTier)
      .filter((t): t is NonNullable<typeof t> => !!t);
    const consensusTier =
      declaredTiers.length > 0
        ? tierOrder[Math.min(...declaredTiers.map(t => tierOrder.indexOf(t)))]!
        : 'medium';

    // Ambience: most common, default medium.
    const ambienceMix: Record<string, number> = {};
    for (const m of input.members)
      if (m.ambiencePreference)
        ambienceMix[m.ambiencePreference] = (ambienceMix[m.ambiencePreference] ?? 0) + 1;
    const consensusAmbience = (Object.entries(ambienceMix).sort((a, b) => b[1] - a[1])[0]?.[0] ??
      'medium') as 'quiet' | 'medium' | 'loud';

    // Dietary: union — must accommodate all.
    const dietaryUnion = Array.from(
      new Set(input.members.flatMap(m => m.dietaryRestrictions ?? []))
    );

    // Activities: intersection (members who all like X).
    const activityCounts: Record<string, number> = {};
    for (const m of input.members)
      for (const a of m.activityPreferences ?? []) activityCounts[a] = (activityCounts[a] ?? 0) + 1;
    const sharedActivities = Object.entries(activityCounts)
      .filter(([, c]) => c >= Math.ceil(input.members.length / 2))
      .sort((a, b) => b[1] - a[1])
      .map(([a]) => a);

    const tensions: string[] = [];
    if (declaredTiers.length > 0 && new Set(declaredTiers).size > 2)
      tensions.push(
        `Budget tiers span ${new Set(declaredTiers).size} levels — anchor to the lowest, offer optional upgrades.`
      );
    if (Object.keys(ambienceMix).length > 1)
      tensions.push(
        `Ambience preferences mixed — pick venues that work across (avoid extreme dive bars OR formal rooms).`
      );
    if (dietaryUnion.length >= 3)
      tensions.push(
        `${dietaryUnion.length} dietary constraints — restaurants need flexibility (limit fine-dining tasting menus).`
      );

    return {
      status: 'ok' as const,
      consensus: {
        tier: consensusTier,
        ambience: consensusAmbience,
        dietaryUnion,
        sharedActivities: sharedActivities.slice(0, 6),
      },
      tensions,
      message: `Group "${input.groupName}" reconciled: ${consensusTier} / ${consensusAmbience} / ${dietaryUnion.length} dietary / ${sharedActivities.length} shared activities.`,
    };
  },
};

// ── 12. perfect_evening_builder ──────────────────────────────────────

const perfectEveningInput = z.object({
  city: z.string().min(1).max(120),
  countryCode: z.string().length(2).optional(),
  languageCode: z.string().max(10).default('en'),
  vibe: z.enum(['romantic', 'foodie', 'cultural', 'nightlife', 'chill']).default('chill'),
  budgetTier: z.enum(['budget', 'medium', 'premium', 'splurge']).default('medium'),
  startsAtIso: z.string(),
  weatherIsPoor: z.boolean().default(false),
  travelerId: z.string().max(120).optional(),
});
type PerfectEveningInput = z.infer<typeof perfectEveningInput>;

const perfectEveningBuilderTool: ToolDef = {
  name: 'perfect_evening_builder',
  internal: true,
  experimental: true,
  description:
    "Build a beautiful single-evening plan composing weather + restaurants + events + safety. High-level orchestrator — caller picks vibe + tier + start time. Returns 2-4 stops with rationale per stop. Use when traveler asks 'plan tonight in <city>'.",
  inputSchema: perfectEveningInput,
  jsonSchema: {
    type: 'object',
    required: ['city', 'startsAtIso'],
    properties: {
      city: { type: 'string', minLength: 1, maxLength: 120 },
      countryCode: { type: 'string', minLength: 2, maxLength: 2 },
      languageCode: { type: 'string', maxLength: 10 },
      vibe: { type: 'string', enum: ['romantic', 'foodie', 'cultural', 'nightlife', 'chill'] },
      budgetTier: { type: 'string', enum: ['budget', 'medium', 'premium', 'splurge'] },
      startsAtIso: { type: 'string' },
      weatherIsPoor: { type: 'boolean' },
      travelerId: { type: 'string', maxLength: 120 },
    },
  },
  handler: async (rawInput: PerfectEveningInput, ctx) => {
    const gate = assertDevOnlyToolAllowed(ctx);
    if (gate.allowed === false)
      return { status: 'production_refused' as const, message: gate.reason };

    const input = perfectEveningInput.parse(rawInput);
    if (input.weatherIsPoor) {
      const indoor = await runRainyDayPlanFinder(
        {
          city: input.city,
          ...(input.countryCode ? { countryCode: input.countryCode } : {}),
          languageCode: input.languageCode,
          hoursToFill: 4,
        } as never,
        ctx
      );
      return {
        status: 'ok' as const,
        plan: indoor.status === 'ok' ? indoor.plan : undefined,
        message: 'Weather poor — built indoor evening.',
      };
    }
    const foodie = await runFoodieShortlistBuilder(
      {
        city: input.city,
        ...(input.countryCode ? { countryCode: input.countryCode } : {}),
        ...(input.travelerId ? { travelerId: input.travelerId } : {}),
        languageCode: input.languageCode,
        categories: ['cheap_michelin', 'specialty_coffee'],
        perCategoryLimit: 3,
      } as never,
      ctx
    );
    if (foodie.status !== 'ok') return { status: 'unavailable' as const, message: foodie.message };

    const stops = foodie.sections.flatMap(sec => sec.picks).slice(0, 3);
    return {
      status: 'ok' as const,
      plan: {
        stops: stops.map(s => ({
          name: s.name,
          ...(s.website ? { url: s.website } : {}),
          rationale: s.rationale,
          ...(s.budget?.moneyTalk ? { expectedSpend: s.budget.moneyTalk } : {}),
        })),
        vibe: input.vibe,
        tier: input.budgetTier,
      },
      message: `${stops.length}-stop ${input.vibe} evening in ${input.city}.`,
    };
  },
};

// ── 13. trip_contextual_recommender ──────────────────────────────────

const contextualInput = z.object({
  city: z.string().min(1).max(120),
  countryCode: z.string().length(2).optional(),
  languageCode: z.string().max(10).default('en'),
  travelerId: z.string().max(120).optional(),
  /** Free-form context: "I'm jet-lagged after a 12h flight, it's 9pm, want something low-key". */
  situation: z.string().min(3).max(400),
});
type ContextualInput = z.infer<typeof contextualInput>;

const tripContextualRecommenderTool: ToolDef = {
  name: 'trip_contextual_recommender',
  internal: true,
  description:
    "Recommend from situation, not category — pure heuristic that infers vibe + intensity from the traveler's free-text context, then composes the right downstream tool. Use as the catch-all 'I don't know what I want, surprise me' surface.",
  inputSchema: contextualInput,
  jsonSchema: {
    type: 'object',
    required: ['city', 'situation'],
    properties: {
      city: { type: 'string', minLength: 1, maxLength: 120 },
      countryCode: { type: 'string', minLength: 2, maxLength: 2 },
      languageCode: { type: 'string', maxLength: 10 },
      travelerId: { type: 'string', maxLength: 120 },
      situation: { type: 'string', minLength: 3, maxLength: 400 },
    },
  },
  handler: async (rawInput: ContextualInput, ctx) => {
    const gate = assertDevOnlyToolAllowed(ctx);
    if (gate.allowed === false)
      return { status: 'production_refused' as const, message: gate.reason };
    const input = contextualInput.parse(rawInput);
    const s = input.situation.toLowerCase();

    let intent:
      | 'low_key'
      | 'foodie_anchor'
      | 'event_hunt'
      | 'walk_explore'
      | 'cafe_work'
      | 'romantic' = 'low_key';
    if (/jet[\s-]?lag|tired|exhausted|early flight/i.test(s)) intent = 'low_key';
    else if (/foodie|hungry|dinner|lunch|comer|cena/i.test(s)) intent = 'foodie_anchor';
    else if (/event|concert|happening|tonight|fun/i.test(s)) intent = 'event_hunt';
    else if (/walk|explore|wander|caminar/i.test(s)) intent = 'walk_explore';
    else if (/laptop|work|trabajar|wifi/i.test(s)) intent = 'cafe_work';
    else if (/date|romantic|partner|cita/i.test(s)) intent = 'romantic';

    let suggestedTool: string;
    let why: string;

    switch (intent) {
      case 'low_key':
        suggestedTool = 'first_day_soft_plan';
        why = 'Low-key + jet-lag signal — recommend a soft anchor + early bedtime.';
        break;
      case 'foodie_anchor':
        suggestedTool = 'foodie_shortlist_builder';
        why = 'Hungry / dinner intent — go straight to the foodie shortlist.';
        break;
      case 'event_hunt':
        suggestedTool = 'last_minute_tickets_finder';
        why = 'Event tonight signal — check Ticketmaster + curated events.';
        break;
      case 'walk_explore':
        suggestedTool = 'micro_itinerary_builder';
        why = 'Wander signal — build a 2-3h walking micro-itinerary.';
        break;
      case 'cafe_work':
        suggestedTool = 'work_from_cafe_ranker';
        why = 'Work-from-café signal.';
        break;
      case 'romantic':
        suggestedTool = 'romantic_city_pack_builder';
        why = 'Romantic signal — full date plan.';
        break;
    }

    return {
      status: 'ok' as const,
      intent,
      suggestedTool,
      why,
      message: `Situation parsed → intent=${intent}, recommended tool=${suggestedTool}.`,
    };
  },
};

// ── exports ──────────────────────────────────────────────────────────

export {
  cityPulseBriefTool,
  tripOpportunityRankerTool,
  itineraryGapDetectorTool,
  microItineraryBuilderTool,
  layoverCityEscapeTool,
  firstDaySoftPlanTool,
  lastDayCheckoutPlanTool,
  luggageStorageFinderTool,
  tripPacingOptimizerTool,
  weatherReplanEngineTool,
  groupPreferenceReconcilerTool,
  perfectEveningBuilderTool,
  tripContextualRecommenderTool,
};
