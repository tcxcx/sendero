/**
 * Shared ToolRegistry adapter. Wraps every ToolDef in @sendero/tools
 * so the workflow runner can invoke them as plain async functions.
 *
 * Used by the chat route, the MCP server, and webhook-driven resume.
 */

import { toolList } from '@sendero/tools';
import type { ToolRegistry } from '@sendero/workflows';

export function makeToolRegistry(): ToolRegistry {
  const reg: ToolRegistry = {};
  for (const t of toolList) {
    reg[t.name] = async (args: Record<string, unknown>) => t.handler(args as any);
  }
  return reg;
}
