/**
 * Gemini multimodal extractor.
 *
 * Ported from desk-v1 `packages/documents/src/processors/base-extraction-engine.ts`
 * (Fantasmita LLC, internal reuse) — heavily trimmed for Sendero's Vercel
 * serverless shape:
 *
 *   - Single provider, not desk-v1's 4-pass mistral→gemini cascade. Sendero
 *     agents already pay for Vertex capacity; we piggy-back on it instead
 *     of adding a second vendor.
 *   - Vertex-first → Gemini direct API fallback, matching `/api/chat`'s
 *     `resolveDirectPickeds` so the OCR path inherits the same credential
 *     probe chain (ADC → service-account JSON → GEMINI_API_KEY).
 *   - AI SDK v6 `generateText` + `Output.object({ schema })` with a raw
 *     inline file part — the same shape desk-v1 used in v6.
 *   - Caller-supplied `AbortSignal` + a default 60s timeout keeps us
 *     inside Vercel's 300s API-route budget with plenty of margin.
 */

import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createVertex } from '@ai-sdk/google-vertex';
import { type LanguageModel, Output, generateText } from 'ai';
import type { ZodTypeAny, z } from 'zod';

// These helpers mirror `@sendero/agent/models` exactly — inlined here to
// keep @sendero/ocr off the @sendero/agent → @sendero/tools → @sendero/ocr
// dependency cycle. Keep them in sync whenever the agent-side contract
// changes (grep for `vertexProject` across packages).
function vertexProject(): string | null {
  return (
    process.env.GOOGLE_CLOUD_PROJECT ||
    process.env.GCLOUD_PROJECT ||
    process.env.GOOGLE_VERTEX_PROJECT ||
    null
  );
}
function vertexLocation(): string {
  return process.env.GOOGLE_CLOUD_LOCATION || process.env.GOOGLE_VERTEX_LOCATION || 'us-central1';
}
function vertexConfigured(): boolean {
  return Boolean(vertexProject());
}
function googleGenerativeAiKey(): string | null {
  return process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GEMINI_API_KEY || null;
}
/**
 * Map gateway-style `google/...` handles to direct Gemini model ids.
 * Same mapping as `@sendero/agent/models.geminiDirectModelId`.
 */
