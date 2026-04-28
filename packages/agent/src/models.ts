/**
 * Model tier selection + price-aware fallback chains.
 *
 * **Vercel AI Gateway (preferred):** we pass string models such as
 * `google/gemini-3-flash` so the gateway can route observably with a
 * single `AI_GATEWAY_API_KEY` (or `VERCEL_OIDC_TOKEN` on Vercel).
 * **Google (Gemini)** is listed first in `providerOptions.gateway.order`
 * to align with our Arc hackathon sponsor; the gateway then tries
 * Anthropic and OpenAI when a provider is unavailable.
 *
 * **Direct keys (no gateway):** cascade is **Gemini → OpenAI → Anthropic**
 * when the corresponding env keys exist (`GOOGLE_GENERATIVE_AI_API_KEY`
 * or `GEMINI_API_KEY`, then `OPENAI_API_KEY`, then `ANTHROPIC_API_KEY`).
 * That mirrors gateway-down retries in `/api/agent/dispatch`.
 *
 * BYOK: optional `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, and
 * `GOOGLE_GENERATIVE_AI_API_KEY` / `GEMINI_API_KEY` are forwarded in
 * `gateway.byok` when set so billing can stay on your accounts while
 * traffic still flows through the gateway.
 *
 * Three tiers (Gemini-first on gateway; see `MODEL_TIERS`):
 *
 *   smart — Gemini 3-class pro reasoning, then Claude / GPT fallbacks
 *   fast  — Gemini 3 Flash–class latency, then Claude / GPT / Haiku
 *   cheap — Gemini 2.5 Flash Lite–class volume, then GPT mini / Haiku
 *
 * Tools in @sendero/tools can declare `modelTier` in their ToolDef;
 * absent → 'fast'. Chat defaults to `fast` tier unless overridden.
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
  'google/gemini-3.1-pro-preview': 'google/gemini-3.1-pro-preview',
  'google/gemini-3-flash': 'google/gemini-3-flash',
  'google/gemini-2.5-flash-lite': 'google/gemini-2.5-flash-lite',
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
  providerOrder: Array<'google' | 'anthropic' | 'openai' | 'vertex' | 'bedrock'>;
  /** Fallback models tried in sequence if the primary completely fails. */
  fallbacks: GatewayModel[];
}

