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

export interface TripEvent {
  id: string;
  kind: string;
  direction: 'inbound' | 'outbound' | 'internal';
  channel: 'whatsapp' | 'slack' | 'sms' | 'email' | 'web' | 'internal';
  createdAt: string;
  [key: string]: unknown;
}

export interface ToolContext {
  /** Active Trip.id for this tool turn, when the caller is scoped to a trip. */
  tripId?: string;
  /** Human-readable caller surface for observability (`web_console_chat`, `whatsapp_kapso`, etc.). */
  surface?: string;
  /** Signed-in traveler identity, forwarded from the chat POST body. */
  traveler?: {
    name?: string;
    email?: string;
    phone?: string;
    userId?: string;
    tenantId?: string;
    /**
     * True when the resolved User row has no `clerkUserId` — they exist
     * only as the placeholder created on first WhatsApp inbound. Tools
     * that require a real signed-in identity (booking flows, settlement,
     * NFT mint, prefund) should refuse and ask the agent to surface the
     * sign-in flow first via `prepare_traveler_signin`.
     */
    isPlaceholder?: boolean;
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
  /**
   * ChannelIdentity row id when the agent turn was triggered by a
   * channel inbound (WhatsApp / Slack / web). Used by escalation tools
   * (`request_human_handoff`) to anchor handoffs to the originating
   * traveler so the resolve route can deliver back through the same
   * channel. Optional — operator console turns leave it unset.
   */
  channelIdentityId?: string;
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
  /**
   * Resolved payer for this turn. Populated by the dispatch route via
   * `resolvePayer()` from `Trip.paymentMode` / `Tenant.defaultPaymentMode`.
   * Tools that record meter/booking attribution read from here to avoid
   * re-resolving (and to avoid the DB hit in test fixtures that don't
   * inject Trip/Tenant rows). Per-tool `provisionedBy` input still
   * overrides — the dispatch resolution is the floor, not the ceiling.
   *
   * Absent on operator chat turns and service-account dispatches that
   * don't carry traveler context.
   */
  payer?: {
    type: 'tenant' | 'traveler';
    /** User.id of the traveler-side wallet bearer when type='traveler'. */
    travelerUserId?: string;
  };
  appendTripEvent?: (args: {
    tripId: string;
    tenantId: string;
    event: TripEvent;
  }) => Promise<boolean>;
  resolveTripByBoardingPass?: (args: {
    tenantId: string;
    userId: string;
    pnr: string | null | undefined;
    flightNumber: string | null | undefined;
    departureDate: string | null | undefined;
  }) => Promise<{ id: string } | null>;
  readTripEvents?: (args: { tripId: string; tenantId: string }) => Promise<TripEvent[]>;
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
  /**
   * Mark a tool as experimental — a *phase*, not a permanent label.
   *
   * Five consequences flow from the flag (spec: docs/specs/anticipatory-concierge.md §5):
   *
   * 1. **Registry filter** (PR-A1+, future). Production prod-key
   *    catalogs strip `experimental` tools by default. Sandbox keys
   *    + the in-process operator console see all. Tenants opt in
   *    per-tool via `Tenant.metadata.experimental.toolsEnabled[<name>]=true`.
   * 2. **Span attribute** (PR-A1+, future). Each invocation stamps
   *    `sendero.experimental_tool: true` on the active OTel span.
   * 3. **Operator badge** (PR-A1+, future). `/dashboard/spend` Phoenix
   *    introspection strip + the new anticipation strip render an
   *    "experimental" pill next to the tool name.
   * 4. **Per-tool kill switch** (PR-A1+, future). `SENDERO_EXPERIMENTAL_DISABLED`
   *    env (comma-list) flips a single primitive to `production_refused`
   *    without touching the rest of the catalog.
   * 5. **Auto-graduation** (PR-A1+, future). Flips to `false` on a PR
   *    once threshold is met (≥30 invocations × ≥2 tenants × ≥0.85
   *    eval × ≤2% gap rate over 30 days for v0.1; tightens after first
   *    paying TMC).
   *
   * v0.3: the flag itself is annotative — registry filters and badge
   * UI come in PR-A1. Tools tagged `experimental: true` today still
   * compose with the existing dev-gate (env + key + tenant) when they
   * also call `assertDevOnlyToolAllowed(ctx)` from their handler.
   */
  experimental?: boolean;
  handler(input: I, ctx?: ToolContext): Promise<O>;
}
