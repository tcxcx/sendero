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

import { createSolanaKitAdapterFromPrivateKey } from '@circle-fin/adapter-solana-kit';
import type { GetBalancesResult, SpendResult } from '@circle-fin/unified-balance-kit';
import { type Prisma, prisma } from '@sendero/database';
import type { Address } from 'viem';

import { createLogOnlyComplianceDecision } from './compliance';
import { GATEWAY_CHAINS } from './gateway';
import {
  createGatewayTransferIntent,
  decimalUsdcToMicro,
  markGatewayTransferIntent,
} from './gateway-intent';
import type { TenantGatewaySigner, TenantSolanaSigner } from './gateway-signer';
import { getOrCreateGatewaySigner, getTenantSolanaSigner } from './gateway-signer';
import {
  circleWalletsPrincipal,
  type GatewayChainKey,
  getBalances,
  type Principal,
  spend,
  viemPrincipal,
} from './unified-gateway';

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
  principal: Principal;
  /**
   * Read-only principals merged into balance queries alongside
   * `principal`. Always safe to surface. For Sol-primary tenants this
   * includes the self-custody Sol signer when provisioned, or the Sol
   * DCW addresses as a read-only fallback.
   */
  extraReadPrincipals: Principal[];
  /**
   * Principals safe to pass as `unifiedBalance.spend` sources alongside
   * `principal`. Self-custody Sol signers belong here (their adapter
   * satisfies App Kit's signMessages protocol via the @solana/kit
   * KeyPairSigner). Circle Wallets DCW principals do NOT (Circle
   * holds keys server-side) and must stay out.
   */
  extraSpendPrincipals: Principal[];
  enabledChains: GatewayChainKey[];
}

export async function getTenantUnifiedBalanceContext(
  tenantId: string
): Promise<TenantUnifiedBalanceContext> {
  const [tenant, signer] = await Promise.all([
    prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        primaryChain: true,
        gatewayConfig: { select: { enabledDomains: true } },
      },
    }),
    getOrCreateGatewaySigner(tenantId),
  ]);
  if (!tenant?.gatewayConfig) {
    throw new Error('TenantGatewayConfig missing; provision Gateway before spending.');
  }
  const enabledChains = chainsForDomains(tenant.gatewayConfig.enabledDomains);
  if (enabledChains.length === 0) {
    throw new Error('TenantGatewayConfig has no enabled Gateway domains.');
  }

  // Phase 4.5 — Sol-source spend path. The self-custody Sol signer
  // (TenantSolanaGatewaySigner) holds its own keypair encrypted under
  // SENDERO_KEK; createSolanaKitAdapterFromPrivateKey wraps it as a
  // proper App Kit Sol signer (satisfies signMessages protocol that
  // Circle Wallets DCW adapter doesn't). Funds at this address can be
  // both READ as part of unified balance AND SPENT cross-chain via
  // App Kit `unifiedBalance.spend` (burn-Sol, mint-EVM).
  //
  // Falls back to surfacing Sol DCWs as read-only when no self-custody
  // signer exists yet — they still show in the unified-balance display
  // but trip the "Signer does not support" error on spend.
  const extraReadPrincipals: Principal[] = [];
  const extraSpendPrincipals: Principal[] = [];
  let solSigner: TenantSolanaSigner | null = null;
  if (tenant.primaryChain === 'sol') {
    solSigner = await getTenantSolanaSigner(tenantId);
    if (solSigner) {
      // 'solana-kit' kind matches App Kit's "user-controlled adapter"
      // expectation — buildSpendFrom omits `address` (the adapter
      // derives it from the private key), but maybeTopUpSolanaGas still
      // gas-tops the signer via SENDERO_SOLANA_PLATFORM_PRIVATE_KEY.
      const adapter = createSolanaKitAdapterFromPrivateKey({
        privateKey: solSigner.privateKey,
      });
      const solPrincipal: Principal = {
        kind: 'solana-kit',
        adapter,
        address: solSigner.address,
        label: `tenant:${tenantId}:sol-self-custody`,
      };
      extraReadPrincipals.push(solPrincipal);
      extraSpendPrincipals.push(solPrincipal);
    } else {
      const solDcws = await prisma.circleWallet.findMany({
        where: {
          tenantId,
          kind: 'operations',
          chain: { in: ['SOL-DEVNET', 'SOL'] },
        },
        select: { address: true, chain: true },
      });
      for (const dcw of solDcws) {
        const dcwPrincipal = circleWalletsPrincipal({
          address: dcw.address,
          label: `tenant:${tenantId}:sol-ops:${dcw.chain}`,
        });
        if (dcwPrincipal) extraReadPrincipals.push(dcwPrincipal);
      }
    }
  }

  return {
    tenantId,
    signer,
    principal: viemPrincipal({
      privateKey: signer.privateKey,
      address: signer.address,
      label: `tenant:${tenantId}`,
    }),
    extraReadPrincipals,
    extraSpendPrincipals,
    enabledChains,
  };
}

