/**
 * B1 — Research Infrastructure (7 tools).
 *
 * Spec: docs/experimental-tools-wip/sendero_final_experimental_tool_roadmap.md §B1.
 *
 * Foundation layer that every HP1/HP2/HP3 tool depends on for source
 * provenance + confidence scoring + cache + audit trail. None of these
 * touch external APIs except `official_source_resolver` (CSE) and
 * `agentic_research_planner` (LLM). The rest are pure / Redis / Phoenix.
 *
 * All experimental + internal + dev-gated.
 */

import { z } from 'zod';
import { generateObject } from 'ai';
import { google } from '@ai-sdk/google';
import { createVertex } from '@ai-sdk/google-vertex';

import { cseSearch } from '@sendero/web-search';

import { assertDevOnlyToolAllowed } from '../dev-gate';
import type { ToolContext, ToolDef } from '../types';

// ─────────────────────────────────────────────────────────────────────
// 1. official_source_resolver
// Find the canonical URL for a venue / airport / government / museum /
// restaurant / airline / embassy via CSE site-scoping.
// ─────────────────────────────────────────────────────────────────────

const SOURCE_KINDS = [
  'venue',
  'airport',
  'government',
  'museum',
  'restaurant',
  'ticketing',
  'airline',
  'embassy',
  'hotel',
  'gallery',
] as const;

const officialSourceResolverInput = z.object({
  name: z.string().min(1).max(200),
  city: z.string().max(120).optional(),
  countryCode: z.string().length(2).optional(),
  kind: z.enum(SOURCE_KINDS),
  languageCode: z.string().max(10).default('en'),
});
type OfficialSourceResolverInput = z.infer<typeof officialSourceResolverInput>;

interface OfficialSource {
  url: string;
  title: string;
  snippet: string;
  confidence: 'low' | 'medium' | 'high';
  reason: string;
}

type OfficialSourceResolverResult =
  | { status: 'ok'; sources: OfficialSource[]; message: string }
  | { status: 'unavailable'; reason: string; message: string }
  | { status: 'production_refused'; message: string };

const OFFICIAL_DOMAIN_HINTS: Record<(typeof SOURCE_KINDS)[number], string[]> = {
  venue: ['.com', '.co', '.net'],
  airport: ['flyaa.com', '.airport', 'aeropuerto'],
  government: ['.gov', '.gob', 'gouv.fr', '.go.', 'official', 'mae'],
  museum: ['museum', 'museo'],
  restaurant: ['.com', 'guide.michelin.com'],
  ticketing: ['ticketmaster.com', 'ticketek', 'eventbrite.com', 'songkick.com'],
  airline: ['airlines.com', 'airways.com', 'lufthansa', 'aerolineas', 'iata'],
  embassy: ['.gov', 'embassy', 'embajada', 'consulate', 'consul'],
  hotel: ['marriott.com', 'hilton.com', 'hyatt.com', 'fourseasons.com', 'aman.com'],
  gallery: ['galerie', 'gallery', 'kunst', 'arte'],
};

function scoreOfficialDomain(
  displayLink: string,
  kind: OfficialSourceResolverInput['kind']
): { confidence: 'low' | 'medium' | 'high'; reason: string } {
  const host = displayLink.toLowerCase();
  const hints = OFFICIAL_DOMAIN_HINTS[kind] ?? [];
  if (
    host.endsWith('.gov') ||
    host.endsWith('.gov.uk') ||
    host.endsWith('.gob.es') ||
    host.endsWith('.go.jp')
  ) {
    return { confidence: 'high', reason: 'government TLD' };
  }
  if (hints.some(h => host.includes(h)))
    return { confidence: 'high', reason: `matches official-domain hint for ${kind}` };
  // Wikipedia / generic encyclopedia is medium for context, not authoritative.
  if (host.includes('wikipedia.org'))
    return { confidence: 'medium', reason: 'encyclopedia source — context only' };
  // Travel aggregators are low (TripAdvisor, Yelp, etc.)
  if (
    host.includes('tripadvisor.com') ||
    host.includes('yelp.com') ||
    host.includes('viator.com')
  ) {
    return { confidence: 'low', reason: 'travel aggregator — not authoritative' };
  }
  return { confidence: 'medium', reason: 'unknown authority — caller should verify' };
}

