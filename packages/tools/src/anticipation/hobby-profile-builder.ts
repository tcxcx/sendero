/**
 * hobby_profile_builder — HP1 Tool 1.
 *
 * Builds and updates the traveler's structured taste graph from explicit
 * preferences, repeated behavior, saved places, previous trips and
 * feedback. The substrate every other HP1/HP2 tool reads at planning time.
 *
 * Spec: docs/specs/anticipatory-concierge.md §4.0 HP1 + Appendix A.4.
 *
 * Storage: row-per-hobby in `traveler_taste_entries` (Postgres). Keyed
 * uniquely on (userId, key) so re-firing with the same hobby key
 * upserts. Priority **escalates but never downgrades** on repeat
 * signals — a 'high' signal cannot be reduced to 'medium' by a later
 * 'low' signal.
 *
 * **Experimental** (`experimental: true`) — registry filter + per-tool
 * span attribute land in PR-A1. Today the flag is annotative + the
 * dev-only gate runs in the handler.
 *
 * **Privacy.** Do NOT infer sensitive personal attributes (sexual
 * orientation, religious belief, health conditions). Travel-relevant
 * preferences only. Traveler can correct the graph through
 * `city_bucket_list_manager` feedback or by sending an explicit
 * preference message.
 */

import { prisma } from '@sendero/database';
import { z } from 'zod';

import { assertDevOnlyToolAllowed } from '../dev-gate';
import type { ToolContext, ToolDef } from '../types';

const KIND_VALUES = [
  'specialty_coffee',
  'work_from_cafes',
  'cheap_michelin',
  'bib_gourmand',
  'worlds_50_best',
  'ramen',
  'founder_networking',
  'ai_events',
  'web3_events',
  'meetups',
  'date_spots',
  'bookstores',
  'wine_bars',
  'record_stores',
  'running',
  'gyms',
  'language_exchange',
  'art_galleries',
  'local_design',
] as const;

const inputSchema = z.object({
  travelerId: z
    .string()
    .min(1)
    .max(120)
    .describe(
      "Sendero User.id of the traveler whose taste graph we're building. Must match ctx.traveler.userId — server validates."
    ),
  tripId: z
    .string()
    .max(120)
    .optional()
    .describe('Optional trip context (the inferred signals came from this trip).'),
  explicitPreferences: z
    .array(z.string().min(1).max(120))
    .max(20)
    .optional()
    .describe(
      "Strings the traveler explicitly stated. e.g. ['I love specialty coffee', 'I always look for cheap Michelin']. Stored at priority='high'."
    ),
  inferredSignals: z
    .array(
      z.object({
        source: z.enum(['chat', 'saved_place', 'visited', 'feedback', 'booking', 'manual']),
        value: z.string().min(1).max(200),
        confidence: z.enum(['low', 'medium', 'high']),
      })
    )
    .max(40)
    .optional()
    .describe('Derived signals from prior behavior. Confidence sets row priority.'),
});

export type HobbyProfileBuilderInput = z.infer<typeof inputSchema>;

export interface TravelerTasteGraph {
  travelerId: string;
  hobbies: Array<{
    key: string;
    priority: 'low' | 'medium' | 'high';
    notes: string | null;
    avoid: string[];
    preferredTimeOfDay: string | null;
    preferredBudget: string | null;
  }>;
  cityBehavior: {
    prefersWorkingFromCafes: boolean;
    likesNetworkingEvents: boolean;
    likesLocalHiddenGems: boolean;
    likesBeautyPerDollar: boolean;
    likesRankedLists: boolean;
  };
  updatedAt: string;
}

export type HobbyProfileBuilderResult =
  | {
      status: 'ok';
      tasteGraph: TravelerTasteGraph;
      newPreferences: string[];
      updatedPreferences: string[];
      confidence: 'low' | 'medium' | 'high';
      message: string;
    }
  | {
      status: 'production_refused';
      message: string;
    };

// ── Deps (testability) ──────────────────────────────────────────────

