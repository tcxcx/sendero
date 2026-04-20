/**
 * Convert a ToolDef into an AI SDK v6 `tool()` call.
 *
 * `ctx` is captured in a closure so `book_flight` gets traveler
 * context without the AI SDK knowing about it — `execute`'s signature
 * stays `(input) => Promise<output>`, which is what the AI SDK expects.
 */

import { tool, type ToolSet } from 'ai';
import type { ToolDef, ToolContext } from '../types';

export function toAiSdkTool(def: ToolDef, ctx: ToolContext = {}) {
  return tool({
    description: def.description,
    inputSchema: def.inputSchema as any,
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