async function runOfficialSourceResolver(
  rawInput: OfficialSourceResolverInput,
  ctx?: ToolContext
): Promise<OfficialSourceResolverResult> {
  const gate = assertDevOnlyToolAllowed(ctx);
  if (gate.allowed === false) return { status: 'production_refused', message: gate.reason };

  const input = officialSourceResolverInput.parse(rawInput);
  const q = [
    input.name,
    input.city,
    input.kind === 'embassy' ? 'embassy consulate' : 'official site',
  ]
    .filter(Boolean)
    .join(' ');
  const r = await cseSearch({
    query: q,
    limit: 8,
    lang: input.languageCode,
    ...(input.countryCode ? { country: input.countryCode } : {}),
  });
  if (!r.available) {
    return {
      status: 'unavailable',
      reason: r.reason ?? 'cse-unavailable',
      message: `CSE unavailable: ${r.reason ?? 'unknown'}.`,
    };
  }

  const sources: OfficialSource[] = r.results.slice(0, 5).map(hit => {
    const { confidence, reason } = scoreOfficialDomain(hit.displayLink, input.kind);
    return {
      url: hit.link,
      title: hit.title.trim(),
      snippet: hit.snippet,
      confidence,
      reason,
    };
  });

  // Sort by confidence — high first.
  sources.sort((a, b) => {
    const order = { high: 0, medium: 1, low: 2 } as const;
    return order[a.confidence] - order[b.confidence];
  });

  return {
    status: 'ok',
    sources,
    message: `${sources.length} candidate official sources for ${input.name} (${input.kind}).`,
  };
}

const officialSourceResolverTool: ToolDef<
  OfficialSourceResolverInput,
  OfficialSourceResolverResult
> = {
  name: 'official_source_resolver',
  internal: true,
  experimental: true,
  description:
    'Find authoritative URLs for a name + kind (venue, airport, government, museum, restaurant, ticketing, airline, embassy, hotel, gallery). CSE-scoped lookup with per-kind official-domain hints. Each result tagged with `confidence` (high / medium / low). Use as the first step of any deep-research chain — `monocle_place_researcher` and friends compose this when they need the canonical site URL.',
  inputSchema: officialSourceResolverInput,
  jsonSchema: {
    type: 'object',
    required: ['name', 'kind'],
    properties: {
      name: { type: 'string', minLength: 1, maxLength: 200 },
      city: { type: 'string', maxLength: 120 },
      countryCode: { type: 'string', minLength: 2, maxLength: 2 },
      kind: { type: 'string', enum: [...SOURCE_KINDS] },
      languageCode: { type: 'string', maxLength: 10 },
    },
  },
  handler: runOfficialSourceResolver,
};

// ─────────────────────────────────────────────────────────────────────
// 2. source_confidence_scorer
// Pure scorer over an array of source URLs.
// ─────────────────────────────────────────────────────────────────────

const sourceConfidenceScorerInput = z.object({
  sources: z
    .array(
      z.object({
        url: z.string().url(),
        title: z.string().max(200).optional(),
        publishedAtIso: z.string().optional(),
      })
    )
    .min(1)
    .max(20),
  /** Reference city — domains matching localTld for this country score higher. */
  countryCode: z.string().length(2).optional(),
  /** Category — adjusts authority weights. */
  category: z
    .enum(['restaurant', 'cafe', 'event', 'museum', 'safety', 'ticketing', 'general'])
    .default('general'),
});
type SourceConfidenceScorerInput = z.infer<typeof sourceConfidenceScorerInput>;

interface ScoredSource {
  url: string;
  authorityScore: number;
  freshnessScore: number;
  localityScore: number;
  combined: number;
  rationale: string;
}

const HIGH_AUTHORITY: Record<string, number> = {
  'guide.michelin.com': 1.0,
  'theworlds50best.com': 0.95,
  'eater.com': 0.85,
  'monocle.com': 0.85,
  'cntraveler.com': 0.75,
  'nytimes.com': 0.85,
  'theguardian.com': 0.8,
  'wallpaper.com': 0.8,
  'sprudge.com': 0.85,
  'ticketmaster.com': 0.75,
  'lonelyplanet.com': 0.7,
  'natgeo.com': 0.85,
  'nationalgeographic.com': 0.85,
  'reuters.com': 0.85,
  'bloomberg.com': 0.8,
  'apnews.com': 0.85,
  'wikipedia.org': 0.65,
  'tripadvisor.com': 0.4,
  'yelp.com': 0.45,
  'reddit.com': 0.5,
  'medium.com': 0.45,
  'substack.com': 0.5,
};

