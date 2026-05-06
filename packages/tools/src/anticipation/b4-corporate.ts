/**
 * B4 — Corporate / Business Travel (10 tools).
 *
 *   - client_dinner_recommender         B4 #70
 *   - executive_lounge_finder           B4 #71
 *   - private_meeting_room_finder       B4 #72
 *   - business_dress_code_brief         B4 #73
 *   - local_business_protocol_brief     B4 #74
 *   - expense_policy_checker            B4 #75
 *   - receipt_collection_assistant      B4 #76
 *   - vat_refund_researcher             B4 #77
 *   - corporate_travel_risk_digest      B4 #78
 *   - meeting_commute_planner           B4 #79
 *
 * Spec: docs/experimental-tools-wip/sendero_final_experimental_tool_roadmap.md §B4.
 *
 * Mix of pure (curated tables, rules) + composer (over Places +
 * existing finders) + Vertex-grounded (live VAT / protocol research).
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

import { runCheapMichelinFinder } from './cheap-michelin-finder';
import { runMonoclePlaceResearcher } from './monocle-place-researcher';

const VERTEX_MODEL_ID = 'gemini-3-flash-preview';
const GATEWAY_MODEL_ID = 'google/gemini-3-flash';

function resolveVertex() {
  const project = process.env.GOOGLE_CLOUD_PROJECT ?? process.env.GOOGLE_VERTEX_PROJECT ?? null;
  const location = process.env.GOOGLE_CLOUD_LOCATION ?? 'global';
  const saJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
  if (!project || !saJson) return null;
  try {
    return createVertex({ project, location, googleAuthOptions: { credentials: JSON.parse(saJson) } });
  } catch {
    return null;
  }
}

// ── 1. client_dinner_recommender ─────────────────────────────────────

const clientDinnerInput = z.object({
  city: z.string().min(1).max(120),
  countryCode: z.string().length(2).optional(),
  languageCode: z.string().max(10).default('en'),
  /** Tone of the dinner. */
  tone: z.enum(['classic_steakhouse', 'modern_tasting', 'understated_local', 'safe_international', 'celebratory']).default('safe_international'),
  partySize: z.number().int().min(2).max(20).default(4),
  budgetTier: z.enum(['medium', 'premium', 'splurge']).default('premium'),
});
type ClientDinnerInput = z.infer<typeof clientDinnerInput>;

interface ClientDinnerCandidate {
  name: string;
  rationale: string;
  budgetEnvelope?: string;
  reservationUrl?: string;
  fitTone: ClientDinnerInput['tone'];
}

async function runClientDinnerRecommender(
  rawInput: ClientDinnerInput,
  ctx?: ToolContext
): Promise<{ status: 'ok' | 'unavailable' | 'production_refused'; message: string; candidates?: ClientDinnerCandidate[] }> {
  const gate = assertDevOnlyToolAllowed(ctx);
  if (gate.allowed === false) return { status: 'production_refused', message: gate.reason };

  const input = clientDinnerInput.parse(rawInput);
  const filter = input.budgetTier === 'splurge' ? 'all' : input.budgetTier === 'premium' ? 'all' : 'bib';

  const r = await runCheapMichelinFinder(
    {
      city: input.city,
      ...(input.countryCode ? { countryCode: input.countryCode } : {}),
      languageCode: input.languageCode,
      filter,
      limit: 6,
    } as never,
    ctx
  );
  if (r.status !== 'ok') {
    return {
      status: 'unavailable',
      message: r.status === 'production_refused' ? r.message : `${r.status === 'unavailable' ? r.reason : 'fail'}`,
    };
  }
  const candidates: ClientDinnerCandidate[] = r.shops.slice(0, 5).map(s => ({
    name: s.name,
    rationale: s.rationale,
    fitTone: input.tone,
    ...(s.website ? { reservationUrl: s.website } : {}),
  }));
  return {
    status: 'ok',
    candidates,
    message: `${candidates.length} client-dinner candidates in ${input.city} (tone=${input.tone}, tier=${input.budgetTier}, party=${input.partySize}).`,
  };
}

const clientDinnerRecommenderTool: ToolDef = {
  name: 'client_dinner_recommender',
  internal: true,
  experimental: true,
  description:
    "Find restaurants for client dinners — composes `cheap_michelin_finder` (with `filter='all'` for premium / splurge) tilted by tone (classic_steakhouse / modern_tasting / understated_local / safe_international / celebratory). Use when traveler asks 'where for a client dinner in <city>', 'cena con cliente <ciudad>'.",
  inputSchema: clientDinnerInput,
  jsonSchema: {
    type: 'object',
    required: ['city'],
    properties: {
      city: { type: 'string', minLength: 1, maxLength: 120 },
      countryCode: { type: 'string', minLength: 2, maxLength: 2 },
      languageCode: { type: 'string', maxLength: 10 },
      tone: {
        type: 'string',
        enum: ['classic_steakhouse', 'modern_tasting', 'understated_local', 'safe_international', 'celebratory'],
      },
      partySize: { type: 'integer', minimum: 2, maximum: 20 },
      budgetTier: { type: 'string', enum: ['medium', 'premium', 'splurge'] },
    },
  },
  handler: runClientDinnerRecommender as unknown as ToolDef['handler'],
};

// ── 2. executive_lounge_finder ───────────────────────────────────────