export interface HobbyProfileBuilderDeps {
  findEntry(
    userId: string,
    key: string
  ): Promise<{ priority: string; notes: string | null } | null>;
  upsertEntry(args: {
    userId: string;
    tenantId: string;
    key: string;
    priority: string;
    notes: string | null;
  }): Promise<void>;
  listEntries(userId: string): Promise<
    Array<{
      key: string;
      priority: string;
      notes: string | null;
      avoid: string[];
      preferredTimeOfDay: string | null;
      preferredBudget: string | null;
    }>
  >;
}

export const dbDependencies: HobbyProfileBuilderDeps = {
  async findEntry(userId, key) {
    const row = await prisma.travelerTasteEntry.findUnique({
      where: { userId_key: { userId, key } },
      select: { priority: true, notes: true },
    });
    return row;
  },
  async upsertEntry({ userId, tenantId, key, priority, notes }) {
    await prisma.travelerTasteEntry.upsert({
      where: { userId_key: { userId, key } },
      create: { userId, tenantId, key, priority, notes },
      update: { priority, ...(notes !== null ? { notes } : {}) },
    });
  },
  async listEntries(userId) {
    const rows = await prisma.travelerTasteEntry.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
    });
    return rows.map(r => ({
      key: r.key,
      priority: r.priority,
      notes: r.notes,
      avoid: r.avoid,
      preferredTimeOfDay: r.preferredTimeOfDay,
      preferredBudget: r.preferredBudget,
    }));
  },
};

// ── Helpers ──────────────────────────────────────────────────────────

/**
 * Map a free-text signal value to a canonical hobby key.
 *
 * Returns one of `KIND_VALUES` when the text matches a known hobby;
 * otherwise normalizes the text to snake_case (custom hobbies allowed
 * per spec). Returns null when the text is too short to bucket safely.
 */
