/**
 * Next.js instrumentation — runs once at server startup.
 *
 * Boots paired Phoenix + Langfuse OTel exporters so every agent
 * runtime span lands in both dashboards under the same trace_id.
 * Mirrors the orchestrator pattern from Sendero monolith's
 * apps/app/instrumentation.ts. Each processor builder returns null
 * when its env is not configured — Minions still boots clean with
 * just one or zero processors.
 *
 * Phoenix → OTLP HTTP (proto) with PHOENIX_API_KEY as bearer
 * Langfuse → LangfuseSpanProcessor from @langfuse/otel
 *
 * Both register on a single NodeTracerProvider. OTel v2's
 * BasicTracerProvider does NOT support addSpanProcessor() after
 * construction, so processors must be gathered before provider
 * creation.
 *
 * See: https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */

export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  type SpanProcessor = import('@opentelemetry/sdk-trace-base').SpanProcessor;
  const processors: SpanProcessor[] = [];

  // Phoenix span processor — exports via OTLP HTTP to Phoenix Cloud
  // or a self-hosted collector. Project routing uses arize-space-id
  // header. Skips silently when PHOENIX_ENABLED is not "true" or
  // PHOENIX_API_KEY is unset.
  if (process.env.PHOENIX_ENABLED === 'true' && process.env.PHOENIX_API_KEY) {
    try {
      const { OTLPTraceExporter } = await import('@opentelemetry/exporter-trace-otlp-proto');
      const { BatchSpanProcessor } = await import('@opentelemetry/sdk-trace-base');
      const collector = (
        process.env.PHOENIX_COLLECTOR_ENDPOINT ||
        process.env.PHOENIX_BASE_URL ||
        'https://app.phoenix.arize.com'
      ).replace(/\/$/, '');
      const exporter = new OTLPTraceExporter({
        url: `${collector}/v1/traces`,
        headers: {
          authorization: `Bearer ${process.env.PHOENIX_API_KEY}`,
          'arize-space-id': process.env.PHOENIX_PROJECT_NAME || 'sendero-minions',
        },
      });
      processors.push(new BatchSpanProcessor(exporter));
      console.info('[instrumentation] Phoenix processor built', {
        collector,
        project: process.env.PHOENIX_PROJECT_NAME,
      });
    } catch (err) {
      console.warn(
        '[instrumentation] Phoenix processor build failed:',
        err instanceof Error ? err.message : err
      );
    }
  }

  // Langfuse span processor — exports via @langfuse/otel SDK using
  // public+secret key auth. Filters to AI SDK + provider scopes only
  // so HTTP/DB infrastructure spans don't pollute Langfuse.
  if (process.env.LANGFUSE_SECRET_KEY && process.env.LANGFUSE_PUBLIC_KEY) {
    try {
      const { LangfuseSpanProcessor } = await import('@langfuse/otel');
      const proc = new LangfuseSpanProcessor({
        shouldExportSpan: ({
          otelSpan,
        }: {
          otelSpan: { instrumentationScope: { name: string } };
        }) => {
          const allowed = [
            'langfuse-sdk',
            'ai',
            'openai',
            '@ai-sdk/openai',
            '@ai-sdk/anthropic',
            '@ai-sdk/google',
            '@ai-sdk/google-vertex',
            '@ai-sdk/groq',
          ];
          return allowed.includes(otelSpan.instrumentationScope?.name);
        },
      }) as unknown as SpanProcessor;
      processors.push(proc);
      console.info('[instrumentation] Langfuse processor built');
    } catch (err) {
      console.warn(
        '[instrumentation] Langfuse processor build failed:',
        err instanceof Error ? err.message : err
      );
    }
  }

  if (processors.length === 0) {
    console.info('[instrumentation] No OTel processors configured');
    return;
  }

  const { NodeTracerProvider } = await import('@opentelemetry/sdk-trace-node');
  const provider = new NodeTracerProvider({ spanProcessors: processors });
  provider.register();

  console.info('[instrumentation] OTel orchestrated', {
    processorCount: processors.length,
  });
}
