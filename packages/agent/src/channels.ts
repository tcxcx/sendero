/**
 * Channel-agnostic message format + ChannelAdapter interface.
 *
 * Every inbound traveler message — regardless of whether it arrives
 * over WhatsApp, Slack, MCP, email, or the web console — maps to a
 * normalized AgentInput. Every outbound reply is a normalized
 * AgentOutput that the adapter renders back into the channel's
 * native protocol.
 *
 * The engine does NOT know what channel it's running on. Adding a
 * new channel = writing a new adapter (inbound + outbound), not
 * touching the engine.
 */

export type Channel = 'whatsapp' | 'slack' | 'web' | 'mcp' | 'email';

export interface AgentActor {
  /** Tenant the traveler belongs to. */
  tenantId: string;
  /** Sendero User id — stable across channels via ChannelIdentity. */
  userId: string;
  /** Optional trip context — when the adapter knows it (e.g. a deep-link). */
  tripId?: string | null;
  /** Best-effort display name for logs + LLM prompt. */
  displayName?: string;
  /** BCP-47 locale. Falls back to tenant default. */
  locale?: string;
}

export interface AgentInput {
  actor: AgentActor;
  channel: Channel;
  /** Freeform traveler text. Media / structured inputs surface in `attachments`. */
  text: string;
  /** Optional structured attachments — images, itinerary fragments, booking ids. */
  attachments?: Array<{
    kind: 'image' | 'document' | 'location' | 'itinerary' | 'booking_ref';
    url?: string;
    data?: Record<string, unknown>;
  }>;
  /**
   * Stable identifier for THIS turn — used to key idempotent meter
   * writes. Adapters derive it from the channel's native message id
   * (WA messageId, Slack event_id, etc.).
   */
  turnId: string;
  /** Optional channel-specific metadata for observability. */
  meta?: Record<string, unknown>;
}

export interface AgentOutput {
  /** Primary reply text for the traveler. Adapter splits / formats per channel. */
  text: string;
  /** Optional structured attachments the adapter should surface. */
  attachments?: Array<{
    kind: 'image' | 'link' | 'button_row' | 'itinerary_card' | 'trip_link';
    data: Record<string, unknown>;
  }>;
  /** Tool-call trail for analytics + admin display. */
  trail: Array<{
    toolName: string;
    ok: boolean;
    latencyMs: number;
    priceMicroUsdc: string;
  }>;
  /** Workflow run id when the turn invoked a named workflow. */
  workflowRunId?: string;
  /** Milliseconds the turn took end-to-end. */
  latencyMs: number;
  /** Whether the turn was billed (false when cap blocked). */
  billed: boolean;
  /** Optional telemetry the adapter forwards to the channel (e.g. Slack thread_ts echo). */
  meta?: Record<string, unknown>;
}

/**
 * Shape of the raw request an adapter sees at the webhook edge — the
 * body and any headers it needs to verify. Stays framework-agnostic
 * (no NextRequest / Hono) so tests and edge workers share the same
 * adapter.
 */
export interface SignVerifyInput {
  rawBody: string;
  headers: Record<string, string | null | undefined>;
}

export type SignVerifyResult = { ok: true } | { ok: false; reason: string };

/**
 * A ChannelAdapter only needs to translate.
 * Inbound: native envelope → AgentInput[]
 * Outbound: AgentOutput + context → native API call (send WA / post Slack / return JSON)
 *
 * Everything else (auth, memory, meter, policy) lives in the engine.
 *
 * `signVerify` and `resolveSession` are optional — adapters that don't
 * need them (e.g. an internal test harness) can omit. Channels with a
 * custom subject-key derivation override `resolveSession`; the engine
 * falls back to `subjectKeyForChannel` from ./session when absent.
 */
export interface ChannelAdapter<In = unknown, OutArgs = unknown> {
  readonly channel: Channel;
  /** Extract zero or more agent turns from a raw inbound payload. */
  parseInbound: (rawBody: In, ctx: { tenantId: string }) => Promise<AgentInput[]>;
  /** Ship an AgentOutput back to the traveler. */
  sendOutbound: (output: AgentOutput, args: OutArgs) => Promise<void>;
  /** Verify signature / replay window on the raw webhook request. */
  signVerify?: (args: SignVerifyInput) => SignVerifyResult | Promise<SignVerifyResult>;
  /**
   * Compute the channel-agnostic subject key for this actor. Defaults
   * to `${channel}:${userId}` via the engine. Adapters override for
   * richer keys (e.g. Slack `${enterpriseId}:${teamId}:${userId}`).
   */
  resolveSession?: (input: AgentInput) => string | null | Promise<string | null>;
}
