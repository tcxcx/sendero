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
  /**
   * Operator-only tool — never exposed to external API keys, MCP
   * clients, customer-facing channels (WhatsApp / Slack / email),
   * or the public OpenAPI spec.  Defaults to `false` (public).
   *
   * Mark `internal: true` for:
   *   - Channel provisioning (kapso_*, slack_persist_channel_routes,
   *     slack_invite_bot_to_channels, …)
   *   - Tenant-admin actions that move org-level config
   *   - Anything an operator dashboard runs that a customer agent
   *     should never trigger by accident or via prompt injection
   *
   * The web console (Clerk-authed operator) still sees every tool;
   * filtering happens at the channel + API-key boundary.
   */
  internal?: boolean;
  handler(input: I, ctx?: ToolContext): Promise<O>;
}
