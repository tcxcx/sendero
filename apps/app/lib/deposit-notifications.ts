/**
 * Post-deposit notifications.
 *
 * Fires AFTER `unifiedGateway.deposit` confirms a USDC inbound, so
 * users learn about the new balance on the channel they already use:
 *   - Traveler  → WhatsApp text on the tenant's number ("+10 USDC,
 *                 balance: 11 USDC").
 *   - Treasury  → email to the tenant notification address (same
 *                 resolver Duffel/booking emails use).
 *
 * Both helpers are fail-soft: any DB / network / template error logs
 * a warning and resolves cleanly. They never throw — webhook
 * handlers wrap them in `after()` and must not let a notification
 * crash break the deposit confirmation.
 *
 * Balance reads use `unifiedGateway.queryDepositorBalances` (REST) so
 * we can include the FRESH unified-balance total in the message
 * without holding an adapter. The deposit is on-chain confirmed
 * before this fires, so the total reflects it.
 */

import { prisma } from '@sendero/database';
import { env } from '@sendero/env';
import { WhatsAppClient } from '@sendero/whatsapp';
import { notifier } from '@sendero/notifications';
import { GATEWAY_CHAINS, queryDepositorBalances } from '@sendero/circle';
import type { Address } from 'viem';

import { getTenantNotificationEmail } from './tenant-notification-email';

const ARC_TX_EXPLORER_PREFIX = 'https://testnet.arcscan.app/tx';

/**
 * Mirrors the Solana DCW chainId stored on `Wallet` rows. Same constant
 * as `traveler_balance` uses; Solana DCWs aren't EVM, so we tag them
 * with Circle Gateway's Solana domain id (5) as a synthetic chainId.
 */
const SOL_DEVNET_CHAIN_ID = 5;

interface NotifyArgs {
  tenantId: string;
  amount: string;
  chainKey: keyof typeof GATEWAY_CHAINS;
  depositTxHash: string;
}

/** ── Traveler WhatsApp ─────────────────────────────────────────── */

export interface NotifyTravelerArgs extends NotifyArgs {
  /** Sendero User.id of the traveler whose DCW received USDC. */
  userId: string;
  /** DCW EVM address — kept for audit logging only; the unified
   *  balance is queried against the gateway-signer EOA (the address
   *  Circle Gateway credits via `depositFor`), not the DCW.  */
  dcwAddress: string;
}

