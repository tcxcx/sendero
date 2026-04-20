/**
 * Convert a ToolDef into the shape Sendero's Hono MCP server expects:
 *   { description, inputSchema (JSON Schema), handler }
 */

import type { ToolDef, ToolContext } from '../types';

export interface McpToolEntry {
  description: string;
  inputSchema: Record<string, unknown>;
  handler(input: any): Promise<unknown>;
}

export function toMcpTool(def: ToolDef, ctx: ToolContext = {}): McpToolEntry {
  return {
    description: def.description,
    inputSchema: def.jsonSchema,
    handler: (input: any) => def.handler(input, ctx),
  };
}

export function buildMcpCatalog(
  defs: ToolDef[],
  ctx: ToolContext = {},
): Record<string, McpToolEntry> {
  return Object.fromEntries(defs.map((d) => [d.name, toMcpTool(d, ctx)]));
}
