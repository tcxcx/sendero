/**
 * Per-workflow pricing in USDC.
 *
 * Workflows sell at a premium over the underlying primitive
 * tool calls (typically 10–20× the per-call price) because the
 * caller offloads orchestration to Sendero — durable, resumable
 * execution that replaces hand-rolled queues and retries on the
 * caller's side. The agent buys the outcome (trip + invoice +
 * ledger), not the steps.
 *
 * Pricing tiers:
 *   - Read-only (no money moves):    $0.10
 *   - Mid (read + plan, no settle):  $0.15
 *   - Top (escrow, ticketing, money):$0.25
 *
 * Workflows tagged `internal: true` are not externally callable
 * (tenant provisioning, ops fan-out) and stay at `'0'`.
 *
 * Decimal USDC strings; the meter converts to 6-decimal atomic
 * units on settle.
 */

export const WORKFLOW_PRICING: Record<string, string> = {
  // Top tier — escrow + ticketing + money movement
  'sendero.book_flight': '0.25',
  'sendero.guest_prefund': '0.25',
  'sendero.book_with_ancillaries': '0.25',
  'sendero.book_stay_with_loyalty': '0.25',
  'sendero.cancel_order_with_credits': '0.25',
  'sendero.refund': '0.25',
  'sendero.cancellation_recovery': '0.25',
  'sendero.group_trip': '0.25',
  'sendero.agency_cohort': '0.25',
  'sendero.ops_quote_to_book': '0.25',
  'sendero.ops_rebook_refund': '0.25',

  // Mid tier — read + replan, hold but no settle
  'sendero.trip_delay_replanner': '0.15',
  'sendero.verify_travel_documents': '0.15',

  // Low tier — pure orchestrated reads
  'sendero.travel_safety_brief': '0.10',
  'sendero.check_in_reminder': '0.10',

  // Internal only — tenant provisioning + ops fan-out, never externally callable
  'sendero.ops_channel_intake': '0',
  'sendero.ops_artifact_pack': '0',
  'sendero.whatsapp_provision': '0',
  'sendero.slack_install': '0',
};

export const DEFAULT_WORKFLOW_PRICE = '0';

/**
 * Returns the USDC price for a workflow id.
 * Unknown workflows default to `'0'` (free / unpriced).
 */
export function workflowPriceFor(workflowId: string): string {
  return WORKFLOW_PRICING[workflowId] ?? DEFAULT_WORKFLOW_PRICE;
}

/**
 * Workflows that are not exposed for external sale — internal
 * tenant provisioning and ops fan-out. Used by the MCP catalog
 * filter so external API keys never see them.
 */
export const INTERNAL_WORKFLOWS = new Set<string>([
  'sendero.ops_channel_intake',
  'sendero.ops_artifact_pack',
  'sendero.whatsapp_provision',
  'sendero.slack_install',
]);

export function isInternalWorkflow(workflowId: string): boolean {
  return INTERNAL_WORKFLOWS.has(workflowId);
}