export async function notifyTravelerOfDeposit(args: NotifyTravelerArgs): Promise<void> {
  try {
    const identity = await prisma.channelIdentity.findFirst({
      where: { tenantId: args.tenantId, userId: args.userId, kind: 'whatsapp' },
      select: { externalUserId: true },
    });
    if (!identity?.externalUserId) {
      console.log('[deposit-notify] no whatsapp identity for traveler — skipping', {
        userId: args.userId,
      });
      return;
    }

    const install = await prisma.whatsAppInstall.findUnique({
      where: { tenantId: args.tenantId },
      select: { phoneNumberId: true, status: true },
    });
    if (!install?.phoneNumberId || install.status === 'disabled') {
      console.log('[deposit-notify] no active whatsapp install for tenant — skipping', {
        tenantId: args.tenantId,
      });
      return;
    }

    const accessToken = env.whatsappAccessToken() ?? env.kapsoApiKey();
    if (!accessToken) return;

    // DRY balance read — same shared helper as `traveler_balance`
    // (wallet card) and `book_flight` (pre-pay funds gate). The
    // notification message MUST report the same number the user
    // sees in their wallet seconds later.
    const { getTravelerUnifiedBalance } = await import('@sendero/circle/traveler-unified-balance');
    let newTotal: string | null = null;
    try {
      const unified = await getTravelerUnifiedBalance({ userId: args.userId });
      newTotal = unified.total ? Number(unified.total).toFixed(2) : null;
    } catch (err) {
      console.warn('[deposit-notify] unified balance lookup failed (non-fatal)', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
    const chainLabel = GATEWAY_CHAINS[args.chainKey]?.label ?? args.chainKey;

    const text = formatTravelerMessage({
      amount: args.amount,
      chainLabel,
      newTotal,
      depositTxHash: args.depositTxHash,
      chainKey: args.chainKey,
    });

    const apiBaseUrl =
      env.whatsappApiBaseUrl() ??
      (env.kapsoApiKey() ? `${env.kapsoApiBaseUrl()}/meta/whatsapp/v24.0` : undefined);
    const client = new WhatsAppClient({
      phoneNumberId: install.phoneNumberId,
      accessToken,
      apiBaseUrl,
    });

    await client.sendText(identity.externalUserId, text);
    console.log('[deposit-notify] traveler whatsapp sent', {
      userId: args.userId,
      to: identity.externalUserId,
      amount: args.amount,
      chainKey: args.chainKey,
    });
  } catch (err) {
    console.warn('[deposit-notify] traveler send failed (non-fatal)', {
      userId: args.userId,
      tenantId: args.tenantId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/** ── Treasury email ───────────────────────────────────────────── */

export interface NotifyTreasuryArgs extends NotifyArgs {
  /** DCW address that physically received the on-chain inbound. */
  walletAddress: string;
  /** Tenant CircleWallet kind that received the inbound (`treasury` | `operations`). */
  walletKind: string;
  /**
   * Address that holds the resulting Gateway unified balance. When the
   * sweep used `depositFor` to credit the tenant gateway-signer EOA,
   * this is that EOA. When the DCW self-deposited, this is the DCW
   * itself. Defaults to `walletAddress` when omitted (legacy behavior).
   */
  gatewayDepositorAddress?: string;
}

export async function notifyTreasuryOfDeposit(args: NotifyTreasuryArgs): Promise<void> {
  try {
    const adminEmail = await getTenantNotificationEmail(args.tenantId);
    if (!adminEmail) {
      console.log('[deposit-notify] no tenant notification email — skipping treasury email', {
        tenantId: args.tenantId,
      });
      return;
    }

    const tenant = await prisma.tenant.findUnique({
      where: { id: args.tenantId },
      select: { displayName: true, slug: true },
    });
    const tenantLabel = tenant?.displayName ?? tenant?.slug ?? args.tenantId.slice(0, 8);

    // Query unified balance using the address that actually holds it.
    // When `depositFor` credited the EOA, that's where Gateway sees
    // the funds — querying the DCW returns 0 even though the deposit
    // succeeded.
    const balanceLookupAddress = args.gatewayDepositorAddress ?? args.walletAddress;
    const newTotal = await safeUnifiedTotal({ evm: balanceLookupAddress as Address });
    const chainLabel = GATEWAY_CHAINS[args.chainKey]?.label ?? args.chainKey;
    const linkOrigin = (process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3010').replace(
      /\/$/,
      ''
    );
    const tripsUrl = `${linkOrigin}/dashboard`;

    const result = await notifier().sendShareCard(adminEmail, {
      title: `Treasury received ${args.amount} USDC`,
      body:
        `${tenantLabel} ${args.walletKind} wallet on ${chainLabel} just received ` +
        `${args.amount} USDC. The funds are now in your Sendero unified balance — total: ` +
        `${newTotal ?? '—'} USDC.`,
      bullets: [
        `Inbound at: ${args.walletAddress} (${args.walletKind})`,
        ...(args.gatewayDepositorAddress && args.gatewayDepositorAddress !== args.walletAddress
          ? [`Gateway depositor: ${args.gatewayDepositorAddress}`]
          : []),
        `Chain: ${chainLabel}`,
        `Transaction: ${args.depositTxHash}`,
      ],
      primaryCta: { label: 'Open dashboard', href: tripsUrl },
    });

    console.log('[deposit-notify] treasury email dispatch', {
      tenantId: args.tenantId,
      to: adminEmail,
      amount: args.amount,
      result: result.ok ? 'sent' : result.skipped ? 'skipped' : 'error',
      error: result.error,
    });
  } catch (err) {
    console.warn('[deposit-notify] treasury email failed (non-fatal)', {
      tenantId: args.tenantId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// ── Helpers ───────────────────────────────────────────────────────

async function safeUnifiedTotal(depositor: {
  evm?: Address;
  solana?: string;
}): Promise<string | null> {
  try {
    const { total } = await queryDepositorBalances(depositor);
    // queryDepositorBalances returns total as a 6-decimal string; trim
    // trailing zeros to "1.00" / "19.99" style.
    const num = Number(total);
    if (!Number.isFinite(num)) return null;
    return num.toFixed(2);
  } catch (err) {
    console.warn('[deposit-notify] queryDepositorBalances failed (non-fatal)', {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

function formatTravelerMessage(args: {
  amount: string;
  chainLabel: string;
  newTotal: string | null;
  depositTxHash: string;
  chainKey: keyof typeof GATEWAY_CHAINS;
}): string {
  const lines = [
    `💰 *+${args.amount} USDC* received on ${args.chainLabel}`,
    '',
    args.newTotal
      ? `Your unified balance: *${args.newTotal} USDC*`
      : 'Funds are now in your unified balance.',
  ];
  // Arc explorer link only — other chain explorers vary; the
  // tx hash is the source of truth either way.
  if (args.chainKey === 'Arc_Testnet') {
    lines.push('', `🔗 ${ARC_TX_EXPLORER_PREFIX}/${args.depositTxHash}`);
  } else {
    lines.push('', `Tx: \`${args.depositTxHash}\``);
  }
  return lines.join('\n');
}