function authorityFor(host: string): number {
  for (const [domain, score] of Object.entries(HIGH_AUTHORITY)) {
    if (host === domain || host.endsWith(`.${domain}`)) return score;
  }
  if (host.endsWith('.gov') || host.includes('.gov.')) return 0.95;
  if (host.endsWith('.edu')) return 0.8;
  return 0.45;
}

function freshnessFor(publishedAtIso?: string): { score: number; reason: string } {
  if (!publishedAtIso) return { score: 0.5, reason: 'unknown publish date' };
  const ts = Date.parse(publishedAtIso);
  if (!Number.isFinite(ts)) return { score: 0.5, reason: 'unparseable date' };
  const ageDays = (Date.now() - ts) / 86_400_000;
  if (ageDays < 30) return { score: 1.0, reason: 'fresh (<30d)' };
  if (ageDays < 180) return { score: 0.85, reason: 'recent (<6mo)' };
  if (ageDays < 365) return { score: 0.7, reason: 'within 1y' };
  if (ageDays < 365 * 3) return { score: 0.55, reason: 'within 3y' };
  return { score: 0.35, reason: 'aging (>3y)' };
}

function localityFor(host: string, countryCode?: string): { score: number; reason: string } {
  if (!countryCode) return { score: 0.5, reason: 'no locality reference' };
  const cc = countryCode.toLowerCase();
  if (host.endsWith(`.${cc}`)) return { score: 1.0, reason: `local TLD .${cc}` };
  if (host.includes(`/${cc}/`)) return { score: 0.85, reason: `path includes /${cc}/` };
  return { score: 0.6, reason: 'no locality match' };
}

async function runSourceConfidenceScorer(
  rawInput: SourceConfidenceScorerInput,
  ctx?: ToolContext
): Promise<{ status: 'ok' | 'production_refused'; message: string; ranked?: ScoredSource[] }> {
  const gate = assertDevOnlyToolAllowed(ctx);
  if (gate.allowed === false) return { status: 'production_refused', message: gate.reason };

  const input = sourceConfidenceScorerInput.parse(rawInput);
  const ranked: ScoredSource[] = input.sources.map(s => {
    const host = (() => {
      try {
        return new URL(s.url).host.replace(/^www\./, '');
      } catch {
        return '';
      }
    })();
    const authority = authorityFor(host);
    const fresh = freshnessFor(s.publishedAtIso);
    const local = localityFor(host, input.countryCode);
    const combined = authority * 0.55 + fresh.score * 0.25 + local.score * 0.2;
    return {
      url: s.url,
      authorityScore: authority,
      freshnessScore: fresh.score,
      localityScore: local.score,
      combined,
      rationale: `${host}: authority=${authority.toFixed(2)}, ${fresh.reason}, ${local.reason}`,
    };
  });
  ranked.sort((a, b) => b.combined - a.combined);

  return {
    status: 'ok',
    ranked,
    message: `${ranked.length} sources scored — top: ${ranked[0]!.url} (${ranked[0]!.combined.toFixed(2)}).`,
  };
}

const sourceConfidenceScorerTool: ToolDef = {
  name: 'source_confidence_scorer',
  internal: true,
  description:
    'Pure scorer over an array of source URLs. Returns ranked list with authority + freshness + locality + combined score. Use as a middleware step before quoting any source to a traveler — the agent can drop low-confidence sources from the rationale.',
  inputSchema: sourceConfidenceScorerInput,
  jsonSchema: {
    type: 'object',
    required: ['sources'],
    properties: {
      sources: { type: 'array', minItems: 1, maxItems: 20 },
      countryCode: { type: 'string', minLength: 2, maxLength: 2 },
      category: {
        type: 'string',
        enum: ['restaurant', 'cafe', 'event', 'museum', 'safety', 'ticketing', 'general'],
      },
    },
  },
  handler: runSourceConfidenceScorer,
};

