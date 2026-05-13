/**
 * gateway-deposit-core — the single source of truth for moving USDC
 * from a Circle DCW into a Circle Gateway unified-balance depositor.
 *
 * Why this exists: tenant sweeps (`gateway-sweep.ts::sweepChain`) and
 * traveler sweeps (`gateway-deposit-traveler.ts::depositTravelerToGateway`)
 * were two separate implementations of the same pattern that drifted —
 * the traveler path forgot to call `depositFor` against a separate
 * signer EOA and silently no-op'd on every deposit. One implementation
 * means one place to look when "Gateway shows 0 even though I deposited."
 *
 * The semantics:
 *
 *   - Principal: the Circle DCW that holds the on-chain USDC. Signs the
 *     deposit transaction. Always a Circle Wallets adapter.
 *   - Depositor: the address Circle Gateway credits in its unified
 *     balance ledger. Sendero's invariant: ALWAYS a separate signer EOA
 *     when one exists for the scope. Tenants → `TenantGatewaySigner`.
 *     Travelers → `UserGatewaySigner`. Self-deposit (principal ==
 *     depositor) only when no signer row exists yet (provisioning gap).
 *
 * Self-deposit is a known no-op in Circle's App Kit: the SDK fires an
 * on-chain transaction but only debits gas-fee-scale USDC, never
 * moving the principal. That's why the depositFor pattern is the
 * canonical path. Both tenants and travelers MUST use it.
 *
 * Idempotency: keyed on `webhookEventId`. Circle fires CONFIRMED +
 * COMPLETED for the same notification.id; both arrivals resolve to
 * the same GatewayDepositLog row via unique constraint. Manual /
 * cron triggers should pass a deterministic key (e.g.
 * `manual-sweep:<userId>:<chainKey>:<window>`) so retries within a
 * short window collapse.
 */

import { prisma } from '@sendero/database';

import { GATEWAY_CHAINS, isEvmChain } from './gateway';
import {
  type BalancedJournalLegs,
  journalAccounts,
  journalTransactionId,
  writeJournalEntry,
} from './journal';
import {
  circleWalletsPrincipal,
  type GatewayChainKey,
  deposit as unifiedDeposit,
  depositFor as unifiedDepositFor,
} from './unified-gateway';

/**
 * Post-deposit notification hooks. Both resolvers register one; the
 * core calls it after a confirmed deposit. Keeping these as opaque
 * callbacks (rather than direct imports) avoids a circular dep
 * between `@sendero/circle` and `apps/app/lib/deposit-notifications`.
 */
export interface DepositNotificationHooks {
  /** Fired for traveler-scope confirmed deposits. */
  notifyTraveler?: (args: {
    userId: string;
    tenantId: string;
    chainKey: GatewayChainKey;
    amount: string;
    dcwAddress: string;
    depositTxHash: string;
  }) => Promise<void> | void;
  /** Fired for tenant-scope confirmed deposits. */
  notifyTenant?: (args: {
    tenantId: string;
    chainKey: GatewayChainKey;
    amount: string;
    walletAddress: string;
    depositTxHash: string;
    gatewayDepositorAddress?: string;
  }) => Promise<void> | void;
}

let registeredHooks: DepositNotificationHooks = {};
/**
 * Apps register their notification side-effects once at startup
 * (see `apps/app/instrumentation.ts`). Tests can override per-case.
 */
export function registerDepositNotificationHooks(hooks: DepositNotificationHooks): void {
  registeredHooks = hooks;
}

export interface DepositToGatewayArgs {
  /** Audit scope — every row in GatewayDepositLog needs a tenantId. */
  tenantId: string;
  /** Optional userId for traveler audit trail (logged, not persisted as a column today). */
  userId?: string;
  /** Notification scope — picks the right post-deposit hook to fire. */
  scope?: 'tenant' | 'traveler';
  /** Source of funds — the Circle DCW address holding the USDC. */
  dcwAddress: string;
  /**
   * Address Circle Gateway will credit on the unified-balance ledger.
   * Pass the per-scope gateway-signer EOA when one exists; pass null
   * (or the same address as dcwAddress) ONLY when no signer is
   * provisioned for this scope yet. Solana ignores this — the Sol DCW
   * IS the depositor for that ecosystem.
   */
  evmDepositorAddress?: string | null;
  /** Gateway chain key — must exist in GATEWAY_CHAINS. */
  chainKey: GatewayChainKey;
  /** Human-readable USDC amount, e.g. "10.50". */
  amount: string;
  /** Pre-parsed amount in base units (10^6). Caller computes once; we persist. */
  amountBaseUnits: bigint;
  /** Trigger source for the audit row. */
  triggeredBy?: 'auto' | 'manual' | 'cron';
  /** Idempotency key. Required for safe retries; collapses duplicate calls. */
  webhookEventId?: string;
  /** Audit label — defaults to scope:address; surfaces in Circle's SDK logs. */
  label?: string;
}

