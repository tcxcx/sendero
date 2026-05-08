/**
 * Phase C-2 — Liveblocks identity gate fallback chain.
 *
 * Codex outside-voice #5 flagged: when `operatorUserIds` lookup
 * yields zero, only the legacy `agent:customer-support` Liveblocks
 * notification fires; no human bell rings; the handoff goes silent.
 *
 * /plan-eng-review E7 locked the chain:
 *   1. Bell  — handled by the dispatcher's adapter (input)
 *   2. Tenant Slack — the dispatcher's slack adapter
 *   3. Tenant admin email — dispatcher's email adapter (lookup admin)
 *   4. **Sendero customer-support Slack** — terminal state.
 *      Reuses `SLACK_CHANNEL_ID` env (same channel
 *      `platform-wallet-alerts.ts` posts to). Throttled
 *      1-alert-per-30-min per `(tenantId, eventKind)` so a tenant
 *      with chronic config issues doesn't spam Sendero ops.
 *
 * The dispatcher's caller (e.g., `request_human_handoff`) checks
 * `result.sentCount === 0` after `dispatch()` and invokes
 * `notifyTerminalFallback()` here. The dispatcher itself never
 * triggers the chain — keeps the adapter contract clean.
 */

const THROTTLE_WINDOW_MS = 30 * 60 * 1000;
const lastAlertByKey = new Map<string, number>();

export interface TerminalFallbackArgs {
  tenantId: string;
  /** What the dispatcher tried to do — 'handoff.requested' etc. */
  eventKind: string;
  /** Stable id from the originating call site for the audit row. */
  sourceId: string;
  /** Why the chain reached terminal state — '0 operators bound',
   *  '0 channels enabled', 'all channels failed'. Surfaces in the
   *  Slack post for triage. */
  reason: string;
  /** Optional deep-link for ops to open the affected workspace. */
  url?: string;
}

/**
 * Post a throttled message to the Sendero customer-support Slack
 * channel when a notification dispatch reached the chain's terminal
 * state. Mirrors `platform-wallet-alerts::notifyPlatformWalletLow`
 * pattern: 1-alert-per-30-min per (tenantId, eventKind), fail-soft
 * on Slack outages.
 */
export async function notifyTerminalFallback(args: TerminalFallbackArgs): Promise<void> {
  const channelId = process.env.SLACK_CHANNEL_ID;
  const botToken = process.env.SLACK_BOT_TOKEN;

  if (!channelId || !botToken) {
    console.warn(
      '[notification-fallback] SLACK_CHANNEL_ID or SLACK_BOT_TOKEN not set — terminal alert dropped',
      { tenantId: args.tenantId, eventKind: args.eventKind, reason: args.reason }
    );
    return;
  }

  const throttleKey = `${args.tenantId}:${args.eventKind}`;
  const now = Date.now();
  const last = lastAlertByKey.get(throttleKey) ?? 0;
  if (now - last < THROTTLE_WINDOW_MS) {
    console.warn('[notification-fallback] throttled', {
      tenantId: args.tenantId,
      eventKind: args.eventKind,
      ageMs: now - last,
    });
    return;
  }
  lastAlertByKey.set(throttleKey, now);

  const text = [
    `:warning: Notification dispatch terminal fallback — \`${args.eventKind}\``,
    `Tenant: \`${args.tenantId}\``,
    `Source: \`${args.sourceId}\``,
    `Reason: ${args.reason}`,
    args.url ? `Open: ${args.url}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  try {
    const res = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        Authorization: `Bearer ${botToken}`,
      },
      body: JSON.stringify({ channel: channelId, text, mrkdwn: true }),
    });
    if (!res.ok) {
      console.warn('[notification-fallback] Slack chat.postMessage rejected', {
        status: res.status,
      });
      return;
    }
    const json = (await res.json()) as { ok: boolean; error?: string };
    if (!json.ok) {
      console.warn('[notification-fallback] Slack returned ok=false', { error: json.error });
    }
  } catch (err) {
    console.warn('[notification-fallback] Slack post failed', err);
  }
}