// ─────────────────────────────────────────────────────────────────────
// 3. research_audit_trail
// Pure tool — receives a recommendation + sources + tools + score, emits
// a structured audit-trail object. Stored externally (Phoenix span +
// Postgres ResearchAudit row) but the tool itself is shape-only so it
// works in test envs without those backends.
// ─────────────────────────────────────────────────────────────────────

const researchAuditTrailInput = z.object({
  recommendation: z.string().min(1).max(2000),
  toolsUsed: z.array(z.string().max(80)).min(1).max(20),
  sources: z
    .array(
      z.object({
        url: z.string().url(),
        title: z.string().max(200).optional(),
        confidence: z.enum(['low', 'medium', 'high']).optional(),
      })
    )
    .max(20),
  /** Final confidence assessment — agent self-reports. */
  finalConfidence: z.enum(['low', 'medium', 'high']),
  /** Optional Phoenix trace id for cross-reference. */
  traceId: z.string().max(80).optional(),
  /** Tenant + user — drawn from ctx but echoed for the audit row. */
  tenantId: z.string().max(80).optional(),
  travelerId: z.string().max(80).optional(),
});
type ResearchAuditTrailInput = z.infer<typeof researchAuditTrailInput>;

async function runResearchAuditTrail(
  rawInput: ResearchAuditTrailInput,
  ctx?: ToolContext
): Promise<{
  status: 'ok' | 'production_refused';
  message: string;
  auditId?: string;
  record?: ResearchAuditTrailInput & { recordedAt: string };
}> {
  const gate = assertDevOnlyToolAllowed(ctx);
  if (gate.allowed === false) return { status: 'production_refused', message: gate.reason };

  const input = researchAuditTrailInput.parse(rawInput);
  const auditId = `audit_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const record = { ...input, recordedAt: new Date().toISOString() };

  return {
    status: 'ok',
    auditId,
    record,
    message: `Audit ${auditId} recorded (${input.toolsUsed.length} tools, ${input.sources.length} sources, confidence=${input.finalConfidence}).`,
  };
}

const researchAuditTrailTool: ToolDef = {
  name: 'research_audit_trail',
  internal: true,
  description:
    'Record why Sendero made a recommendation — tools used, sources cited, final confidence. Returns an `auditId` the agent can quote in its reply ("audit ref: audit_…"). The structured record is suitable for Phoenix span attachment + Postgres ResearchAudit row.',
  inputSchema: researchAuditTrailInput,
  jsonSchema: {
    type: 'object',
    required: ['recommendation', 'toolsUsed', 'sources', 'finalConfidence'],
    properties: {
      recommendation: { type: 'string', minLength: 1, maxLength: 2000 },
      toolsUsed: {
        type: 'array',
        minItems: 1,
        maxItems: 20,
        items: { type: 'string', maxLength: 80 },
      },
      sources: { type: 'array', maxItems: 20 },
      finalConfidence: { type: 'string', enum: ['low', 'medium', 'high'] },
      traceId: { type: 'string', maxLength: 80 },
      tenantId: { type: 'string', maxLength: 80 },
      travelerId: { type: 'string', maxLength: 80 },
    },
  },
  handler: runResearchAuditTrail,
};

// ─────────────────────────────────────────────────────────────────────
// 4. source_cache_manager
// In-process LRU cache for v0.1 — promotes to Upstash Redis in v0.2 by
// swapping the storage layer.
// ─────────────────────────────────────────────────────────────────────

const sourceCacheManagerInput = z.object({
  op: z.enum(['get', 'set', 'invalidate']),
  key: z.string().min(1).max(400),
  value: z.unknown().optional(),
  ttlSeconds: z
    .number()
    .int()
    .min(60)
    .max(86_400 * 30)
    .default(86_400),
});
type SourceCacheManagerInput = z.infer<typeof sourceCacheManagerInput>;

interface CacheEntry {
  value: unknown;
  expiresAt: number;
}
const _cache = new Map<string, CacheEntry>();
const CACHE_MAX = 1024;

function evictExpired() {
  const now = Date.now();
  for (const [k, v] of _cache.entries()) if (v.expiresAt < now) _cache.delete(k);
  while (_cache.size > CACHE_MAX) {
    const k = _cache.keys().next().value;
    if (!k) break;
    _cache.delete(k);
  }
}

async function runSourceCacheManager(
  rawInput: SourceCacheManagerInput,
  ctx?: ToolContext
): Promise<{
  status: 'ok' | 'production_refused';
  message: string;
  hit?: boolean;
  value?: unknown;
}> {
  const gate = assertDevOnlyToolAllowed(ctx);
  if (gate.allowed === false) return { status: 'production_refused', message: gate.reason };

  const input = sourceCacheManagerInput.parse(rawInput);
  evictExpired();

  if (input.op === 'get') {
    const entry = _cache.get(input.key);
    if (!entry || entry.expiresAt < Date.now()) {
      return { status: 'ok', hit: false, message: `MISS ${input.key}` };
    }
    return { status: 'ok', hit: true, value: entry.value, message: `HIT ${input.key}` };
  }
  if (input.op === 'set') {
    _cache.set(input.key, { value: input.value, expiresAt: Date.now() + input.ttlSeconds * 1000 });
    return { status: 'ok', message: `SET ${input.key} ttl=${input.ttlSeconds}s` };
  }
  // invalidate
  _cache.delete(input.key);
  return { status: 'ok', message: `DEL ${input.key}` };
}

const sourceCacheManagerTool: ToolDef = {
  name: 'source_cache_manager',
  internal: true,
  description:
    'Cache layer for research outputs — get/set/invalidate by key (e.g. `coffee:Tokyo:en`). v0.1 is in-process LRU (process restart wipes); v0.2 promotes to Upstash Redis. Use to avoid burning CSE quota on hot queries.',
  inputSchema: sourceCacheManagerInput,
  jsonSchema: {
    type: 'object',
    required: ['op', 'key'],
    properties: {
      op: { type: 'string', enum: ['get', 'set', 'invalidate'] },
      key: { type: 'string', minLength: 1, maxLength: 400 },
      value: {},
      ttlSeconds: { type: 'integer', minimum: 60, maximum: 2592000 },
    },
  },
  handler: runSourceCacheManager,
};

// ─────────────────────────────────────────────────────────────────────
// 5. research_gap_router
// When research confidence is low or upstream tool failed, decide where
// to route next: try alternate strategy, ask traveler, or escalate.
// ─────────────────────────────────────────────────────────────────────

const researchGapRouterInput = z.object({
  intent: z.string().min(1).max(400),
  currentConfidence: z.enum(['low', 'medium', 'high']),
  attemptedTools: z.array(z.string().max(80)).min(1).max(20),
  failedReasons: z.array(z.string().max(200)).max(10).optional(),
  isBlockingTraveler: z.boolean().default(false),
});
type ResearchGapRouterInput = z.infer<typeof researchGapRouterInput>;

interface GapRoute {
  action: 'try_alternate' | 'ask_traveler' | 'escalate_handoff' | 'accept_low_confidence';
  reasoning: string;
  suggestedTools?: string[];
  suggestedTravelerQuestion?: string;
}

async function runResearchGapRouter(
  rawInput: ResearchGapRouterInput,
  ctx?: ToolContext
): Promise<{ status: 'ok' | 'production_refused'; message: string; route?: GapRoute }> {
  const gate = assertDevOnlyToolAllowed(ctx);
  if (gate.allowed === false) return { status: 'production_refused', message: gate.reason };

  const input = researchGapRouterInput.parse(rawInput);

  // 1. Blocking failure → escalate.
  if (input.isBlockingTraveler && input.currentConfidence === 'low') {
    return {
      status: 'ok',
      route: {
        action: 'escalate_handoff',
        reasoning:
          'Low-confidence answer is blocking the traveler. Escalate via `request_human_handoff` so an operator answers in the actual channel.',
      },
      message: 'Routed to handoff (blocking + low-confidence).',
    };
  }

  // 2. Already tried 3+ tools and still low → ask traveler.
  if (input.currentConfidence === 'low' && input.attemptedTools.length >= 3) {
    return {
      status: 'ok',
      route: {
        action: 'ask_traveler',
        reasoning: 'After 3+ tool attempts, ask one clarifying question before another lookup.',
        suggestedTravelerQuestion: `I want to make sure I get this right — could you tell me ${guessClarifyingQuestion(input.intent)}?`,
      },
      message: 'Routed to traveler clarification (3+ failed attempts).',
    };
  }

  // 3. Medium confidence, non-blocking → accept.
  if (input.currentConfidence === 'medium' && !input.isBlockingTraveler) {
    return {
      status: 'ok',
      route: {
        action: 'accept_low_confidence',
        reasoning:
          'Medium confidence is acceptable for non-blocking informational queries. Quote the source verbatim and let the traveler decide.',
      },
      message: 'Accepted at medium confidence.',
    };
  }

  // 4. Default → try alternate strategy.
  return {
    status: 'ok',
    route: {
      action: 'try_alternate',
      reasoning: 'Try a different tool family.',
      suggestedTools: suggestAlternates(input.attemptedTools),
    },
    message: 'Routed to alternate strategy.',
  };
}

function guessClarifyingQuestion(intent: string): string {
  if (/restaurant|food|eat|dinner|lunch/i.test(intent)) {
    return 'your budget tier (budget / medium / premium) and any dietary restrictions';
  }
  if (/coffee|cafe/i.test(intent))
    return 'whether you need WiFi + outlets to work or just the coffee';
  if (/event|meetup|ticket/i.test(intent)) return 'the date range and topic you care about';
  if (/hotel|stay|lodging/i.test(intent))
    return 'your nightly budget and the neighborhood you prefer';
  return 'a couple of details to narrow this down';
}

function suggestAlternates(attempted: string[]): string[] {
  const tried = new Set(attempted);
  const alternates: string[] = [];
  if (tried.has('cse')) alternates.push('web_search');
  if (tried.has('web_search')) alternates.push('monocle_place_researcher');
  if (tried.has('specialty_coffee_finder')) alternates.push('foodie_shortlist_builder');
  if (tried.has('mainstream_event_discovery'))
    alternates.push('eventbrite_event_discovery', 'professional_networking_scanner');
  return alternates.length > 0 ? alternates : ['web_search', 'monocle_place_researcher'];
}

const researchGapRouterTool: ToolDef = {
  name: 'research_gap_router',
  internal: true,
  description:
    'Router for low-confidence research. Decides among: try_alternate (different tool), ask_traveler (clarifying Q), escalate_handoff (request_human_handoff), accept_low_confidence (quote + caveat). Use as the second step after any failed/uncertain primary research.',
  inputSchema: researchGapRouterInput,
  jsonSchema: {
    type: 'object',
    required: ['intent', 'currentConfidence', 'attemptedTools'],
    properties: {
      intent: { type: 'string', minLength: 1, maxLength: 400 },
      currentConfidence: { type: 'string', enum: ['low', 'medium', 'high'] },
      attemptedTools: {
        type: 'array',
        minItems: 1,
        maxItems: 20,
        items: { type: 'string', maxLength: 80 },
      },
      failedReasons: { type: 'array', maxItems: 10, items: { type: 'string', maxLength: 200 } },
      isBlockingTraveler: { type: 'boolean' },
    },
  },
  handler: runResearchGapRouter,
};

// ─────────────────────────────────────────────────────────────────────
// 6. agentic_research_planner
// LLM-driven: given an intent + caller scopes, propose an ordered tool
// chain. Vertex direct + Gateway fallback (same pattern as monocle).
// ─────────────────────────────────────────────────────────────────────

const TOOL_CATALOG_HINT = [
  'web_search',
  'lookup_match_fixtures',
  'monocle_place_researcher',
  'visual_aesthetic_scorer',
  'budget_estimator',
  'beauty_budget_ranker',
  'specialty_coffee_finder',
  'work_from_cafe_ranker',
  'cheap_michelin_finder',
  'ramen_finder',
  'foodie_shortlist_builder',
  'wine_bar_finder',
  'bookstore_finder',
  'art_gallery_opening_finder',
  'running_route_finder',
  'gym_day_pass_finder',
  'eventbrite_event_discovery',
  'mainstream_event_discovery',
  'crowd_level_predictor',
  'luma_event_discovery',
  'meetup_event_discovery',
  'professional_networking_scanner',
  'city_taste_map_builder',
  'hobby_concierge_discover',
  'date_plan_builder',
  'date_perfume_advisor',
  'official_source_resolver',
  'source_confidence_scorer',
  'research_audit_trail',
];

const agenticResearchPlannerInput = z.object({
  intent: z.string().min(3).max(400),
  city: z.string().max(120).optional(),
  budgetTier: z.enum(['budget', 'medium', 'premium', 'splurge']).optional(),
  /** Caller scopes — planner respects what's actually callable. */
  availableTools: z.array(z.string().max(80)).max(40).optional(),
  /** Maximum tool calls in the chain. */
  maxSteps: z.number().int().min(1).max(8).default(4),
});
type AgenticResearchPlannerInput = z.infer<typeof agenticResearchPlannerInput>;

const planSchema = z.object({
  plan: z
    .array(
      z.object({
        toolName: z.string(),
        rationale: z.string(),
        inputs: z.string().describe('Free-form description of what to pass to the tool.'),
      })
    )
    .max(8),
  expectedConfidence: z.enum(['low', 'medium', 'high']),
  fallbackIfFails: z.string(),
});

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

async function runAgenticResearchPlanner(
  rawInput: AgenticResearchPlannerInput,
  ctx?: ToolContext
): Promise<{
  status: 'ok' | 'unavailable' | 'production_refused';
  message: string;
  plan?: z.infer<typeof planSchema>;
  via?: 'vertex' | 'gateway';
}> {
  const gate = assertDevOnlyToolAllowed(ctx);
  if (gate.allowed === false) return { status: 'production_refused', message: gate.reason };

  const input = agenticResearchPlannerInput.parse(rawInput);
  const tools =
    input.availableTools && input.availableTools.length > 0
      ? input.availableTools
      : TOOL_CATALOG_HINT;

  const prompt = `You are Sendero's research planner. Given a traveler intent, propose an ordered tool chain — at most ${input.maxSteps} steps — that the agent can run to answer it confidently.

Traveler intent: "${input.intent}"
${input.city ? `City: ${input.city}` : ''}
${input.budgetTier ? `Budget tier: ${input.budgetTier}` : ''}

Available tools (respect this list verbatim):
${tools.map(t => `  - ${t}`).join('\n')}

Rules:
- Prefer canonical Sendero tools over web_search.
- Compose: a finder tool first, then a budget_estimator and/or visual_aesthetic_scorer for ranking, then beauty_budget_ranker if multiple candidates.
- For events, pick the right event-source tool (mainstream_event_discovery for ticketed, eventbrite/luma/meetup for community, professional_networking_scanner for founder).
- Always end with research_audit_trail to record provenance.
- Each step's inputs field is FREE-FORM — describe what the agent should pass, don't try to fully pre-fill JSON.`;

  const vertex = resolveVertex();
  if (vertex) {
    try {
      const r = await generateObject({
        model: vertex(VERTEX_MODEL_ID),
        schema: planSchema,
        prompt,
      });
      return {
        status: 'ok',
        plan: r.object,
        via: 'vertex',
        message: `Planned ${r.object.plan.length} steps via Vertex.`,
      };
    } catch (err) {
      console.warn(
        '[agentic_research_planner] Vertex direct failed, falling back to AI Gateway:',
        (err as Error).message ?? err
      );
    }
  }
  try {
    const r = await generateObject({
      model: GATEWAY_MODEL_ID,
      schema: planSchema,
      prompt,
      providerOptions: { gateway: { order: ['google'] } },
    });
    return {
      status: 'ok',
      plan: r.object,
      via: 'gateway',
      message: `Planned ${r.object.plan.length} steps via gateway.`,
    };
  } catch (err) {
    return {
      status: 'unavailable',
      message: `Couldn't plan research chain. ${(err as Error).message ?? 'gateway-failed'}`,
    };
  }
}

