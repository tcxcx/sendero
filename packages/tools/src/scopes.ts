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
  // Read-only stays funnel step between search and quote — no money moves,
  // no PII surfaced. Same scope as the search itself.
  if (toolName === 'list_stay_rates') return 'search';
  if (toolName.startsWith('book_') || toolName.startsWith('hold_')) return 'bookings';
  // Group-trip operator actions — broadcast fans out N WhatsApp sends,
  // same tier as a booking commit (real-world, customer-visible, not
  // free-form chat). User-minted prod keys can't invoke it because
  // `bookings` isn't in DEFAULT_PROD_SCOPES.
  if (toolName === 'broadcast_to_group_trip') return 'bookings';
  // Pre-booking ancillary staging — same scope as the bookings they
  // attach to. A read-mostly key shouldn't be able to stage paid extras
  // that auto-flow into the next book_flight call.
  if (toolName === 'select_seat' || toolName === 'add_baggage') return 'bookings';
  if (
    toolName === 'reserve_booking' ||
    toolName === 'commit_booking' ||
    toolName === 'confirm_booking' ||
    toolName === 'prefund_trip' ||
    toolName === 'settle_booking' ||
    toolName === 'settle_split' ||
    toolName === 'send_pay_link' ||
    toolName === 'guest_claim_link' ||
    toolName === 'confirm_flight' ||
    toolName === 'give_feedback' ||
    toolName === 'request_validation' ||
    toolName === 'submit_validation_response' ||
    // E2 — flipping the activated pricing policy row is an admin write
    // that unlocks the entire settlement pipeline. Lives in the same
    // 'settlement' scope so a leaked read-mostly key can't enable it.
    toolName === 'activate_tenant_pricing_policy' ||
    toolName.includes('cancel') ||
    toolName.includes('order_change')
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
    toolName === 'gateway_transfer' ||
    toolName === 'mint_stamp' ||
    toolName === 'refresh_stamp_uri'
  ) {
    return 'treasury';
  }
  if (toolName === 'scan_document' || toolName === 'generate_booking_invoice') return 'documents';
  if (
    toolName === 'check_travel_eligibility' ||
    toolName === 'read_validation' ||
    toolName === 'check_visa_requirements' ||
    toolName === 'recommend_visa_application_path'
  ) {
    return 'compliance';
  }
  if (toolName === 'read_reputation') {
    return 'trip_assistance';
  }
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
    toolName === 'validate_travel_address' ||
    toolName === 'currency_convert' ||
    toolName === 'tipping_etiquette' ||
    toolName === 'local_color_brief' ||
    toolName === 'get_trip_brief'
  ) {
    return 'trip_assistance';
  }
  // Dev/sandbox observability tools. Scoped to `utilities` because
  // they're not part of the customer-facing capability set; the
  // production-key gate lives at the handler layer (see
  // `report-knowledge-gap.ts::isCallerAllowed`), not here.
  if (toolName === 'report_knowledge_gap' || toolName === 'list_available_tools') {
    return 'utilities';
  }
  // ── Managed workflow tier mapping ─────────────────────────────────
  // Workflow tool names are `sendero_<workflow_id>` (mirror of the
  // workflowId → toolName transform in `@sendero/workflows/external-tools`).
  // Scope is derived from the pricing tier so adding a new workflow at
  // the right price band auto-classifies the scope. Keep the lists in
  // sync with `TOOL_PRICING`.
  if (toolName.startsWith('sendero_')) {
    if (
      toolName === 'sendero_book_flight' ||
      toolName === 'sendero_book_with_ancillaries' ||
      toolName === 'sendero_book_stay_with_loyalty' ||
      toolName === 'sendero_guest_prefund' ||
      toolName === 'sendero_cancel_order_with_credits' ||
      toolName === 'sendero_refund' ||
      toolName === 'sendero_cancellation_recovery' ||
      toolName === 'sendero_group_trip' ||
      toolName === 'sendero_agency_cohort' ||
      toolName === 'sendero_ops_quote_to_book' ||
      toolName === 'sendero_ops_rebook_refund'
    ) {
      return 'settlement';
    }
    if (
      toolName === 'sendero_trip_delay_replanner' ||
      toolName === 'sendero_verify_travel_documents'
    ) {
      return 'bookings';
    }
    // sendero_travel_safety_brief, sendero_check_in_reminder, and any
    // future read-tier workflow.
    return 'trip_assistance';
  }
  if (toolName === 'resume_workflow') {
    // Resuming a paused workflow exercises whatever scope the original
    // start granted — but resume itself is just a re-entry, so we give
    // it `trip_assistance` (read-mostly default scope can resume a
    // read-tier workflow it started). The scope check on the underlying
    // workflow re-fires when the next step runs.
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
  'confirm_booking',
  'settle_booking',
  'settle_split',
  'send_pay_link',
  'prefund_trip',
  'cancel_booking',
  'cancel_order_quote',
  'confirm_cancel_order',
  'confirm_order_change',
  'request_order_change',
  'select_order_change_offer',
  // Treasury — balance-changing ops
  'swap_tokens',
  'send_tokens',
  'bridge_to_arc',
  'swap_and_bridge',
  'gateway_transfer',
  // Real-world commit paths
  'book_flight',
  'book_stay',
  'book_esim',
  'book_insurance',
  'confirm_flight',
  // Vault-backed + ID-sensitive
  'scan_document', // kind === 'id_document' tightens further at the tool layer
  // NFT stamps — touches on-chain state via Circle DCW + treasury wallet.
  // The mint tool is internal:true so this gate is defense-in-depth in
  // case it's ever exposed via a future surface.
  'mint_stamp',
  'refresh_stamp_uri',
  // ERC-8004 reputation + validation — every "write" tool moves on-chain
  // trust state. Reads (read_reputation, read_validation) are public.
  'give_feedback',
  'request_validation',
  'submit_validation_response',
  // Group broadcasts — fans out N WhatsApp template sends through
  // Kapso. Not strictly money, but customer-visible mass messaging
  // and template-cost-bearing; HMAC requirement keeps a leaked
  // bearer key from spamming traveler phones.
  'broadcast_to_group_trip',
  // Managed workflows that touch settlement / ticketing / refunds.
  // Mirrors the top-tier ($0.25) entries in `TOOL_PRICING` and the
  // 'settlement' scope branch above. Mid-tier workflows
  // (sendero_trip_delay_replanner, sendero_verify_travel_documents)
  // are scoped to 'bookings' but not signature-required — they read +
  // plan without committing real money. Read-tier workflows are open
  // (trip_assistance, no HMAC).
  'sendero_book_flight',
  'sendero_book_with_ancillaries',
  'sendero_book_stay_with_loyalty',
  'sendero_guest_prefund',
  'sendero_cancel_order_with_credits',
  'sendero_refund',
  'sendero_cancellation_recovery',
  'sendero_group_trip',
  'sendero_agency_cohort',
  'sendero_ops_quote_to_book',
  'sendero_ops_rebook_refund',
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
