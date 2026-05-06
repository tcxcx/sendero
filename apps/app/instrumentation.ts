/**
 * Next.js instrumentation — runs once at server startup.
 *
 * Orchestrates the SHARED OTel TracerProvider for Sendero observability.
 * OTel only allows ONE global provider per process; both Langfuse and
 * Phoenix register span processors on it. Each package exports a
 * `buildXSpanProcessor()` returning a SpanProcessor (or null when not
 * configured); the orchestrator gathers them and constructs the single
 * provider once.
 *
 * Two-plane observability:
 *   - Langfuse → human ops (prompt management, evaluators, dashboards)
 *   - Phoenix  → agent runtime self-introspection (recall, find_resolved_gap)
 *
 * Spec: docs/specs/arize-phoenix-integration.md §4.1.
 *
 * See: https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Gather span processors from each Sendero observability package.
    // Each builder returns null when its env is not configured.
    const { buildLangfuseSpanProcessor, markOtelInitialized } = await import(
      '@sendero/langfuse/otel'
    );
    const { buildPhoenixSpanProcessor } = await import('@sendero/arize-phoenix/otel');

    const langfuseProcessor = buildLangfuseSpanProcessor();
    const phoenixProcessor = buildPhoenixSpanProcessor();

    type SpanProcessor = import('@opentelemetry/sdk-trace-base').SpanProcessor;
    const processors: SpanProcessor[] = [];
    if (langfuseProcessor) processors.push(langfuseProcessor);
    if (phoenixProcessor) processors.push(phoenixProcessor);

    if (processors.length > 0) {
      // OTel v2: BasicTracerProvider does NOT support addSpanProcessor()
      // after construction. Pass all processors via the constructor.
      const { NodeTracerProvider } = await import('@opentelemetry/sdk-trace-node');
      const provider = new NodeTracerProvider({ spanProcessors: processors });
      provider.register();

      // Tell @sendero/langfuse/otel that the global provider is already
      // registered, so subsequent initLangfuseOtel() calls (legacy
      // workers, scripts running in this process) become no-ops.
      markOtelInitialized(langfuseProcessor);

      console.info('[instrumentation] OTel orchestrated', {
        langfuse: !!langfuseProcessor,
        phoenix: !!phoenixProcessor,
        processorCount: processors.length,
      });
    }

    // Wire the unified-gateway → Liveblocks alert callback so a low
    // platform Solana hot-wallet balance pings the customer-support
    // agent (which fans out to Slack/WhatsApp/inbox). Lazy imports
    // keep the @sendero/circle module free of Liveblocks deps.
    const { setSolanaPlatformLowAlertCallback } = await import('@sendero/circle');
    const { notifyPlatformWalletLow } = await import('@/lib/platform-wallet-alerts');
    setSolanaPlatformLowAlertCallback(notifyPlatformWalletLow);
  }
}
