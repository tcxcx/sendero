/**
 * B7 — Health, Safety, Wellness (10 tools).
 *
 *   - clinic_finder                  B7 #99
 *   - pharmacy_24h_finder            B7 #100
 *   - travel_vaccine_researcher      B7 #101 (Vertex grounded)
 *   - food_safety_brief              B7 #102 (Vertex grounded)
 *   - allergy_safe_restaurant_finder B7 #103
 *   - emergency_numbers_card         B7 #104 (curated)
 *   - embassy_consulate_locator      B7 #105 (curated + CSE)
 *   - safe_route_home                B7 #106 (pure)
 *   - area_after_dark_check          B7 #107 (pure + CSE)
 *   - scam_risk_brief                B7 #108 (Vertex grounded)
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

const cityInput = z.object({
  city: z.string().min(1).max(120),
  countryCode: z.string().length(2).optional(),
  languageCode: z.string().max(10).default('en'),
  limit: z.number().int().min(1).max(15).default(8),
});
type CityInput = z.infer<typeof cityInput>;

interface PlacesHit {
  name: string;
  url?: string;
  rationale: string;
  rating?: number;
}
type PlacesListResult =
  | { status: 'ok'; results: PlacesHit[]; message: string }
  | { status: 'unavailable'; reason: string; message: string }
  | { status: 'production_refused'; message: string };

async function placesQuery(
  query: string,
  input: CityInput,
  filter: RegExp | null,
  ctx?: ToolContext
): Promise<PlacesListResult> {
  const gate = assertDevOnlyToolAllowed(ctx);
  if (gate.allowed === false) return { status: 'production_refused', message: gate.reason };
  const places = await searchText({
    query: `${query} in ${input.city}`,
    limit: input.limit + 4,
    languageCode: input.languageCode,
    ...(input.countryCode ? { regionCode: input.countryCode } : {}),
  });
  if (!places.available)
    return {
      status: 'unavailable',
      reason: places.reason ?? 'unknown',
      message: `Places unavailable: ${places.reason ?? 'unknown'}.`,
    };
  const filtered = filter
    ? places.results.filter(p =>
        filter.test(`${p.name} ${p.editorialSummary ?? ''} ${p.types?.join(' ') ?? ''}`)
      )
    : places.results;
  return {
    status: 'ok',
    results: filtered.slice(0, input.limit).map(p => ({
      name: p.name,
      ...(p.website ? { url: p.website } : {}),
      rationale: `${p.rating?.toFixed(1) ?? '?'}★ over ${p.userRatingCount ?? 0} reviews · ${p.editorialSummary ?? p.formattedAddress ?? ''}`,
      ...(typeof p.rating === 'number' ? { rating: p.rating } : {}),
    })),
    message: `${filtered.length} ${query} candidates in ${input.city}.`,
  };
}

const baseJsonProps = {
  city: { type: 'string', minLength: 1, maxLength: 120 },
  countryCode: { type: 'string', minLength: 2, maxLength: 2 },
  languageCode: { type: 'string', maxLength: 10 },
  limit: { type: 'integer', minimum: 1, maximum: 15 },
} as const;

// ── 1. clinic_finder ─────────────────────────────────────────────────

const clinicFinderTool: ToolDef = {
  name: 'clinic_finder',
  internal: true,
  experimental: true,
  description:
    'Find clinics, private hospitals, urgent care in a city. Places-only with health-keyword filter. Use when traveler is sick on a trip and needs care without a full ER visit. ALWAYS pair with `emergency_numbers_card` for life-threatening situations.',
  inputSchema: cityInput,
  jsonSchema: { type: 'object', required: ['city'], properties: { ...baseJsonProps } },
  handler: (input, ctx) =>
    placesQuery(
      'private clinic urgent care',
      input as CityInput,
      /\b(clinic|hospital|urgent|medic|cl(í|i)nic)\b/i,
      ctx
    ),
};

// ── 2. pharmacy_24h_finder ───────────────────────────────────────────

const pharmacy24hFinderTool: ToolDef = {
  name: 'pharmacy_24h_finder',
  internal: true,
  experimental: true,
  description:
    'Find 24-hour pharmacies in a city. Places + name filter (24h / 24 horas / overnight / nocturna). Use when traveler needs medication outside business hours.',
  inputSchema: cityInput,
  jsonSchema: { type: 'object', required: ['city'], properties: { ...baseJsonProps } },
  handler: (input, ctx) =>
    placesQuery(
      '24 hour pharmacy',
      input as CityInput,
      /\b(24[\s-]?hour|24h|overnight|nocturna|farmacia)\b/i,
      ctx
    ),
};

// ── 3. travel_vaccine_researcher (Vertex grounded) ───────────────────

const vaccineInput = z.object({
  destinationCountryCode: z.string().length(2),
  travelerNationalityCode: z.string().length(2).optional(),
  tripDays: z.number().int().min(1).max(365).default(7),
  /** Activity hint — drives malaria / yellow-fever / rabies advisories. */
  activities: z
    .array(z.enum(['urban', 'rural', 'safari', 'jungle', 'mountain', 'beach', 'volunteering']))
    .max(6)
    .optional(),
  locale: z.string().min(2).max(10).default('en-US'),
});
type VaccineInput = z.infer<typeof vaccineInput>;

