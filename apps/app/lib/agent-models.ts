/**
 * Shared model resolver for `runAgentTurn` callers.
 *
 * Mirrors the dispatch route's resolution policy so Slack agent turns,
 * dispatch turns, and any future agent caller all use the same path:
 *
 *   1. If Vercel AI Gateway is configured → return the gateway string form
 *      (`'google/gemini-3-flash'` for `fast`, `'google/gemini-3.1-pro-preview'`
 *      for `smart`). AI SDK auto-routes; `providerOptions.gateway.order` drives
 *      fallback **google → anthropic → openai** (Gemini-first per CLAUDE.md).
 *   2. Else fall back to direct SDKs in the same cascade order via
 *      `directProviderCascade` from `@sendero/agent`.
 *   3. Else return `null` and the caller surfaces a clear error.
 *
 * NEVER hardcode a single provider/model in callers. The whole point of
 * the gateway is provider redundancy + Gemini-first defaulting; bypassing it
 * with a hardcoded string ignores Sendero's billing-aware tier mapping
 * (`@sendero/billing/plans`) and the gateway's auto-failover.
 */

import { anthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { openai } from '@ai-sdk/openai';
import {
  directProviderCascade,
  directProviderModel,
  gatewayConfigured,
  gatewayErrorAllowsDirectRetry,
  geminiDirectModelId,
  googleGenerativeAiKey,
  selectModel,
  type ModelTier,
} from '@sendero/agent';
import type { LanguageModel } from 'ai';

export type { ModelTier };
export { gatewayErrorAllowsDirectRetry };

/**
 * Pick the model handle for this turn — gateway when configured, direct as
 * fallback. Returns `null` if neither path is available; caller should 503
 * with a clear error.
 */
export function resolveModel(tier: ModelTier): LanguageModel | string | null {
  if (gatewayConfigured()) {
    return selectModel({ tier }).model;
  }
  return resolveDirectModel(tier);
}

export function resolveDirectModel(tier: ModelTier): LanguageModel | null {
  const direct = directProviderModel(tier);
  if (!direct) return null;
  return directModelFromString(direct);
}

/**
 * For gateway-failure retry: list of direct-provider models in cascade
 * order (google → anthropic → openai per `directProviderCascade`). Each
 * returned model is already validated against env (e.g. anthropic dropped
 * if `ANTHROPIC_API_KEY` is unset).
 */
export function resolveDirectModels(
  tier: ModelTier
): Array<{ label: string; model: LanguageModel }> {
  const seen = new Set<string>();
  const models: Array<{ label: string; model: LanguageModel }> = [];
  for (const candidate of directProviderCascade(tier)) {
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    const model = directModelFromString(candidate);
    if (model) models.push({ label: candidate, model });
  }
  return models;
}

export function directModelFromString(direct: string): LanguageModel | null {
  const [provider, modelId] = direct.split('/') as [string, string];
  if (provider === 'google') {
    const key = googleGenerativeAiKey();
    if (!key) return null;
    const google = createGoogleGenerativeAI({ apiKey: key });
    return google(geminiDirectModelId(direct));
  }
  if (provider === 'anthropic' && !process.env.ANTHROPIC_API_KEY) return null;
  if (provider === 'openai' && !process.env.OPENAI_API_KEY) return null;
  if (provider === 'anthropic') return anthropic(modelId);
  if (provider === 'openai') return openai(modelId);
  return null;
}
