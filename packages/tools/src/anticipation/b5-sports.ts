/**
 * B5 — Sports / Fan Travel (7 tools).
 *
 * Composes existing primitives:
 *   - lookup_match_fixtures (stable Sendero tool) — fixture lookup
 *   - searchFlights / searchHotels — base trip primitives
 *   - venue_nearby_plan_builder — pre/post-match dinner+drinks
 *   - mainstream_event_discovery — Ticketmaster Sports segment
 *
 * Spec: docs/experimental-tools-wip/sendero_final_experimental_tool_roadmap.md §B5.
 *
 * All experimental + internal + dev-gated.
 */

import { google } from '@ai-sdk/google';
import { createVertex } from '@ai-sdk/google-vertex';
import { searchText } from '@sendero/google-places';
import { cseSearch } from '@sendero/web-search';
import { generateObject, generateText } from 'ai';
import { z } from 'zod';

import { assertDevOnlyToolAllowed } from '../dev-gate';
import { lookupMatchFixturesTool } from '../lookup-match-fixtures';
import type { ToolContext, ToolDef } from '../types';
import { runMainstreamEventDiscovery } from './mainstream-event-discovery';

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

// ── 1. team_travel_package_builder ───────────────────────────────────
// Composer that returns a structured "around the match" trip skeleton.
// Doesn't actually book — emits the chain the agent should run. Fixture
// resolution composes lookup_match_fixtures.

const teamTravelInput = z.object({
  team: z.string().min(1).max(120),
  competition: z.string().max(120).optional(),
  /** Origin city for the traveling fan. */
  originCity: z.string().min(1).max(120),
  originIata: z.string().length(3).optional(),
  fanCount: z.number().int().min(1).max(50).default(1),
  budgetTier: z.enum(['budget', 'medium', 'premium', 'splurge']).default('medium'),
  locale: z.string().min(2).max(10).default('en-US'),
  fixtureLimit: z.number().int().min(1).max(4).default(2),
});
type TeamTravelInput = z.infer<typeof teamTravelInput>;

interface TeamTravelLeg {
  fixtureSummary: string;
  matchDate: string;
  hostCity: string;
  airportIataHint: string | null;
  suggestedChain: string[];
}

async function runTeamTravelPackageBuilder(
  rawInput: TeamTravelInput,
  ctx?: ToolContext
): Promise<{
  status: 'ok' | 'unavailable' | 'production_refused';
  message: string;
  legs?: TeamTravelLeg[];
}> {
  const gate = assertDevOnlyToolAllowed(ctx);
  if (gate.allowed === false) return { status: 'production_refused', message: gate.reason };

  const input = teamTravelInput.parse(rawInput);
  const fixtureQuery = [input.team, input.competition, 'next fixtures'].filter(Boolean).join(' ');
  const fixtures = await lookupMatchFixturesTool.handler({
    query: fixtureQuery,
    limit: input.fixtureLimit,
    locale: input.locale,
  } as never);
  if (fixtures.status !== 'ok' || fixtures.fixtures.length === 0) {
    return {
      status: 'unavailable',
      message: `Couldn't surface fixtures for ${input.team}. ${fixtures.notes ?? 'try a different query phrasing.'}`,
    };
  }

  const legs: TeamTravelLeg[] = fixtures.fixtures.map(f => ({
    fixtureSummary: `${f.competition ?? 'Match'}: ${f.homeTeam} vs ${f.awayTeam}`,
    matchDate: f.kickoff,
    hostCity: f.city,
    airportIataHint: f.airportIataHint,
    suggestedChain: [
      `search_flights({origin: '${input.originIata ?? input.originCity}', destination: '${f.airportIataHint ?? f.city}', departAt: '${f.kickoff.slice(0, 10)}'})`,
      `search_hotels({city: '${f.city}', checkIn: '${f.kickoff.slice(0, 10)}', nights: 2, budgetTier: '${input.budgetTier}'})`,
      `mainstream_event_discovery({city: '${f.city}', segment: 'Sports', keyword: '${input.team}'})`,
      f.venue
        ? `venue_nearby_plan_builder({city: '${f.city}', venueName: '${f.venue}', eventStartsAtIso: '${f.kickoff}'})`
        : `cultural_attractions_finder({city: '${f.city}'})`,
      `away_fan_safety_brief({hostCity: '${f.city}', hostCountryCode: '${f.countryIso2 ?? 'XX'}', team: '${input.team}'})`,
    ],
  }));

  return {
    status: 'ok',
    legs,
    message: `${legs.length}-leg fan package for ${input.team}: ${legs.map(l => l.hostCity).join(' → ')}.`,
  };
}

