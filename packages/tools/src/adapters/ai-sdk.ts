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
 */

import { jsonSchema, tool, type ToolSet } from 'ai';
import type { ToolDef, ToolContext } from '../types';

export function toAiSdkTool(def: ToolDef, ctx: ToolContext = {}) {
  const schema = def.jsonSchema
    ? jsonSchema(def.jsonSchema as Parameters<typeof jsonSchema>[0])
    : (def.inputSchema as any);
  return tool({
    description: def.description,
    inputSchema: schema,
    execute: (input: any) => def.handler(input, ctx),
  });
}

export function buildAiSdkTools(defs: ToolDef[], ctx: ToolContext = {}): ToolSet {
  const entries: [string, ReturnType<typeof toAiSdkTool>][] = defs.map(d => [
    d.name,
    toAiSdkTool(d, ctx),
  ]);
  return Object.fromEntries(entries);
}
