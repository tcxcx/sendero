import type { ZodTypeAny } from 'zod';

/**
 * Single source-of-truth tool contract used by both the AI SDK chat
 * route and the MCP server. See `lib/tools/index.ts` for the registry
 * and `lib/tools/adapters/*` for per-surface wrappers.
 */

export interface JsonSchemaObject {
  type: string;
  properties?: Record<string, Record<string, unknown>>;
  required?: string[];
  [key: string]: unknown;
}

export interface ToolContext {
  /** Signed-in traveler identity, forwarded from the chat POST body. */
  traveler?: {
    name?: string;
    email?: string;
    phone?: string;
    userId?: string;
    tenantId?: string;
  };
}

export interface ToolDef<I = any, O = any> {
  name: string;
  description: string;
  /** Zod schema — used by AI SDK adapter for inference + runtime validation. */
  inputSchema: ZodTypeAny;
  /** Hand-authored JSON Schema — served to MCP clients via tools/list. */
  jsonSchema: JsonSchemaObject;
  handler(input: I, ctx?: ToolContext): Promise<O>;
}
