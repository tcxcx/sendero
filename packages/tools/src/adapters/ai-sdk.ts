/**
 * Convert a ToolDef into an AI SDK v6 `tool()` call.
 *
 * `ctx` is captured in a closure so `book_flight` gets traveler
 * context without the AI SDK knowing about it — `execute`'s signature
 * stays `(input) => Promise<output>`, which is what the AI SDK expects.
 *
 * Prefers the explicit `def.jsonSchema` over deriving one from
 * `def.inputSchema` (Zod). Some Zod constructs — notably
 * `z.union([z.literal(100), z.literal(0)])` for the validator
 * `submit_validation_response` tool — emit numeric `enum` values that
 * Vertex/Gemini's function-declaration validator rejects:
 *
 *   "Invalid value at 'tools[0].function_declarations[16]
 *    .parameters.properties[1].value.enum[0]' (TYPE_STRING), 100"
 *
 * The `jsonSchema` field is the authored-by-hand schema the tool
 * already curates for Gemini compatibility, so route it through
 * `jsonSchema()` here. Runtime validation still happens through
 * `def.inputSchema` (Zod) inside the handler — both paths agree.
 *
 * Experimental-flag stamping. When `def.experimental === true`, the
 * adapter stamps `sendero.experimental_tool: true` (+ tool name +
 * lifecycle) on the active OTel span before invoking the handler.
 * The AI SDK opens a per-tool-call span when `experimental_telemetry`
 * is enabled, so the active span at handler time IS the per-call span.
 * This is what powers the Phoenix "experimental traffic" filter
 * called out in anticipatory-concierge.md §5. Failures during
 * stamping are swallowed — observability never breaks a turn.
 */

import { jsonSchema, tool, type ToolSet } from 'ai';
import type { ToolDef, ToolContext } from '../types';

/**
 * Minimal structural type for the OTel API surface we touch. Avoids
 * adding `@opentelemetry/api` to this package's peerDependencies — the
 * runtime is loaded via `require()` only when present (edge runtimes,
 * test envs without OTel installed are no-ops).
 */
type OtelApi = {
  trace: { getActiveSpan(): { setAttribute(key: string, value: unknown): void } | undefined };
};

/**
 * Stamp Sendero-prefixed attributes on the active OTel span. No-op
 * when `@opentelemetry/api` is unavailable (edge runtime, test env
 * without the package) or when no span is active. Always swallows.
 */
function stampExperimentalSpan(toolName: string): void {
  try {
    const otel = require('@opentelemetry/api') as OtelApi;
    const span = otel.trace.getActiveSpan();
    if (!span) return;
    span.setAttribute('sendero.experimental_tool', true);
    span.setAttribute('sendero.tool_name', toolName);
    span.setAttribute('sendero.tool.lifecycle', 'experimental');
  } catch {
    // OTel API unavailable — non-fatal
  }
}

export function toAiSdkTool(def: ToolDef, ctx: ToolContext = {}) {
  const schema = def.jsonSchema
    ? jsonSchema(def.jsonSchema as Parameters<typeof jsonSchema>[0])
    : (def.inputSchema as any);
  const isExperimental = def.experimental === true;
  return tool({
    description: def.description,
    inputSchema: schema,
    execute: (input: any) => {
      if (isExperimental) stampExperimentalSpan(def.name);
      return def.handler(input, ctx);
    },
  });
}

export function buildAiSdkTools(defs: ToolDef[], ctx: ToolContext = {}): ToolSet {
  const entries: [string, ReturnType<typeof toAiSdkTool>][] = defs.map(d => [
    d.name,
    toAiSdkTool(d, ctx),
  ]);
  return Object.fromEntries(entries);
}