const loungeInput = z.object({
  city: z.string().min(1).max(120),
  countryCode: z.string().length(2).optional(),
  /** Lounge type — at the airport (priority pass / amex), at the hotel, or premium cafés in the business district. */
  kind: z.enum(['airport_lounge', 'hotel_lounge', 'premium_cafe']).default('airport_lounge'),
  airportIata: z.string().length(3).optional(),
  languageCode: z.string().max(10).default('en'),
  limit: z.number().int().min(1).max(10).default(6),
});
type LoungeInput = z.infer<typeof loungeInput>;

interface LoungeCandidate {
  name: string;
  url?: string;
  category: string;
  rationale: string;
}

async function runExecutiveLoungeFinder(
  rawInput: LoungeInput,
  ctx?: ToolContext
): Promise<{ status: 'ok' | 'unavailable' | 'production_refused'; message: string; candidates?: LoungeCandidate[] }> {
  const gate = assertDevOnlyToolAllowed(ctx);
  if (gate.allowed === false) return { status: 'production_refused', message: gate.reason };

  const input = loungeInput.parse(rawInput);
  if (input.kind === 'airport_lounge') {
    const target = input.airportIata ?? input.city;
    const cse = await cseSearch({
      query: `priority pass amex lounges ${target}`,
      limit: 8,
      lang: input.languageCode,
      ...(input.countryCode ? { country: input.countryCode } : {}),
    });
    if (!cse.available) return { status: 'unavailable', message: `CSE unavailable: ${cse.reason ?? 'unknown'}.` };
    return {
      status: 'ok',
      candidates: cse.results.slice(0, input.limit).map(hit => ({
        name: hit.title.replace(/\s*\|\s*Priority Pass$/i, '').trim(),
        url: hit.link,
        category: 'airport_lounge',
        rationale: hit.snippet,
      })),
      message: `${cse.results.length} airport lounge candidates for ${target}.`,
    };
  }

  const queryByKind: Record<LoungeInput['kind'], string> = {
    airport_lounge: 'airport lounge',
    hotel_lounge: 'hotel executive lounge club lounge',
    premium_cafe: 'premium specialty coffee business district',
  };
  const places = await searchText({
    query: `${queryByKind[input.kind]} in ${input.city}`,
    limit: input.limit + 4,
    languageCode: input.languageCode,
    ...(input.countryCode ? { regionCode: input.countryCode } : {}),
  });
  if (!places.available) return { status: 'unavailable', message: `Places unavailable: ${places.reason ?? 'unknown'}.` };

  return {
    status: 'ok',
    candidates: places.results.slice(0, input.limit).map(p => ({
      name: p.name,
      ...(p.website ? { url: p.website } : {}),
      category: input.kind,
      rationale: `${p.rating?.toFixed(1) ?? '?'}★ over ${p.userRatingCount ?? 0} reviews · ${p.editorialSummary ?? p.formattedAddress ?? ''}`,
    })),
    message: `${places.results.length} ${input.kind} candidates in ${input.city}.`,
  };
}

const executiveLoungeFinderTool: ToolDef = {
  name: 'executive_lounge_finder',
  internal: true,
  experimental: true,
  description:
    "Find airport lounges (Priority Pass / Amex), hotel executive lounges, or premium business-district cafés. Pick `kind`. Airport lounges hit CSE; hotel + cafe hit Places. Use when traveler asks 'priority pass <airport>', 'club lounge <hotel>', 'where to take a quiet call near the office'.",
  inputSchema: loungeInput,
  jsonSchema: {
    type: 'object',
    required: ['city'],
    properties: {
      city: { type: 'string', minLength: 1, maxLength: 120 },
      countryCode: { type: 'string', minLength: 2, maxLength: 2 },
      kind: { type: 'string', enum: ['airport_lounge', 'hotel_lounge', 'premium_cafe'] },
      airportIata: { type: 'string', minLength: 3, maxLength: 3 },
      languageCode: { type: 'string', maxLength: 10 },
      limit: { type: 'integer', minimum: 1, maximum: 10 },
    },
  },
  handler: runExecutiveLoungeFinder as unknown as ToolDef['handler'],
};

// ── 3. private_meeting_room_finder ───────────────────────────────────

const meetingRoomInput = z.object({
  city: z.string().min(1).max(120),
  countryCode: z.string().length(2).optional(),
  languageCode: z.string().max(10).default('en'),
  capacity: z.enum(['1to3', '4to8', '9to20', 'over_20']).default('4to8'),
  durationHours: z.number().min(0.5).max(8).default(1),
  limit: z.number().int().min(1).max(10).default(6),
});
type MeetingRoomInput = z.infer<typeof meetingRoomInput>;

async function runPrivateMeetingRoomFinder(
  rawInput: MeetingRoomInput,
  ctx?: ToolContext
): Promise<{ status: 'ok' | 'unavailable' | 'production_refused'; message: string; candidates?: LoungeCandidate[] }> {
  const gate = assertDevOnlyToolAllowed(ctx);
  if (gate.allowed === false) return { status: 'production_refused', message: gate.reason };

  const input = meetingRoomInput.parse(rawInput);
  const cse = await cseSearch({
    query: `meeting room hourly rental ${input.city} (wework OR industrious OR regus OR talentgarden)`,
    limit: 8,
    lang: input.languageCode,
    ...(input.countryCode ? { country: input.countryCode } : {}),
  });
  if (!cse.available) return { status: 'unavailable', message: `CSE unavailable: ${cse.reason ?? 'unknown'}.` };

  return {
    status: 'ok',
    candidates: cse.results.slice(0, input.limit).map(hit => ({
      name: hit.title.trim(),
      url: hit.link,
      category: 'meeting_room',
      rationale: hit.snippet,
    })),
    message: `${cse.results.length} hourly meeting-room candidates in ${input.city} (cap=${input.capacity}, ${input.durationHours}h).`,
  };
}

