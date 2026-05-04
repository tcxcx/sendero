/**
 * Platform-wallet low-balance alerts.
 *
 * Fires when the Sendero Solana hot wallet (the JIT SOL gas funder)
 * dips below the operational threshold. Posts directly into the
 * Sendero customer-support Slack channel (`SLACK_CHANNEL_ID`) using
 * the support-agent bot token (`SLACK_BOT_TOKEN`) — same surface
 * where tenant escalations land, so the platform developer sees ops
 * pings alongside customer issues.
 *
 * Registered once at boot in `apps/app/instrumentation.ts` so the
 * `@sendero/circle/unified-gateway` package stays free of Slack
 * imports. The package invokes the callback after every successful
 * JIT top-up; this module decides what to do with it.
 */

const ALERT_THROTTLE_MS = 30 * 60 * 1000;
const recentAlerts = new Map<string, number>();

export interface PlatformWalletLowAlertArgs {
  platformAddress: string;
  lamports: number;
  thresholdLamports: number;
}

export async function notifyPlatformWalletLow(args: PlatformWalletLowAlertArgs): Promise<void> {
  const botToken = process.env.SLACK_BOT_TOKEN;
  const channelId = process.env.SLACK_CHANNEL_ID;
  if (!botToken || !channelId) {
    console.warn(
      '[platform-wallet-alert] SLACK_BOT_TOKEN / SLACK_CHANNEL_ID not set — alert dropped',
      { platformAddress: args.platformAddress, lamports: args.lamports }
    );
    return;
  }

  const now = Date.now();
  const last = recentAlerts.get(args.platformAddress) ?? 0;
  if (now - last < ALERT_THROTTLE_MS) return;
  recentAlerts.set(args.platformAddress, now);

  const sol = (args.lamports / 1e9).toFixed(4);
  const thresholdSol = (args.thresholdLamports / 1e9).toFixed(2);
  const cluster = (process.env.SENDERO_SOLANA_RPC_URL ?? '').includes('mainnet')
    ? 'mainnet'
    : 'devnet';
  const explorerUrl = `https://explorer.solana.com/address/${args.platformAddress}?cluster=${cluster}`;
  const faucetUrl =
    cluster === 'devnet' ? 'https://faucet.solana.com' : 'corporate ops wallet (no public faucet)';

  const text =
    `:warning: *Sendero Solana hot wallet running low* — \`${sol} SOL\` ` +
    `(below \`${thresholdSol} SOL\` threshold)\n` +
    `Address: \`${args.platformAddress}\` (${cluster})\n` +
    `Drip from: ${faucetUrl}\n` +
    `Explorer: ${explorerUrl}\n\n` +
    `Without funds, traveler/tenant Solana deposits will fail with "Insufficient SOL". ` +
    `Each JIT top-up is ~0.01 SOL — refill 1 SOL covers ~100 deposits.`;

  try {
    const res = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        Authorization: `Bearer ${botToken}`,
      },
      body: JSON.stringify({
        channel: channelId,
        text,
        unfurl_links: false,
        unfurl_media: false,
      }),
    });
    const body = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
    if (!body?.ok) {
      console.warn('[platform-wallet-alert] Slack chat.postMessage rejected', {
        platformAddress: args.platformAddress,
        slackError: body?.error ?? `http_${res.status}`,
      });
      return;
    }
    console.log('[platform-wallet-alert] sent to Slack', {
      platformAddress: args.platformAddress,
      sol,
      channelId,
    });
  } catch (err) {
    console.warn('[platform-wallet-alert] Slack send threw', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
