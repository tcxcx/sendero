/**
 * @sendero/arize-phoenix — Arize Phoenix observability for Sendero.
 *
 * This is the ONLY package that imports `@arizeai/*` and the Phoenix
 * OTLP exporter directly. All surfaces (apps, agent runtime, tools)
 * import from here.
 *
 * Quick start:
 *   1. Set PHOENIX_API_KEY in .env
 *   2. apps/app/instrumentation.ts orchestrates buildPhoenixSpanProcessor()
 *      alongside @sendero/langfuse so both ride one global TracerProvider
 *   3. PR2 will add recall_similar_turns + dataset queries via @arizeai/phoenix-client
 *
 * Read-side (recall, datasets) lands in PR2/PR3.
 */

export {
  getPhoenixApiKey,
  getPhoenixCollectorEndpoint,
  getPhoenixProjectName,
  isPhoenixEnabled,
} from './client';
export { buildPhoenixSpanProcessor, getPhoenixSpanProcessor } from './otel';
export {
  recallSimilarTurns,
  type RecallSimilarTurn,
  type RecallSimilarTurnsArgs,
  type RecallSimilarTurnsResult,
} from './recall';
export {
  findResolvedGap,
  resetResolvedGapsDatasetCache,
  type FindResolvedGapArgs,
  type FindResolvedGapResult,
  type ResolvedGapHit,
} from './experiments';
export {
  promoteResolutions,
  promoteSuccesses,
  type BookingRow,
  type KnowledgeGapRow,
  type PromoteReport,
  type PromoteResolutionsArgs,
  type PromoteSuccessesArgs,
} from './promote';
export { SENDERO_SPAN_ATTRS, type Provenance, type SenderoSpanAttr } from './types';
