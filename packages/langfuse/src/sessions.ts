/**
 * @sendero/langfuse/sessions — Session ID generators
 *
 * Langfuse sessions group related traces. Set sessionId on a trace and
 * the session exists — no separate creation step needed.
 *
 * Naming convention:
 *   agent:{tenantId}:{channel}   — all turns in one tenant's channel session
 *   trip:{tripId}                — all traces for a specific trip
 *   cron:{jobId}:{YYYY-MM-DD}    — scheduled background job runs
 */

/** Groups all agent turns for a tenant+channel combo (e.g. one Slack workspace). */
export function agentSessionId(tenantId: string, channel: string): string {
  return `agent:${tenantId}:${channel}`;
}

/** Groups all traces touching a single trip (booking, status, refund, etc.). */
export function tripSessionId(tripId: string): string {
  return `trip:${tripId}`;
}

/** Groups all traces for a background cron job run on a given date. */
export function cronSessionId(jobId: string): string {
  const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  return `cron:${jobId}:${date}`;
}

/** Groups traces for a stamp generation workflow run. */
export function stampSessionId(tokenId: string): string {
  return `stamp:${tokenId}`;
}
