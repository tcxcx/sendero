/**
 * Operational Slack alerts.
 *
 * Posts to the ops channel (env: SENDERO_OPS_SLACK_CHANNEL_ID) using
 * the bot token configured in `@sendero/slack/client`. Fails silently
 * in prod — alerts are best-effort; a missing token is logged, not
 * thrown, so a misconfig can't break the cron.
 */

import { createSlackClient, postMessage } from './client';

function opsChannelId(): string | null {
  return process.env.SENDERO_OPS_SLACK_CHANNEL_ID ?? null;
}

function botToken(): string | null {
  return process.env.SLACK_BOT_TOKEN ?? null;
}

export interface BatchFailedAlert {
  batchId: string;
  tenantId: string;
  totalMicroUsdc: bigint;
  retryCount: number;
  error: string;
}

export async function fireBatchFailedAlert(a: BatchFailedAlert): Promise<void> {
  const channel = opsChannelId();
  const token = botToken();
  if (!channel || !token) {
    console.warn('[slack.alerts] SLACK_BOT_TOKEN or SENDERO_OPS_SLACK_CHANNEL_ID not set; skipping batch-failed alert');
    return;
  }
  const text =
    `:rotating_light: Nanopay batch *failed* after ${a.retryCount} retries\n` +
    `> batch \`${a.batchId}\` · tenant \`${a.tenantId}\`\n` +
    `> total \`${(Number(a.totalMicroUsdc) / 1e6).toFixed(6)} USDC\`\n` +
    `> last error: \`${a.error}\``;
  try {
    const client = createSlackClient(token);
    await postMessage(client, { channel, text });
  } catch (err) {
    console.warn('[slack.alerts] postMessage failed:', err instanceof Error ? err.message : err);
  }
}
