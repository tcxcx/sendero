/**
 * Chat-turn pricing for nanopayments.
 *
 * Returns the priceMicroUsdc to charge for a single chat turn, given the
 * model used + the token usage reported by `streamText`'s `onFinish`
 * callback.
 *
 * Why this exists: enabling thinking on the conversational LLM made the
 * per-turn cost vary by ~50× across the available models (Gemini Flash
 * vs Claude Opus with budget=4096). The legacy flat $0.01 chat_reply
 * fee under-priced expensive models and over-priced cheap ones. This
 * helper sums (a) a tiny base fee for the dispatch overhead, plus
 * (b) actual provider cost rolled up to micro-USDC, plus (c) a small
 * margin so we don't run at-cost.
 *
 * Per-million-token rates below are the GATEWAY's pass-through rates
 * (Vercel AI Gateway publishes these). Reasoning tokens bill as output
 * tokens at every provider — Anthropic explicitly, Gemini implicitly
 * (the `thoughtsTokenCount` rolls into `outputTokenCount` for billing).
 *
 * Tool-internal models (OCR, embeddings) NEVER hit this — they price
 * per their own pinned rates inside the respective tool handlers.
 */

export interface ChatUsage {
  /** Tokens we sent into the model (system + history + new user turn). */
  inputTokens?: number | null | undefined;
  /** Final-answer tokens streamed back. */
  outputTokens?: number | null | undefined;
  /**
   * Hidden chain-of-thought tokens — Gemini's `thoughtsTokenCount` and
   * Anthropic's thinking output. Bills at the same rate as outputTokens
   * at every provider; we surface the count separately for audit.
   */
  reasoningTokens?: number | null | undefined;
  totalTokens?: number | null | undefined;
}

interface ModelRates {
  /** USD per 1M input tokens. */
  inputUsdPerMillion: number;
  /** USD per 1M output tokens (reasoning rolls in here). */
  outputUsdPerMillion: number;
}

/**
 * Per-million-token USD rates, keyed on gateway slug.
 * Source: Vercel AI Gateway pricing pages (2026-04). Update when rates
 * change — the legacy flat fee is the safety net if a model is missing.
 */
const MODEL_RATES: Record<string, ModelRates> = {
  // Google
  'google/gemini-2.5-flash': { inputUsdPerMillion: 0.075, outputUsdPerMillion: 0.3 },
  'google/gemini-2.5-pro': { inputUsdPerMillion: 1.25, outputUsdPerMillion: 5 },
  'google/gemini-3-flash': { inputUsdPerMillion: 0.075, outputUsdPerMillion: 0.3 },
  'google/gemini-3.1-pro-preview': { inputUsdPerMillion: 1.25, outputUsdPerMillion: 5 },
  // Anthropic
  'anthropic/claude-sonnet-4-5': { inputUsdPerMillion: 3, outputUsdPerMillion: 15 },
  'anthropic/claude-opus-4-1': { inputUsdPerMillion: 15, outputUsdPerMillion: 75 },
  'anthropic/claude-haiku-4-5': { inputUsdPerMillion: 1, outputUsdPerMillion: 5 },
  // OpenAI
  'openai/gpt-5': { inputUsdPerMillion: 2.5, outputUsdPerMillion: 10 },
  'openai/gpt-5-mini': { inputUsdPerMillion: 0.5, outputUsdPerMillion: 2 },
};

/**
 * Base dispatch overhead — covers turn id minting, meter write, SSE
 * fan-out, idempotency check. Independent of model. 1_000 micro = $0.001.
 */
const BASE_FEE_MICRO_USDC = 1_000n;

/**
 * Margin multiplier on raw provider cost. 1.20 = 20% margin on top of
 * gateway pass-through. Keeps the take-rate honest without sneaking in
 * an opaque markup. Plan tiers can still discount this via
 * `pricingOverrides` from `buildPlanOverrides()`.
 */
const COST_MARGIN = 1.2;

