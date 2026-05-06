/**
 * monocle_place_researcher — HP2 Tool 26.
 *
 * Spec: docs/specs/anticipatory-concierge.md §4.0 HP2 + roadmap §HP2.
 *
 * Deep-researches a single place. The "Monocle take" tool — when the
 * traveler asks "is X actually any good?" or "is Y overrated?", we run
 * a full editorial sweep + Places metadata + budget estimate and return
 * a single structured verdict with sources.
 *
 * Two-pass model (mirrors `lookup_match_fixtures`):
 *  1. Vertex direct (Vortex / corporate Google billing) with
 *     `googleSearch` grounding — pulls editorial coverage, reviews,
 *     guide listings, signature dishes, vibe.
 *  2. AI-Gateway fallback when Vertex direct isn't bound. Gateway's
 *     Google leg honors the same `googleSearch` provider tool.
 *
 * Then a structured-coercion pass shapes the grounded answer into the
 * `MonoclePlaceReport` schema (verdict, vibeTags, signatureItems,
 * isOverrated, etc.).
 *
 * Composition. The tool also reads canonical Places metadata via
 * `getPlace` when a placeId or website is given, and folds
 * `budget_estimator`'s output when a category is supplied. Both are
 * injectable for tests.
 *
 * **Experimental** (`experimental: true`). Dev-only gate at handler-time.
 *
 * Cost. Two grounded LLM calls per place — reserve for the "is this
 * worth it" moment, not the bulk-rank loop. The cheaper rankers
 * (`specialty_coffee_finder`, `work_from_cafe_ranker`,
 * `foodie_shortlist_builder`) compose without invoking this tool.
 */

import { z } from 'zod';
import { generateObject, generateText } from 'ai';
import { google } from '@ai-sdk/google';
import { createVertex } from '@ai-sdk/google-vertex';

import { getPlace, type PlacesPlace } from '@sendero/google-places';

import { assertDevOnlyToolAllowed } from '../dev-gate';
import type { ToolContext, ToolDef } from '../types';

import { runBudgetEstimator, type BudgetEstimatorInput } from './budget-estimator';

// ── Schemas ──────────────────────────────────────────────────────────

const CATEGORY_KEYS = [
  'cafe',
  'ramen',
  'casual_restaurant',
  'mid_restaurant',
  'fine_restaurant',
  'tasting_menu',
  'bar',
  'wine_bar',
  'cocktail_bar',
  'bakery',
  'street_food',
  'fast_casual',
] as const;

const inputSchema = z.object({
  /** Place name. Required; we always quote it verbatim in the search prompt. */
  name: z.string().min(2).max(160),
  city: z.string().min(1).max(120),
  /** Google place id when caller has it; lets us pull canonical metadata. */
  placeId: z.string().min(3).max(160).optional(),
  /** Optional category — when present, we fold a budget estimate into the report. */
  category: z.enum(CATEGORY_KEYS).optional(),
  /** ISO 3166-1 alpha-2 — improves both grounding and budget estimation. */
  countryCode: z.string().length(2).optional(),
  /** BCP-47 locale for the verdict body. Default es-AR. */
  locale: z.string().min(2).max(10).default('es-AR'),
});

export type MonoclePlaceResearcherInput = z.infer<typeof inputSchema>;

