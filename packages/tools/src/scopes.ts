/**
 * Tool → scope classification.
 *
 * Single source of truth for which family a tool belongs to. Consumed by:
 *   - `@sendero/tools/openapi` — emits the tag on each OpenAPI operation.
 *   - `@sendero/auth/dispatch-auth` — re-exports these identifiers so the
 *     runtime enforcement check and the public API docs can never
 *     disagree.
 *
 * Lives in `@sendero/tools` because the tool catalog is the source of
 * truth; @sendero/auth depends on this package, never the other way.
 * See `packages/tools/src/openapi.test.ts::OpenAPI ↔ scope consistency`
 * for the guard that catches drift.
 */

/** Granular capability envelope. Keys carry a subset; '*' = all. */
export const KEY_SCOPES = [
  'search',
  'bookings',
  'settlement',
  'treasury',
  'documents',
  'compliance',
  'trip_assistance',
  'utilities',
] as const;
export type KeyScope = (typeof KEY_SCOPES)[number] | '*';

/**
 * Default scope set for user-minted keys via Clerk's `<APIKeys />`.
 * Read-mostly, never settlement or treasury — so a leaked frontend
 * key spams search but can't move USDC or touch passport PII.
 */
export const DEFAULT_PROD_SCOPES: KeyScope[] = [
  'search',
  'trip_assistance',
  'utilities',
  'compliance',
  'documents',
];

/** Sandbox + service keys default to full access — operators are trusted. */
export const SANDBOX_SCOPES: KeyScope[] = ['*'];

/**
 * Map a tool name to the scope that authorizes it.  This is the single
 * source of truth — the OpenAPI categorizer in `./openapi.ts` and the
 * runtime scope check in `@sendero/auth/dispatch-auth` both call this.
 */
export function toolToScope(toolName: string): KeyScope {
  if (toolName.startsWith('search_') || toolName.startsWith('find_')) return 'search';
  if (toolName.startsWith('book_') || toolName.startsWith('hold_')) return 'bookings';
  if (
    toolName === 'reserve_booking' ||
    toolName === 'commit_booking' ||
    toolName === 'prefund_trip' ||
    toolName === 'settle_booking' ||
    toolName === 'settle_split' ||
    toolName === 'guest_claim_link' ||
    toolName === 'confirm_flight' ||
    toolName.includes('cancel')
  ) {
    return 'settlement';
  }
  if (
    toolName === 'check_treasury' ||
    toolName === 'swap_tokens' ||
    toolName === 'send_tokens' ||
    toolName === 'bridge_to_arc' ||
    toolName === 'swap_and_bridge' ||
    toolName === 'gateway_balance' ||
    toolName === 'gateway_transfer'
  ) {
    return 'treasury';
  }
  if (toolName === 'scan_document' || toolName === 'generate_booking_invoice') return 'documents';
  if (toolName === 'check_travel_eligibility') return 'compliance';
  if (
    toolName.startsWith('airport_') ||
    toolName.startsWith('trip_') ||
    toolName === 'restaurant_route_card' ||
    toolName === 'recommend_restaurants' ||
    toolName === 'travel_safety_aid' ||
    toolName === 'elevation_risk_brief' ||
    toolName === 'air_quality_brief' ||
    toolName === 'timezone_brief' ||
    toolName === 'export_route_map' ||
    toolName === 'geocode_trip_stop' ||
    toolName === 'validate_travel_address'
  ) {
    return 'trip_assistance';
  }
  return 'utilities';
}

export function hasScope(granted: readonly KeyScope[], required: KeyScope): boolean {
  return granted.includes('*') || granted.includes(required);
}

/**
 * Tools where a bearer key is insufficient — caller must also sign
 * the request with the bearer-derived HMAC key.  Anything that moves
 * USDC, tickets a flight, or decrypts vault PII lives here.
 *
 * This is the sensitive direction.  Search + read-only briefs are
 * bearer-only for latency.
 */
export const PRIVILEGED_TOOLS: ReadonlySet<string> = new Set([
  // Settlement — any USDC movement
  'reserve_booking',
  'commit_booking',
  'settle_booking',
  'settle_split',
  'prefund_trip',
  'cancel_booking',
  'cancel_order_quote',
  'confirm_cancel_order',
  // Treasury — balance-changing ops
  'swap_tokens',
  'send_tokens',
  'bridge_to_arc',
  'swap_and_bridge',
  'gateway_transfer',
  // Real-world commit paths
  'book_flight',
  'book_stay',
  'confirm_flight',
  // Vault-backed + ID-sensitive
  'scan_document', // kind === 'id_document' tightens further at the tool layer
]);
// Note: channel-provisioning tools (kapso_*, slack_*) are NOT listed
// here.  They're `internal: true` on their ToolDef, which strips them
// at every external boundary (channels, API keys, MCP, OpenAPI). The
// operator path doesn't carry a signed-request HMAC — it runs under a
// Clerk session — so adding them to PRIVILEGED_TOOLS would only fire
// false-positive 401s from the dispatch route's signing gate when an
// admin tests via curl.  `internal: true` is the right axis for them.

export function requiresSignature(toolName: string): boolean {
  return PRIVILEGED_TOOLS.has(toolName);
}

// ── Audience filter ────────────────────────────────────────────────
//
// Some tools are operator-only (channel provisioning, tenant-admin
// orchestrations).  They live in the same registry as customer-facing
// tools so the web console operator agent can call them, but every
// outward-facing surface (external API keys, MCP, WhatsApp / Slack
// channel webhooks, public OpenAPI) must filter them out before
// advertising.
//
// `tool.internal === true` is the marker; the helper below is the
// single place every consumer calls so the filter never gets
// duplicated wrong.

import type { ToolDef } from './types';

/** True when a tool is safe to expose to external integrators + customers. */
export function isPublicTool(tool: Pick<ToolDef, 'internal'>): boolean {
  return tool.internal !== true;
}

/**
 * Strip operator-only tools from a registry.  Always called at
 * the channel + external-API-key boundary; operators (web console
 * with Clerk session) skip this filter and see everything.
 */
export function filterPublicTools<T extends Pick<ToolDef, 'internal'>>(tools: readonly T[]): T[] {
  return tools.filter(isPublicTool);
}