const privateMeetingRoomFinderTool: ToolDef = {
  name: 'private_meeting_room_finder',
  internal: true,
  experimental: true,
  description:
    "Find hourly-rental meeting rooms in a city — WeWork, Industrious, Regus, Talent Garden, etc. CSE-scoped to coworking platforms. Use when the traveler needs a private room for an hour during a trip and doesn't have an office in that city.",
  inputSchema: meetingRoomInput,
  jsonSchema: {
    type: 'object',
    required: ['city'],
    properties: {
      city: { type: 'string', minLength: 1, maxLength: 120 },
      countryCode: { type: 'string', minLength: 2, maxLength: 2 },
      languageCode: { type: 'string', maxLength: 10 },
      capacity: { type: 'string', enum: ['1to3', '4to8', '9to20', 'over_20'] },
      durationHours: { type: 'number', minimum: 0.5, maximum: 8 },
      limit: { type: 'integer', minimum: 1, maximum: 10 },
    },
  },
  handler: runPrivateMeetingRoomFinder as unknown as ToolDef['handler'],
};

// ── 4. business_dress_code_brief ─────────────────────────────────────
// Pure curated tables. Rough but useful — explicit "verify with the host"
// guardrail in the output.
// ─────────────────────────────────────────────────────────────────────

const dressCodeInput = z.object({
  countryCode: z.string().length(2),
  city: z.string().max(120).optional(),
  industry: z.enum(['banking', 'consulting', 'tech', 'creative', 'legal', 'government', 'manufacturing', 'unknown']).default('tech'),
  meetingType: z.enum(['client_pitch', 'internal_meeting', 'client_dinner', 'conference', 'site_visit', 'unknown']).default('client_pitch'),
  /** Weather hint — drives layering advice. */
  climate: z.enum(['warm', 'cool', 'cold', 'tropical_humid', 'unknown']).default('unknown'),
});
type DressCodeInput = z.infer<typeof dressCodeInput>;

const COUNTRY_FORMALITY: Record<string, 'high' | 'medium-high' | 'medium' | 'medium-low' | 'low'> = {
  JP: 'high',
  KR: 'high',
  CH: 'high',
  DE: 'medium-high',
  FR: 'medium-high',
  GB: 'medium-high',
  IT: 'medium',
  ES: 'medium',
  US: 'medium-low',
  CA: 'medium-low',
  MX: 'medium',
  AR: 'medium',
  BR: 'medium',
  CL: 'medium',
  AU: 'medium-low',
  NL: 'medium-low',
  SE: 'medium-low',
  NO: 'medium-low',
  IS: 'medium-low',
  IN: 'medium-high',
  SG: 'medium-high',
  HK: 'medium-high',
  AE: 'high',
  IL: 'medium-low',
  ZA: 'medium',
};

async function runBusinessDressCodeBrief(
  rawInput: DressCodeInput,
  ctx?: ToolContext
): Promise<{ status: 'ok' | 'production_refused'; message: string; brief?: { formality: string; men: string; women: string; layering: string; guardrail: string } }> {
  const gate = assertDevOnlyToolAllowed(ctx);
  if (gate.allowed === false) return { status: 'production_refused', message: gate.reason };

  const input = dressCodeInput.parse(rawInput);
  const cc = input.countryCode.toUpperCase();
  const baseFormality = COUNTRY_FORMALITY[cc] ?? 'medium';

  let formality = baseFormality;
  if (input.industry === 'banking' || input.industry === 'consulting' || input.industry === 'legal') formality = 'high';
  if (input.industry === 'tech' || input.industry === 'creative') formality = 'medium-low';
  if (input.industry === 'government') formality = 'medium-high';

  const men = formality === 'high'
    ? 'Dark suit (charcoal / navy), white or light-blue shirt, conservative tie, black leather lace-ups. Pressed.'
    : formality === 'medium-high'
      ? 'Suit (no tie acceptable in tech), crisp shirt, leather Oxfords or polished derbys.'
      : formality === 'medium'
        ? 'Sport coat + chinos / wool trousers, button-down. Loafers or polished sneakers (city-dependent).'
        : 'Smart casual: button-down + chinos or dark jeans, clean leather sneakers. Skip the suit.';

  const women = formality === 'high'
    ? 'Tailored suit / sheath dress + blazer, low-heeled pumps, minimal jewelry. Conservative.'
    : formality === 'medium-high'
      ? 'Tailored separates (blazer + trousers / midi skirt), structured blouse, comfortable heels or polished flats.'
      : formality === 'medium'
        ? 'Smart blouse + tailored trousers OR shift dress + cardigan/blazer. Polished flats / low heels.'
        : 'Smart casual blouse + dark jeans / trousers, blazer optional, clean leather flats or sneakers.';

  const layering = (() => {
    if (input.climate === 'cold') return 'Wool overcoat, cashmere scarf in office-appropriate color (charcoal / navy / camel), leather gloves.';
    if (input.climate === 'cool') return 'Lightweight wool coat or trench. One layer warmer than feels needed walking in — meeting rooms run cold.';
    if (input.climate === 'warm') return 'Single layer + a packable blazer for AC. Skip wool — linen-blend or tropical wool reads better.';
    if (input.climate === 'tropical_humid') return 'Tropical-weight fabrics. Bring a fresh shirt to change into between morning + afternoon meetings; humidity is unforgiving.';
    return 'Pack one layer warmer than expected — most meeting rooms run cold from AC.';
  })();

  const guardrail =
    'These are rough averages — VERIFY with the host or local team. Industry + company culture overrides country defaults. When in doubt, dress one notch above what you think; over-formal beats under-formal in client-facing meetings.';

  return {
    status: 'ok',
    brief: { formality, men, women, layering, guardrail },
    message: `Dress code brief: ${cc}/${input.industry}/${input.meetingType} → ${formality}.`,
  };
}