function sumDecimal(values: Array<string | undefined>): string {
  let microSum = 0n;
  for (const value of values) {
    if (!value) continue;
    const [whole = '0', frac = ''] = value.split('.');
    const padded = `${frac}000000`.slice(0, 6);
    microSum += BigInt(whole || '0') * 1_000_000n + BigInt(padded || '0');
  }
  const whole = microSum / 1_000_000n;
  const frac = (microSum % 1_000_000n).toString().padStart(6, '0');
  return `${whole}.${frac}`;
}

export async function getTenantUnifiedBalances(args: {
  tenantId: string;
  includePending?: boolean;
}): Promise<GetBalancesResult> {
  const ctx = await getTenantUnifiedBalanceContext(args.tenantId);
  const primary = await getBalances({
    principal: ctx.principal,
    includePending: args.includePending,
  });
  if (ctx.extraReadPrincipals.length === 0) return primary;

  // App Kit's getBalances expects ONE adapter shape per call. Run an
  // address-based query per Circle Wallets DCW and merge breakdowns
  // into the primary result. allSettled isolates failures so a single
  // misconfigured Sol DCW can't poison the EVM signer's read.
  const extraResults = await Promise.allSettled(
    ctx.extraReadPrincipals.map(p =>
      getBalances({
        kind: 'address',
        address: p.address,
        includePending: args.includePending,
      })
    )
  );

  const merged = { ...primary, breakdown: [...primary.breakdown] };
  const totals = [primary.totalConfirmedBalance];
  const pendingTotals = [primary.totalPendingBalance];
  for (const [i, r] of extraResults.entries()) {
    if (r.status !== 'fulfilled') {
      console.warn('[unified-balance] extra principal balance read failed (non-fatal)', {
        tenantId: args.tenantId,
        principalLabel: ctx.extraReadPrincipals[i]?.label,
        reason: r.reason instanceof Error ? r.reason.message : String(r.reason),
      });
      continue;
    }
    merged.breakdown.push(...r.value.breakdown);
    totals.push(r.value.totalConfirmedBalance);
    pendingTotals.push(r.value.totalPendingBalance);
  }
  merged.totalConfirmedBalance = sumDecimal(totals);
  merged.totalPendingBalance = sumDecimal(pendingTotals);
  return merged;
}

/**
 * App Kit's `spend()` runs three steps: estimate → burn (on each source
 * chain) → mint (on the destination). When the burn succeeds but the
 * mint step's tx submit fails (e.g., the EVM tenant signer has no native
 * gas), the kit throws with the burn attestation + signature attached
 * to `error.cause.trace`. The kit's own retry path skips estimate+burn
 * and replays only the mint via `config.retry`.
 *
 * Common production trigger: tenant EOA signer with 0 native ETH on the
 * destination EVM chain. Arc's Gateway service has a server-side
 * fallback that eventually submits the mint with relayer gas, but the
 * UI sees the kit error in the meantime. Single-shot retry papers over
 * transient gas blips and saves the burn attestation from being lost.
 */
interface RetryTrace {
  attestation: string;
  signature: string;
}