const teamTravelPackageBuilderTool: ToolDef = {
  name: 'team_travel_package_builder',
  internal: true,
  experimental: true,
  description:
    "Build a multi-leg fan trip around a team's upcoming fixtures. Composes lookup_match_fixtures → search_flights → search_hotels → mainstream_event_discovery → venue_nearby_plan_builder → away_fan_safety_brief. Returns the chain the agent should execute. Use when traveler asks 'I want to follow Boca for the next 2 home games', 'Argentina World Cup package'.",
  inputSchema: teamTravelInput,
  jsonSchema: {
    type: 'object',
    required: ['team', 'originCity'],
    properties: {
      team: { type: 'string', minLength: 1, maxLength: 120 },
      competition: { type: 'string', maxLength: 120 },
      originCity: { type: 'string', minLength: 1, maxLength: 120 },
      originIata: { type: 'string', minLength: 3, maxLength: 3 },
      fanCount: { type: 'integer', minimum: 1, maximum: 50 },
      budgetTier: { type: 'string', enum: ['budget', 'medium', 'premium', 'splurge'] },
      locale: { type: 'string', minLength: 2, maxLength: 10 },
      fixtureLimit: { type: 'integer', minimum: 1, maximum: 4 },
    },
  },
  handler: runTeamTravelPackageBuilder,
};

// ── 2. stadium_day_plan ──────────────────────────────────────────────

const stadiumDayInput = z.object({
  city: z.string().min(1).max(120),
  countryCode: z.string().length(2).optional(),
  stadiumName: z.string().min(1).max(200),
  matchAtIso: z.string(),
  arrivalBufferMinutes: z.number().int().min(30).max(240).default(120),
  fanCount: z.number().int().min(1).max(50).default(1),
  languageCode: z.string().max(10).default('en'),
});
type StadiumDayInput = z.infer<typeof stadiumDayInput>;

interface StadiumDayPlan {
  preMatch: { name: string; window: string; rationale: string; url?: string } | null;
  arrivalGuide: { leaveByIso: string; arriveByIso: string; tips: string[] };
  postMatch: { name: string; window: string; rationale: string; url?: string } | null;
}

