/**
 * @sendero/arize-phoenix/types — public type surface.
 *
 * Kept minimal for PR1 (OTel write-side only). PR2 adds recall + dataset
 * types when @arizeai/phoenix-client is wired for read-side queries.
 */

/** Provenance tag attached to recall + resolved-gap dataset rows. */
export type Provenance = 'auto-promoted' | 'human-curated';

/** Sendero-specific span attribute keys that Phoenix queries filter on. */
export const SENDERO_SPAN_ATTRS = {
  TENANT_ID: 'sendero.tenant_id',
  USER_ID: 'sendero.user_id',
  SURFACE: 'sendero.surface',
  CHANNEL: 'sendero.channel',
  TRIP_ID: 'sendero.trip_id',
  TURN_ID: 'sendero.turn_id',
  MODEL: 'sendero.model',
  /**
   * Stamped on the per-tool-call OTel span (the AI SDK opens one per
   * tool execution when `experimental_telemetry` is enabled) by the
   * AI-SDK adapter when `ToolDef.experimental === true`. Phoenix
   * queries filter on this to count + score experimental traffic
   * separately from stable tools — see anticipatory-concierge.md §5.
   *
   * Companion `TOOL_NAME` always co-fires so a Phoenix query can
   * group by tool without re-deriving from span name.
   */
  EXPERIMENTAL_TOOL: 'sendero.experimental_tool',
  TOOL_NAME: 'sendero.tool_name',
  TOOL_LIFECYCLE: 'sendero.tool.lifecycle',
} as const;

export type SenderoSpanAttr = (typeof SENDERO_SPAN_ATTRS)[keyof typeof SENDERO_SPAN_ATTRS];