const businessDressCodeBriefTool: ToolDef = {
  name: 'business_dress_code_brief',
  internal: true,
  experimental: true,
  description:
    "Recommend clothing for a business meeting based on country + city + industry + meeting type + climate. Pure curated tables; explicit 'verify with host' guardrail in output. Use when traveler asks 'what should I wear to my meeting in <city>'.",
  inputSchema: dressCodeInput,
  jsonSchema: {
    type: 'object',
    required: ['countryCode'],
    properties: {
      countryCode: { type: 'string', minLength: 2, maxLength: 2 },
      city: { type: 'string', maxLength: 120 },
      industry: {
        type: 'string',
        enum: ['banking', 'consulting', 'tech', 'creative', 'legal', 'government', 'manufacturing', 'unknown'],
      },
      meetingType: {
        type: 'string',
        enum: ['client_pitch', 'internal_meeting', 'client_dinner', 'conference', 'site_visit', 'unknown'],
      },
      climate: { type: 'string', enum: ['warm', 'cool', 'cold', 'tropical_humid', 'unknown'] },
    },
  },
  handler: runBusinessDressCodeBrief,
};

// ── 5. local_business_protocol_brief (Vertex grounded) ───────────────

const protocolInput = z.object({
  countryCode: z.string().length(2),
  city: z.string().max(120).optional(),
  meetingContext: z.enum(['first_meeting', 'closing_deal', 'client_dinner', 'office_visit', 'conference', 'general']).default('first_meeting'),
  travelerNationalityCode: z.string().length(2).optional(),
  locale: z.string().min(2).max(10).default('en-US'),
});
type ProtocolInput = z.infer<typeof protocolInput>;

const protocolShape = z.object({
  greetingProtocol: z.string(),
  giftConventions: z.string(),
  cardExchange: z.string(),
  punctualityNorm: z.string(),
  toastingProtocol: z.string().nullable(),
  taboos: z.array(z.string()).max(8),
  notes: z.string().nullable(),
});

async function runLocalBusinessProtocolBrief(
  rawInput: ProtocolInput,
  ctx?: ToolContext
): Promise<{ status: 'ok' | 'unavailable' | 'production_refused'; message: string; brief?: z.infer<typeof protocolShape>; via?: 'vertex' | 'gateway' }> {
  const gate = assertDevOnlyToolAllowed(ctx);
  if (gate.allowed === false) return { status: 'production_refused', message: gate.reason };

  const input = protocolInput.parse(rawInput);
  const groundingPrompt = `Provide practical business etiquette for a foreigner meeting local counterparts in ${input.countryCode}${input.city ? ` (specifically ${input.city})` : ''} for a ${input.meetingContext} context. Cover: greeting protocol (handshake / bow / kiss), business card exchange ritual (give/receive with one or two hands?), punctuality norms, gift conventions, toasting protocol if dinners are involved, and taboos to avoid (topics, gestures, food). Only include verifiable, widely-documented norms; never invent.`;
  const coercePrompt = (text: string, sources: string[]) => `Coerce into the protocol schema. Locale: ${input.locale}.

Report:
"""
${text}
"""

Sources cited:
${sources.slice(0, 6).map((u, i) => `${i + 1}. ${u}`).join('\n')}`;

  const vertex = resolveVertex();
  async function viaPath(modelLike: any, providerOptions?: any) {
    const grounded = await generateText({
      model: modelLike,
      tools: { google_search: vertex ? vertex.tools.googleSearch({}) : google.tools.googleSearch({}) },
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
      schema: protocolShape,
      prompt: coercePrompt(text, sources),
      ...(providerOptions ? { providerOptions } : {}),
    });
    return coerced.object;
  }

  if (vertex) {
    try {
      const obj = await viaPath(vertex(VERTEX_MODEL_ID));
      if (obj) return { status: 'ok', brief: obj, via: 'vertex', message: `Protocol brief for ${input.countryCode} via Vertex.` };
    } catch {
      // fall through
    }
  }
  try {
    const obj = await viaPath(GATEWAY_MODEL_ID, { gateway: { order: ['google'] } });
    if (obj) return { status: 'ok', brief: obj, via: 'gateway', message: `Protocol brief via gateway.` };
    return { status: 'unavailable', message: 'No grounded data returned.' };
  } catch (err) {
    return { status: 'unavailable', message: `Vertex + gateway both failed: ${(err as Error).message ?? 'unknown'}.` };
  }
}

const localBusinessProtocolBriefTool: ToolDef = {
  name: 'local_business_protocol_brief',
  internal: true,
  experimental: true,
  description:
    'Practical business etiquette — greetings, card exchange, punctuality, gifts, toasts, taboos — for a country + meeting context. Vertex-grounded research with Gateway fallback. Use when traveler asks "Japan business protocol", "how do I greet in Korea", "qué llevar a una cena en China".',
  inputSchema: protocolInput,
  jsonSchema: {
    type: 'object',
    required: ['countryCode'],
    properties: {
      countryCode: { type: 'string', minLength: 2, maxLength: 2 },
      city: { type: 'string', maxLength: 120 },
      meetingContext: { type: 'string', enum: ['first_meeting', 'closing_deal', 'client_dinner', 'office_visit', 'conference', 'general'] },
      travelerNationalityCode: { type: 'string', minLength: 2, maxLength: 2 },
      locale: { type: 'string', minLength: 2, maxLength: 10 },
    },
  },
  handler: runLocalBusinessProtocolBrief,
};