async function runStadiumDayPlan(
  rawInput: StadiumDayInput,
  ctx?: ToolContext
): Promise<{
  status: 'ok' | 'unavailable' | 'production_refused';
  message: string;
  plan?: StadiumDayPlan;
}> {
  const gate = assertDevOnlyToolAllowed(ctx);
  if (gate.allowed === false) return { status: 'production_refused', message: gate.reason };

  const input = stadiumDayInput.parse(rawInput);
  const matchAt = new Date(input.matchAtIso);
  if (Number.isNaN(matchAt.getTime()))
    return { status: 'unavailable', message: 'Invalid matchAtIso.' };

  const arriveBy = new Date(matchAt.getTime() - input.arrivalBufferMinutes * 60_000);
  const leaveBy = new Date(arriveBy.getTime() - 30 * 60_000);

  // Pre-match: meal nearby that's open early enough.
  const preP = searchText({
    query: `restaurant pub near ${input.stadiumName} ${input.city}`,
    limit: 5,
    languageCode: input.languageCode,
    ...(input.countryCode ? { regionCode: input.countryCode } : {}),
  });
  // Post-match: bar / casual food.
  const postP = searchText({
    query: `bar pub near ${input.stadiumName} ${input.city}`,
    limit: 5,
    languageCode: input.languageCode,
    ...(input.countryCode ? { regionCode: input.countryCode } : {}),
  });
  const [pre, post] = await Promise.all([preP, postP]);

  const preTop = pre.available
    ? (pre.results.find(p => (p.rating ?? 0) >= 4.0 && (p.userRatingCount ?? 0) >= 200) ??
      pre.results[0])
    : undefined;
  const postTop = post.available
    ? (post.results.find(p => (p.rating ?? 0) >= 4.0 && (p.userRatingCount ?? 0) >= 200) ??
      post.results[0])
    : undefined;

  const tips: string[] = [
    'Carry the ticket on phone + a screenshot — gate scanners can be flaky.',
    `Match starts ${matchAt.toISOString()}; gates typically open 90 minutes prior.`,
    `Group of ${input.fanCount}: agree on a meeting point at the stadium BEFORE entering — phone signal dies inside.`,
  ];
  if (input.fanCount >= 6)
    tips.push('Groups of 6+: consider arranging two cabs going in (one going out is much harder).');

  return {
    status: 'ok',
    plan: {
      preMatch: preTop
        ? {
            name: preTop.name,
            window: `${leaveBy.toISOString().slice(11, 16)} → ${arriveBy.toISOString().slice(11, 16)}`,
            rationale: `${preTop.rating?.toFixed(1) ?? '?'}★ over ${preTop.userRatingCount ?? 0} reviews — close to ${input.stadiumName}.`,
            ...(preTop.website ? { url: preTop.website } : {}),
          }
        : null,
      arrivalGuide: {
        leaveByIso: leaveBy.toISOString(),
        arriveByIso: arriveBy.toISOString(),
        tips,
      },
      postMatch: postTop
        ? {
            name: postTop.name,
            window: `${new Date(matchAt.getTime() + 110 * 60_000).toISOString().slice(11, 16)} onward`,
            rationale: `Post-match crowd-tolerant pub near ${input.stadiumName}.`,
            ...(postTop.website ? { url: postTop.website } : {}),
          }
        : null,
    },
    message: `Stadium day plan for ${input.stadiumName} (${input.city}) — match at ${matchAt.toISOString()}.`,
  };
}

const stadiumDayPlanTool: ToolDef = {
  name: 'stadium_day_plan',
  internal: true,
  experimental: true,
  description:
    "Plan a full match day around a specific stadium — pre-match meal + arrival timing + post-match bar. Pure heuristics + Places nearby. Use after `team_travel_package_builder` chooses the leg, or when the traveler already has a ticket and asks 'plan my match day at <stadium>'.",
  inputSchema: stadiumDayInput,
  jsonSchema: {
    type: 'object',
    required: ['city', 'stadiumName', 'matchAtIso'],
    properties: {
      city: { type: 'string', minLength: 1, maxLength: 120 },
      countryCode: { type: 'string', minLength: 2, maxLength: 2 },
      stadiumName: { type: 'string', minLength: 1, maxLength: 200 },
      matchAtIso: { type: 'string' },
      arrivalBufferMinutes: { type: 'integer', minimum: 30, maximum: 240 },
      fanCount: { type: 'integer', minimum: 1, maximum: 50 },
      languageCode: { type: 'string', maxLength: 10 },
    },
  },
  handler: runStadiumDayPlan,
};

// ── 3. away_fan_safety_brief (Vertex grounded) ───────────────────────

const awayFanSafetyInput = z.object({
  hostCity: z.string().min(1).max(120),
  hostCountryCode: z.string().length(2),
  team: z.string().min(1).max(120),
  rivalry: z.enum(['low', 'medium', 'high', 'derby']).default('medium'),
  locale: z.string().min(2).max(10).default('en-US'),
});
type AwayFanSafetyInput = z.infer<typeof awayFanSafetyInput>;

