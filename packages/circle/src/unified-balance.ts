/**
 * Tenant-side Unified Balance helpers.
 *
 * Thin wrappers over `@sendero/circle/unified-gateway`. The kit
 * instance, adapter wiring, and chain-name normalization live in the
 * gateway service; this module knows how to resolve the per-tenant
 * signer, what `enabledDomains` means, and how to map App Kit
 * allocation results back to Sendero's `GATEWAY_CHAINS` keys.
 *
 * Kept at this path for back-compat with existing imports
 * (`@sendero/circle/unified-balance` is referenced from
 * `apps/app/lib/gateway-treasury.ts`).
 */

import type { GetBalancesResult, SpendResult } from '@circle-fin/unified-balance-kit';
import { prisma } from '@sendero/database';
import type { Address } from 'viem';

import { GATEWAY_CHAINS } from './gateway';
import type { TenantGatewaySigner, TenantSolanaGatewaySigner } from './gateway-signer';
import { getOrCreateGatewaySigner, getOrCreateTenantSolanaSigner } from './gateway-signer';
import {
  type GatewayChainKey,
  type Principal,
  type SpendSource,
  circleWalletsPrincipal,
  getBalances,
  solanaSelfCustodyPrincipal,
  spend,
  viemPrincipal,
} from './unified-gateway';
import { queryUnifiedBalance } from './gateway';

const ARC_CHAIN_KEY: GatewayChainKey = 'Arc_Testnet';

export function resolveUnifiedBalanceChain(input: string | undefined): GatewayChainKey {
  if (!input) return ARC_CHAIN_KEY;
  if (input in GATEWAY_CHAINS) return input as GatewayChainKey;
  for (const [key, chain] of Object.entries(GATEWAY_CHAINS)) {
    if (chain.kitName === input || chain.circleId === input) {
      return key as GatewayChainKey;
    }
  }
  if (input === 'Solana_Devnet') return 'Sol_Devnet';
  throw new Error(`Unsupported unified-balance chain: ${input}`);
}

function chainsForDomains(domains: number[]): GatewayChainKey[] {
  const seen = new Set<GatewayChainKey>();
  for (const [key, chain] of Object.entries(GATEWAY_CHAINS)) {
    if (domains.includes(chain.domain)) {
      seen.add(key as GatewayChainKey);
    }
  }
  return [...seen];
}

export interface TenantUnifiedBalanceContext {
  tenantId: string;
  signer: TenantGatewaySigner;
  /**
   * Spend principal — always the EVM gateway-signer EOA. Used for
   * EVM-side burns + EVM destination mints when forwarder is off.
   */
  principal: Principal;
  /**
   * Per-tenant self-custody Solana keypair. Built lazily on first
   * unified-balance touch by `getOrCreateTenantSolanaSigner`. We use it
   * as both the Sol gateway depositor and the Sol burn-intent signer
   * — Circle DCW Sol signers can't do raw-message signing (App Kit's
   * `gateway.v1.signBurnIntents` requirement), but `@solana/kit`
   * `KeyPairSigner` (under `createSolanaKitAdapterFromPrivateKey`)
   * exposes `signMessages` natively.
   */
  solanaSigner: TenantSolanaGatewaySigner;
  /**
   * Sol principal built from `solanaSigner.privateKey`. Drives the
   * Sol-source branch of `spend()` and is the address we query Sol
   * Gateway balance against. Single source of truth for Sol on the
   * unified-balance hot path.
   */
  solanaPrincipal: Principal;
  /**
   * Legacy Sol depositor (the Circle ops DCW). Kept on the context as
   * a read-only diagnostic — funds stranded here from before the
   * self-custody migration still exist in Gateway and surface in the
   * balance query when the new signer's balance is zero. Not used for
   * spend.
   */
  legacySolanaDcwAddress: string | null;
  /**
   * Per-chain Circle DCW addresses keyed by Circle's blockchain
   * identifier (`ARC-TESTNET`, `SOL-DEVNET`, `AVAX-FUJI`, …) — i.e.
   * `GATEWAY_CHAINS[key].circleId`. Drives the destination-side
   * Circle Wallets adapter binding in `spend()` when forwarder is
   * off. Circle's fleet adapter rejects spend calls without a wallet
   * address attached.
   */
  circleWalletsByChain: Record<string, string>;
  enabledChains: GatewayChainKey[];
}

