/**
 * @sendero/langfuse — Langfuse observability for all Sendero AI operations
 *
 * This is the ONLY package that imports @langfuse/* directly.
 * All surfaces (app-api, agent, slack, whatsapp, mcp, workflows) import from here.
 *
 * Quick start:
 *   1. Set LANGFUSE_SECRET_KEY + LANGFUSE_PUBLIC_KEY in .env
 *   2. Call initLangfuseOtel() in instrumentation.ts (auto-captures all AI SDK calls)
 *   3. Add experimental_telemetry: aiTelemetryConfig() to every generateText/streamText call
 *   4. Wrap agent operations with traceAgent() to group AI SDK spans into logical traces
 *   5. Call flushLangfuse() at the end of every serverless turn
 */

export {
  getClient,
  isLangfuseEnabled,
  isLangfusePromptManagementEnabled,
  isLangfuseEvaluatorsEnabled,
} from './client';
export { evaluateTrace } from './evaluators';
export { flushLangfuse } from './flush';
export {
  buildLangfuseSpanProcessor,
  getSpanProcessor,
  initLangfuseOtel,
  markOtelInitialized,
} from './otel';
export { compilePrompt, getPromptRaw, getPromptWithFallback } from './prompts';
export type { LangfusePromptResult } from './prompts';
export {
  batchScore,
  scoreCost,
  scoreGeneration,
  scoreLatency,
  scoreToolSuccess,
  scoreTrace,
} from './scores';
export {
  agentSessionId,
  cronSessionId,
  stampSessionId,
  tripSessionId,
} from './sessions';
export {
  aiTelemetryConfig,
  extractTraceId,
  getActiveTraceId,
  propagateTraceHeaders,
  traceAgent,
} from './traces';
export * from './types';