const reportShape = z.object({
  verdict: z
    .enum(['recommend', 'recommend_with_caveats', 'skip', 'inconclusive'])
    .describe(
      "One-token rating. 'recommend' = clearly good for the right traveler. 'recommend_with_caveats' = good but with tradeoffs the agent should mention. 'skip' = overrated / not worth the money / consistently disappointing. 'inconclusive' = not enough public signal to judge."
    ),
  /** One-paragraph takeaway, ≤ 4 sentences. Written in the requested locale. */
  takeaway: z.string().describe('≤ 4-sentence takeaway in the requested locale.'),
  vibeTags: z
    .array(z.string())
    .max(8)
    .describe(
      "Aesthetic / atmosphere tags from the AestheticTag taxonomy: 'warm_lighting', 'natural_light', 'minimal', 'old_world', 'japanese_clean', 'editorial', 'romantic', 'cozy', 'design_forward', 'beautiful_counter', 'good_plating', 'lush_greenery', 'rooftop_view', 'generic', 'touristy', 'fluorescent', 'crowded', 'soulless', 'instagram_trap'. Pick at most 6."
    ),
  signatureItems: z
    .array(z.string())
    .max(8)
    .describe(
      'Specific dishes / drinks / experiences the place is known for. Pull verbatim from sources when possible.'
    ),
  isOverrated: z
    .boolean()
    .nullable()
    .describe(
      'True when public discourse explicitly flags the place as overrated. Null when no clear consensus.'
    ),
  guideMentions: z
    .array(
      z.object({
        guide: z
          .string()
          .describe("E.g. 'Michelin', 'Bib Gourmand', \"World's 50 Best\", 'Eater Essential'."),
        year: z.string().nullable(),
      })
    )
    .max(6),
  bestFor: z
    .array(z.string())
    .max(6)
    .describe(
      "Use cases — 'date', 'solo_lunch', 'deep_work', 'group_dinner', 'celebration', 'tasting'."
    ),
  notFor: z
    .array(z.string())
    .max(6)
    .describe("Avoid scenarios — 'large_group', 'calls', 'budget', 'family'."),
  reservationRequired: z.boolean().nullable(),
  /** What the traveler should know that's not obvious from the listing. */
  fineprint: z.array(z.string()).max(6),
});

export interface MonoclePlaceReport extends z.infer<typeof reportShape> {
  /** Place metadata pulled from Google Places (when placeId given). */
  placeMeta?: PlacesPlace;
  /** Sources Vertex/Gateway cited during grounding. */
  sources: Array<{ uri: string; title?: string }>;
  /** Budget estimate when category was provided. */
  budget?: {
    tier: 'budget' | 'medium' | 'premium' | 'splurge';
    range: { low: number; typical: number; high: number; currency: string };
    moneyTalk: string;
  };
}

export type MonoclePlaceResearcherResult =
  | {
      status: 'ok';
      report: MonoclePlaceReport;
      via: 'vertex' | 'gateway';
      message: string;
    }
  | { status: 'production_refused'; message: string }
  | { status: 'unavailable'; reason: string; message: string };

// ── Deps ─────────────────────────────────────────────────────────────

export interface MonoclePlaceResearcherDeps {
  /** Injectable Places lookup. Defaults to live `getPlace`. */
  getPlace?: typeof getPlace;
  /** Injectable budget estimator. Defaults to live `runBudgetEstimator`. */
  runBudget?: typeof runBudgetEstimator;
}

const liveDeps: MonoclePlaceResearcherDeps = {
  getPlace,
  runBudget: runBudgetEstimator,
};

export const liveDependencies = liveDeps;

// ── Vertex / Gateway plumbing ────────────────────────────────────────

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

function buildGroundingPrompt(input: MonoclePlaceResearcherInput): string {
  return `Research the place "${input.name}" in ${input.city}${input.countryCode ? ` (${input.countryCode})` : ''}. I want a concise editorial dossier covering:

- What is it actually known for? Specific dishes / drinks / details.
- The general consensus from local press, guides, and recent reviews.
- Whether it appears in Michelin Guide, Bib Gourmand, World's 50 Best, Eater Essential, Time Out, or notable local guides.
- Aesthetic / vibe — warm vs minimal vs touristy etc.
- Common complaints or whether it is widely seen as overrated.
- Reservation reality — required, recommended, walk-in friendly.
- What kind of visit it is best for (date, solo lunch, group dinner, deep work).

Cite the source verbatim when possible (Eater, Michelin, Time Out, Bon Appétit, Tabelog, NYT, etc.). If reliable public information is unavailable, say so explicitly. Never invent details.`;
}