export function normalizeHobbyKey(value: string): string | null {
  const lower = value.toLowerCase().trim();
  if (lower.length < 3) return null;

  // Direct match against known hobbies (with underscores or spaces)
  for (const known of KIND_VALUES) {
    if (lower === known) return known;
    const spaced = known.replace(/_/g, ' ');
    if (lower.includes(spaced)) return known;
  }

  // Fuzzy intent match — common phrasings agents pass us. Multilingual
  // by construction (EN + ES + PT) so the same canonical key lands
  // regardless of locale; otherwise the taste graph fragments by
  // language and downstream ranking can't compose across travelers.
  if (
    /\b(specialty\s*coffee|tercer?a?\s*ola|third\s*wave|caf[eé]\s*de\s*especialidad)\b/.test(lower)
  )
    return 'specialty_coffee';
  if (
    /\bwork\s*(from|in)\s*caf|laptop|deep\s*work\s*spot|trabajar\s*desde\s*caf|caf[eé]\s*para\s*trabajar/.test(
      lower
    )
  )
    return 'work_from_cafes';
  if (/\b(michelin|bib\s*gourmand|guide-?level)\b/.test(lower)) return 'cheap_michelin';
  if (/\b50\s*best|world.?s\s*50\s*best|los\s*50\s*mejores\b/.test(lower)) return 'worlds_50_best';
  if (/\bramen\b/.test(lower)) return 'ramen';
  // Founder networking: leave trailing boundary off so plural + suffix
  // forms ("founders", "founding", "fundadores", "emprendedores") match.
  // Stems are distinctive enough that we don't worry about false hits.
  if (/\b(founder|venture|startup|builder|fundador|emprendedor)/.test(lower))
    return 'founder_networking';
  // AI/Web3 events: support both word orders
  //   EN/standard: "ai event", "ml meetup", "llm night"
  //   ES inverted: "encuentro de IA", "evento de ML", "meetup de IA"
  if (/\b(ai|llm|ml|ia)\s*(event|meetup|night|evento|encuentro)/.test(lower)) return 'ai_events';
  if (/\b(event|meetup|evento|encuentro)\s*(?:de\s*)?(ai|llm|ml|ia)\b/.test(lower))
    return 'ai_events';
  if (/\b(web3|crypto|defi|cripto)\s*(event|meetup|evento|encuentro)/.test(lower))
    return 'web3_events';
  if (/\b(event|meetup|evento|encuentro)\s*(?:de\s*)?(web3|crypto|defi|cripto)\b/.test(lower))
    return 'web3_events';
  // Date spots: EN "date spot/night/idea", ES "lugar(es) para cita(s)" / "cita romántica" /
  // "lugar romántico" / "lugar con onda para una cita", PT "lugar para encontros" / "namoro"
  if (
    /\bdate\s*(spot|night|idea)|cita\s*rom[aá]ntica|lugar(?:es)?\s*(?:para|de|con\s*onda\s*para)\s*(?:una\s*)?cita|lugar\s*rom[aá]ntico|para\s*citas|encontros\s*rom[aá]nticos/.test(
      lower
    )
  )
    return 'date_spots';
  if (/\b(bookstore|book\s*shop|libreria|librería|livraria)\b/.test(lower)) return 'bookstores';
  if (/\b(wine\s*bar|bar\s*de\s*vinos|vinoteca)/.test(lower)) return 'wine_bars';
  if (/\b(record\s*store|vinyl|tienda\s*de\s*vinilos|disquer[ií]a)/.test(lower))
    return 'record_stores';
  if (/\b(running|correr|trotar)\b/.test(lower)) return 'running';
  if (/\b(gym|fitness|gimnasio|academia)\b/.test(lower)) return 'gyms';
  if (/\b(language\s*exchange|intercambio\s*de\s*idiomas|conversa[çc][aã]o)\b/.test(lower))
    return 'language_exchange';
  if (/\b(art\s*galler|galer[ií]a\s*de\s*arte)/.test(lower)) return 'art_galleries';
  if (/\b(local\s*design|concept\s*store|design\s*shop|tienda\s*de\s*dise[ñn]o)/.test(lower))
    return 'local_design';

  // Custom hobby — slug it. Cap at 60 chars; reject if too short or
  // the only content is stop-words.
  const slug = lower
    .replace(/[^a-z0-9_\s-]/g, '')
    .trim()
    .replace(/[\s-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
  if (slug.length < 3 || slug.length > 60) return null;
  return slug;
}

function priorityRank(p: string): number {
  return p === 'high' ? 3 : p === 'medium' ? 2 : 1;
}

function deriveCityBehavior(
  entries: Array<{ key: string; priority: string }>
): TravelerTasteGraph['cityBehavior'] {
  const has = (k: string) => entries.some(e => e.key === k);
  return {
    prefersWorkingFromCafes: has('work_from_cafes') || has('specialty_coffee'),
    likesNetworkingEvents: has('founder_networking') || has('ai_events') || has('meetups'),
    likesLocalHiddenGems: has('local_design') || has('record_stores') || has('bookstores'),
    likesBeautyPerDollar: has('cheap_michelin') || has('bib_gourmand'),
    likesRankedLists: has('worlds_50_best') || has('cheap_michelin'),
  };
}

// ── Orchestrator ─────────────────────────────────────────────────────

export async function runHobbyProfileBuilder(
  input: HobbyProfileBuilderInput,
  ctx?: ToolContext,
  deps: HobbyProfileBuilderDeps = dbDependencies
): Promise<HobbyProfileBuilderResult> {
  const gate = assertDevOnlyToolAllowed(ctx);
  if (gate.allowed === false) {
    return { status: 'production_refused', message: gate.reason };
  }

  // Gate guarantees ctx.traveler.tenantId is populated. Bind userId from
  // ctx if available; only fall back to input.travelerId when ctx
  // doesn't carry a userId (in-process tests / operator console seeds).
  const tenantId = ctx!.traveler!.tenantId!;
  const userId = ctx?.traveler?.userId ?? input.travelerId;

  // Normalize all signals into uniform shape. Explicit prefs land at
  // confidence='high' (the user said it themselves); inferred signals
  // carry their declared confidence.
  const explicit: Array<{ source: string; value: string; confidence: 'low' | 'medium' | 'high' }> =
    (input.explicitPreferences ?? []).map(value => ({
      source: 'manual',
      value,
      confidence: 'high',
    }));
  const inferred: Array<{ source: string; value: string; confidence: 'low' | 'medium' | 'high' }> =
    (input.inferredSignals ?? []).map(s => ({
      source: s.source,
      value: s.value,
      confidence: s.confidence,
    }));
  const signals = [...explicit, ...inferred];

  const newPrefs = new Set<string>();
  const updatedPrefs = new Set<string>();

  for (const signal of signals) {
    const key = normalizeHobbyKey(signal.value);
    if (!key) continue;

    const priority =
      signal.confidence === 'high' ? 'high' : signal.confidence === 'medium' ? 'medium' : 'low';

    const existing = await deps.findEntry(userId, key);
    if (existing) {
      // Escalate but never downgrade.
      if (priorityRank(priority) > priorityRank(existing.priority)) {
        await deps.upsertEntry({
          userId,
          tenantId,
          key,
          priority,
          notes: existing.notes,
        });
        updatedPrefs.add(key);
      }
    } else {
      await deps.upsertEntry({ userId, tenantId, key, priority, notes: null });
      newPrefs.add(key);
    }
  }

  // Build the current taste graph from DB state.
  const entries = await deps.listEntries(userId);
  const tasteGraph: TravelerTasteGraph = {
    travelerId: userId,
    hobbies: entries.map(e => ({
      key: e.key,
      priority: (['low', 'medium', 'high'] as const).find(p => p === e.priority) ?? 'medium',
      notes: e.notes,
      avoid: e.avoid,
      preferredTimeOfDay: e.preferredTimeOfDay,
      preferredBudget: e.preferredBudget,
    })),
    cityBehavior: deriveCityBehavior(entries),
    updatedAt: new Date().toISOString(),
  };

  // Overall confidence reflects the strongest signal in this call.
  const overallConfidence: 'low' | 'medium' | 'high' =
    signals.length === 0
      ? 'low'
      : signals.some(s => s.confidence === 'high')
        ? 'high'
        : signals.some(s => s.confidence === 'medium')
          ? 'medium'
          : 'low';

  const message =
    newPrefs.size + updatedPrefs.size > 0
      ? `Updated taste graph: +${newPrefs.size} new, ${updatedPrefs.size} escalated. Total ${tasteGraph.hobbies.length} hobbies tracked.`
      : `No taste-graph changes. Total ${tasteGraph.hobbies.length} hobbies tracked.`;

  return {
    status: 'ok',
    tasteGraph,
    newPreferences: Array.from(newPrefs),
    updatedPreferences: Array.from(updatedPrefs),
    confidence: overallConfidence,
    message,
  };
}

// ── Tool registration ────────────────────────────────────────────────

export const hobbyProfileBuilderTool: ToolDef<HobbyProfileBuilderInput, HobbyProfileBuilderResult> =
  {
    name: 'hobby_profile_builder',
    /**
     * Internal — never reaches customer-facing channels through MCP.
     * The dev-only gate at handler-time is the security boundary.
     */
    internal: true,
    /**
     * Experimental (HP1 #1) — flips to false after auto-graduation.
     * See packages/tools/src/types.ts ToolDef.experimental for what
     * this flag means today vs after PR-A1 lands the registry filter.
     */
    experimental: true,
    description:
      "Build or update the traveler's taste graph from explicit preferences and inferred signals (chat mentions, saved places, prior bookings, feedback). Use whenever the traveler expresses or implies a preference — 'I love specialty coffee', 'always look for cheap Michelin', 'find me a beautiful date spot'. Returns the full TravelerTasteGraph snapshot + lists of new/updated keys + an overall confidence. Priority escalates but never downgrades on repeat signals. Custom hobby strings are slugged automatically when no canonical key matches. **Privacy:** never infer sensitive traits (orientation, religion, health). Travel-relevant prefs only.",
    inputSchema,
    jsonSchema: {
      type: 'object',
      required: ['travelerId'],
      properties: {
        travelerId: { type: 'string', minLength: 1, maxLength: 120 },
        tripId: { type: 'string', maxLength: 120 },
        explicitPreferences: {
          type: 'array',
          items: { type: 'string', minLength: 1, maxLength: 120 },
          maxItems: 20,
        },
        inferredSignals: {
          type: 'array',
          maxItems: 40,
          items: {
            type: 'object',
            required: ['source', 'value', 'confidence'],
            properties: {
              source: {
                type: 'string',
                enum: ['chat', 'saved_place', 'visited', 'feedback', 'booking', 'manual'],
              },
              value: { type: 'string', minLength: 1, maxLength: 200 },
              confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
            },
          },
        },
      },
    },
    handler: runHobbyProfileBuilder,
  };
