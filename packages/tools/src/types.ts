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
  /**
   * Caller identity derived server-side from the API key (or absent
   * for in-app operator sessions). Tools that gate on scopes / key type
   * read from here so the LLM can never spoof either value via the
   * tool input. Populated by the dispatch route from
   * `resolveTenantFromApiKey`.
   *
   * Tools that don't need these fields can ignore them. Tools that DO
   * need them (e.g., `confirm_booking` for the markup override gate)
   * should treat `ctx.caller` as the source of truth and fall back
   * gracefully when absent (test fixtures, in-process callers, etc.).
   */
  caller?: {
    scopes?: readonly string[];
    /**
     * The on-key type from the API key claims — `'sandbox'` for the
     * auto-minted org sandbox key, `'production'` for user-minted keys.
     * Distinct from `effectiveKeyType` because testnet-beta downgrades
     * production keys to behave as sandbox at runtime.
     */
    keyType?: 'sandbox' | 'production';
    /**
     * Effective type after any testnet-beta downgrade. Use this for
     * security gates (e.g., the markup override rejection); use
     * `keyType` only for accounting / audit display.
     */
    effectiveKeyType?: 'sandbox' | 'production';
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