const agenticResearchPlannerTool: ToolDef = {
  name: 'agentic_research_planner',
  internal: true,
  experimental: true,
  description:
    "Given a traveler intent, plan an ordered tool chain via Vertex / AI Gateway. Returns `plan[]` with toolName + rationale + inputs description, plus `expectedConfidence` and a `fallbackIfFails` recommendation. Use when the traveler asks something complex (e.g. 'plan my Tokyo week') and the agent needs to compose multiple tools.",
  inputSchema: agenticResearchPlannerInput,
  jsonSchema: {
    type: 'object',
    required: ['intent'],
    properties: {
      intent: { type: 'string', minLength: 3, maxLength: 400 },
      city: { type: 'string', maxLength: 120 },
      budgetTier: { type: 'string', enum: ['budget', 'medium', 'premium', 'splurge'] },
      availableTools: { type: 'array', maxItems: 40, items: { type: 'string', maxLength: 80 } },
      maxSteps: { type: 'integer', minimum: 1, maximum: 8 },
    },
  },
  handler: runAgenticResearchPlanner,
};

// ─────────────────────────────────────────────────────────────────────
// 7. recommendation_explainer
// Pure tool — turns rationale array + audit metadata into a 1-paragraph
// human-readable explanation the agent can quote.
// ─────────────────────────────────────────────────────────────────────

