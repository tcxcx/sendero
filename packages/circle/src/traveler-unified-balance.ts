/**
 * `getTravelerUnifiedBalance({ userId })` — the single source of truth
 * for a traveler's Circle Gateway unified USDC balance.
 *
 * Before this helper existed, three call sites independently resolved
 * "which address is the traveler's Gateway depositor":
 *
 *   - `packages/tools/src/gateway-balance.ts::travelerBalanceTool` (wallet card)
 *   - `packages/tools/src/book-flight.ts::assertTravelerHasUsdc` (pre-pay funds check)
 *   - `apps/app/lib/deposit-notifications.ts::notifyTravelerOfDeposit` (post-deposit ping)
 *
 * All three resolved it differently. Two used the DCW principal (which
 * Gateway returns 0 for after `depositFor`), one used the signer.
 * Result: the wallet card said 316 USDC and the ticketing pre-check
 * said 23 USDC for the same human, same instant. This file makes it
 * impossible for that drift to happen again.
 *
 * Resolution rule (matches what `gateway-deposit-core::depositFor`
 * credits):
 *
 *   1. UserGatewaySigner.address  (the EOA that Gateway credits via
 *      `depositFor` — the canonical depositor after the 2026-05-12 fix)
 *   2. fallback: first EVM DCW row (the legacy self-deposit path,
 *      kept only for travelers provisioned before the signer existed)
 *   3. Solana DCW for the Sol_Devnet domain
 *
 * Both `signerAddress` and the EVM DCW addresses are surfaced
 * separately so callers can render the wallet card with all the
 * known principals + flag divergence.
 */

import { prisma } from '@sendero/database';

import { queryUnifiedBalance, type GatewayBalance } from './gateway';

/** Synthetic chainId Sendero stores on Solana DCW Wallet rows. */
const SOL_DEVNET_CHAIN_ID = 5;

export interface TravelerUnifiedBalance {
  /** Sum across every reachable chain. 6-decimal string, e.g. "316.500000". */
  total: string;
  /** Per-chain breakdown straight from Circle Gateway. */
  balances: GatewayBalance[];
  /** Address actually used as the EVM depositor in the Gateway query. */
  evmDepositorAddress: `0x${string}` | null;
  /** UserGatewaySigner.address — null when the row hasn't been provisioned. */
  signerAddress: string | null;
  /** Per-chain DCW addresses (kept for wallet-card rendering). */
  evmDcwAddresses: Array<{ chainId: number; address: string }>;
  /** Solana DCW address — null when unprovisioned. */
  solanaAddress: string | null;
  /** True when EVM DCW rows don't agree on a single canonical address. */
  evmDcwsDivergent: boolean;
  /** Source flag for audit logs / observability. */
  resolvedFrom: 'signer' | 'evm_dcw_fallback' | 'sol_only' | 'no_wallet';
}

export async function getTravelerUnifiedBalance(args: {
  userId: string;
}): Promise<TravelerUnifiedBalance> {
  const [evmDcwRows, solanaWallet, signer] = await Promise.all([
    prisma.wallet.findMany({
      where: { userId: args.userId, provisioner: 'dcw', NOT: { chainId: SOL_DEVNET_CHAIN_ID } },
      orderBy: { createdAt: 'asc' },
      select: { address: true, chainId: true },
    }),
    prisma.wallet.findFirst({
      where: { userId: args.userId, provisioner: 'dcw', chainId: SOL_DEVNET_CHAIN_ID },
      select: { address: true },
    }),
    prisma.userGatewaySigner.findUnique({
      where: { userId: args.userId },
      select: { address: true },
    }),
  ]);

  const evmDcwAddresses = evmDcwRows.map(r => ({ chainId: r.chainId, address: r.address }));
  const uniqueDcwAddresses = new Set(evmDcwAddresses.map(r => r.address.toLowerCase()));
  const evmDcwsDivergent = uniqueDcwAddresses.size > 1;

  // Resolution priority — signer > first DCW > nothing.
  let evmDepositor: `0x${string}` | null = null;
  let resolvedFrom: TravelerUnifiedBalance['resolvedFrom'] = 'no_wallet';
  if (signer?.address) {
    evmDepositor = signer.address as `0x${string}`;
    resolvedFrom = 'signer';
  } else if (evmDcwRows[0]?.address) {
    evmDepositor = evmDcwRows[0].address as `0x${string}`;
    resolvedFrom = 'evm_dcw_fallback';
  } else if (solanaWallet?.address) {
    resolvedFrom = 'sol_only';
  }

  // Empty case — no wallets at all.
  if (!evmDepositor && !solanaWallet?.address) {
    return {
      total: '0.000000',
      balances: [],
      evmDepositorAddress: null,
      signerAddress: signer?.address ?? null,
      evmDcwAddresses,
      solanaAddress: null,
      evmDcwsDivergent: false,
      resolvedFrom: 'no_wallet',
    };
  }

  const { total, balances } = await queryUnifiedBalance({
    evm: evmDepositor ?? undefined,
    solana: solanaWallet?.address ?? undefined,
  });

  return {
    total,
    balances,
    evmDepositorAddress: evmDepositor,
    signerAddress: signer?.address ?? null,
    evmDcwAddresses,
    solanaAddress: solanaWallet?.address ?? null,
    evmDcwsDivergent,
    resolvedFrom,
  };
}