function geminiDirectModelId(gatewayModel: string): string {
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

export interface GeminiExtractArgs<TSchema extends ZodTypeAny> {
  /** Base64 or data-URI string for the document. */
  data: string;
  /** `application/pdf`, `image/png`, `image/jpeg`, etc. */
  mediaType: string;
  /** System prompt — caller composes per document kind. */
  systemPrompt: string;
  /** Zod schema for the structured output. */
  schema: TSchema;
  /** Gemini model ID. Defaults to `gemini-2.5-pro`. */
  model?: string;
  /** Timeout in ms. Defaults to 60 000. */
  timeoutMs?: number;
  /** Optional caller-supplied abort signal; merged with timeout. */
  signal?: AbortSignal;
}

export interface GeminiExtractResult<TOut> {
  data: TOut;
  /**
   * Which credential path actually ran the extraction.  `gateway`
   * means the Vercel AI Gateway routed it (and we can't tell from
   * the client which underlying provider the gateway picked).
   */
  provider: 'gateway' | 'vertex' | 'google';
  /** Model id used (post `geminiDirectModelId` mapping). */
  model: string;
  latencyMs: number;
}

/**
 * Run multimodal extraction against Gemini with a zod-backed structured output.
 *
 * The first provider that has credentials wins — Vertex when
 * `GOOGLE_CLOUD_PROJECT` (+ ADC / `GOOGLE_APPLICATION_CREDENTIALS_JSON`) is
 * set, otherwise Gemini AI Studio (`GOOGLE_GENERATIVE_AI_API_KEY` or
 * `GEMINI_API_KEY`). Neither configured → throws a clear error the caller
 * can surface to the user.
 */
export async function extractWithGemini<TSchema extends ZodTypeAny>(
  args: GeminiExtractArgs<TSchema>
): Promise<GeminiExtractResult<z.infer<TSchema>>> {
  const started = Date.now();
  const timeoutMs = args.timeoutMs ?? 60_000;
  const abortSignal = mergeSignals(args.signal, AbortSignal.timeout(timeoutMs));
  // Flash is the right default for structured document extraction:
  // ~3-5× faster than Pro, ~10× cheaper, same field accuracy when the
  // schema is tight. Callers who need Pro for ambiguous scans pass it
  // explicitly via `args.model`.
  const gatewayModelId = `google/${args.model ?? 'gemini-2.5-flash'}`;
  const directModelId = geminiDirectModelId(gatewayModelId);

  const picked = pickProvider(gatewayModelId, directModelId);
  if (!picked) {
    throw new Error(
      'No Gemini credentials configured. Set AI_GATEWAY_API_KEY (preferred — uses Vercel AI Gateway credits), GOOGLE_CLOUD_PROJECT (+ADC) for Vertex, or GOOGLE_GENERATIVE_AI_API_KEY / GEMINI_API_KEY for direct Gemini.'
    );
  }

  const result = await generateText({
    model: picked.model,
    // AI SDK v6 output-as-object replaces the deprecated generateObject path.
    output: Output.object({ schema: args.schema }),
    // Two retries with the SDK's built-in exponential backoff. One
    // transient 503 from the Gemini API otherwise kills a live demo.
    maxRetries: 2,
    temperature: 0,
    abortSignal,
    // Strip thinking budget when Pro is selected. Pro defaults to
    // reasoning-on, but OCR is a non-reasoning task: the schema pins
    // the output, there's nothing for the model to "think" about.
    // Disabling cuts latency + cost ~40-60% on Pro with no accuracy
    // loss. Harmless on Flash (which doesn't expose thinking).
    providerOptions: {
      google: {
        thinkingConfig: { thinkingBudget: 0 },
      },
    },
    messages: [
      { role: 'system', content: args.systemPrompt },
      {
        role: 'user',
        content: [
          {
            type: 'file' as const,
            data: args.data,
            mediaType: args.mediaType,
          },
        ],
      },
    ],
  });

  if (!result.output) {
    throw new Error(`Gemini ${picked.provider}:${directModelId} returned no structured output`);
  }

  return {
    data: result.output as z.infer<TSchema>,
    provider: picked.provider,
    model: directModelId,
    latencyMs: Date.now() - started,
  };
}

// ─── provider selection ───────────────────────────────────────────────

interface PickedProvider {
  provider: 'gateway' | 'vertex' | 'google';
  /**
   * Gateway path passes a bare `google/<model>` string — AI SDK v6
   * routes strings through `AI_GATEWAY_API_KEY` (or
   * `VERCEL_OIDC_TOKEN` on Vercel) automatically.  Vertex / Google
   * direct paths pass a fully-constructed LanguageModel instance.
   */
  model: LanguageModel;
}

/**
 * Priority order:
 *   1. Vercel AI Gateway (when `AI_GATEWAY_API_KEY` / `VERCEL_OIDC_TOKEN`).
 *      Consolidates billing, no per-provider key management, and
 *      falls over gracefully between gateway-side providers.
 *   2. Vertex direct (when `GOOGLE_CLOUD_PROJECT` + ADC).
 *      Fronts Gemini against a real GCP project — avoids the
 *      AI Studio free-tier quota ceiling.
 *   3. AI Studio direct (when `GOOGLE_GENERATIVE_AI_API_KEY` / `GEMINI_API_KEY`).
 */
function pickProvider(gatewayModelId: string, directModelId: string): PickedProvider | null {
  const gateway = tryGateway(gatewayModelId);
  if (gateway) return gateway;
  const vertex = tryVertex(directModelId);
  if (vertex) return vertex;
  return tryGoogle(directModelId);
}

function tryGateway(gatewayModelId: string): PickedProvider | null {
  if (process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN) {
    return { provider: 'gateway', model: gatewayModelId };
  }
  return null;
}

function tryVertex(modelId: string): PickedProvider | null {
  if (!vertexConfigured()) return null;
  const project = vertexProject();
  if (!project) return null;
  let googleAuthOptions: Parameters<typeof createVertex>[0]['googleAuthOptions'];
  const saJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
  if (saJson) {
    try {
      googleAuthOptions = { credentials: JSON.parse(saJson) };
    } catch (err) {
      // Parse errors fall through to the Google direct fallback so a
      // misconfigured SA JSON doesn't break OCR outright.
      console.warn(
        '[ocr] GOOGLE_APPLICATION_CREDENTIALS_JSON set but invalid, skipping vertex',
        err instanceof Error ? err.message : err
      );
      return null;
    }
  }
  const vertex = createVertex({ project, location: vertexLocation(), googleAuthOptions });
  return { provider: 'vertex', model: vertex(modelId) };
}

function tryGoogle(modelId: string): PickedProvider | null {
  const key = googleGenerativeAiKey();
  if (!key) return null;
  const google = createGoogleGenerativeAI({ apiKey: key });
  return { provider: 'google', model: google(modelId) };
}

function mergeSignals(a: AbortSignal | undefined, b: AbortSignal): AbortSignal {
  if (!a) return b;
  const ctrl = new AbortController();
  const forward = (signal: AbortSignal) => {
    if (signal.aborted) {
      ctrl.abort(signal.reason);
      return;
    }
    signal.addEventListener('abort', () => ctrl.abort(signal.reason), { once: true });
  };
  forward(a);
  forward(b);
  return ctrl.signal;
}