const vaccineShape = z.object({
  required: z.array(z.string()).max(8),
  recommended: z.array(z.string()).max(12),
  considerations: z.array(z.string()).max(6),
  sourceAdvice: z.string(),
});

async function runTravelVaccineResearcher(
  rawInput: VaccineInput,
  ctx?: ToolContext
): Promise<{
  status: 'ok' | 'unavailable' | 'production_refused';
  message: string;
  vaccines?: z.infer<typeof vaccineShape>;
  via?: 'vertex' | 'gateway';
}> {
  const gate = assertDevOnlyToolAllowed(ctx);
  if (gate.allowed === false) return { status: 'production_refused', message: gate.reason };

  const input = vaccineInput.parse(rawInput);
  const groundingPrompt = `Research current vaccine requirements + recommendations for a ${input.tripDays}-day trip to ${input.destinationCountryCode}${input.travelerNationalityCode ? ` (passport ${input.travelerNationalityCode})` : ''}${input.activities?.length ? ` with activities: ${input.activities.join(', ')}` : ''}. Use CDC + WHO + UK NHS travel-health pages. Cover: required vaccines (entry rules), recommended vaccines (CDC standard), special considerations (malaria, dengue, altitude, food/water-borne risks). Always recommend the traveler verifies with a travel clinic 4-6 weeks before departure.`;
  const coercePrompt = (
    text: string,
    sources: string[]
  ) => `Coerce vaccine report into the schema. Locale: ${input.locale}.

Report:
"""
${text}
"""

Sources cited:
${sources
  .slice(0, 6)
  .map((u, i) => `${i + 1}. ${u}`)
  .join('\n')}`;

  const vertex = resolveVertex();
  async function viaPath(modelLike: any, providerOptions?: any) {
    const grounded = await generateText({
      model: modelLike,
      tools: {
        google_search: vertex ? vertex.tools.googleSearch({}) : google.tools.googleSearch({}),
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
      schema: vaccineShape,
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
          vaccines: obj,
          via: 'vertex',
          message: `Vaccine brief for ${input.destinationCountryCode} via Vertex.`,
        };
    } catch {}
  }
  try {
    const obj = await viaPath(GATEWAY_MODEL_ID, { gateway: { order: ['google'] } });
    if (obj)
      return { status: 'ok', vaccines: obj, via: 'gateway', message: `Vaccine brief via gateway.` };
    return { status: 'unavailable', message: 'No grounded vaccine data returned.' };
  } catch (err) {
    return {
      status: 'unavailable',
      message: `Vertex + gateway both failed: ${(err as Error).message ?? 'unknown'}.`,
    };
  }
}

const travelVaccineResearcherTool: ToolDef = {
  name: 'travel_vaccine_researcher',
  internal: true,
  experimental: true,
  description:
    "Research vaccine requirements + recommendations for a destination + activities. Vertex-grounded against CDC / WHO / UK NHS. Always recommends traveler verifies with a travel clinic. Use when traveler asks 'do I need vaccines for <country>'.",
  inputSchema: vaccineInput,
  jsonSchema: {
    type: 'object',
    required: ['destinationCountryCode'],
    properties: {
      destinationCountryCode: { type: 'string', minLength: 2, maxLength: 2 },
      travelerNationalityCode: { type: 'string', minLength: 2, maxLength: 2 },
      tripDays: { type: 'integer', minimum: 1, maximum: 365 },
      activities: {
        type: 'array',
        maxItems: 6,
        items: {
          type: 'string',
          enum: ['urban', 'rural', 'safari', 'jungle', 'mountain', 'beach', 'volunteering'],
        },
      },
      locale: { type: 'string', minLength: 2, maxLength: 10 },
    },
  },
  handler: runTravelVaccineResearcher,
};

// ── 4. food_safety_brief (Vertex grounded) ──────────────────────────

const foodSafetyInput = z.object({
  countryCode: z.string().length(2),
  city: z.string().max(120).optional(),
  locale: z.string().min(2).max(10).default('en-US'),
});
type FoodSafetyInput = z.infer<typeof foodSafetyInput>;

const foodSafetyShape = z.object({
  tapWaterSafe: z.boolean().nullable(),
  iceMatchesTapWater: z.boolean(),
  rawFoodWarnings: z.array(z.string()).max(6),
  streetFoodGuidance: z.string(),
  topGastroRiskFoods: z.array(z.string()).max(6),
  packAlong: z.array(z.string()).max(4),
});

async function runFoodSafetyBrief(
  rawInput: FoodSafetyInput,
  ctx?: ToolContext
): Promise<{
  status: 'ok' | 'unavailable' | 'production_refused';
  message: string;
  brief?: z.infer<typeof foodSafetyShape>;
  via?: 'vertex' | 'gateway';
}> {
  const gate = assertDevOnlyToolAllowed(ctx);
  if (gate.allowed === false) return { status: 'production_refused', message: gate.reason };

  const input = foodSafetyInput.parse(rawInput);
  const groundingPrompt = `Provide practical water + food safety brief for a tourist visiting ${input.countryCode}${input.city ? ` (${input.city})` : ''}. Cover: is tap water safe to drink (yes / no / locals only / boil)?, does the ice match tap water?, raw-food warnings (sushi / ceviche / lettuce / unpasteurized), street-food guidance, top gastro-risk foods, packing-along recommendations (electrolytes / probiotics). Pull from CDC / WHO / Lonely Planet country guides.`;
  const coercePrompt = (
    text: string,
    _sources: string[]
  ) => `Coerce into food safety schema. Locale: ${input.locale}.

Report:
"""
${text}
"""`;

  const vertex = resolveVertex();
  async function viaPath(modelLike: any, providerOptions?: any) {
    const grounded = await generateText({
      model: modelLike,
      tools: {
        google_search: vertex ? vertex.tools.googleSearch({}) : google.tools.googleSearch({}),
      },
      prompt: groundingPrompt,
      ...(providerOptions ? { providerOptions } : {}),
    });
    const text = grounded.text?.trim() ?? '';
    if (!text) return null;
    const coerced = await generateObject({
      model: modelLike,
      schema: foodSafetyShape,
      prompt: coercePrompt(text, []),
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
          brief: obj,
          via: 'vertex',
          message: `Food safety brief for ${input.countryCode} via Vertex.`,
        };
    } catch {}
  }
  try {
    const obj = await viaPath(GATEWAY_MODEL_ID, { gateway: { order: ['google'] } });
    if (obj)
      return {
        status: 'ok',
        brief: obj,
        via: 'gateway',
        message: `Food safety brief via gateway.`,
      };
    return { status: 'unavailable', message: 'No grounded food safety data returned.' };
  } catch (err) {
    return {
      status: 'unavailable',
      message: `Vertex + gateway both failed: ${(err as Error).message ?? 'unknown'}.`,
    };
  }
}

const foodSafetyBriefTool: ToolDef = {
  name: 'food_safety_brief',
  internal: true,
  experimental: true,
  description:
    'Water + food safety brief for a country. Vertex-grounded against CDC / WHO + travel guides. Returns structured fields: tap water safety, ice match, raw-food warnings, street-food guidance, gastro-risk foods, packing recommendations.',
  inputSchema: foodSafetyInput,
  jsonSchema: {
    type: 'object',
    required: ['countryCode'],
    properties: {
      countryCode: { type: 'string', minLength: 2, maxLength: 2 },
      city: { type: 'string', maxLength: 120 },
      locale: { type: 'string', minLength: 2, maxLength: 10 },
    },
  },
  handler: runFoodSafetyBrief,
};

// ── 5. allergy_safe_restaurant_finder ────────────────────────────────

const allergyInput = cityInput.extend({
  allergens: z
    .array(
      z.enum(['gluten', 'peanut', 'tree_nut', 'dairy', 'shellfish', 'soy', 'egg', 'sesame', 'fish'])
    )
    .min(1)
    .max(6),
});
type AllergyInput = z.infer<typeof allergyInput>;

const allergySafeRestaurantFinderTool: ToolDef = {
  name: 'allergy_safe_restaurant_finder',
  internal: true,
  experimental: true,
  description:
    'Find restaurants safe for specific allergens. Places + filter on allergen-aware language ("gluten-free", "vegan", "nut-free", "celiac"). Use when traveler asks "celiac-safe restaurants <city>", "gluten-free <ciudad>", "nut allergy".',
  inputSchema: allergyInput,
  jsonSchema: {
    type: 'object',
    required: ['city', 'allergens'],
    properties: {
      ...baseJsonProps,
      allergens: { type: 'array', minItems: 1, maxItems: 6 },
    },
  },
  handler: async (input: AllergyInput, ctx) => {
    const term = input.allergens.includes('gluten')
      ? 'gluten free celiac'
      : input.allergens.includes('peanut') || input.allergens.includes('tree_nut')
        ? 'nut free'
        : input.allergens.includes('dairy')
          ? 'dairy free vegan'
          : 'allergy aware';
    return placesQuery(
      `${term} restaurant`,
      input,
      /\b(gluten[\s-]?free|celiac|sin gluten|nut[\s-]?free|vegan|sin lácteos|allergen)\b/i,
      ctx
    );
  },
};

// ── 6. emergency_numbers_card (pure curated) ─────────────────────────

const emergencyInput = z.object({
  countryCode: z.string().length(2),
  travelerNationalityCode: z.string().length(2).optional(),
});
type EmergencyInput = z.infer<typeof emergencyInput>;

interface EmergencyCard {
  general: string;
  police: string;
  ambulance: string;
  fire: string;
  notes: string[];
}

const EMERGENCY_NUMBERS: Record<string, EmergencyCard> = {
  US: {
    general: '911',
    police: '911',
    ambulance: '911',
    fire: '911',
    notes: ['Same number for all emergencies.'],
  },
  CA: { general: '911', police: '911', ambulance: '911', fire: '911', notes: [] },
  MX: {
    general: '911',
    police: '911',
    ambulance: '911',
    fire: '911',
    notes: ['911 is national; some locales also have 060/065.'],
  },
  AR: { general: '911', police: '911', ambulance: '107', fire: '100', notes: [] },
  BR: { general: '190', police: '190', ambulance: '192', fire: '193', notes: [] },
  CL: { general: '133', police: '133', ambulance: '131', fire: '132', notes: [] },
  CO: { general: '123', police: '123', ambulance: '123', fire: '123', notes: [] },
  PE: { general: '105', police: '105', ambulance: '116', fire: '116', notes: [] },
  UY: { general: '911', police: '911', ambulance: '105', fire: '104', notes: [] },
  EU: {
    general: '112',
    police: '112',
    ambulance: '112',
    fire: '112',
    notes: ['EU-wide standard.'],
  },
  GB: {
    general: '999',
    police: '999',
    ambulance: '999',
    fire: '999',
    notes: ['Also 112 (EU) and 111 for non-emergency NHS.'],
  },
  IE: { general: '112', police: '112', ambulance: '112', fire: '112', notes: ['Or 999.'] },
  FR: { general: '112', police: '17', ambulance: '15', fire: '18', notes: ['Or 112 EU-wide.'] },
  DE: { general: '112', police: '110', ambulance: '112', fire: '112', notes: [] },
  ES: {
    general: '112',
    police: '091',
    ambulance: '061',
    fire: '080',
    notes: ['112 connects all.'],
  },
  IT: { general: '112', police: '113', ambulance: '118', fire: '115', notes: [] },
  PT: { general: '112', police: '112', ambulance: '112', fire: '112', notes: [] },
  CH: { general: '112', police: '117', ambulance: '144', fire: '118', notes: [] },
  AT: { general: '112', police: '133', ambulance: '144', fire: '122', notes: [] },
  NL: { general: '112', police: '112', ambulance: '112', fire: '112', notes: [] },
  SE: { general: '112', police: '112', ambulance: '112', fire: '112', notes: [] },
  NO: { general: '112', police: '112', ambulance: '113', fire: '110', notes: [] },
  DK: { general: '112', police: '112', ambulance: '112', fire: '112', notes: [] },
  FI: { general: '112', police: '112', ambulance: '112', fire: '112', notes: [] },
  IS: { general: '112', police: '112', ambulance: '112', fire: '112', notes: [] },
  JP: {
    general: '110',
    police: '110',
    ambulance: '119',
    fire: '119',
    notes: ['English-speaking line: +81-(0)50-3171-9119 (TELL Lifeline).'],
  },
  KR: { general: '112', police: '112', ambulance: '119', fire: '119', notes: [] },
  CN: { general: '110', police: '110', ambulance: '120', fire: '119', notes: [] },
  HK: { general: '999', police: '999', ambulance: '999', fire: '999', notes: [] },
  TW: { general: '110', police: '110', ambulance: '119', fire: '119', notes: [] },
  TH: {
    general: '191',
    police: '191',
    ambulance: '1669',
    fire: '199',
    notes: ['Tourist Police: 1155.'],
  },
  SG: { general: '999', police: '999', ambulance: '995', fire: '995', notes: [] },
  ID: { general: '112', police: '110', ambulance: '118', fire: '113', notes: [] },
  IN: { general: '112', police: '100', ambulance: '108', fire: '101', notes: [] },
  AU: {
    general: '000',
    police: '000',
    ambulance: '000',
    fire: '000',
    notes: ['Or 112 from mobile.'],
  },
  NZ: { general: '111', police: '111', ambulance: '111', fire: '111', notes: [] },
  AE: { general: '112', police: '999', ambulance: '998', fire: '997', notes: [] },
  IL: { general: '112', police: '100', ambulance: '101', fire: '102', notes: [] },
  ZA: {
    general: '10111',
    police: '10111',
    ambulance: '10177',
    fire: '10177',
    notes: ['Mobile: 112.'],
  },
  EG: {
    general: '122',
    police: '122',
    ambulance: '123',
    fire: '180',
    notes: ['Tourist Police: 126.'],
  },
  MA: { general: '19', police: '19', ambulance: '15', fire: '15', notes: [] },
};

const emergencyNumbersCardTool: ToolDef = {
  name: 'emergency_numbers_card',
  internal: true,
  experimental: true,
  description:
    'Local emergency numbers + tourist police + consulate notes for ~40 countries. Pure curated table. Use whenever traveler arrives in a new country — pair with `embassy_consulate_locator` for the diplomatic-side info.',
  inputSchema: emergencyInput,
  jsonSchema: {
    type: 'object',
    required: ['countryCode'],
    properties: {
      countryCode: { type: 'string', minLength: 2, maxLength: 2 },
      travelerNationalityCode: { type: 'string', minLength: 2, maxLength: 2 },
    },
  },
  handler: async (rawInput: EmergencyInput, ctx?: ToolContext) => {
    const gate = assertDevOnlyToolAllowed(ctx);
    if (gate.allowed === false)
      return { status: 'production_refused' as const, message: gate.reason };
    const input = emergencyInput.parse(rawInput);
    const card = EMERGENCY_NUMBERS[input.countryCode.toUpperCase()];
    if (!card) {
      return {
        status: 'unavailable' as const,
        message: `No curated emergency numbers for ${input.countryCode} yet. Default European 112 / North American 911 likely work.`,
      };
    }
    return {
      status: 'ok' as const,
      card,
      message: `Emergency: ${card.general} (police ${card.police}, ambulance ${card.ambulance}, fire ${card.fire}).`,
    };
  },
};

// ── 7. embassy_consulate_locator ─────────────────────────────────────

const embassyInput = z.object({
  hostCountryCode: z.string().length(2),
  travelerNationalityCode: z.string().length(2),
  city: z.string().max(120).optional(),
  languageCode: z.string().max(10).default('en'),
});
type EmbassyInput = z.infer<typeof embassyInput>;

const embassyConsulateLocatorTool: ToolDef = {
  name: 'embassy_consulate_locator',
  internal: true,
  experimental: true,
  description:
    "Locate a traveler's home-country embassy / consulate in the destination country. CSE-scoped to the foreign affairs department of the traveler's nationality. Use after passport loss, arrest, medical emergency, or when traveler asks 'where's the US embassy in <country>'.",
  inputSchema: embassyInput,
  jsonSchema: {
    type: 'object',
    required: ['hostCountryCode', 'travelerNationalityCode'],
    properties: {
      hostCountryCode: { type: 'string', minLength: 2, maxLength: 2 },
      travelerNationalityCode: { type: 'string', minLength: 2, maxLength: 2 },
      city: { type: 'string', maxLength: 120 },
      languageCode: { type: 'string', maxLength: 10 },
    },
  },
  handler: async (rawInput: EmbassyInput, ctx) => {
    const gate = assertDevOnlyToolAllowed(ctx);
    if (gate.allowed === false)
      return { status: 'production_refused' as const, message: gate.reason };

    const input = embassyInput.parse(rawInput);
    const cse = await cseSearch({
      query: `${input.travelerNationalityCode} embassy consulate in ${input.hostCountryCode}${input.city ? ` ${input.city}` : ''}`,
      limit: 6,
      lang: input.languageCode,
    });
    if (!cse.available)
      return {
        status: 'unavailable' as const,
        message: `CSE unavailable: ${cse.reason ?? 'unknown'}.`,
      };
    return {
      status: 'ok' as const,
      candidates: cse.results.slice(0, 5).map(hit => ({
        name: hit.title.trim(),
        url: hit.link,
        snippet: hit.snippet,
      })),
      message: `${cse.results.length} embassy / consulate candidates.`,
    };
  },
};

// ── 8. safe_route_home (pure heuristic) ──────────────────────────────

const safeRouteInput = z.object({
  city: z.string().min(1).max(120),
  countryCode: z.string().length(2).optional(),
  fromAreaScore: z.enum(['safe', 'mostly_safe', 'caution', 'avoid']).default('mostly_safe'),
  toAreaScore: z.enum(['safe', 'mostly_safe', 'caution', 'avoid']).default('safe'),
  distanceKm: z.number().min(0).max(50).optional(),
  hourLocal: z.number().int().min(0).max(23).default(23),
  groupSize: z.number().int().min(1).max(20).default(1),
  hasPhone: z.boolean().default(true),
});
type SafeRouteInput = z.infer<typeof safeRouteInput>;

const safeRouteHomeTool: ToolDef = {
  name: 'safe_route_home',
  internal: true,
  experimental: true,
  description:
    "Recommend a safer route + mode home at night. Pure heuristic — caller passes from/to area scores + distance + hour + group size + phone state. Returns mode (walk / shared taxi / arranged ride) + concrete tips. Use when traveler asks 'how do I get back to my hotel' late at night.",
  inputSchema: safeRouteInput,
  jsonSchema: {
    type: 'object',
    required: ['city'],
    properties: {
      city: { type: 'string', minLength: 1, maxLength: 120 },
      countryCode: { type: 'string', minLength: 2, maxLength: 2 },
      fromAreaScore: { type: 'string', enum: ['safe', 'mostly_safe', 'caution', 'avoid'] },
      toAreaScore: { type: 'string', enum: ['safe', 'mostly_safe', 'caution', 'avoid'] },
      distanceKm: { type: 'number', minimum: 0, maximum: 50 },
      hourLocal: { type: 'integer', minimum: 0, maximum: 23 },
      groupSize: { type: 'integer', minimum: 1, maximum: 20 },
      hasPhone: { type: 'boolean' },
    },
  },
  handler: async (rawInput: SafeRouteInput, ctx) => {
    const gate = assertDevOnlyToolAllowed(ctx);
    if (gate.allowed === false)
      return { status: 'production_refused' as const, message: gate.reason };
    const input = safeRouteInput.parse(rawInput);

    const isLate = input.hourLocal >= 22 || input.hourLocal <= 4;
    const tips: string[] = [];
    let mode: 'walk' | 'shared_taxi' | 'arranged_ride' | 'public_transit' = 'arranged_ride';

    if (input.fromAreaScore === 'avoid' || input.toAreaScore === 'avoid') {
      mode = 'arranged_ride';
      tips.push(
        'At least one neighborhood is on the avoid list — only arranged ride (Uber / Cabify / hotel taxi).'
      );
    } else if (
      input.distanceKm !== undefined &&
      input.distanceKm < 1.5 &&
      !isLate &&
      input.fromAreaScore !== 'caution' &&
      input.toAreaScore !== 'caution'
    ) {
      mode = 'walk';
      tips.push('Short distance + not late + safe areas — walking is fine.');
    } else if (isLate || input.fromAreaScore === 'caution' || input.toAreaScore === 'caution') {
      mode = 'arranged_ride';
      tips.push(
        'Late hour or caution-rated area — use arranged ride only. Avoid hailing on the street.'
      );
    } else if (input.groupSize >= 3) {
      mode = 'shared_taxi';
      tips.push('Group of 3+ — split a single arranged taxi.');
    } else {
      mode = 'public_transit';
      tips.push('Public transit is fine in safe / mostly-safe areas during normal hours.');
    }

    if (!input.hasPhone)
      tips.push(
        'No phone — pre-arrange a fixed pickup time + place at the venue before going out.'
      );
    if (input.groupSize === 1 && isLate)
      tips.push('Solo + late: share live location with one trusted contact.');
    tips.push(
      'Fare ~ verify in-app before stepping into the car. Decline rides where the driver cancels in-app and asks for cash.'
    );

    return {
      status: 'ok' as const,
      recommendedMode: mode,
      tips,
      message: `Safer route home: ${mode} (${tips.length} tips).`,
    };
  },
};

// ── 9. area_after_dark_check (pure curated + CSE fallback) ───────────

const areaCheckInput = z.object({
  city: z.string().min(1).max(120),
  countryCode: z.string().length(2).optional(),
  neighborhood: z.string().min(1).max(120),
  languageCode: z.string().max(10).default('en'),
});
type AreaCheckInput = z.infer<typeof areaCheckInput>;

interface CuratedNeighborhood {
  city: string;
  neighborhood: string;
  rating: 'safe' | 'mostly_safe' | 'caution' | 'avoid';
  notes?: string;
}

const CURATED_NEIGHBORHOODS: CuratedNeighborhood[] = [
  // Buenos Aires
  { city: 'buenos aires', neighborhood: 'recoleta', rating: 'safe' },
  {
    city: 'buenos aires',
    neighborhood: 'palermo soho',
    rating: 'mostly_safe',
    notes: 'Active nightlife; fine when busy, thin out late and use taxi.',
  },
  { city: 'buenos aires', neighborhood: 'puerto madero', rating: 'safe' },
  {
    city: 'buenos aires',
    neighborhood: 'san telmo',
    rating: 'mostly_safe',
    notes: 'Vibrant by day, quieter side streets late.',
  },
  {
    city: 'buenos aires',
    neighborhood: 'la boca',
    rating: 'caution',
    notes: 'Daytime tourist visits ok; avoid past 18:00 outside Caminito.',
  },
  {
    city: 'buenos aires',
    neighborhood: 'constitución',
    rating: 'avoid',
    notes: 'High crime around station; avoid after dark entirely.',
  },
  // Mexico City
  { city: 'mexico city', neighborhood: 'condesa', rating: 'safe' },
  { city: 'mexico city', neighborhood: 'roma norte', rating: 'safe' },
  { city: 'mexico city', neighborhood: 'polanco', rating: 'safe' },
  {
    city: 'mexico city',
    neighborhood: 'centro histórico',
    rating: 'mostly_safe',
    notes: 'Stay on main streets after sundown.',
  },
  { city: 'mexico city', neighborhood: 'doctores', rating: 'caution' },
  { city: 'mexico city', neighborhood: 'tepito', rating: 'avoid' },
  // NYC (concise)
  { city: 'new york', neighborhood: 'midtown', rating: 'safe' },
  { city: 'new york', neighborhood: 'soho', rating: 'safe' },
  { city: 'new york', neighborhood: 'east village', rating: 'mostly_safe' },
  {
    city: 'new york',
    neighborhood: 'bushwick',
    rating: 'mostly_safe',
    notes: 'Quiet residential blocks late.',
  },
  // Paris
  { city: 'paris', neighborhood: 'le marais', rating: 'safe' },
  { city: 'paris', neighborhood: 'saint-germain', rating: 'safe' },
  {
    city: 'paris',
    neighborhood: 'gare du nord',
    rating: 'caution',
    notes: 'Around the station after dark.',
  },
  // Barcelona
  { city: 'barcelona', neighborhood: 'gràcia', rating: 'safe' },
  {
    city: 'barcelona',
    neighborhood: 'el raval',
    rating: 'mostly_safe',
    notes: 'Pickpocket-heavy; nothing in pockets.',
  },
  // Tokyo
  { city: 'tokyo', neighborhood: 'shibuya', rating: 'safe' },
  {
    city: 'tokyo',
    neighborhood: 'shinjuku golden gai',
    rating: 'safe',
    notes: 'Tourist-heavy; common pickpocket-free area.',
  },
  {
    city: 'tokyo',
    neighborhood: 'kabukichō',
    rating: 'mostly_safe',
    notes: 'Avoid touts offering drinks at unknown bars.',
  },
];

const areaAfterDarkCheckTool: ToolDef = {
  name: 'area_after_dark_check',
  internal: true,
  experimental: true,
  description:
    "Evaluate after-dark suitability of a city neighborhood. Returns rating ('safe' / 'mostly_safe' / 'caution' / 'avoid') + notes. Curated table for ~30 high-traffic neighborhoods; CSE fallback for everything else. Compose with `safe_route_home` and `date_route_safety_check`.",
  inputSchema: areaCheckInput,
  jsonSchema: {
    type: 'object',
    required: ['city', 'neighborhood'],
    properties: {
      city: { type: 'string', minLength: 1, maxLength: 120 },
      countryCode: { type: 'string', minLength: 2, maxLength: 2 },
      neighborhood: { type: 'string', minLength: 1, maxLength: 120 },
      languageCode: { type: 'string', maxLength: 10 },
    },
  },
  handler: async (rawInput: AreaCheckInput, ctx) => {
    const gate = assertDevOnlyToolAllowed(ctx);
    if (gate.allowed === false)
      return { status: 'production_refused' as const, message: gate.reason };

    const input = areaCheckInput.parse(rawInput);
    const cityKey = input.city.trim().toLowerCase();
    const neighKey = input.neighborhood.trim().toLowerCase();
    const direct = CURATED_NEIGHBORHOODS.find(
      n => n.city === cityKey && (n.neighborhood === neighKey || neighKey.includes(n.neighborhood))
    );
    if (direct) {
      return {
        status: 'ok' as const,
        rating: direct.rating,
        ...(direct.notes ? { notes: direct.notes } : {}),
        source: 'curated' as const,
        message: `${input.neighborhood} (${input.city}) — ${direct.rating}.`,
      };
    }
    const cse = await cseSearch({
      query: `safety ${input.neighborhood} ${input.city} at night`,
      limit: 4,
      lang: input.languageCode,
      ...(input.countryCode ? { country: input.countryCode } : {}),
    });
    if (!cse.available)
      return {
        status: 'unavailable' as const,
        message: `CSE unavailable: ${cse.reason ?? 'unknown'}.`,
      };
    return {
      status: 'ok' as const,
      rating: 'unknown' as const,
      source: 'cse' as const,
      cseHits: cse.results
        .slice(0, 3)
        .map(hit => ({ title: hit.title, url: hit.link, snippet: hit.snippet })),
      message: `${input.neighborhood} not in curated table — CSE returned ${cse.results.length} hits for manual review.`,
    };
  },
};

// ── 10. scam_risk_brief (Vertex grounded) ────────────────────────────

const scamInput = z.object({
  countryCode: z.string().length(2),
  city: z.string().max(120).optional(),
  channel: z
    .enum(['general', 'taxi', 'tourist_attraction', 'hotel', 'currency_exchange', 'restaurant'])
    .default('general'),
  locale: z.string().min(2).max(10).default('en-US'),
});
type ScamInput = z.infer<typeof scamInput>;

const scamShape = z.object({
  topScams: z
    .array(
      z.object({
        name: z.string(),
        howItWorks: z.string(),
        howToAvoid: z.string(),
      })
    )
    .max(8),
  generalGuidance: z.array(z.string()).max(6),
});

async function runScamRiskBrief(
  rawInput: ScamInput,
  ctx?: ToolContext
): Promise<{
  status: 'ok' | 'unavailable' | 'production_refused';
  message: string;
  brief?: z.infer<typeof scamShape>;
  via?: 'vertex' | 'gateway';
}> {
  const gate = assertDevOnlyToolAllowed(ctx);
  if (gate.allowed === false) return { status: 'production_refused', message: gate.reason };

  const input = scamInput.parse(rawInput);
  const groundingPrompt = `List the top 5-8 most-reported tourist scams in ${input.countryCode}${input.city ? ` (${input.city})` : ''}, focusing on ${input.channel === 'general' ? 'all common channels' : `the ${input.channel} channel`}. For each: name, how it works, how to avoid. Pull from official tourism boards, US State Dept tips, recent traveler reports. Don't sensationalize; focus on practical recognition + avoidance.`;
  const coercePrompt = (text: string) => `Coerce into scam risk schema. Locale: ${input.locale}.

Report:
"""
${text}
"""`;

  const vertex = resolveVertex();
  async function viaPath(modelLike: any, providerOptions?: any) {
    const grounded = await generateText({
      model: modelLike,
      tools: {
        google_search: vertex ? vertex.tools.googleSearch({}) : google.tools.googleSearch({}),
      },
      prompt: groundingPrompt,
      ...(providerOptions ? { providerOptions } : {}),
    });
    const text = grounded.text?.trim() ?? '';
    if (!text) return null;
    const coerced = await generateObject({
      model: modelLike,
      schema: scamShape,
      prompt: coercePrompt(text),
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
          brief: obj,
          via: 'vertex',
          message: `Scam brief for ${input.countryCode} via Vertex (${obj.topScams.length} scams).`,
        };
    } catch {}
  }
  try {
    const obj = await viaPath(GATEWAY_MODEL_ID, { gateway: { order: ['google'] } });
    if (obj)
      return { status: 'ok', brief: obj, via: 'gateway', message: `Scam brief via gateway.` };
    return { status: 'unavailable', message: 'No grounded scam data returned.' };
  } catch (err) {
    return {
      status: 'unavailable',
      message: `Vertex + gateway both failed: ${(err as Error).message ?? 'unknown'}.`,
    };
  }
}

const scamRiskBriefTool: ToolDef = {
  name: 'scam_risk_brief',
  internal: true,
  experimental: true,
  description:
    'Top reported tourist scams in a country / city, scoped by channel (taxi / tourist attraction / hotel / currency exchange / restaurant / general). Vertex-grounded against official tourism + State Dept reports. Returns name + howItWorks + howToAvoid per scam.',
  inputSchema: scamInput,
  jsonSchema: {
    type: 'object',
    required: ['countryCode'],
    properties: {
      countryCode: { type: 'string', minLength: 2, maxLength: 2 },
      city: { type: 'string', maxLength: 120 },
      channel: {
        type: 'string',
        enum: ['general', 'taxi', 'tourist_attraction', 'hotel', 'currency_exchange', 'restaurant'],
      },
      locale: { type: 'string', minLength: 2, maxLength: 10 },
    },
  },
  handler: runScamRiskBrief,
};

// ── exports ──────────────────────────────────────────────────────────

export {
  clinicFinderTool,
  pharmacy24hFinderTool,
  travelVaccineResearcherTool,
  foodSafetyBriefTool,
  allergySafeRestaurantFinderTool,
  emergencyNumbersCardTool,
  embassyConsulateLocatorTool,
  safeRouteHomeTool,
  areaAfterDarkCheckTool,
  scamRiskBriefTool,
};
