/**
 * Per-model COGS registry — the single source of truth for "how
 * expensive is this model to run, on average, per agentic turn."
 *
 * Drives two things:
 *  1. Server-side model gating (`agent-models.ts::resolveModel` rejects
 *     a model when `cogsPerTurnMicro(model) > plan.maxCostPerTurnMicro`).
 *  2. UI picker — locked vs unlocked rows, sorted by cost ascending,
 *     with the description popover when one is present.
 *
 * COGS values are *worst-case uncached, with ~1.5× overhead for
 * agentic tool-call round-trips* (the "uncached + tools" column from
 * the autoplan COGS benchmark). Caching cuts these by ~10× in
 * production but the cap math stays honest by sizing against the
 * uncached upper bound.
 *
 * **Why tier on price-band, not model name** (per autoplan eng review):
 * Hard-coding `allowedModels: ModelId[]` per tier means every quarterly
 * model release (GPT-5.5, Sonnet 5, Gemini 3, fine-tuned travel models)
 * is a 4-tier × N-model decision matrix. Tiering on
 * `maxCostPerTurnMicro` resolves the allowlist dynamically — when a
 * new model lands, register it here once and every tier picker
 * updates correctly.
 *
 * **Provider constraint:** only `anthropic | openai | google` are
 * acceptable providers (the three Sendero has direct API keys for,
 * gateway BYOK confirmed zero markup). Adding a new provider requires
 * extending `ChatModelProvider` here AND validating the gateway
 * supports BYOK for that provider.
 */

export type ChatModelProvider = 'anthropic' | 'openai' | 'google';

export interface ChatModelCogs {
  /** Canonical model ID matching `CHAT_MODEL_OPTIONS[].id`. */
  id: string;
  /** Provider — locked to the three Sendero supports. */
  provider: ChatModelProvider;
  /** Display name. */
  name: string;
  /**
   * Estimated worst-case COGS per typical agentic turn (4k input,
   * 1k output, ~3 tool-call round-trips × 1.5 overhead, NO caching).
   * Values in micro-USDC.
   *
   * Source: April 2026 list pricing pulled from each provider's
   * official pricing page. Update this table whenever a provider
   * re-prices.
   */
  cogsPerTurnMicro: bigint;
  /**
   * Optional one-line description. Surfaces in the picker popover
   * (similar to the WhatsApp integration tooltip pattern). Render
   * the popover ONLY when this field is non-null, so models without
   * a registered description fall back to the simple row.
   *
   * Sourced from the provider's own model card / gateway metadata
   * where available — never invented to fill the field.
   */
  description: string | null;
}

/**
 * Source-of-truth registry. Order is meaningful: picker renders in
 * this order so the cheapest models surface first.
 *
 * Cost figures rounded UP to the nearest 1000 micro for clean
 * cap-band math.
 */
export const CHAT_MODEL_COGS: ChatModelCogs[] = [
  {
    id: 'google/gemini-2.5-flash',
    provider: 'google',
    name: 'Gemini 2.5 Flash',
    cogsPerTurnMicro: 6_000n,
    description:
      "Google's fastest model. Optimized for high-frequency, low-latency tool calls and long context windows.",
  },
  {
    id: 'openai/gpt-5-mini',
    provider: 'openai',
    name: 'GPT-5 Mini',
    cogsPerTurnMicro: 5_000n,
    description:
      "OpenAI's efficient frontier. Great default for chat-shaped agent loops with light reasoning.",
  },
  {
    id: 'openai/gpt-5',
    provider: 'openai',
    name: 'GPT-5',
    cogsPerTurnMicro: 23_000n,
    description:
      "OpenAI's flagship. Stronger reasoning and tool selection than Mini at ~5× the cost.",
  },
  {
    id: 'google/gemini-2.5-pro',
    provider: 'google',
    name: 'Gemini 2.5 Pro',
    cogsPerTurnMicro: 23_000n,
    description:
      "Google's flagship. Excels at long-context corporate-policy reasoning and structured output.",
  },
  {
    id: 'anthropic/claude-sonnet-4-5',
    provider: 'anthropic',
    name: 'Claude Sonnet 4.5',
    cogsPerTurnMicro: 41_000n,
    description:
      "Anthropic's balanced model. Best-in-class instruction following and refusal behavior on regulated-industry travel flows.",
  },
  {
    id: 'anthropic/claude-opus-4-1',
    provider: 'anthropic',
    name: 'Claude Opus 4.1',
    cogsPerTurnMicro: 203_000n,
    description:
      "Anthropic's deepest model. Reserved for high-stakes itineraries — dispute resolution, multi-leg routing, complex policy edge cases.",
  },
];

/** Map of `id → cogs` for O(1) lookup. */
const BY_ID: Map<string, ChatModelCogs> = new Map(CHAT_MODEL_COGS.map(m => [m.id, m]));

/**
 * Look up the COGS for a model ID. Returns `null` for unknown models
 * — the caller decides how to handle (server gating treats unknown
 * as "allow under any cap" so legacy/sandbox flows don't break).
 */
export function cogsForModel(modelId: string): ChatModelCogs | null {
  return BY_ID.get(modelId) ?? null;
}

/**
 * Per-turn COGS in micro-USDC. Returns `0n` for unknown models so
 * the gating math doesn't accidentally lock everything when a new
 * model arrives before its registry entry.
 */
export function cogsPerTurnMicro(modelId: string): bigint {
  return cogsForModel(modelId)?.cogsPerTurnMicro ?? 0n;
}

/**
 * True if a model is callable under a given per-turn cost ceiling.
 * Pass `null` for an unbounded ceiling (Enterprise tier).
 */
export function isModelAllowedByCap(modelId: string, maxCostPerTurnMicro: bigint | null): boolean {
  if (maxCostPerTurnMicro === null) return true;
  const cogs = cogsForModel(modelId);
  if (!cogs) return false;
  return cogs.cogsPerTurnMicro <= maxCostPerTurnMicro;
}

/**
 * The list of model IDs that fit under a given per-turn cost cap.
 * Used by the UI to show locked vs unlocked, by the server's 403
 * envelope to advertise `allowedModels`, and by Slack agent fallback
 * to pick a default when the user-specified model is locked.
 */
export function allowedModelsForCap(maxCostPerTurnMicro: bigint | null): string[] {
  return CHAT_MODEL_COGS.filter(m => isModelAllowedByCap(m.id, maxCostPerTurnMicro)).map(m => m.id);
}

/**
 * Cheapest model under a cap — used as the safe fallback for
 * Slack/WhatsApp agent dispatches when the operator has no live
 * picker UI to make a choice.
 */
export function defaultModelForCap(maxCostPerTurnMicro: bigint | null): string {
  const allowed = allowedModelsForCap(maxCostPerTurnMicro);
  // CHAT_MODEL_COGS sorts by cost ascending so allowed[0] is cheapest.
  // Fallback to gemini-2.5-flash for the truly-no-models edge case.
  return allowed[0] ?? 'google/gemini-2.5-flash';
}
