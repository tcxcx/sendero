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

export interface JournalReconcileBreakArgs {
  breaks: Array<{
    tenantId: string;
    chain: string;
    journalMicroUsdc: string;
    balanceMicroUsdc: string;
    deltaMicroUsdc: string;
  }>;
}

export async function notifyJournalReconcileBreak(args: JournalReconcileBreakArgs): Promise<void> {
  const botToken = process.env.SLACK_BOT_TOKEN;
  const channelId = process.env.SLACK_CHANNEL_ID;
  if (!botToken || !channelId) {
    console.warn(
      '[journal-reconcile-alert] SLACK_BOT_TOKEN / SLACK_CHANNEL_ID not set — alert dropped',
      { breaks: args.breaks.length }
    );
    return;
  }

  const sample = args.breaks
    .slice(0, 10)
    .map(
      b =>
        `• tenant=\`${b.tenantId}\` chain=\`${b.chain}\` journal=\`${b.journalMicroUsdc}\` ` +
        `balance=\`${b.balanceMicroUsdc}\` delta=\`${b.deltaMicroUsdc}\``
    )
    .join('\n');
  const text =
    `:warning: *Gateway journal reconciliation break* — ${args.breaks.length} mismatch(es)\n` +
    sample;

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
      console.warn('[journal-reconcile-alert] Slack chat.postMessage rejected', {
        slackError: body?.error ?? `http_${res.status}`,
      });
    }
  } catch (err) {
    console.warn('[journal-reconcile-alert] Slack send threw', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export interface GatewayIntentStuckAlertArgs {
  intents: Array<{
    id: string;
    tenantId: string;
    state: string;
    destinationChain: string;
    amountMicroUsdc: string;
    ageMinutes: number;
  }>;
}

export async function notifyGatewayIntentStuck(args: GatewayIntentStuckAlertArgs): Promise<void> {
  const botToken = process.env.SLACK_BOT_TOKEN;
  const channelId = process.env.SLACK_CHANNEL_ID;
  if (!botToken || !channelId) {
    console.warn(
      '[gateway-intent-alert] SLACK_BOT_TOKEN / SLACK_CHANNEL_ID not set — alert dropped',
      {
        intents: args.intents.length,
      }
    );
    return;
  }

  const sample = args.intents
    .slice(0, 10)
    .map(
      intent =>
        `• intent=\`${intent.id}\` tenant=\`${intent.tenantId}\` state=\`${intent.state}\` ` +
        `dest=\`${intent.destinationChain}\` amount=\`${intent.amountMicroUsdc}\` age=\`${intent.ageMinutes}m\``
    )
    .join('\n');
  const text =
    `:warning: *Gateway transfer intent stuck* — ${args.intents.length} intent(s) need review\n` +
    sample;

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
      console.warn('[gateway-intent-alert] Slack chat.postMessage rejected', {
        slackError: body?.error ?? `http_${res.status}`,
      });
    }
  } catch (err) {
    console.warn('[gateway-intent-alert] Slack send threw', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