function buildCoercionPrompt(
  input: MonoclePlaceResearcherInput,
  groundedText: string,
  sourceUris: string[]
): string {
  return `Coerce the following grounded research into the MonoclePlaceReport schema.

Place: "${input.name}" in ${input.city}.
Locale for takeaway: ${input.locale}.

Grounded research:
"""
${groundedText}
"""

Sources cited:
${sourceUris
  .slice(0, 8)
  .map((u, i) => `${i + 1}. ${u}`)
  .join('\n') || '(none)'}

Rules:
- Only emit fields you have evidence for. Use null for unknowns.
- vibeTags must come from the AestheticTag taxonomy listed in the schema.
- Takeaway is at most 4 sentences in ${input.locale}. Don't restate the schema; speak in the voice of a discreet concierge.
- isOverrated: true ONLY if multiple sources explicitly say so; otherwise null.
- guideMentions: include each guide once, with the year when stated.`;
}

interface GenerateTextLike {
  text: string;
  providerMetadata?: unknown;
  sources?: ReadonlyArray<unknown>;
}

function extractGrounded(result: GenerateTextLike): {
  text: string;
  sourceUris: string[];
  sources: Array<{ uri: string; title?: string }>;
} {
  const text = result.text?.trim() ?? '';
  const sourceUris: string[] = [];
  const sources: Array<{ uri: string; title?: string }> = [];

  type GroundingMeta = {
    google?: { groundingMetadata?: { groundingChunks?: Array<{ web?: { uri?: string; title?: string } }> } };
  };
  const meta = result.providerMetadata as GroundingMeta | undefined;
  for (const c of meta?.google?.groundingMetadata?.groundingChunks ?? []) {
    const uri = c?.web?.uri;
    const title = c?.web?.title;
    if (typeof uri === 'string') {
      sourceUris.push(uri);
      sources.push({ uri, ...(title ? { title } : {}) });
    }
  }
  // The AI SDK may also surface URL sources via `result.sources`. Merge
  // those when distinct.
  for (const s of result.sources ?? []) {
    const uri =
      (s as { url?: string; uri?: string }).url ?? (s as { uri?: string }).uri ?? '';
    const title = (s as { title?: string }).title;
    if (uri && !sourceUris.includes(uri)) {
      sourceUris.push(uri);
      sources.push({ uri, ...(title ? { title } : {}) });
    }
  }
  return { text, sourceUris, sources };
}

async function runVertex(
  input: MonoclePlaceResearcherInput,
  vertex: ReturnType<typeof createVertex>
) {
  const grounded = await generateText({
    model: vertex(VERTEX_MODEL_ID),
    tools: { google_search: vertex.tools.googleSearch({}) },
    prompt: buildGroundingPrompt(input),
  });
  const g = extractGrounded(grounded);
  if (!g.text) return { ok: false as const, reason: 'no-grounded-text' };

  const coerced = await generateObject({
    model: vertex(VERTEX_MODEL_ID),
    schema: reportShape,
    prompt: buildCoercionPrompt(input, g.text, g.sourceUris),
  });
  return { ok: true as const, report: coerced.object, sources: g.sources };
}

async function runGateway(input: MonoclePlaceResearcherInput) {
  const grounded = await generateText({
    model: GATEWAY_MODEL_ID,
    tools: { google_search: google.tools.googleSearch({}) },
    prompt: buildGroundingPrompt(input),
    providerOptions: { gateway: { order: ['google'] } },
  });
  const g = extractGrounded(grounded);
  if (!g.text) return { ok: false as const, reason: 'no-grounded-text' };

  const coerced = await generateObject({
    model: GATEWAY_MODEL_ID,
    schema: reportShape,
    prompt: buildCoercionPrompt(input, g.text, g.sourceUris),
    providerOptions: { gateway: { order: ['google'] } },
  });
  return { ok: true as const, report: coerced.object, sources: g.sources };
}

// ── Orchestrator ─────────────────────────────────────────────────────