const recommendationExplainerInput = z.object({
  recommendation: z.string().min(1).max(400),
  rationaleParts: z.array(z.string().max(200)).min(1).max(10),
  /** Sources cited — top 3 surface in the explanation. */
  topSources: z
    .array(
      z.object({
        url: z.string().url(),
        title: z.string().max(120).optional(),
      })
    )
    .max(3)
    .optional(),
  budgetEnvelope: z.string().max(120).optional(),
  locale: z.string().min(2).max(10).default('en-US'),
});
type RecommendationExplainerInput = z.infer<typeof recommendationExplainerInput>;

async function runRecommendationExplainer(
  rawInput: RecommendationExplainerInput,
  ctx?: ToolContext
): Promise<{ status: 'ok' | 'production_refused'; message: string; explanation?: string }> {
  const gate = assertDevOnlyToolAllowed(ctx);
  if (gate.allowed === false) return { status: 'production_refused', message: gate.reason };

  const input = recommendationExplainerInput.parse(rawInput);

  const isSpanish = /^es/i.test(input.locale);
  const intro = isSpanish ? 'Recomendación' : 'Recommendation';
  const becauseLabel = isSpanish ? 'Por qué' : 'Why';
  const sourcesLabel = isSpanish ? 'Fuentes' : 'Sources';
  const budgetLabel = isSpanish ? 'Presupuesto' : 'Expected spend';

  const lines: string[] = [];
  lines.push(`**${intro}:** ${input.recommendation}`);
  lines.push(`**${becauseLabel}:** ${input.rationaleParts.join(' · ')}`);
  if (input.budgetEnvelope) lines.push(`**${budgetLabel}:** ${input.budgetEnvelope}`);
  if (input.topSources && input.topSources.length > 0) {
    const fmt = input.topSources
      .map(s => `${s.title ?? s.url} (${new URL(s.url).host.replace(/^www\./, '')})`)
      .join(' · ');
    lines.push(`**${sourcesLabel}:** ${fmt}`);
  }

  return {
    status: 'ok',
    explanation: lines.join('\n'),
    message: `Explanation built (${input.rationaleParts.length} rationale parts, ${input.topSources?.length ?? 0} sources).`,
  };
}

