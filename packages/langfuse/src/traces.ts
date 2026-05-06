/**
 * @sendero/langfuse/traces — Core tracing: traceAgent, aiTelemetryConfig
 *
 * traceAgent() wraps any agent operation in a Langfuse OTel span.
 * aiTelemetryConfig() returns the experimental_telemetry object to pass
 * to every generateText / streamText / generateObject call.
 */

import { isLangfuseEnabled } from './client';
import type { AgentType, Surface, TraceMetadata, TraceResult, TriggerSource } from './types';

type TracingModule = typeof import('@langfuse/tracing');
let _tracing: TracingModule | null = null;
let _tracingInitAttempted = false;

function getTracing(): TracingModule | null {
  if (_tracingInitAttempted) return _tracing;
  _tracingInitAttempted = true;

  try {
    _tracing = require('@langfuse/tracing') as TracingModule;
  } catch {
    // OTel unavailable (edge runtime, test env without the package)
  }

  return _tracing;
}

/**
 * Wrap an agent operation in a Langfuse trace.
 *
 * Uses @langfuse/tracing startActiveObservation to create an OTel span.
 * Falls back to a no-op wrapper when OTel is unavailable so the agent
 * never crashes due to observability failures.
 *
 * Every AI call (runAgentTurn, Slack/WhatsApp turns, OCR, stamp gen)
 * should pass through this — it's the parent span that groups all
 * child AI SDK spans into one logical Langfuse trace.
 */
export async function traceAgent<T>(
  agentType: AgentType,
  metadata: TraceMetadata,
  fn: (ctx: { traceId: string; observationId: string }) => Promise<T>
): Promise<TraceResult<T>> {
  const fallbackTraceId = metadata.parentTraceId ?? crypto.randomUUID();
  const observationId = crypto.randomUUID();

  const tracing = getTracing();

  if (!tracing || !isLangfuseEnabled()) {
    const result = await fn({ traceId: fallbackTraceId, observationId });
    return { result, traceId: fallbackTraceId, observationId };
  }

  // Captured inside startActiveObservation so the returned traceId is the
  // real OTel/Langfuse trace id, not a synthetic UUID. Scoring tagged with
  // this id will land on the correct trace in the Langfuse UI.
  let resolvedTraceId = fallbackTraceId;

  try {
    const result = await tracing.startActiveObservation(agentType, async span => {
      const liveTraceId = tracing.getActiveTraceId();
      if (liveTraceId) resolvedTraceId = liveTraceId;

      // Stamp Sendero attrs on the live OTel span so Phoenix queries
      // can filter cross-tenant. Langfuse's metadata path is separate
      // (set via updateActiveTrace below) — both are needed because
      // Langfuse reads its own metadata while Phoenix reads OTel
      // attributes. Sendero attribute keys are mirrored in
      // @sendero/arize-phoenix/types::SENDERO_SPAN_ATTRS.
      try {
        const { trace: otelTrace } =
          require('@opentelemetry/api') as typeof import('@opentelemetry/api');
        const otelSpan = otelTrace.getActiveSpan();
        if (otelSpan) {
          if (metadata.tenantId) otelSpan.setAttribute('sendero.tenant_id', metadata.tenantId);
          if (metadata.userId) otelSpan.setAttribute('sendero.user_id', metadata.userId);
          if (metadata.surface) otelSpan.setAttribute('sendero.surface', metadata.surface);
          if (metadata.channel) otelSpan.setAttribute('sendero.channel', metadata.channel);
          if (metadata.tripId) otelSpan.setAttribute('sendero.trip_id', metadata.tripId);
          if (metadata.turnId) otelSpan.setAttribute('sendero.turn_id', metadata.turnId);
          if (metadata.model) otelSpan.setAttribute('sendero.model', metadata.model);
          otelSpan.setAttribute('sendero.agent_type', agentType);
        }
      } catch {
        // OTel API unavailable — Langfuse-only path still works
      }

      tracing.updateActiveTrace({
        name: agentType,
        userId: metadata.userId,
        sessionId: metadata.sessionId,
        metadata: {
          tenantId: metadata.tenantId,
          model: metadata.model,
          trigger: metadata.trigger,
          surface: metadata.surface,
          channel: metadata.channel,
          tripId: metadata.tripId,
          turnId: metadata.turnId,
          toolCallCount: metadata.toolCallCount,
        },
        tags: [agentType, metadata.surface, metadata.trigger, metadata.channel ?? ''].filter(
          Boolean
        ),
      });

      span.update({
        metadata: {
          agentType,
          model: metadata.model,
          surface: metadata.surface,
          channel: metadata.channel,
        },
      });

      const propagateMeta: Record<string, string> = {
        tenantId: metadata.tenantId,
        surface: metadata.surface,
      };
      if (metadata.channel) propagateMeta.channel = metadata.channel;

      return tracing.propagateAttributes(
        {
          userId: metadata.userId,
          sessionId: metadata.sessionId,
          metadata: propagateMeta,
          tags: [agentType, metadata.surface].filter((t): t is string => Boolean(t)),
        },
        async () => fn({ traceId: resolvedTraceId, observationId })
      );
    });

    return { result, traceId: resolvedTraceId, observationId };
  } catch (err) {
    console.warn(
      '[langfuse] traceAgent failed, running untraced:',
      err instanceof Error ? err.message : err
    );
    const result = await fn({ traceId: fallbackTraceId, observationId });
    return { result, traceId: fallbackTraceId, observationId };
  }
}

/**
 * Read the active OTel trace ID from the current context. Returns
 * undefined when called outside a Langfuse-traced operation. Tools and
 * downstream code use this to tag side effects (e.g., writing
 * `traceId` to a Booking row so HITL approvals can score the trace
 * later) without plumbing the id through every function signature.
 */
export function getActiveTraceId(): string | undefined {
  const tracing = getTracing();
  if (!tracing) return undefined;
  try {
    return tracing.getActiveTraceId();
  } catch {
    return undefined;
  }
}

/**
 * Telemetry config for AI SDK calls.
 *
 * Pass as `experimental_telemetry` to every generateText / streamText /
 * generateObject call. The AI SDK emits OTel spans that the
 * LangfuseSpanProcessor (from initLangfuseOtel) converts to Langfuse
 * generations — no manual span creation needed per call.
 */
export function aiTelemetryConfig(
  functionId?: string,
  metadata?: {
    userId?: string;
    tenantId?: string;
    surface?: Surface;
    trigger?: TriggerSource;
    sessionId?: string;
    channel?: string;
    tripId?: string;
    turnId?: string;
    planTier?: string;
    model?: string;
    scope?: string;
  }
) {
  return {
    isEnabled: isLangfuseEnabled(),
    functionId,
    metadata: metadata ?? undefined,
  } as const;
}

/** Extract trace ID from incoming request headers (cross-surface propagation). */
export function extractTraceId(headers: Headers | Record<string, string>): string | undefined {
  if (headers instanceof Headers) {
    return headers.get('x-sendero-trace-id') ?? undefined;
  }
  return headers['x-sendero-trace-id'] ?? headers['X-Sendero-Trace-Id'];
}

/** Build headers for outgoing cross-surface requests with trace context. */
export function propagateTraceHeaders(traceId: string): Record<string, string> {
  return { 'X-Sendero-Trace-Id': traceId };
}