// ── 6. expense_policy_checker ────────────────────────────────────────
// Pure rules-based: caller passes proposed expenses + policy; we report
// per-line verdict.
// ─────────────────────────────────────────────────────────────────────

const expensePolicyInput = z.object({
  expenses: z
    .array(
      z.object({
        category: z.enum(['flight', 'hotel_per_night', 'meal', 'ground_transport', 'incidental', 'entertainment', 'other']),
        amountUsd: z.number().nonnegative(),
        description: z.string().max(200).optional(),
      })
    )
    .min(1)
    .max(20),
  policy: z.object({
    flightCabin: z.enum(['economy', 'premium_economy', 'business', 'first']).default('economy'),
    flightCapUsd: z.number().nonnegative().default(2500),
    hotelPerNightUsd: z.number().nonnegative().default(220),
    mealPerDayUsd: z.number().nonnegative().default(80),
    perDiemTotalUsd: z.number().nonnegative().default(120),
    entertainmentAllowed: z.boolean().default(false),
  }),
  tripDays: z.number().int().min(1).max(60).default(1),
});
type ExpensePolicyInput = z.infer<typeof expensePolicyInput>;

interface ExpenseVerdict {
  category: string;
  amountUsd: number;
  verdict: 'within_policy' | 'over_policy' | 'requires_approval' | 'not_allowed';
  reason: string;
}

async function runExpensePolicyChecker(
  rawInput: ExpensePolicyInput,
  ctx?: ToolContext
): Promise<{
  status: 'ok' | 'production_refused';
  message: string;
  verdicts?: ExpenseVerdict[];
  totalUsd?: number;
  withinPolicy?: boolean;
}> {
  const gate = assertDevOnlyToolAllowed(ctx);
  if (gate.allowed === false) return { status: 'production_refused', message: gate.reason };

  const input = expensePolicyInput.parse(rawInput);
  const verdicts: ExpenseVerdict[] = [];

  // Aggregate meal across the trip — meals are per-day not per-row.
  const mealTotal = input.expenses.filter(e => e.category === 'meal').reduce((n, e) => n + e.amountUsd, 0);
  const mealCap = input.policy.mealPerDayUsd * input.tripDays;

  for (const exp of input.expenses) {
    if (exp.category === 'flight') {
      verdicts.push({
        category: 'flight',
        amountUsd: exp.amountUsd,
        verdict: exp.amountUsd <= input.policy.flightCapUsd ? 'within_policy' : 'over_policy',
        reason: `flight cap is $${input.policy.flightCapUsd} (cabin=${input.policy.flightCabin})`,
      });
    } else if (exp.category === 'hotel_per_night') {
      verdicts.push({
        category: 'hotel_per_night',
        amountUsd: exp.amountUsd,
        verdict: exp.amountUsd <= input.policy.hotelPerNightUsd ? 'within_policy' : 'requires_approval',
        reason: `per-night cap is $${input.policy.hotelPerNightUsd}`,
      });
    } else if (exp.category === 'meal') {
      verdicts.push({
        category: 'meal',
        amountUsd: exp.amountUsd,
        verdict:
          mealTotal <= mealCap
            ? 'within_policy'
            : exp.amountUsd === Math.max(...input.expenses.filter(e => e.category === 'meal').map(e => e.amountUsd))
              ? 'over_policy'
              : 'within_policy',
        reason: `trip meal cap = $${mealCap} ($${input.policy.mealPerDayUsd}/day × ${input.tripDays} days). Trip total: $${mealTotal}.`,
      });
    } else if (exp.category === 'entertainment') {
      verdicts.push({
        category: 'entertainment',
        amountUsd: exp.amountUsd,
        verdict: input.policy.entertainmentAllowed ? 'requires_approval' : 'not_allowed',
        reason: input.policy.entertainmentAllowed
          ? 'entertainment requires written manager approval before submission'
          : 'entertainment is not allowed under this policy',
      });
    } else {
      verdicts.push({
        category: exp.category,
        amountUsd: exp.amountUsd,
        verdict: 'within_policy',
        reason: 'no specific cap on this category',
      });
    }
  }

  const totalUsd = input.expenses.reduce((n, e) => n + e.amountUsd, 0);
  const withinPolicy = verdicts.every(v => v.verdict === 'within_policy');
  return {
    status: 'ok',
    verdicts,
    totalUsd,
    withinPolicy,
    message: withinPolicy
      ? `All ${verdicts.length} line items within policy. Total $${totalUsd}.`
      : `${verdicts.filter(v => v.verdict !== 'within_policy').length}/${verdicts.length} line items flagged.`,
  };
}

