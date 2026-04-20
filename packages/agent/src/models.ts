/**
 * Model tier selection + price-aware fallback chains.
 *
 * Sendero routes every LLM call through Vercel AI Gateway using the
 * string-model form (`'anthropic/claude-opus-4.6'`). The gateway
 * handles provider fallback + observability + unified auth via a
 * single `AI_GATEWAY_API_KEY`. When the user has their own Anthropic
 * or OpenAI keys set directly, we pass them as BYOK so tokens still
 * route through the gateway but billing stays on their account.
 *
 * Three tiers, ordered by cost per 1M tokens (descending):
 *
 *   smart — reasoning-heavy, booking decisions, policy interpretation
 *           order: claude-opus → gpt-5 → claude-sonnet
 *           fast fallback keeps the conversation going if Anthropic
 *           is down; sonnet lands if both premium models time out
 *
 *   fast  — chat replies, lightweight routing, simple tool orchestration
 *           order: claude-sonnet → gpt-5-mini → claude-haiku
 *           near-zero latency variance
 *
 *   cheap — high-volume metered tools (search, quote_fx, check_policy)
 *           order: claude-haiku → gpt-5-mini → claude-sonnet
 *           first-pass cost below $0.001 per call
 *
 * Tools in @sendero/tools can declare `modelTier` in their ToolDef;
 * absent → 'fast'. Chat replies default to 'smart' but respect the
 * traveler's explicit tier hint when present.
 */

// ProviderOptions in AI SDK v6 is typed as `Record<string, JSONObject>`.
// We re-derive a compatible shape here so we don't have to add
// `@ai-sdk/provider-utils` as a direct dependency.
type JSONValue = null | string | number | boolean | JSONValue[] | { [k: string]: JSONValue };
type JSONObject = { [k: string]: JSONValue };
export type AgentProviderOptions = Record<string, JSONObject>;

export type ModelTier = 'smart' | 'fast' | 'cheap';

/** Vercel AI Gateway model strings — prefix = provider, suffix = model. */
export const GATEWAY_MODELS = {
  'anthropic/claude-opus-4.6': 'anthropic/claude-opus-4.6',
  'anthropic/claude-sonnet-4.6': 'anthropic/claude-sonnet-4.6',
  'anthropic/claude-haiku-4.5': 'anthropic/claude-haiku-4.5',
  'openai/gpt-5': 'openai/gpt-5',
  'openai/gpt-5-mini': 'openai/gpt-5-mini',
  'openai/gpt-4o': 'openai/gpt-4o',
  'openai/gpt-4o-mini': 'openai/gpt-4o-mini',
} as const;

export type GatewayModel = keyof typeof GATEWAY_MODELS;

export interface TierConfig {
  tier: ModelTier;
  /** Gateway model string chosen first. */
  primary: GatewayModel;
  /** Provider order passed to the gateway for automatic fallback. */
  providerOrder: Array<'anthropic' | 'openai' | 'vertex' | 'bedrock'>;
  /** Fallback models tried in sequence if the primary completely fails. */
  fallbacks: GatewayModel[];
}

export const MODEL_TIERS: Record<ModelTier, TierConfig> = {
  smart: {
    tier: 'smart',
    primary: 'anthropic/claude-opus-4.6',
    providerOrder: ['anthropic', 'vertex'],
    fallbacks: ['openai/gpt-5', 'anthropic/claude-sonnet-4.6'],
  },
  fast: {
    tier: 'fast',
    primary: 'anthropic/claude-sonnet-4.6',
    providerOrder: ['anthropic', 'vertex'],
    fallbacks: ['openai/gpt-5-mini', 'anthropic/claude-haiku-4.5'],
  },
  cheap: {
    tier: 'cheap',
    primary: 'anthropic/claude-haiku-4.5',
    providerOrder: ['anthropic', 'vertex'],
    fallbacks: ['openai/gpt-5-mini', 'openai/gpt-4o-mini'],
  },
};

/**
 * Build the `providerOptions` object to pass alongside `model` in
 * generateText/streamText calls. Includes:
 *   - `gateway.order`   : provider fallback chain
 *   - `gateway.byok`    : per-request credentials when the user supplies
 *                         their own Anthropic / OpenAI key
 *
 * Pass BYOK only when explicit keys exist in env — otherwise the
 * gateway bills against the workspace's AI_GATEWAY_API_KEY.
 */
export function buildProviderOptions(tier: ModelTier): AgentProviderOptions {
  const config = MODEL_TIERS[tier];
  const gateway: JSONObject = {
    order: [...config.providerOrder],
  };
  const byok: JSONObject = {};
  if (process.env.ANTHROPIC_API_KEY) {
    byok.anthropic = [{ apiKey: process.env.ANTHROPIC_API_KEY }];
  }
  if (process.env.OPENAI_API_KEY) {
    byok.openai = [{ apiKey: process.env.OPENAI_API_KEY }];
  }
  if (Object.keys(byok).length > 0) gateway.byok = byok;
  return { gateway };
}

/**
 * Resolve the gateway model string for a tier. Honors a per-tool
 * override passed via `tierOverride`, otherwise returns the tier's
 * primary.
 */
export function selectModel(args: { tier?: ModelTier; tierOverride?: ModelTier }): {
  model: GatewayModel;
  tier: ModelTier;
} {
  const tier = args.tierOverride ?? args.tier ?? 'smart';
  return { model: MODEL_TIERS[tier].primary, tier };
}

/**
 * Is the Vercel AI Gateway reachable? Requires either AI_GATEWAY_API_KEY
 * or VERCEL_OIDC_TOKEN (present automatically when deployed on Vercel).
 */
export function gatewayConfigured(): boolean {
  return Boolean(process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN);
}

/**
 * Fallback when the Gateway has no credential — use direct provider SDKs
 * (Anthropic first, then OpenAI). Returns null if neither is configured.
 */
export function directProviderModel(tier: ModelTier): string | null {
  const direct = MODEL_TIERS[tier].primary;
  const [provider] = direct.split('/');
  if (provider === 'anthropic' && process.env.ANTHROPIC_API_KEY) {
    return direct;
  }
  if (provider === 'openai' && process.env.OPENAI_API_KEY) {
    return direct;
  }
  // Try fallbacks in order.
  for (const fb of MODEL_TIERS[tier].fallbacks) {
    const [fbProvider] = fb.split('/');
    if (fbProvider === 'anthropic' && process.env.ANTHROPIC_API_KEY) return fb;
    if (fbProvider === 'openai' && process.env.OPENAI_API_KEY) return fb;
  }
  return null;
}

/**
 * Per-action tier hint consumed by @sendero/tools and the chat route.
 * Defaults align with the product spec — booking decisions go to smart,
 * chat goes to fast, high-volume search hits cheap.
 */
export const TIER_BY_ACTION: Record<string, ModelTier> = {
  chat_reply: 'smart',
  book_flight: 'smart',
  check_policy: 'smart',
  modify_booking: 'smart',
  cancel_booking: 'smart',
  settle_split: 'smart',

  confirm_booking: 'fast',
  quote_fx: 'fast',
  get_trip_status: 'fast',
  rate_agent: 'fast',
  get_traveler_context: 'fast',

  search_flights: 'cheap',
  search_hotels: 'cheap',
  recommend_restaurants: 'cheap',
  check_treasury: 'cheap',
  gateway_balance: 'cheap',
};

export function tierForAction(action: string): ModelTier {
  return TIER_BY_ACTION[action] ?? 'fast';
}