export async function runMonoclePlaceResearcher(
  rawInput: MonoclePlaceResearcherInput,
  ctx?: ToolContext,
  deps: MonoclePlaceResearcherDeps = liveDeps
): Promise<MonoclePlaceResearcherResult> {
  const gate = assertDevOnlyToolAllowed(ctx);
  if (gate.allowed === false) {
    return { status: 'production_refused', message: gate.reason };
  }

  const input = inputSchema.parse(rawInput);

  // Path 1: Vertex direct.
  const vertex = resolveVertex();
  let llmResult: Awaited<ReturnType<typeof runVertex>> | null = null;
  let via: 'vertex' | 'gateway' = 'vertex';
  if (vertex) {
    try {
      llmResult = await runVertex(input, vertex);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(
        '[monocle_place_researcher] Vertex direct failed, falling back to AI Gateway:',
        (err as Error).message ?? err
      );
    }
  }

  // Path 2: AI Gateway fallback.
  if (!llmResult || !llmResult.ok) {
    via = 'gateway';
    try {
      llmResult = await runGateway(input);
    } catch (err) {
      return {
        status: 'unavailable',
        reason: (err as Error).message ?? 'gateway-failed',
        message: `Couldn't research ${input.name} via Vertex or AI Gateway. Try again or share the official site so the agent can read directly.`,
      };
    }
  }

  if (!llmResult.ok) {
    return {
      status: 'unavailable',
      reason: llmResult.reason,
      message: `No grounded text returned for ${input.name}. The query may be too generic — try including the neighborhood.`,
    };
  }

  // Compose Places metadata when a placeId was given.
  let placeMeta: PlacesPlace | undefined;
  if (input.placeId && deps.getPlace) {
    try {
      const r = await deps.getPlace({ placeId: input.placeId, languageCode: input.locale.split('-')[0] });
      if (r.available && r.place) placeMeta = r.place;
    } catch {
      /* fail-soft — Places is decoration, not load-bearing */
    }
  }

  // Compose budget estimate when category is supplied.
  let budget: MonoclePlaceReport['budget'];
  if (input.category && deps.runBudget) {
    const budgetInput: BudgetEstimatorInput = {
      category: input.category,
      city: input.city,
      partySize: 1,
      ...(input.countryCode ? { countryCode: input.countryCode } : {}),
      ...(placeMeta?.priceLevel ? { priceLevel: placeMeta.priceLevel } : {}),
    };
    try {
      const r = await deps.runBudget(budgetInput, ctx);
      if (r.status === 'ok' && r.expectedSpendPerPerson && r.budgetTier && r.moneyTalk) {
        budget = {
          tier: r.budgetTier,
          range: r.expectedSpendPerPerson,
          moneyTalk: r.moneyTalk,
        };
      }
    } catch {
      /* fail-soft */
    }
  }

  const report: MonoclePlaceReport = {
    ...llmResult.report,
    sources: llmResult.sources,
    ...(placeMeta ? { placeMeta } : {}),
    ...(budget ? { budget } : {}),
  };

  return {
    status: 'ok',
    report,
    via,
    message: `Researched ${input.name} via ${via} (${report.sources.length} sources, verdict=${report.verdict}).`,
  };
}

// ── Tool registration ────────────────────────────────────────────────

export const monoclePlaceResearcherTool: ToolDef<
  MonoclePlaceResearcherInput,
  MonoclePlaceResearcherResult
> = {
  name: 'monocle_place_researcher',
  internal: true,
  experimental: true,
  description:
    "Deep-research a single place and return a structured 'Monocle take' — verdict, vibe tags, signature items, guide mentions, who it's for, who it isn't, fineprint, and (when category is given) a budget estimate. Composes Vertex direct grounding (with AI Gateway fallback) + canonical Places metadata + `budget_estimator`. Use when the traveler asks 'is X actually any good', 'is Y overrated', 'tell me about Z place'. Reserve for the moment of truth — two grounded LLM calls per invocation, so don't loop.",
  inputSchema,
  jsonSchema: {
    type: 'object',
    required: ['name', 'city'],
    properties: {
      name: { type: 'string', minLength: 2, maxLength: 160 },
      city: { type: 'string', minLength: 1, maxLength: 120 },
      placeId: { type: 'string', minLength: 3, maxLength: 160 },
      category: { type: 'string', enum: [...CATEGORY_KEYS] },
      countryCode: { type: 'string', minLength: 2, maxLength: 2 },
      locale: { type: 'string', minLength: 2, maxLength: 10 },
    },
  },
  handler: runMonoclePlaceResearcher,
};