const expensePolicyCheckerTool: ToolDef = {
  name: 'expense_policy_checker',
  internal: true,
  experimental: true,
  description:
    'Check proposed expenses against company travel policy. Pure rules-based — caller passes expenses[] + policy{flightCabin, flightCapUsd, hotelPerNightUsd, mealPerDayUsd, ...}. Returns per-line verdict (within / over / requires_approval / not_allowed) + trip total. Use BEFORE the traveler books anything that\'s borderline.',
  inputSchema: expensePolicyInput,
  jsonSchema: {
    type: 'object',
    required: ['expenses', 'policy'],
    properties: {
      expenses: { type: 'array', minItems: 1, maxItems: 20 },
      policy: { type: 'object' },
      tripDays: { type: 'integer', minimum: 1, maximum: 60 },
    },
  },
  handler: runExpensePolicyChecker,
};

// ── 7. receipt_collection_assistant ──────────────────────────────────

const receiptInput = z.object({
  bookings: z
    .array(
      z.object({
        kind: z.enum(['flight', 'hotel', 'restaurant', 'transport', 'esim', 'other']),
        ref: z.string().min(1).max(120),
        date: z.string().optional(),
        amountUsd: z.number().nonnegative().optional(),
        receiptOnFile: z.boolean().default(false),
      })
    )
    .min(1)
    .max(40),
  travelerEmail: z.string().email().optional(),
});
type ReceiptInput = z.infer<typeof receiptInput>;

async function runReceiptCollectionAssistant(
  rawInput: ReceiptInput,
  ctx?: ToolContext
): Promise<{
  status: 'ok' | 'production_refused';
  message: string;
  missing?: Array<{ kind: string; ref: string; suggestedAction: string }>;
  pctComplete?: number;
}> {
  const gate = assertDevOnlyToolAllowed(ctx);
  if (gate.allowed === false) return { status: 'production_refused', message: gate.reason };

  const input = receiptInput.parse(rawInput);
  const missing = input.bookings.filter(b => !b.receiptOnFile);
  const pct = Math.round(((input.bookings.length - missing.length) / input.bookings.length) * 100);

  return {
    status: 'ok',
    pctComplete: pct,
    missing: missing.map(m => ({
      kind: m.kind,
      ref: m.ref,
      suggestedAction: m.kind === 'flight'
        ? `Pull from airline confirmation email or PNR ${m.ref} on the carrier's manage-booking page.`
        : m.kind === 'hotel'
          ? `Email the hotel for a folio referencing booking ${m.ref}.`
          : m.kind === 'restaurant'
            ? `If paid by card, request a copy via the issuing bank's transaction detail page.`
            : `Find ref ${m.ref} in the relevant inbox / wallet history.`,
    })),
    message: `${missing.length} receipts missing of ${input.bookings.length} bookings (${pct}% complete).`,
  };
}

const receiptCollectionAssistantTool: ToolDef = {
  name: 'receipt_collection_assistant',
  internal: true,
  experimental: true,
  description:
    'Track which trip bookings still need receipts attached. Returns per-row suggested action for each missing receipt. Use as a pre-expense-report step — agent can chase the traveler proactively in the days after a trip.',
  inputSchema: receiptInput,
  jsonSchema: {
    type: 'object',
    required: ['bookings'],
    properties: {
      bookings: { type: 'array', minItems: 1, maxItems: 40 },
      travelerEmail: { type: 'string' },
    },
  },
  handler: runReceiptCollectionAssistant,
};

// ── 8. vat_refund_researcher (Vertex grounded) ───────────────────────

const vatInput = z.object({
  countryCode: z.string().length(2),
  travelerNationalityCode: z.string().length(2).optional(),
  purchaseTotalUsd: z.number().nonnegative().optional(),
  locale: z.string().min(2).max(10).default('en-US'),
});
type VatInput = z.infer<typeof vatInput>;

const vatShape = z.object({
  eligible: z.boolean(),
  minimumPurchase: z.string().nullable(),
  vatRatePct: z.string().nullable(),
  refundProcess: z.array(z.string()).max(6),
  airportProcess: z.string().nullable(),
  documentsRequired: z.array(z.string()).max(6),
  notes: z.string().nullable(),
});

async function runVatRefundResearcher(
  rawInput: VatInput,
  ctx?: ToolContext
): Promise<{ status: 'ok' | 'unavailable' | 'production_refused'; message: string; refund?: z.infer<typeof vatShape>; via?: 'vertex' | 'gateway' }> {
  const gate = assertDevOnlyToolAllowed(ctx);
  if (gate.allowed === false) return { status: 'production_refused', message: gate.reason };

  const input = vatInput.parse(rawInput);
  const groundingPrompt = `Research VAT refund / tax-free shopping rules for a tourist visiting ${input.countryCode}${input.travelerNationalityCode ? ` (passport ${input.travelerNationalityCode})` : ''}. Cover: minimum purchase amount, VAT rate, step-by-step refund process (in-store + at airport / departure), required documents (passport, original receipts, tax-free form). Cite official tax authority + aggregator sites. Never invent rates.`;
  const coercePrompt = (text: string, sources: string[]) => `Coerce into VAT refund schema. Locale: ${input.locale}.

Report:
"""
${text}
"""

Sources:
${sources.slice(0, 6).map((u, i) => `${i + 1}. ${u}`).join('\n')}`;

  const vertex = resolveVertex();
  async function viaPath(modelLike: any, providerOptions?: any) {
    const grounded = await generateText({
      model: modelLike,
      tools: { google_search: vertex ? vertex.tools.googleSearch({}) : google.tools.googleSearch({}) },
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
      schema: vatShape,
      prompt: coercePrompt(text, sources),
      ...(providerOptions ? { providerOptions } : {}),
    });
    return coerced.object;
  }

  if (vertex) {
    try {
      const obj = await viaPath(vertex(VERTEX_MODEL_ID));
      if (obj) return { status: 'ok', refund: obj, via: 'vertex', message: `VAT refund brief for ${input.countryCode} via Vertex (eligible=${obj.eligible}).` };
    } catch {}
  }
  try {
    const obj = await viaPath(GATEWAY_MODEL_ID, { gateway: { order: ['google'] } });
    if (obj) return { status: 'ok', refund: obj, via: 'gateway', message: `VAT refund brief via gateway.` };
    return { status: 'unavailable', message: 'No grounded data returned.' };
  } catch (err) {
    return { status: 'unavailable', message: `Vertex + gateway both failed: ${(err as Error).message ?? 'unknown'}.` };
  }
}