const awayFanSafetyShape = z.object({
  generalRiskLevel: z.enum(['low', 'medium', 'high']),
  awaySectionGuidance: z.string(),
  whatToWear: z.string(),
  whatNotToWear: z.string(),
  arrivalEgressTips: z.array(z.string()).max(6),
  postMatchSafety: z.string(),
  emergencyNotes: z.array(z.string()).max(4),
});

async function runAwayFanSafetyBrief(
  rawInput: AwayFanSafetyInput,
  ctx?: ToolContext
): Promise<{
  status: 'ok' | 'unavailable' | 'production_refused';
  message: string;
  brief?: z.infer<typeof awayFanSafetyShape>;
  via?: 'vertex' | 'gateway';
}> {
  const gate = assertDevOnlyToolAllowed(ctx);
  if (gate.allowed === false) return { status: 'production_refused', message: gate.reason };

  const input = awayFanSafetyInput.parse(rawInput);
  const groundingPrompt = `Provide cautious, practical safety guidance for an away fan of ${input.team} traveling to ${input.hostCity}, ${input.hostCountryCode}. Rivalry level: ${input.rivalry}. Cover: general risk level, away-section guidance (where to enter, who to look for), what to wear and not wear, arrival/egress tips, post-match safety considerations, emergency notes. Pull from official club + UEFA/FIFA away-supporter guidance + recent reporting. Never sensationalize or speculate.`;
  const coercePrompt = (
    text: string,
    sources: string[]
  ) => `Coerce this safety report into the schema. Locale: ${input.locale}.

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
      schema: awayFanSafetyShape,
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
          brief: obj,
          via: 'vertex',
          message: `Away-fan safety brief for ${input.hostCity} via Vertex (risk=${obj.generalRiskLevel}).`,
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
        message: `Away-fan safety brief via gateway.`,
      };
    return { status: 'unavailable', message: 'No grounded data returned.' };
  } catch (err) {
    return {
      status: 'unavailable',
      message: `Vertex + gateway both failed: ${(err as Error).message ?? 'unknown'}.`,
    };
  }
}

const awayFanSafetyBriefTool: ToolDef = {
  name: 'away_fan_safety_brief',
  internal: true,
  experimental: true,
  description:
    'Cautious safety guidance for away fans — risk level, away-section logistics, what to wear/not wear, arrival/egress tips, post-match safety, emergency notes. Vertex-grounded research with Gateway fallback. Use whenever the traveler is going to a derby, high-rivalry, or international away match.',
  inputSchema: awayFanSafetyInput,
  jsonSchema: {
    type: 'object',
    required: ['hostCity', 'hostCountryCode', 'team'],
    properties: {
      hostCity: { type: 'string', minLength: 1, maxLength: 120 },
      hostCountryCode: { type: 'string', minLength: 2, maxLength: 2 },
      team: { type: 'string', minLength: 1, maxLength: 120 },
      rivalry: { type: 'string', enum: ['low', 'medium', 'high', 'derby'] },
      locale: { type: 'string', minLength: 2, maxLength: 10 },
    },
  },
  handler: runAwayFanSafetyBrief,
};

// ── 4. ticket_resale_risk_checker (pure rules + URL heuristics) ──────

const resaleInput = z.object({
  url: z.string().url(),
  askingPrice: z.number().min(0).max(50_000).optional(),
  faceValue: z.number().min(0).max(50_000).optional(),
  /** Sport/event context — different sports have different scam patterns. */
  context: z.enum(['football', 'concert', 'theater', 'general']).default('general'),
});
type ResaleInput = z.infer<typeof resaleInput>;

interface ResaleVerdict {
  riskLevel: 'low' | 'medium' | 'high' | 'avoid';
  flags: string[];
  recommendations: string[];
}

const TRUSTED_RESALE_HOSTS = new Set([
  'ticketmaster.com',
  'stubhub.com',
  'seatgeek.com',
  'vividseats.com',
  'viagogo.com',
  'eventim.de',
  'live-nation.com',
  'songkick.com',
]);

async function runTicketResaleRiskChecker(
  rawInput: ResaleInput,
  ctx?: ToolContext
): Promise<{ status: 'ok' | 'production_refused'; message: string; verdict?: ResaleVerdict }> {
  const gate = assertDevOnlyToolAllowed(ctx);
  if (gate.allowed === false) return { status: 'production_refused', message: gate.reason };

  const input = resaleInput.parse(rawInput);
  const flags: string[] = [];
  const recommendations: string[] = [];

  let host = '';
  try {
    host = new URL(input.url).host.replace(/^www\./, '').toLowerCase();
  } catch {
    flags.push('URL is malformed.');
  }

  let level: ResaleVerdict['riskLevel'] = 'medium';
  if (host && TRUSTED_RESALE_HOSTS.has(host)) {
    level = 'low';
    recommendations.push('Listing is on a known platform with buyer protection.');
  } else if (host) {
    flags.push(`Unknown reseller (${host}) — fraud risk is materially higher.`);
    level = 'high';
  }

  if (input.askingPrice && input.faceValue) {
    const ratio = input.askingPrice / input.faceValue;
    if (ratio > 4) {
      flags.push(
        `Asking ${ratio.toFixed(1)}× face value — extreme markup; check secondary platforms first.`
      );
      level = level === 'low' ? 'medium' : level;
    } else if (ratio < 0.4) {
      flags.push(
        `Asking ${ratio.toFixed(1)}× face value — suspiciously cheap; classic scam pattern.`
      );
      level = 'avoid';
    }
  }

  if (input.context === 'football') {
    recommendations.push(
      "For football: many leagues void resale tickets that aren't transferred via the official app — verify before buying."
    );
  }
  if (level !== 'low') {
    recommendations.push(
      'Pay only via methods with chargeback protection (credit card or PayPal goods+services). Never via wire or crypto.'
    );
    recommendations.push(
      "Ask for the seller's purchase confirmation screenshot WITH the order number visible — and verify on the official site."
    );
  }

  return {
    status: 'ok',
    verdict: { riskLevel: level, flags, recommendations },
    message: `Resale risk: ${level} (${flags.length} flags).`,
  };
}

const ticketResaleRiskCheckerTool: ToolDef = {
  name: 'ticket_resale_risk_checker',
  internal: true,
  description:
    'Evaluate resale-ticket risk on a URL + asking price. Pure heuristic — checks reseller against a trusted-host list, flags extreme markup or suspicious cheap pricing, surfaces sport-specific gotchas (football transfer-app rules, etc.), recommends safe payment methods. Use BEFORE the traveler hits "buy" on a non-Ticketmaster listing.',
  inputSchema: resaleInput,
  jsonSchema: {
    type: 'object',
    required: ['url'],
    properties: {
      url: { type: 'string', format: 'uri' },
      askingPrice: { type: 'number', minimum: 0, maximum: 50000 },
      faceValue: { type: 'number', minimum: 0, maximum: 50000 },
      context: { type: 'string', enum: ['football', 'concert', 'theater', 'general'] },
    },
  },
  handler: runTicketResaleRiskChecker,
};

// ── 5. sports_bar_finder ─────────────────────────────────────────────

const sportsBarInput = z.object({
  city: z.string().min(1).max(120),
  countryCode: z.string().length(2).optional(),
  /** Sport / league watching for. */
  matchKind: z
    .enum(['football', 'nfl', 'mlb', 'nba', 'rugby', 'cricket', 'f1', 'tennis', 'general'])
    .default('football'),
  languageCode: z.string().max(10).default('en'),
  limit: z.number().int().min(1).max(15).default(8),
});
type SportsBarInput = z.infer<typeof sportsBarInput>;

const SPORT_KEYWORDS: Record<SportsBarInput['matchKind'], string> = {
  football: 'football soccer',
  nfl: 'NFL Sunday football',
  mlb: 'MLB baseball',
  nba: 'NBA basketball',
  rugby: 'rugby',
  cricket: 'cricket',
  f1: 'Formula 1 F1',
  tennis: 'tennis grand slam',
  general: 'sports',
};

async function runSportsBarFinder(
  rawInput: SportsBarInput,
  ctx?: ToolContext
): Promise<{
  status: 'ok' | 'unavailable' | 'production_refused';
  message: string;
  bars?: Array<{
    name: string;
    url?: string;
    rationale: string;
    rating?: number;
    reviewCount?: number;
  }>;
}> {
  const gate = assertDevOnlyToolAllowed(ctx);
  if (gate.allowed === false) return { status: 'production_refused', message: gate.reason };

  const input = sportsBarInput.parse(rawInput);
  const term = SPORT_KEYWORDS[input.matchKind];
  const places = await searchText({
    query: `${term} bar pub watch in ${input.city}`,
    limit: input.limit + 4,
    languageCode: input.languageCode,
    ...(input.countryCode ? { regionCode: input.countryCode } : {}),
  });
  if (!places.available) {
    return { status: 'unavailable', message: `Places unavailable: ${places.reason ?? 'unknown'}.` };
  }
  const bars = places.results
    .filter(p =>
      /\b(bar|pub|tavern|brew|sport|cervecer|bodeg)/i.test(
        `${p.name} ${p.editorialSummary ?? ''} ${p.types?.join(' ') ?? ''}`
      )
    )
    .slice(0, input.limit)
    .map(p => ({
      name: p.name,
      ...(p.website ? { url: p.website } : {}),
      rationale: `${p.rating?.toFixed(1) ?? '?'}★ over ${p.userRatingCount ?? 0} reviews · ${p.editorialSummary ?? p.formattedAddress ?? ''}`,
      ...(typeof p.rating === 'number' ? { rating: p.rating } : {}),
      ...(typeof p.userRatingCount === 'number' ? { reviewCount: p.userRatingCount } : {}),
    }));

  return {
    status: 'ok',
    bars,
    message: `${bars.length} sports bars in ${input.city} for ${input.matchKind}.`,
  };
}

const sportsBarFinderTool: ToolDef = {
  name: 'sports_bar_finder',
  internal: true,
  description:
    'Find bars to watch a match in a city — filtered by sport (football/NFL/NBA/F1/etc.). Places-only with sport-keyword tilt + name/editorial filter. Use when traveler asks "where to watch the game in <city>" / "ver el partido en <ciudad>".',
  inputSchema: sportsBarInput,
  jsonSchema: {
    type: 'object',
    required: ['city'],
    properties: {
      city: { type: 'string', minLength: 1, maxLength: 120 },
      countryCode: { type: 'string', minLength: 2, maxLength: 2 },
      matchKind: {
        type: 'string',
        enum: ['football', 'nfl', 'mlb', 'nba', 'rugby', 'cricket', 'f1', 'tennis', 'general'],
      },
      languageCode: { type: 'string', maxLength: 10 },
      limit: { type: 'integer', minimum: 1, maximum: 15 },
    },
  },
  handler: runSportsBarFinder,
};

// ── 6. match_postponement_monitor ────────────────────────────────────
// Pure check — caller passes original kickoff + freshly-fetched fixture
// info and we report whether anything changed. The actual webhook /
// polling lives outside this tool (Sendero scheduler).

const postponementInput = z.object({
  team: z.string().min(1).max(120),
  originalKickoffIso: z.string(),
  /** Latest known kickoff per a fresh fixture lookup. */
  latestKickoffIso: z.string(),
  /** Latest known venue. */
  latestVenue: z.string().max(200).optional(),
  /** Latest known status if reported. */
  latestStatus: z.string().max(80).optional(),
});
type PostponementInput = z.infer<typeof postponementInput>;

async function runMatchPostponementMonitor(
  rawInput: PostponementInput,
  ctx?: ToolContext
): Promise<{
  status: 'ok' | 'production_refused';
  message: string;
  changed: boolean;
  delta?: { kickoffShiftMinutes?: number; venueChanged?: boolean; statusChanged?: boolean };
  guidance?: string[];
}> {
  const gate = assertDevOnlyToolAllowed(ctx);
  if (gate.allowed === false)
    return { status: 'production_refused', message: gate.reason, changed: false };

  const input = postponementInput.parse(rawInput);
  const orig = new Date(input.originalKickoffIso).getTime();
  const latest = new Date(input.latestKickoffIso).getTime();
  if (Number.isNaN(orig) || Number.isNaN(latest)) {
    return { status: 'ok', message: 'One of the kickoff times is unparseable.', changed: false };
  }

  const shiftMinutes = Math.round((latest - orig) / 60_000);
  const venueChanged = !!input.latestVenue && false; // venue compare against prior would need prior venue; flag only as ◐
  const statusChanged =
    !!input.latestStatus && /postponed|cancelled|abandoned/i.test(input.latestStatus);
  const changed = shiftMinutes !== 0 || statusChanged;

  const guidance: string[] = [];
  if (Math.abs(shiftMinutes) >= 60)
    guidance.push('Kickoff moved >1h — re-check transit + dinner reservations.');
  if (Math.abs(shiftMinutes) >= 1440)
    guidance.push('Kickoff moved by >1 day — re-check flights + hotel nights.');
  if (statusChanged)
    guidance.push(
      `Match marked "${input.latestStatus}" — verify with the official source before traveling.`
    );

  return {
    status: 'ok',
    changed,
    delta: {
      ...(shiftMinutes !== 0 ? { kickoffShiftMinutes: shiftMinutes } : {}),
      ...(venueChanged ? { venueChanged: true } : {}),
      ...(statusChanged ? { statusChanged: true } : {}),
    },
    guidance,
    message: changed
      ? `Fixture changed: shift=${shiftMinutes}min${statusChanged ? `, status=${input.latestStatus}` : ''}.`
      : 'No change vs original kickoff.',
  };
}

const matchPostponementMonitorTool: ToolDef = {
  name: 'match_postponement_monitor',
  internal: true,
  description:
    'Detect fixture changes — caller passes original kickoff + latest known kickoff/venue/status from a fresh `lookup_match_fixtures` call. Returns `changed` flag + delta + guidance. Pure — schedule polling externally (Sendero scheduler) and feed into this tool.',
  inputSchema: postponementInput,
  jsonSchema: {
    type: 'object',
    required: ['team', 'originalKickoffIso', 'latestKickoffIso'],
    properties: {
      team: { type: 'string', minLength: 1, maxLength: 120 },
      originalKickoffIso: { type: 'string' },
      latestKickoffIso: { type: 'string' },
      latestVenue: { type: 'string', maxLength: 200 },
      latestStatus: { type: 'string', maxLength: 80 },
    },
  },
  handler: runMatchPostponementMonitor,
};

// ── 7. fan_group_coordination_tool ───────────────────────────────────

const fanGroupInput = z.object({
  groupName: z.string().min(1).max(120),
  members: z
    .array(
      z.object({
        name: z.string().min(1).max(80),
        homeIata: z.string().length(3).optional(),
        budgetTier: z.enum(['budget', 'medium', 'premium', 'splurge']).optional(),
        seatPreference: z
          .enum(['away_section', 'home_section', 'mixed', 'no_preference'])
          .optional(),
        wantsHotel: z.boolean().default(true),
      })
    )
    .min(2)
    .max(50),
  matchCity: z.string().min(1).max(120),
  matchAtIso: z.string(),
});
type FanGroupInput = z.infer<typeof fanGroupInput>;

async function runFanGroupCoordinationTool(
  rawInput: FanGroupInput,
  ctx?: ToolContext
): Promise<{
  status: 'ok' | 'production_refused';
  message: string;
  origins?: Record<string, number>;
  budgetMix?: Record<string, number>;
  consensus?: { recommendedTier: string; recommendedSection: string };
  recommendations?: string[];
}> {
  const gate = assertDevOnlyToolAllowed(ctx);
  if (gate.allowed === false) return { status: 'production_refused', message: gate.reason };

  const input = fanGroupInput.parse(rawInput);
  const origins: Record<string, number> = {};
  const budgetMix: Record<string, number> = {};
  const seatMix: Record<string, number> = {};
  for (const m of input.members) {
    if (m.homeIata) origins[m.homeIata] = (origins[m.homeIata] ?? 0) + 1;
    if (m.budgetTier) budgetMix[m.budgetTier] = (budgetMix[m.budgetTier] ?? 0) + 1;
    if (m.seatPreference) seatMix[m.seatPreference] = (seatMix[m.seatPreference] ?? 0) + 1;
  }

  // Consensus tier: lowest tier above the median (budget < medium < premium < splurge)
  const tierOrder = ['budget', 'medium', 'premium', 'splurge'];
  const declaredTiers = Object.entries(budgetMix);
  const recommendedTier =
    declaredTiers.length > 0
      ? (tierOrder.find(
          t => budgetMix[t] && budgetMix[t]! >= Math.ceil(input.members.length / 2)
        ) ?? 'medium')
      : 'medium';
  const recommendedSection = Object.entries(seatMix).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'mixed';

  const recommendations: string[] = [];
  if (Object.keys(origins).length >= 3) {
    recommendations.push(
      `Group spans ${Object.keys(origins).length} origin cities — book a meeting hotel near the stadium so transfers from each airport are simple.`
    );
  } else if (Object.keys(origins).length === 1) {
    recommendations.push(
      'Group all flying from one origin — book a single charter / group rate via the airline.'
    );
  }
  if (input.members.length >= 8) {
    recommendations.push(
      'Group ≥ 8: lock 1 person as "logistics lead" and run the trip in a shared sheet, not in chat.'
    );
  }
  if (
    declaredTiers.length > 0 &&
    declaredTiers.length === input.members.length &&
    new Set(declaredTiers.map(([t]) => t)).size > 2
  ) {
    recommendations.push(
      'Budget tier varies widely — consider 2 hotel options (one mid, one premium) so each person picks.'
    );
  }
  recommendations.push(
    'Pay tickets through one card → individual Venmo / Splitwise reimbursements. Avoids the trust hit of pooled pre-pay.'
  );

  return {
    status: 'ok',
    origins,
    budgetMix,
    consensus: { recommendedTier, recommendedSection },
    recommendations,
    message: `Group "${input.groupName}" (${input.members.length} fans → ${input.matchCity} on ${input.matchAtIso}). Consensus tier=${recommendedTier}, section=${recommendedSection}.`,
  };
}

const fanGroupCoordinationToolTool: ToolDef = {
  name: 'fan_group_coordination_tool',
  internal: true,
  description:
    'Coordinate group fan travel — aggregate per-member origin / budget tier / seat preference into a consensus + recommendations. Pure DB-only. Use when the traveler is leading a group of 4+ fans on a trip and wants a "how do we agree" briefing.',
  inputSchema: fanGroupInput,
  jsonSchema: {
    type: 'object',
    required: ['groupName', 'members', 'matchCity', 'matchAtIso'],
    properties: {
      groupName: { type: 'string', minLength: 1, maxLength: 120 },
      members: { type: 'array', minItems: 2, maxItems: 50 },
      matchCity: { type: 'string', minLength: 1, maxLength: 120 },
      matchAtIso: { type: 'string' },
    },
  },
  handler: runFanGroupCoordinationTool,
};

// ── exports ──────────────────────────────────────────────────────────

export {
  teamTravelPackageBuilderTool,
  stadiumDayPlanTool,
  awayFanSafetyBriefTool,
  ticketResaleRiskCheckerTool,
  sportsBarFinderTool,
  matchPostponementMonitorTool,
  fanGroupCoordinationToolTool,
  runTicketResaleRiskChecker,
  runMatchPostponementMonitor,
  runFanGroupCoordinationTool,
};
