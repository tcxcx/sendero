/**
 * @sendero/arize-phoenix/otel — Phoenix span processor builder.
 *
 * Phoenix Cloud accepts standard OTLP HTTP at `<collector>/v1/traces`
 * with the API key as a Bearer token. We use vendor-neutral OTel
 * exporters for the write side; @arizeai/phoenix-client is reserved
 * for the read side (recall queries — PR2/PR3).
 *
 * **Architecture note.** OTel v2 `BasicTracerProvider` does NOT expose
 * `addSpanProcessor()` — span processors must be passed to the
 * constructor. This means a single global provider must be constructed
 * with ALL processors at startup. The orchestrator lives in
 * `apps/app/instrumentation.ts`; this file just builds the processor.
 */

import {
  getPhoenixApiKey,
  getPhoenixCollectorEndpoint,
  getPhoenixProjectName,
  isPhoenixEnabled,
} from './client';

type SpanProcessor = import('@opentelemetry/sdk-trace-base').SpanProcessor;

let _spanProcessor: SpanProcessor | null = null;

export function getPhoenixSpanProcessor(): SpanProcessor | null {
  return _spanProcessor;
}

/**
 * Build a BatchSpanProcessor that exports to Phoenix Cloud (or
 * self-host) via OTLP HTTP. Returns `null` when Phoenix is not
 * configured — caller filters and skips.
 *
 * Project routing on Phoenix Cloud uses the `openinference.project.name`
 * resource attribute, which we set to `PHOENIX_PROJECT_NAME` (default
 * `"sendero"`). Spans without a project tag fall into the workspace
 * default project.
 */
export function buildPhoenixSpanProcessor(): SpanProcessor | null {
  if (!isPhoenixEnabled()) return null;

  try {
    // Phoenix prefers protobuf encoding (smaller payloads, faster
    // exports). The Cloud /v1/traces endpoint accepts both proto and
    // JSON OTLP; self-host depends on PHOENIX_GRPC_PORT (4317) for gRPC
    // or HTTP for proto/json.
    const { OTLPTraceExporter } =
      require('@opentelemetry/exporter-trace-otlp-proto') as typeof import('@opentelemetry/exporter-trace-otlp-proto');
    const { BatchSpanProcessor } =
      require('@opentelemetry/sdk-trace-base') as typeof import('@opentelemetry/sdk-trace-base');

    const collector = getPhoenixCollectorEndpoint().replace(/\/$/, '');
    const url = `${collector}/v1/traces`;
    const apiKey = getPhoenixApiKey();

    const exporter = new OTLPTraceExporter({
      url,
      headers: {
        ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
        // Phoenix routes spans to a project via this header on Cloud.
        'arize-space-id': getPhoenixProjectName(),
      },
    });

    const processor = new BatchSpanProcessor(exporter);
    _spanProcessor = processor;

    console.info('[arize-phoenix] OTel span processor built', {
      collector,
      project: getPhoenixProjectName(),
    });

    return processor;
  } catch (err) {
    console.warn(
      '[arize-phoenix] Failed to build span processor:',
      err instanceof Error ? err.message : err
    );
    return null;
  }
}