const vatRefundResearcherTool: ToolDef = {
  name: 'vat_refund_researcher',
  internal: true,
  experimental: true,
  description:
    'Research VAT refund / tax-free shopping for a country + traveler nationality. Vertex-grounded with Gateway fallback. Returns minimum purchase, VAT rate, refund process steps, airport process, required documents. Use when traveler asks "VAT refund France", "tax-free shopping <country>", "Global Blue".',
  inputSchema: vatInput,
  jsonSchema: {
    type: 'object',
    required: ['countryCode'],
    properties: {
      countryCode: { type: 'string', minLength: 2, maxLength: 2 },
      travelerNationalityCode: { type: 'string', minLength: 2, maxLength: 2 },
      purchaseTotalUsd: { type: 'number', minimum: 0 },
      locale: { type: 'string', minLength: 2, maxLength: 10 },
    },
  },
  handler: runVatRefundResearcher,
};

// ── 9. corporate_travel_risk_digest ──────────────────────────────────

const riskDigestInput = z.object({
  city: z.string().min(1).max(120),
  countryCode: z.string().length(2).optional(),
  windowDays: z.number().int().min(1).max(30).default(7),
  travelerCount: z.number().int().min(1).max(50).default(1),
});
type RiskDigestInput = z.infer<typeof riskDigestInput>;

interface RiskDigest {
  topRisks?: string[];
  travelAdvisory?: string;
  recommendations?: string[];
}

async function runCorporateTravelRiskDigest(
  rawInput: RiskDigestInput,
  ctx?: ToolContext
): Promise<{ status: 'ok' | 'unavailable' | 'production_refused'; message: string; digest?: RiskDigest; via?: 'vertex' | 'gateway' }> {
  const gate = assertDevOnlyToolAllowed(ctx);
  if (gate.allowed === false) return { status: 'production_refused', message: gate.reason };

  const input = riskDigestInput.parse(rawInput);
  const groundingPrompt = `Summarize current travel risk for business travelers visiting ${input.city}${input.countryCode ? ` (${input.countryCode})` : ''} over the next ${input.windowDays} days. Cover: top 3-5 specific risks (protests, strikes, weather events, security advisories, transit disruptions), the official government travel advisory level (US State Dept / UK FCDO / equivalent), and 3-4 concrete recommendations for ${input.travelerCount} travelers. Pull from Reuters / AP / official advisories. Never speculate.`;

  const digestShape = z.object({
    topRisks: z.array(z.string()).max(6),
    travelAdvisory: z.string(),
    recommendations: z.array(z.string()).max(6),
  });

  const vertex = resolveVertex();
  async function viaPath(modelLike: any, providerOptions?: any) {
    const grounded = await generateText({
      model: modelLike,
      tools: { google_search: vertex ? vertex.tools.googleSearch({}) : google.tools.googleSearch({}) },
      prompt: groundingPrompt,
      ...(providerOptions ? { providerOptions } : {}),
    });
    const text = grounded.text?.trim() ?? '';
    if (!text) return null;
    const coerced = await generateObject({
      model: modelLike,
      schema: digestShape,
      prompt: `Coerce this travel-risk report into the schema:\n${text}`,
      ...(providerOptions ? { providerOptions } : {}),
    });
    return coerced.object;
  }

  if (vertex) {
    try {
      const obj = await viaPath(vertex(VERTEX_MODEL_ID));
      if (obj) return { status: 'ok', digest: obj, via: 'vertex', message: `Risk digest for ${input.city} via Vertex.` };
    } catch {}
  }
  try {
    const obj = await viaPath(GATEWAY_MODEL_ID, { gateway: { order: ['google'] } });
    if (obj) return { status: 'ok', digest: obj, via: 'gateway', message: `Risk digest via gateway.` };
    return { status: 'unavailable', message: 'No grounded data returned.' };
  } catch (err) {
    return { status: 'unavailable', message: `Vertex + gateway both failed: ${(err as Error).message ?? 'unknown'}.` };
  }
}

const corporateTravelRiskDigestTool: ToolDef = {
  name: 'corporate_travel_risk_digest',
  internal: true,
  experimental: true,
  description:
    "Daily risk digest for travel teams — top 3-5 specific risks (protests, strikes, weather, security advisories, transit) + official advisory level + recommendations. Vertex-grounded research with Gateway fallback. Compose with `crowd_level_predictor` for full city-pulse picture.",
  inputSchema: riskDigestInput,
  jsonSchema: {
    type: 'object',
    required: ['city'],
    properties: {
      city: { type: 'string', minLength: 1, maxLength: 120 },
      countryCode: { type: 'string', minLength: 2, maxLength: 2 },
      windowDays: { type: 'integer', minimum: 1, maximum: 30 },
      travelerCount: { type: 'integer', minimum: 1, maximum: 50 },
    },
  },
  handler: runCorporateTravelRiskDigest,
};