export async function getTenantUnifiedBalanceContext(
  tenantId: string
): Promise<TenantUnifiedBalanceContext> {
  const [tenant, signer, solanaSigner, opsWallets] = await Promise.all([
    prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        gatewayConfig: {
          select: { enabledDomains: true, solanaDepositorAddress: true },
        },
      },
    }),
    getOrCreateGatewaySigner(tenantId),
    // Lazy-provision the Sol self-custody keypair the first time anyone
    // touches unified balance. Idempotent on tenantId; concurrent calls
    // race on the unique constraint and the loser re-reads.
    getOrCreateTenantSolanaSigner(tenantId),
    prisma.circleWallet.findMany({
      where: { tenantId, kind: 'operations' },
      select: { chain: true, address: true },
    }),
  ]);
  if (!tenant?.gatewayConfig) {
    throw new Error('TenantGatewayConfig missing; provision Gateway before spending.');
  }
  const enabledChains = chainsForDomains(tenant.gatewayConfig.enabledDomains);
  if (enabledChains.length === 0) {
    throw new Error('TenantGatewayConfig has no enabled Gateway domains.');
  }
  const circleWalletsByChain: Record<string, string> = {};
  for (const w of opsWallets) {
    circleWalletsByChain[w.chain] = w.address;
  }
  return {
    tenantId,
    signer,
    principal: viemPrincipal({
      privateKey: signer.privateKey,
      address: signer.address,
      label: `tenant:${tenantId}`,
    }),
    solanaSigner,
    solanaPrincipal: solanaSelfCustodyPrincipal({
      privateKey: solanaSigner.privateKey,
      address: solanaSigner.address,
      label: `tenant:${tenantId}:sol`,
    }),
    legacySolanaDcwAddress: tenant.gatewayConfig.solanaDepositorAddress ?? null,
    circleWalletsByChain,
    enabledChains,
  };
}

/**
 * Query the tenant's unified USDC balance across EVM + Sol depositors.
 *
 * Two reads merged: the viem-principal adapter call (returns balances
 * tied to the EVM gateway-signer EOA across every Gateway-enabled EVM
 * chain) and a REST-fallback `queryUnifiedBalance({ solana })` for the
 * Sol depositor (the Sol-side gateway adapter doesn't share an EOA
 * with the EVM signer, so its balance has to be queried by address).
 *
 * Without the Sol read, USDC sent to a Sol-primary tenant's Solana DCW
 * gets swept into Gateway but is invisible to the wallet UI — the EVM
 * principal can't see Sol-domain balances tied to a different
 * depositor pubkey. That's why a sol-primary workspace's "$0.00"
 * showed up while the funds were sitting in flight.
 */
export async function getTenantUnifiedBalances(args: {
  tenantId: string;
  includePending?: boolean;
}): Promise<GetBalancesResult> {
  const ctx = await getTenantUnifiedBalanceContext(args.tenantId);
  // EVM principal — covers Arc, Sepolia, Base, etc., all on the same
  // viem EOA address.
  const evmResult = await getBalances({
    principal: ctx.principal,
    includePending: args.includePending,
  });

  // Query the self-custody Sol signer first — that's where new deposits
  // land. We also peek at the legacy DCW depositor (if it exists) so
  // pre-migration funds remain visible until they're swept. Both reads
  // are REST queries because Sol depositors aren't tied to the EVM
  // viem adapter.
  const solanaAddresses: string[] = [ctx.solanaSigner.address];
  if (ctx.legacySolanaDcwAddress && ctx.legacySolanaDcwAddress !== ctx.solanaSigner.address) {
    solanaAddresses.push(ctx.legacySolanaDcwAddress);
  }

  let merged: GetBalancesResult = evmResult;
  for (const solAddress of solanaAddresses) {
    let solResult: Awaited<ReturnType<typeof queryUnifiedBalance>>;
    try {
      solResult = await queryUnifiedBalance({ solana: solAddress });
    } catch (err) {
      console.warn('[unified-balance] sol query failed for depositor, skipping', {
        tenantId: ctx.tenantId,
        solDepositor: solAddress,
        error: err instanceof Error ? err.message : String(err),
      });
      continue;
    }
    merged = mergeEvmAndSolBalances(merged, solResult, solAddress);
  }
  return merged;
}

interface SolBalanceShape {
  total: string;
  balances: Array<{ chain: string; balance: string }>;
}

/**
 * Fold the Sol REST result into the App Kit GetBalancesResult shape.
 *
 * App Kit's shape (from `@circle-fin/unified-balance-kit`):
 *   {
 *     token: 'USDC',
 *     totalConfirmedBalance: string,
 *     totalPendingBalance?: string,
 *     breakdown: [{
 *       depositor: string,        // depositor address
 *       totalConfirmed: string,
 *       breakdown: [{ chain: string, confirmedBalance: string }]
 *     }]
 *   }
 *
 * We append a new top-level breakdown entry for the Sol depositor and
 * recompute `totalConfirmedBalance`. The Sol depositor's per-chain
 * breakdown uses `chain: 'Sol_Devnet'` because that's the kit-name the
 * `/api/gateway/balance` route already maps to Circle's Solana domain
 * (id 5). Without that match, the Sol row would be filtered out
 * downstream and the unified balance would still show $0.
 */