export type DepositToGatewayResult =
  | {
      status: 'confirmed';
      depositLogId: string;
      depositTxHash: string;
      depositMode: 'deposit' | 'depositFor';
      depositAccount: string;
    }
  | { status: 'already-processed'; depositLogId: string; depositTxHash: string }
  | { status: 'skipped'; reason: string }
  | { status: 'failed'; depositLogId?: string; error: string };

/**
 * Deposit USDC from a Circle DCW into Circle Gateway. ONE function.
 * Both tenant and traveler sweeps route through here.
 */
export async function depositToGatewayCore(
  args: DepositToGatewayArgs
): Promise<DepositToGatewayResult> {
  const {
    tenantId,
    userId,
    dcwAddress,
    evmDepositorAddress,
    chainKey,
    amount,
    amountBaseUnits,
    triggeredBy = 'auto',
    webhookEventId,
    label,
  } = args;

  const chain = GATEWAY_CHAINS[chainKey];
  if (!chain) {
    return { status: 'failed', error: `Unknown Gateway chain: ${chainKey}` };
  }
  if (amountBaseUnits <= 0n) {
    return { status: 'skipped', reason: 'zero or negative amount' };
  }

  // Early idempotency — short-circuit before we touch Circle.
  if (webhookEventId) {
    const existing = await prisma.gatewayDepositLog.findUnique({
      where: { webhookEventId },
    });
    if (existing?.status === 'confirmed' && existing.depositTxHash) {
      return {
        status: 'already-processed',
        depositLogId: existing.id,
        depositTxHash: existing.depositTxHash,
      };
    }
  }

  // Claim the audit row. Unique on webhookEventId for safe retries.
  const logRow = await prisma.gatewayDepositLog.upsert({
    where: webhookEventId ? { webhookEventId } : { id: '00000000-0000-0000-0000-000000000000' },
    create: {
      tenantId,
      chain: chain.kitName,
      domain: chain.domain,
      amountMicroUsdc: amountBaseUnits,
      status: 'pending',
      triggeredBy,
      webhookEventId: webhookEventId ?? null,
    },
    update: {},
  });

  const principal = circleWalletsPrincipal({
    address: dcwAddress,
    label: label ?? `dcw:${dcwAddress}`,
  });
  if (!principal) {
    await prisma.gatewayDepositLog.update({
      where: { id: logRow.id },
      data: { status: 'failed', errorMessage: 'circle_wallets_adapter_not_configured' },
    });
    return {
      status: 'failed',
      depositLogId: logRow.id,
      error: 'circle_wallets_adapter_not_configured',
    };
  }

  // Decide deposit mode. ONE rule: if we have a separate EVM depositor
  // address for this scope (and we're on EVM), use depositFor — the
  // DCW signs + pays on-chain but Gateway credits the signer EOA.
  // Self-deposit only when no signer exists or on Solana.
  const useDepositFor =
    isEvmChain(chain) &&
    !!evmDepositorAddress &&
    evmDepositorAddress.toLowerCase() !== dcwAddress.toLowerCase();
  const depositAccount = useDepositFor ? evmDepositorAddress! : dcwAddress;
  const depositMode: 'deposit' | 'depositFor' = useDepositFor ? 'depositFor' : 'deposit';

  console.log('[gateway-deposit-core] dispatching', {
    tenantId,
    userId,
    chainKey,
    dcwAddress,
    depositMode,
    depositAccount,
    amount,
  });

  try {
    const { txHash: depositTxHash } = useDepositFor
      ? await unifiedDepositFor({
          principal,
          chainKey,
          amount,
          depositAccount: depositAccount,
        })
      : await unifiedDeposit({ principal, chainKey, amount });

    await prisma.gatewayDepositLog.update({
      where: { id: logRow.id },
      data: {
        status: 'confirmed',
        depositTxHash,
        confirmedAt: new Date(),
      },
    });

    const contextKind = args.scope === 'tenant' ? 'gateway_sweep' : 'deposit';
    const transactionId = journalTransactionId(contextKind, logRow.id);
    const liabilityAccount =
      args.scope === 'traveler' && userId
        ? journalAccounts.userLiability(userId)
        : journalAccounts.tenantLiability(tenantId);
    const journalLegs: BalancedJournalLegs = [
      {
        transactionId,
        tenantId,
        userId: userId ?? null,
        account: journalAccounts.dcwAsset(chainKey),
        direction: 'debit',
        amountMicroUsdc: amountBaseUnits,
        contextKind,
        contextRef: logRow.id,
        metadata: { leg: 'inbound_deposit', depositMode, depositAccount, dcwAddress },
      },
      {
        transactionId,
        tenantId,
        userId: userId ?? null,
        account: liabilityAccount,
        direction: 'credit',
        amountMicroUsdc: amountBaseUnits,
        contextKind,
        contextRef: logRow.id,
        metadata: { leg: 'inbound_deposit', depositMode, depositAccount, dcwAddress },
      },
      {
        transactionId,
        tenantId,
        userId: userId ?? null,
        account: journalAccounts.gatewayAsset(chainKey),
        direction: 'debit',
        amountMicroUsdc: amountBaseUnits,
        contextKind,
        contextRef: logRow.id,
        metadata: { leg: 'gateway_sweep', depositMode, depositAccount, dcwAddress, depositTxHash },
      },
      {
        transactionId,
        tenantId,
        userId: userId ?? null,
        account: journalAccounts.dcwAsset(chainKey),
        direction: 'credit',
        amountMicroUsdc: amountBaseUnits,
        contextKind,
        contextRef: logRow.id,
        metadata: { leg: 'gateway_sweep', depositMode, depositAccount, dcwAddress, depositTxHash },
      },
    ];
    await writeJournalEntry(journalLegs);

    console.log('[gateway-deposit-core] confirmed', {
      tenantId,
      userId,
      chainKey,
      dcwAddress,
      depositMode,
      depositAccount,
      depositTxHash,
      depositLogId: logRow.id,
    });

    // Fire-and-forget post-deposit notification. Hooks are wired by
    // the app at startup; they own the surface (WhatsApp for traveler,
    // email for tenant). Failures here MUST NOT propagate — the
    // deposit is already on-chain and persisted.
    const scope = args.scope;
    if (scope === 'traveler' && userId && registeredHooks.notifyTraveler) {
      Promise.resolve(
        registeredHooks.notifyTraveler({
          userId,
          tenantId,
          chainKey,
          amount,
          dcwAddress,
          depositTxHash,
        })
      ).catch(err => {
        console.warn('[gateway-deposit-core] traveler notification failed (non-fatal)', {
          userId,
          tenantId,
          chainKey,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    } else if (scope === 'tenant' && registeredHooks.notifyTenant) {
      Promise.resolve(
        registeredHooks.notifyTenant({
          tenantId,
          chainKey,
          amount,
          walletAddress: dcwAddress,
          depositTxHash,
          gatewayDepositorAddress: useDepositFor ? depositAccount : undefined,
        })
      ).catch(err => {
        console.warn('[gateway-deposit-core] tenant notification failed (non-fatal)', {
          tenantId,
          chainKey,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }

    return {
      status: 'confirmed',
      depositLogId: logRow.id,
      depositTxHash,
      depositMode,
      depositAccount,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.gatewayDepositLog.update({
      where: { id: logRow.id },
      data: { status: 'failed', errorMessage: message.slice(0, 500) },
    });
    return { status: 'failed', depositLogId: logRow.id, error: message };
  }
}

/**
 * Tenant scope resolver — looks up `TenantGatewayConfig.evmDepositorAddress`
 * (the per-tenant gateway-signer EOA) and dispatches to the core.
 */
export async function depositTenantToGateway(args: {
  tenantId: string;
  dcwAddress: string;
  chainKey: GatewayChainKey;
  amount: string;
  amountBaseUnits: bigint;
  triggeredBy?: 'auto' | 'manual' | 'cron';
  webhookEventId?: string;
}): Promise<DepositToGatewayResult> {
  const cfg = await prisma.tenantGatewayConfig.findUnique({
    where: { tenantId: args.tenantId },
    select: { evmDepositorAddress: true },
  });
  return depositToGatewayCore({
    tenantId: args.tenantId,
    scope: 'tenant',
    dcwAddress: args.dcwAddress,
    evmDepositorAddress: cfg?.evmDepositorAddress ?? null,
    chainKey: args.chainKey,
    amount: args.amount,
    amountBaseUnits: args.amountBaseUnits,
    triggeredBy: args.triggeredBy,
    webhookEventId: args.webhookEventId,
    label: `tenant:${args.tenantId}:${args.chainKey}`,
  });
}

/**
 * Traveler scope resolver — looks up `UserGatewaySigner.address`
 * (the per-traveler gateway-signer EOA) and dispatches to the core.
 */
export async function depositTravelerToGatewayUnified(args: {
  tenantId: string;
  userId: string;
  dcwAddress: string;
  chainKey: GatewayChainKey;
  amount: string;
  amountBaseUnits: bigint;
  triggeredBy?: 'auto' | 'manual' | 'cron';
  webhookEventId?: string;
}): Promise<DepositToGatewayResult> {
  const signer = await prisma.userGatewaySigner.findUnique({
    where: { userId: args.userId },
    select: { address: true },
  });
  return depositToGatewayCore({
    tenantId: args.tenantId,
    scope: 'traveler',
    userId: args.userId,
    dcwAddress: args.dcwAddress,
    evmDepositorAddress: signer?.address ?? null,
    chainKey: args.chainKey,
    amount: args.amount,
    amountBaseUnits: args.amountBaseUnits,
    triggeredBy: args.triggeredBy,
    webhookEventId: args.webhookEventId,
    label: `traveler:${args.userId}:${args.chainKey}`,
  });
}