// ── 10. meeting_commute_planner ──────────────────────────────────────
// Pure heuristic. Real impl uses Routes API (we already have
// `airportTransferCoordinator` for similar shape); v0.1 uses curated
// city-typical buffers.
// ─────────────────────────────────────────────────────────────────────

const commutePlannerInput = z.object({
  city: z.string().min(1).max(120),
  countryCode: z.string().length(2).optional(),
  meetingAtIso: z.string(),
  origin: z.enum(['hotel', 'airport', 'home_office']).default('hotel'),
  /** Driving distance estimate (km) — caller has Routes API output. */
  drivingKm: z.number().nonnegative().max(120).optional(),
  /** Public transit available? */
  transitAvailable: z.boolean().default(true),
});
type CommutePlannerInput = z.infer<typeof commutePlannerInput>;

const RUSH_HOUR_BUFFER_BY_CITY: Record<string, number> = {
  'mexico city': 1.6,
  'sao paulo': 1.7,
  'mumbai': 1.8,
  'jakarta': 1.8,
  'cairo': 1.6,
  'lagos': 1.8,
  'london': 1.4,
  'new york': 1.45,
  'paris': 1.4,
  'tokyo': 1.3,
  'seoul': 1.4,
  'bangkok': 1.7,
  'manila': 1.7,
  'istanbul': 1.55,
};

async function runMeetingCommutePlanner(
  rawInput: CommutePlannerInput,
  ctx?: ToolContext
): Promise<{
  status: 'ok' | 'production_refused';
  message: string;
  leaveByIso?: string;
  bufferMinutes?: number;
  modeRecommendation?: string;
  notes?: string[];
}> {
  const gate = assertDevOnlyToolAllowed(ctx);
  if (gate.allowed === false) return { status: 'production_refused', message: gate.reason };

  const input = commutePlannerInput.parse(rawInput);
  const meetingAt = new Date(input.meetingAtIso);
  if (Number.isNaN(meetingAt.getTime())) {
    return { status: 'ok', message: 'Invalid meetingAtIso.' };
  }

  const cityKey = input.city.trim().toLowerCase();
  const rushFactor = RUSH_HOUR_BUFFER_BY_CITY[cityKey] ?? 1.3;
  const meetingHour = meetingAt.getHours();
  const isRushHour = (meetingHour >= 7 && meetingHour <= 10) || (meetingHour >= 17 && meetingHour <= 19);

  // Base minutes from origin.
  const baseMinutes = input.origin === 'airport' ? 50 : input.origin === 'home_office' ? 25 : 20;
  const drivingMinutes = input.drivingKm ? Math.max(input.drivingKm * 2.5, 10) : baseMinutes;
  const adjusted = drivingMinutes * (isRushHour ? rushFactor : 1.0);
  const safetyBuffer = 10; // never arrive at the door of a meeting on time
  const totalMinutes = Math.ceil(adjusted + safetyBuffer);

  const leaveBy = new Date(meetingAt.getTime() - totalMinutes * 60_000);
  const modeRecommendation =
    !input.transitAvailable
      ? 'taxi / arranged car only'
      : isRushHour
        ? 'public transit if available — taxi will sit in traffic'
        : 'taxi or transit, your call';

  const notes: string[] = [];
  if (isRushHour) notes.push(`Rush-hour multiplier (${rushFactor.toFixed(2)}×) applied — ${cityKey === 'tokyo' ? 'Tokyo rush is mostly transit congestion, not road' : 'roads will be slow'}.`);
  if (input.origin === 'airport') notes.push('Airport→meeting transfers should add ~15min for terminal egress + bag claim if checked.');
  if (totalMinutes > 90) notes.push('Total travel >90min — strongly consider rescheduling to a later slot if any flexibility.');

  return {
    status: 'ok',
    leaveByIso: leaveBy.toISOString(),
    bufferMinutes: totalMinutes,
    modeRecommendation,
    notes,
    message: `Leave by ${leaveBy.toISOString()} (${totalMinutes}min ahead, ${isRushHour ? 'rush-hour' : 'off-peak'}).`,
  };
}

const meetingCommutePlannerTool: ToolDef = {
  name: 'meeting_commute_planner',
  internal: true,
  experimental: true,
  description:
    'Calculate when to leave for a meeting. Pure heuristic — uses curated city rush-hour buffers + safety buffer. Compose with Routes API output by passing `drivingKm`. Use when traveler asks "what time should I leave for my <time> meeting".',
  inputSchema: commutePlannerInput,
  jsonSchema: {
    type: 'object',
    required: ['city', 'meetingAtIso'],
    properties: {
      city: { type: 'string', minLength: 1, maxLength: 120 },
      countryCode: { type: 'string', minLength: 2, maxLength: 2 },
      meetingAtIso: { type: 'string' },
      origin: { type: 'string', enum: ['hotel', 'airport', 'home_office'] },
      drivingKm: { type: 'number', minimum: 0, maximum: 120 },
      transitAvailable: { type: 'boolean' },
    },
  },
  handler: runMeetingCommutePlanner,
};

// ─────────────────────────────────────────────────────────────────────

export {
  clientDinnerRecommenderTool,
  executiveLoungeFinderTool,
  privateMeetingRoomFinderTool,
  businessDressCodeBriefTool,
  localBusinessProtocolBriefTool,
  expensePolicyCheckerTool,
  receiptCollectionAssistantTool,
  vatRefundResearcherTool,
  corporateTravelRiskDigestTool,
  meetingCommutePlannerTool,
};