function mergeEvmAndSolBalances(
  evmResult: GetBalancesResult,
  solResult: SolBalanceShape,
  solDepositorAddress: string
): GetBalancesResult {
  const result = evmResult as unknown as {
    token?: string;
    totalConfirmedBalance?: string;
    totalPendingBalance?: string;
    breakdown?: Array<{
      depositor: string;
      totalConfirmed: string;
      totalPending?: string;
      breakdown: Array<{ chain: string; confirmedBalance: string; pendingBalance?: string }>;
    }>;
  };

  const solBalanceUsdc = solResult.balances.reduce((sum, row) => {
    return sum + Number(row.balance ?? 0);
  }, 0);
  if (solBalanceUsdc <= 0) return evmResult;

  const solBreakdownEntry = {
    depositor: solDepositorAddress,
    totalConfirmed: solBalanceUsdc.toString(),
    breakdown: [
      {
        // Match `GATEWAY_CHAINS.Sol_Devnet.kitName` so the route's
        // chainToDomain map resolves it to domain 5.
        chain: 'Sol_Devnet',
        confirmedBalance: solBalanceUsdc.toString(),
      },
    ],
  };

  const evmTotal = Number(result.totalConfirmedBalance ?? '0');
  const merged = {
    ...evmResult,
    totalConfirmedBalance: (evmTotal + solBalanceUsdc).toString(),
    breakdown: [...(result.breakdown ?? []), solBreakdownEntry],
  };
  return merged as GetBalancesResult;
}

export interface TenantUnifiedSpendArgs {
  tenantId: string;
  amount: string;
  destinationChain?: string;
  recipient?: string;
}

export interface TenantUnifiedSpendResult {
  signerAddress: Address;
  source: 'unified_balance';
  destinationChain: GatewayChainKey;
  destinationChainName: string;
  recipient: string;
  amount: string;
  txHash: string;
  explorerUrl: string | null;
  allocations: SpendResult['allocations'];
  raw: SpendResult;
}