const recommendationExplainerTool: ToolDef = {
  name: 'recommendation_explainer',
  internal: true,
  description:
    "Turn a recommendation + rationale parts + top sources + budget envelope into a quotable, locale-aware explanation paragraph. Pure — no external API. Use as the final step before sending the agent's reply, so the traveler sees WHY the recommendation was made.",
  inputSchema: recommendationExplainerInput,
  jsonSchema: {
    type: 'object',
    required: ['recommendation', 'rationaleParts'],
    properties: {
      recommendation: { type: 'string', minLength: 1, maxLength: 400 },
      rationaleParts: {
        type: 'array',
        minItems: 1,
        maxItems: 10,
        items: { type: 'string', maxLength: 200 },
      },
      topSources: { type: 'array', maxItems: 3 },
      budgetEnvelope: { type: 'string', maxLength: 120 },
      locale: { type: 'string', minLength: 2, maxLength: 10 },
    },
  },
  handler: runRecommendationExplainer,
};

// ─────────────────────────────────────────────────────────────────────

export {
  officialSourceResolverTool,
  sourceConfidenceScorerTool,
  researchAuditTrailTool,
  sourceCacheManagerTool,
  researchGapRouterTool,
  agenticResearchPlannerTool,
  recommendationExplainerTool,
  runOfficialSourceResolver,
  runSourceConfidenceScorer,
  runResearchAuditTrail,
  runSourceCacheManager,
  runResearchGapRouter,
  runAgenticResearchPlanner,
  runRecommendationExplainer,
};