/**
 * Compute the priceMicroUsdc for a chat turn. Uses the actual token
 * usage when available; falls back to a conservative ceiling estimate
 * when usage is missing (e.g. the provider didn't report counts).
 *
 * @param modelId      Gateway slug (e.g. `google/gemini-2.5-flash`) or
 *                     null when running through a direct-provider handle
 *                     that doesn't expose a parseable id. Falls back to
 *                     base fee.
 * @param usage        `streamText` `onFinish.usage` — input/output/
 *                     reasoning token counts. Reasoning is counted as
 *                     output for cost.
 * @param discountBps  Plan-tier nanopayment discount in basis points
 *                     (0 / 1500 / 3000 / 5000 = free / basic / pro /
 *                     enterprise). Applied to BOTH the base fee and the
 *                     provider passthrough so paid plans get their
 *                     advertised cut even on expensive thinking models.
 */
export function chatTurnPriceMicroUsdc(
  modelId: string | null,
  usage: ChatUsage | undefined,
  discountBps: number = 0
): bigint {
  const applyDiscount = (raw: bigint): bigint => {
    if (discountBps <= 0) return raw;
    const bps = BigInt(Math.max(0, Math.min(10_000, Math.round(discountBps))));
    return (raw * (10_000n - bps)) / 10_000n;
  };

  if (!modelId) return applyDiscount(BASE_FEE_MICRO_USDC);
  const rates = MODEL_RATES[modelId];
  if (!rates || !usage) return applyDiscount(BASE_FEE_MICRO_USDC);

  const inputTokens = Math.max(0, Number(usage.inputTokens ?? 0));
  const outputTokens = Math.max(0, Number(usage.outputTokens ?? 0));
  const reasoningTokens = Math.max(0, Number(usage.reasoningTokens ?? 0));

  // Reasoning bills at the output rate at every provider Sendero
  // ships against today.
  const inputCostUsd = (inputTokens / 1_000_000) * rates.inputUsdPerMillion;
  const outputCostUsd = ((outputTokens + reasoningTokens) / 1_000_000) * rates.outputUsdPerMillion;
  const totalCostUsd = (inputCostUsd + outputCostUsd) * COST_MARGIN;

  // Convert to micro-USDC (1 USD = 1_000_000 micro). bigint to keep
  // settlement math exact.
  const totalCostMicro = BigInt(Math.ceil(totalCostUsd * 1_000_000));
  return applyDiscount(BASE_FEE_MICRO_USDC + totalCostMicro);
}

/**
 * Tiny shim for the meter event metadata so a downstream auditor can
 * see the priced inputs side-by-side with the cost. Always cheap to
 * include — it's just numbers.
 */
export function chatPricingBreakdown(
  modelId: string | null,
  usage: ChatUsage | undefined,
  discountBps: number = 0
) {
  return {
    model: modelId ?? null,
    inputTokens: usage?.inputTokens ?? null,
    outputTokens: usage?.outputTokens ?? null,
    reasoningTokens: usage?.reasoningTokens ?? null,
    totalTokens: usage?.totalTokens ?? null,
    rates: modelId ? (MODEL_RATES[modelId] ?? null) : null,
    marginMultiplier: COST_MARGIN,
    baseFeeMicroUsdc: BASE_FEE_MICRO_USDC.toString(),
    discountBps,
  };
}

/**
 * Extract the gateway slug from whatever streamText was handed. When
 * the caller passed a string slug, return it. When it passed a
 * direct-provider model handle (Vertex / direct Anthropic / direct
 * OpenAI), best-effort sniff `.modelId`. Returns null when unknowable.
 */
export function inferModelId(model: unknown): string | null {
  if (typeof model === 'string') return model;
  if (model && typeof model === 'object') {
    const m = model as { modelId?: unknown; provider?: unknown };
    if (typeof m.modelId === 'string') {
      // Direct-provider handles expose plain modelId (e.g.
      // 'gemini-2.5-flash'); prefix when we can guess the provider so
      // the lookup table hits.
      if (typeof m.provider === 'string' && m.provider.length > 0) {
        return `${m.provider}/${m.modelId}`;
      }
      return m.modelId;
    }
  }
  return null;
}