export async function spendTenantUnifiedUsd(
  args: TenantUnifiedSpendArgs
): Promise<TenantUnifiedSpendResult> {
  const ctx = await getTenantUnifiedBalanceContext(args.tenantId);
  const destinationChain = resolveUnifiedBalanceChain(args.destinationChain);
  const recipient = args.recipient ?? ctx.signer.address;

  // Multi-chain spend source list so App Kit can auto-allocate from
  // EVM Gateway + Sol Gateway. Sol source uses the self-custody
  // KeyPairSigner (via `solanaSelfCustodyPrincipal`) so the burn-intent
  // signing path — which requires `signMessage`/`signMessages` — has a
  // signer that actually exposes it. Circle DCW signers don't, hence
  // the architectural shift.
  const sources: SpendSource[] = [
    { principal: ctx.principal, sourceAccount: ctx.signer.address },
    { principal: ctx.solanaPrincipal, sourceAccount: ctx.solanaSigner.address },
  ];

  // Forwarder policy:
  //   - Arc_Testnet (our home chain) → forwarder OFF, we sign the mint
  //     locally via the EVM signer EOA. Gas comes from the EOA, which
  //     Arc faucets keep topped.
  //   - Sol destinations → forwarder OFF (Circle's Forwarding Service
  //     doesn't support Solana as a destination today). We sign the
  //     mint via the self-custody Sol signer; gas via `ensureSolanaGas`.
  //   - Every other EVM destination → forwarder ON. Circle's relayer
  //     submits the mint, no destination DCW or gas needed.
  const isSolDestination = destinationChain === 'Sol_Devnet' || destinationChain === 'Sol';
  const useForwarder = destinationChain !== 'Arc_Testnet' && !isSolDestination;

  // Destination adapter wiring (only relevant when forwarder is OFF).
  // Strategy: use the Circle Wallets DCW on the destination chain as
  // the signing adapter. Sol DCW signers expose `signTransactions`,
  // which is all we need for the destination MINT (the receiveMessage
  // call on Sol or the gatewayMint call on EVM is an on-chain tx).
  // The signMessages gap that bit us on the SOURCE-side burn-intent
  // path does NOT apply on the destination — destination signing is
  // a regular transaction, not a raw message.
  //
  // Why not the self-custody Sol signer for Sol destinations?
  // SolanaKitAdapter created from a private key is user-controlled;
  // App Kit's destination address-resolution path runs a viem chain
  // lookup for the chain name and errors "Unsupported blockchain:
  // Solana_Devnet" because viem doesn't know Solana. The Circle
  // Wallets adapter (developer-controlled) skips that path entirely,
  // taking `toAccount` as the authoritative address.
  let toAdapter: Principal['adapter'] | undefined;
  let toAccount: string | undefined;
  if (!useForwarder) {
    // Bind the destination adapter to the DCW that ACTUALLY OWNS the
    // recipient's token account. Circle's Sol Gateway program
    // (`gateway.v1.gatewayMint` for Sol) validates that the signing
    // DCW context owns the destination ATA — wiring the operations
    // DCW as toAccount when recipient is a different DCW (e.g. the
    // treasury DCW for a buyer prefund) trips:
    //   AnchorError 6027 InvalidDestinationTokenAccount.
    //
    // Resolution order:
    //   1. If `args.recipient` matches any tenant DCW (ops OR treasury)
    //      on the destination chain → bind toAccount = recipient.
    //   2. Otherwise fall back to the operations DCW on the destination
    //      chain (legacy behavior for cases where the recipient is
    //      external).
    const destinationCircleId = GATEWAY_CHAINS[destinationChain].circleId;
    const recipientMatch = args.recipient
      ? await prisma.circleWallet.findFirst({
          where: {
            tenantId: args.tenantId,
            chain: destinationCircleId,
            address: args.recipient,
          },
          select: { address: true },
        })
      : null;
    const destinationDcwAddress =
      recipientMatch?.address ?? ctx.circleWalletsByChain[destinationCircleId] ?? null;
    if (destinationDcwAddress) {
      const destCircle = circleWalletsPrincipal({
        address: destinationDcwAddress,
        label: `tenant:${args.tenantId}:dest:${destinationCircleId}`,
      });
      if (destCircle) {
        toAdapter = destCircle.adapter;
        toAccount = destinationDcwAddress;
      }
    }
  }

  // Diagnostic: surface the source-vs-balance mismatch that has been
  // blocking Sol unified spend. We log:
  //   • each principal's address + kind
  //   • each depositor's Gateway pool balance from Circle's REST API
  //   • the configured destination + forwarder flag
  // so a failed "Insufficient balance" is debuggable from server logs.
  try {
    const { queryUnifiedBalance } = await import('./gateway');
    const evmDepositor = ctx.signer.address;
    const solSelfDepositor = ctx.solanaSigner.address;
    const solLegacyDepositor = ctx.legacySolanaDcwAddress;

    const [evmRest, solSelfRest, solLegacyRest] = await Promise.all([
      queryUnifiedBalance({ evm: evmDepositor }).catch(e => ({
        error: e instanceof Error ? e.message : String(e),
      })),
      queryUnifiedBalance({ solana: solSelfDepositor }).catch(e => ({
        error: e instanceof Error ? e.message : String(e),
      })),
      solLegacyDepositor && solLegacyDepositor !== solSelfDepositor
        ? queryUnifiedBalance({ solana: solLegacyDepositor }).catch(e => ({
            error: e instanceof Error ? e.message : String(e),
          }))
        : Promise.resolve({ skipped: 'same as self-custody address' }),
    ]);

    console.log('[unified-balance/spend] dispatch', {
      tenantId: args.tenantId,
      amount: args.amount,
      destinationChain,
      useForwarder,
      recipient,
      sources: sources.map(s => ({
        kind: s.principal.kind,
        address: 'address' in s.principal ? (s.principal as { address?: string }).address : null,
        sourceAccount: s.sourceAccount,
      })),
      pool: {
        evmDepositor,
        evmPool: evmRest,
        solSelfDepositor,
        solSelfPool: solSelfRest,
        solLegacyDepositor,
        solLegacyPool: solLegacyRest,
      },
      note:
        'spend allocates from EVM viem + Sol self-custody only. The legacy ' +
        'Sol DCW pool is visible to the balance UI but UNSPENDABLE — Circle ' +
        'DCW Sol signers do not implement signMessages, which App Kit needs ' +
        'for gateway.v1.signBurnIntents.',
    });
  } catch (logErr) {
    console.warn('[unified-balance/spend] diagnostic log failed (non-fatal)', logErr);
  }

  const result = await spend({
    sources,
    toChainKey: destinationChain,
    recipient,
    amount: args.amount,
    useForwarder,
    ...(toAdapter && toAccount ? { toAdapter, toAccount } : {}),
  });

  return {
    signerAddress: ctx.signer.address,
    source: 'unified_balance',
    destinationChain,
    destinationChainName: GATEWAY_CHAINS[destinationChain].kitName,
    recipient,
    amount: args.amount,
    txHash: result.txHash,
    explorerUrl: result.explorerUrl ?? null,
    allocations: result.allocations as SpendResult['allocations'],
    raw: result.raw as SpendResult,
  };
}

export async function materializeTenantUnifiedUsdToArc(args: {
  tenantId: string;
  amount: string;
  recipient?: string;
}): Promise<TenantUnifiedSpendResult> {
  return spendTenantUnifiedUsd({
    tenantId: args.tenantId,
    amount: args.amount,
    destinationChain: ARC_CHAIN_KEY,
    recipient: args.recipient,
  });
}
