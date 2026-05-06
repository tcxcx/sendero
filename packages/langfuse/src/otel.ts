/**
 * @sendero/langfuse/otel — OpenTelemetry initialization with LangfuseSpanProcessor
 *
 * Two entry shapes:
 *
 *   1. **Orchestrator path** (Next.js): `apps/app/instrumentation.ts`
 *      calls `buildLangfuseSpanProcessor()` to get the processor, then
 *      gathers it alongside `buildPhoenixSpanProcessor()` and constructs
 *      a SINGLE global `NodeTracerProvider` with both processors.
 *      Required because OTel v2 `BasicTracerProvider` does NOT support
 *      `addSpanProcessor()` after construction — processors must be
 *      passed in via `TracerConfig`.
 *
 *   2. **Legacy path** (Trigger.dev workers, scripts): `initLangfuseOtel()`
 *      builds + registers a Langfuse-only provider. Idempotent —
 *      subsequent calls (or calls after the orchestrator path already
 *      ran) no-op.
 *
 * The LangfuseSpanProcessor intercepts every AI SDK span (generateText,
 * streamText, generateObject) and ships it to Langfuse. The filtering
 * allowlist below prevents Langfuse from receiving infrastructure noise
 * (HTTP client spans, DB queries, etc.).
 */

import { isLangfuseEnabled, getLangfuseBaseUrl } from './client';

type SpanProcessor = import('@opentelemetry/sdk-trace-base').SpanProcessor;

let _otelInitialized = false;
let _spanProcessor: SpanProcessor | null = null;

export function getSpanProcessor(): SpanProcessor | null {
  return _spanProcessor;
}

/**
 * Build (but don't register) the Langfuse span processor. Returns
 * `null` when Langfuse is not configured. Used by the orchestrator at
 * `apps/app/instrumentation.ts` to gather processors before constructing
 * the global provider once.
 */
export function buildLangfuseSpanProcessor(): SpanProcessor | null {
  if (!isLangfuseEnabled()) return null;

  try {
    const { LangfuseSpanProcessor } = require('@langfuse/otel') as typeof import('@langfuse/otel');
    return new LangfuseSpanProcessor({
      // Only export spans from AI SDK and Langfuse — not HTTP, DB, etc.
      shouldExportSpan: ({
        otelSpan,
      }: {
        otelSpan: { instrumentationScope: { name: string } };
      }) => {
        const allowedScopes = [
          'langfuse-sdk',
          'ai',
          'openai',
          '@ai-sdk/openai',
          '@ai-sdk/anthropic',
          '@ai-sdk/google',
          '@ai-sdk/google-vertex',
          '@ai-sdk/groq',
          // OpenInference instrumentors (richer Gemini span attrs in PR2+)
          '@arizeai/openinference-instrumentation-vertexai',
          '@arizeai/openinference-instrumentation-google-genai',
        ];
        return allowedScopes.includes(otelSpan.instrumentationScope.name);
      },
    }) as unknown as SpanProcessor;
  } catch (err) {
    console.warn(
      '[langfuse] Failed to build span processor:',
      err instanceof Error ? err.message : err
    );
    return null;
  }
}

/**
 * Mark OTel as initialized externally — used by orchestrators that
 * construct the provider themselves. Subsequent `initLangfuseOtel()`
 * calls become no-ops, preventing a second `provider.register()` that
 * OTel would silently ignore.
 */
export function markOtelInitialized(processor: SpanProcessor | null): void {
  _otelInitialized = true;
  if (processor) _spanProcessor = processor;
}

/**
 * Legacy stand-alone initialization for non-Next entry points
 * (Trigger.dev workers, scripts). Constructs a Langfuse-only provider.
 * Next.js routes through `apps/app/instrumentation.ts` which orchestrates
 * Langfuse + Phoenix together via `buildLangfuseSpanProcessor()` +
 * `buildPhoenixSpanProcessor()`.
 *
 * Idempotent — repeated calls (or calls after the orchestrator already
 * registered a provider via `markOtelInitialized`) return null without
 * side effects.
 */
export function initLangfuseOtel(): {
  spanProcessor: SpanProcessor;
  shutdown: () => Promise<void>;
} | null {
  if (_otelInitialized) return null;
  _otelInitialized = true;

  const processor = buildLangfuseSpanProcessor();
  if (!processor) return null;

  try {
    const { NodeTracerProvider } =
      require('@opentelemetry/sdk-trace-node') as typeof import('@opentelemetry/sdk-trace-node');

    const provider = new NodeTracerProvider({ spanProcessors: [processor] });
    provider.register();
    _spanProcessor = processor;

    console.info('[langfuse] OTel initialized (legacy stand-alone path)', {
      baseUrl: getLangfuseBaseUrl() ?? 'cloud (default)',
    });

    return {
      spanProcessor: processor,
      shutdown: async () => {
        await processor.forceFlush();
        await provider.shutdown();
      },
    };
  } catch (err) {
    console.warn('[langfuse] Failed to initialize OTel:', err instanceof Error ? err.message : err);
    return null;
  }
}