function extractRetryTrace(err: unknown): RetryTrace | null {
  if (!err || typeof err !== 'object') return null;
  const cause = (err as { cause?: unknown }).cause;
  if (!cause || typeof cause !== 'object') return null;
  const trace = (cause as { trace?: unknown }).trace;
  if (!trace || typeof trace !== 'object') return null;
  const t = trace as { attestation?: unknown; signature?: unknown };
  if (typeof t.attestation !== 'string' || typeof t.signature !== 'string') return null;
  return { attestation: t.attestation, signature: t.signature };
}

async function spendWithMintRetry(args: Parameters<typeof spend>[0]) {
  try {
    return await spend(args);
  } catch (err) {
    const trace = extractRetryTrace(err);
    if (!trace) throw err;
    await markGatewayTransferIntent({
      intentId: args.gatewayIntentId,
      state: 'burn_attested',
      attestation: trace.attestation,
      apiSignature: trace.signature,
      failedReason: err instanceof Error ? err.message : String(err),
    });
    console.warn('[unified-balance] mint failed; retrying with attestation', {
      tenantId: args.sources[0]?.principal.label,
      toChainKey: args.toChainKey,
      reason: err instanceof Error ? err.message : String(err),
    });
    return await spend({
      ...args,
      retry: trace,
    });
  }
}

export interface TenantUnifiedSpendArgs {
  tenantId: string;
  amount: string;
  destinationChain?: string;
  recipient?: string;
  gatewayTransferLogId?: string | null;
  journalContextRef?: string;
  journalContextKind?: 'spend' | 'bridge';
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
  const journalContextKind = args.journalContextKind ?? 'spend';
  const journalContextRef =
    args.journalContextRef ??
    `tenant:${args.tenantId}:${destinationChain}:${recipient}:${args.amount}:${Date.now()}`;

  // EVM signer + any self-custody Sol signers from ctx. The self-custody
  // Sol path is Phase 4.5: createSolanaKitAdapterFromPrivateKey wraps an
  // encrypted-at-rest secretKey into an App-Kit-compatible Sol signer
  // that DOES satisfy signMessages. App Kit allocates burns across
  // every source adapter and mints on the destination chain via CCTP.
  const sources = [
    { principal: ctx.principal, sourceAccount: ctx.signer.address },
    ...ctx.extraSpendPrincipals.map(p => ({ principal: p })),
  ];
  const amountMicroUsdc = decimalUsdcToMicro(args.amount);
  const intentId = await createGatewayTransferIntent({
    tenantId: args.tenantId,
    gatewayTransferLogId: args.gatewayTransferLogId ?? null,
    signerKind: 'app-kit-principal',
    sourceChain: null,
    destinationChain,
    amountMicroUsdc,
    recipientAddress: recipient,
    metadata: { source: 'spendTenantUnifiedUsd' },
  });
  const complianceDecision = await createLogOnlyComplianceDecision({
    tenantId: args.tenantId,
    intentId,
    recipientAddress: recipient,
    recipientChain: destinationChain,
    amountMicroUsdc,
    contextKind: journalContextKind,
    contextRef: journalContextRef,
    metadata: {
      mode: 'log_only',
      source: 'spendTenantUnifiedUsd',
      gatewayTransferLogId: args.gatewayTransferLogId ?? null,
    },
  });

  let result: Awaited<ReturnType<typeof spendWithMintRetry>>;
  try {
    result = await spendWithMintRetry({
      sources,
      toChainKey: destinationChain,
      recipient,
      amount: args.amount,
      gatewayIntentId: intentId,
      journal: {
        tenantId: args.tenantId,
        complianceDecisionId: complianceDecision?.complianceDecisionId ?? null,
        contextKind: journalContextKind,
        contextRef: journalContextRef,
      },
    });
  } catch (err) {
    await markGatewayTransferIntent({
      intentId,
      state: 'mint_failed_terminal',
      failedReason: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }

  await markGatewayTransferIntent({
    intentId,
    state: 'mint_confirmed',
    mintTxHash: result.txHash,
    metadata: {
      tenantId: args.tenantId,
      destinationChain,
      recipient,
      allocations: result.allocations as unknown as Record<string, unknown>[],
    } as Prisma.InputJsonValue,
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
