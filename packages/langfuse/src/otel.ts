/**
 * @sendero/langfuse/otel — OpenTelemetry initialization with LangfuseSpanProcessor
 *
 * Call initLangfuseOtel() once at application startup:
 *   - Next.js: apps/app/instrumentation.ts
 *   - Trigger.dev / background workers: task entry file
 *
 * The LangfuseSpanProcessor intercepts every AI SDK span (generateText,
 * streamText, generateObject) and ships it to Langfuse. The filtering
 * allowlist below prevents Langfuse from receiving infrastructure noise
 * (HTTP client spans, DB queries, etc.).
 */

import { isLangfuseEnabled, getLangfuseBaseUrl } from './client';

let _otelInitialized = false;
let _spanProcessor: { forceFlush: () => Promise<void> } | null = null;

export function getSpanProcessor(): { forceFlush: () => Promise<void> } | null {
  return _spanProcessor;
}

export function initLangfuseOtel(): {
  spanProcessor: { forceFlush: () => Promise<void> };
  shutdown: () => Promise<void>;
} | null {
  if (_otelInitialized) return null;
  _otelInitialized = true;

  if (!isLangfuseEnabled()) return null;

  try {
    const { LangfuseSpanProcessor } = require('@langfuse/otel') as typeof import('@langfuse/otel');
    const { NodeTracerProvider } =
      require('@opentelemetry/sdk-trace-node') as typeof import('@opentelemetry/sdk-trace-node');

    const spanProcessor = new LangfuseSpanProcessor({
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
        ];
        return allowedScopes.includes(otelSpan.instrumentationScope.name);
      },
    });

    const provider = new NodeTracerProvider({
      spanProcessors: [spanProcessor],
    });

    provider.register();
    _spanProcessor = spanProcessor;

    console.info('[langfuse] OTel initialized', {
      baseUrl: getLangfuseBaseUrl() ?? 'cloud (default)',
    });

    return {
      spanProcessor,
      shutdown: async () => {
        await spanProcessor.forceFlush();
        await provider.shutdown();
      },
    };
  } catch (err) {
    console.warn('[langfuse] Failed to initialize OTel:', err instanceof Error ? err.message : err);
    return null;
  }
}
