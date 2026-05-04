/**
 * Next.js instrumentation — runs once at server startup.
 *
 * Initializes Langfuse OpenTelemetry so every AI SDK call
 * (generateText, streamText, generateObject) automatically creates
 * a Langfuse generation via the LangfuseSpanProcessor.
 *
 * See: https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { initLangfuseOtel } = await import('@sendero/langfuse/otel');
    initLangfuseOtel();

    // Wire the unified-gateway → Liveblocks alert callback so a low
    // platform Solana hot-wallet balance pings the customer-support
    // agent (which fans out to Slack/WhatsApp/inbox). Lazy imports
    // keep the @sendero/circle module free of Liveblocks deps.
    const { setSolanaPlatformLowAlertCallback } = await import('@sendero/circle');
    const { notifyPlatformWalletLow } = await import('@/lib/platform-wallet-alerts');
    setSolanaPlatformLowAlertCallback(notifyPlatformWalletLow);
  }
}
