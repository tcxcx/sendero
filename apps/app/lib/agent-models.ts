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
import { createVertex } from '@ai-sdk/google-vertex';
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
  vertexConfigured,
  vertexLocation,
  vertexProject,
} from '@sendero/agent';
import {
  allowedModelsForCap,
  cogsForModel,
  defaultModelForCap,
  isModelAllowedByCap,
  PLANS,
  type PlanConfig,
  type PlanTier,
} from '@sendero/billing';
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

/**
 * Server-side model gating envelope. Returned to callers when the user
 * (or AI agent) requests a model that exceeds their plan's per-turn
 * COGS ceiling. The 403 envelope includes everything an LLM caller
 * needs to self-recover: allowed models for this tier, the next
 * upgrade target, and a docs deep-link.
 *
 * Match the existing `signature_required` envelope format from
 * `apps/app/app/api/agent/dispatch/route.ts` for consistency with
 * the rest of the developer surface.
 */
export interface LockedModelError {
  error: 'model_locked';
  code: 'BILLING_MODEL_LOCKED';
  message: string;
  requestedModel: string;
  currentTier: PlanTier;
  /** Lowest tier whose `maxCostPerTurnMicro` would unlock the model. */
  requiredTier: PlanTier | 'enterprise';
  /** Models the calling tier IS allowed to invoke right now. */
  allowedModels: string[];
  /** Deep-link to the upgrade flow with context (model, key, source). */
  upgradeUrl: string;
  /** Public docs page explaining the model-tier policy. */
  docs: string;
}

export type ResolveChatModelResult =
  | { ok: true; modelId: string; model: LanguageModel | string }
  | { ok: false; locked: LockedModelError };

const TIER_ORDER: readonly PlanTier[] = ['free', 'basic', 'pro', 'enterprise'] as const;

/**
 * Resolve a user-picked model against the tenant's plan's per-turn
 * COGS ceiling. Returns either the model handle ready for streamText
 * OR a structured 403 envelope.
 *
 * Critical security property: the model parameter is server-validated
 * here. Routes MUST NOT pass the requested model directly to streamText
 * without going through this gate, otherwise a Free-tier API caller
 * could call opus by guessing the model ID.
 *
 * For auto-routed flows (Slack agent dispatch, no user picker), pass
 * `defaultModelForCap(plan.maxCostPerTurnMicro)` as the modelId — the
 * helper resolves to the cheapest allowed model for the tier.
 */
export function resolveChatModel(
  modelId: string,
  plan: PlanConfig,
  options: { keyId?: string; source?: 'web' | 'api' | 'slack' | 'whatsapp' } = {}
): ResolveChatModelResult {
  if (!isModelAllowedByCap(modelId, plan.maxCostPerTurnMicro)) {
    const cogs = cogsForModel(modelId);
    const cogsValue = cogs?.cogsPerTurnMicro ?? null;
    const requiredTier = TIER_ORDER.find(t => {
      if (t === plan.tier) return false;
      const cap = PLANS[t]?.maxCostPerTurnMicro;
      if (cap === null || cap === undefined) return true; // unbounded
      if (cogsValue === null) return false;
      return cogsValue <= cap;
    }) ?? ('enterprise' as const);

    const upgradeQS = new URLSearchParams({
      upgrade: requiredTier,
      from: options.source ?? 'web',
      model: modelId,
      ...(options.keyId ? { keyId: options.keyId } : {}),
    });

    return {
      ok: false,
      locked: {
        error: 'model_locked',
        code: 'BILLING_MODEL_LOCKED',
        message: `Model '${modelId}' requires ${requiredTier} tier or higher.`,
        requestedModel: modelId,
        currentTier: plan.tier,
        requiredTier,
        allowedModels: allowedModelsForCap(plan.maxCostPerTurnMicro),
        upgradeUrl: `/dashboard/settings/billing?${upgradeQS.toString()}`,
        docs: 'https://docs.sendero.travel/docs/pricing#model-tiers',
      },
    };
  }

  // Allowed — resolve the model handle. Gateway path returns the
  // string form so the AI SDK auto-routes; direct path constructs
  // the provider-specific model handle via `directModelFromString`.
  if (gatewayConfigured()) {
    return { ok: true, modelId, model: modelId };
  }
  const direct = directModelFromString(modelId);
  if (!direct) {
    // No gateway, no direct credentials, but model is technically
    // allowed by the tier cap. Fall back to tier default so Slack
    // dispatch still works rather than 503ing the whole turn.
    const fallbackId = defaultModelForCap(plan.maxCostPerTurnMicro);
    const fallback = directModelFromString(fallbackId);
    if (!fallback) {
      // Truly nothing available — caller should 503.
      return {
        ok: false,
        locked: {
          error: 'model_locked',
          code: 'BILLING_MODEL_LOCKED',
          message: `No model handle available for '${modelId}'; check provider credentials.`,
          requestedModel: modelId,
          currentTier: plan.tier,
          requiredTier: plan.tier,
          allowedModels: allowedModelsForCap(plan.maxCostPerTurnMicro),
          upgradeUrl: `/dashboard/settings/billing`,
          docs: 'https://docs.sendero.travel/docs/pricing#model-tiers',
        },
      };
    }
    return { ok: true, modelId: fallbackId, model: fallback };
  }
  return { ok: true, modelId, model: direct };
}

export function directModelFromString(direct: string): LanguageModel | null {
  const [provider, modelId] = direct.split('/') as [string, string];
  if (provider === 'vertex') {
    // Vertex AI auth via ADC locally (~/.config/gcloud/...) and via
    // GOOGLE_APPLICATION_CREDENTIALS_JSON in deployed envs. The
    // @ai-sdk/google-vertex SDK auto-discovers when googleAuthOptions
    // is omitted; we only pass credentials when the SA JSON env is set.
    if (!vertexConfigured()) return null;
    const project = vertexProject();
    if (!project) return null;
    let googleAuthOptions: Parameters<typeof createVertex>[0]['googleAuthOptions'];
    const saJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
    if (saJson) {
      try {
        googleAuthOptions = { credentials: JSON.parse(saJson) };
      } catch {
        return null;
      }
    }
    const vertex = createVertex({ project, location: vertexLocation(), googleAuthOptions });
    return vertex(geminiDirectModelId(direct));
  }
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