export const MODEL_TIERS: Record<ModelTier, TierConfig> = {
  smart: {
    tier: 'smart',
    primary: 'google/gemini-3.1-pro-preview',
    providerOrder: ['google', 'anthropic', 'openai'],
    fallbacks: ['anthropic/claude-opus-4.6', 'openai/gpt-5', 'anthropic/claude-sonnet-4.6'],
  },
  fast: {
    tier: 'fast',
    primary: 'google/gemini-3-flash',
    providerOrder: ['google', 'anthropic', 'openai'],
    fallbacks: ['anthropic/claude-sonnet-4.6', 'openai/gpt-5-mini', 'anthropic/claude-haiku-4.5'],
  },
  cheap: {
    tier: 'cheap',
    primary: 'google/gemini-2.5-flash-lite',
    providerOrder: ['google', 'anthropic', 'openai'],
    fallbacks: ['anthropic/claude-haiku-4.5', 'openai/gpt-5-mini', 'openai/gpt-4o-mini'],
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
  const googleKey = googleGenerativeAiKey();
  if (googleKey) {
    byok.google = [{ apiKey: googleKey }];
  }
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

/** Google AI Studio / Gemini API key (either env name is accepted). */
export function googleGenerativeAiKey(): string | null {
  return process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GEMINI_API_KEY || null;
}

/** Google Cloud project id for Vertex AI. Locally discovered via ADC if unset. */
export function vertexProject(): string | null {
  return (
    process.env.GOOGLE_CLOUD_PROJECT ||
    process.env.GCLOUD_PROJECT ||
    process.env.GOOGLE_VERTEX_PROJECT ||
    null
  );
}

/**
 * Vertex regions where Gemini 2.5 Pro / Flash are GA at time of writing
 * (2026-04). New regions land regularly — extend rather than narrow.
 * The check is non-fatal: an unknown value warns once per process and
 * still flows through to Vertex (so a brand-new region works the day
 * Google launches it, before this list catches up).
 */
const KNOWN_VERTEX_LOCATIONS = new Set([
  'us-central1',
  'us-east1',
  'us-east4',
  'us-east5',
  'us-south1',
  'us-west1',
  'us-west4',
  'europe-west1',
  'europe-west2',
  'europe-west3',
  'europe-west4',
  'europe-west8',
  'europe-west9',
  'europe-southwest1',
  'asia-northeast1',
  'asia-northeast3',
  'asia-southeast1',
  'australia-southeast1',
  'global',
]);
let warnedUnknownVertexLocation = false;

/** Google Cloud region for Vertex AI. Defaults to us-central1. */
export function vertexLocation(): string {
  const value =
    process.env.GOOGLE_CLOUD_LOCATION || process.env.GOOGLE_VERTEX_LOCATION || 'us-central1';
  if (!KNOWN_VERTEX_LOCATIONS.has(value) && !warnedUnknownVertexLocation) {
    warnedUnknownVertexLocation = true;
    console.warn(
      `[vertexLocation] "${value}" is not in the known Vertex region set — typo? ` +
        'Falling through anyway. Update KNOWN_VERTEX_LOCATIONS in packages/agent/src/models.ts ' +
        'if Google added a region.'
    );
  }
  return value;
}

/**
 * True when Vertex AI is reachable. Two acceptance paths:
 *  1. Service-account JSON pasted into GOOGLE_APPLICATION_CREDENTIALS_JSON
 *     (prod on Vercel — can't ship an ADC file with the bundle).
 *  2. GOOGLE_APPLICATION_CREDENTIALS pointing at a file on disk OR a
 *     local `~/.config/gcloud/application_default_credentials.json` from
 *     `gcloud auth application-default login` (dev).
 * In both cases GOOGLE_CLOUD_PROJECT must be set so the SDK knows which
 * project to bill. We probe-then-stream, so a misconfigured Vertex just
 * falls through to the next provider.
 */
export function vertexConfigured(): boolean {
  return Boolean(vertexProject());
}

function providerHasKey(provider: string): boolean {
  if (provider === 'vertex') return vertexConfigured();
  if (provider === 'google') return Boolean(googleGenerativeAiKey());
  if (provider === 'anthropic') return Boolean(process.env.ANTHROPIC_API_KEY);
  if (provider === 'openai') return Boolean(process.env.OPENAI_API_KEY);
  return false;
}

/**
 * Ordered `provider/model` handles for **direct** SDK calls when the
 * gateway is not configured (or after a gateway hard-fail in dispatch).
 * Order: **Vertex → Gemini (AI Studio) → OpenAI → Anthropic** within the
 * tier’s candidate list. Vertex fronts the same Gemini model ids as
 * AI Studio but bills against a real GCP project, so it doesn't hit the
 * free-credits restrictions that burn AI Studio keys on shared quota.
 */
export function directProviderCascade(tier: ModelTier): string[] {
  const { primary, fallbacks } = MODEL_TIERS[tier];
  const candidates = [primary, ...fallbacks];
  const vertex: string[] = [];
  const google: string[] = [];
  const openai: string[] = [];
  const anthropic: string[] = [];
  const seen = new Set<string>();
  for (const id of candidates) {
    if (seen.has(id)) continue;
    seen.add(id);
    const [p, m] = id.split('/');
    if (p === 'google') {
      // Same Gemini model id exposed through both providers — we fan it
      // out so Vertex (when configured) gets first crack, then AI Studio.
      vertex.push(`vertex/${m}`);
      google.push(id);
    } else if (p === 'openai') openai.push(id);
    else if (p === 'anthropic') anthropic.push(id);
  }
  const ordered = [...vertex, ...google, ...openai, ...anthropic];
  return ordered.filter(id => {
    const [p] = id.split('/');
    return providerHasKey(p);
  });
}

/**
 * First direct model when the Gateway has no credential — prefers
 * Gemini, then OpenAI, then Anthropic for the tier (see `directProviderCascade`).
 */
export function directProviderModel(tier: ModelTier): string | null {
  const cascade = directProviderCascade(tier);
  return cascade[0] ?? null;
}

/**
 * True when an error thrown by a gateway-routed call is plausibly a
 * gateway-level (not provider-level) failure, and we should cascade to
 * direct-provider retries. Matches the Vercel AI Gateway "free credits
 * restricted" family, plus generic "gateway" mentions and AI_GATEWAY env
 * references that bubble up from the SDK.
 *
 * Shared by /api/chat (web console, streaming) and /api/agent/dispatch
 * (channel fan-in, generateText). Both cascade the same way.
 */
export function gatewayErrorAllowsDirectRetry(err: unknown): boolean {
  if (!gatewayConfigured()) return false;
  const message = err instanceof Error ? err.message : String(err);
  const lower = message.toLowerCase();
  return (
    lower.includes('free credits') ||
    lower.includes('restricted access') ||
    lower.includes('ai_gateway') ||
    lower.includes('ai gateway') ||
    lower.includes('gateway')
  );
}

/**
 * Maps Vercel Gateway-style `google/...` handles to **Gemini API** model ids
 * for `@ai-sdk/google` when calling Google directly (no gateway).
 * Gateway catalog may trail the consumer API; these ids are stable on AI Studio.
 */
export function geminiDirectModelId(gatewayModel: string): string {
  const suffix = gatewayModel.startsWith('google/')
    ? gatewayModel.slice('google/'.length)
    : gatewayModel;
  const map: Record<string, string> = {
    'gemini-3.1-pro-preview': 'gemini-2.5-pro',
    'gemini-3-flash': 'gemini-2.5-flash',
    'gemini-2.5-flash-lite': 'gemini-2.5-flash',
  };
  return map[suffix] ?? suffix;
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
  scan_document: 'smart',

  confirm_booking: 'fast',
  quote_fx: 'fast',
  get_trip_status: 'fast',
  rate_agent: 'fast',
  get_traveler_context: 'fast',

  search_flights: 'cheap',
  search_hotels: 'cheap',
  recommend_restaurants: 'cheap',
  export_route_map: 'cheap',
  check_treasury: 'cheap',
  gateway_balance: 'cheap',
};

export function tierForAction(action: string): ModelTier {
  return TIER_BY_ACTION[action] ?? 'fast';
}
