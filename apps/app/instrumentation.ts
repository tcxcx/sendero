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
  }
}
