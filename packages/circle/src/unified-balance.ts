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
import type { TenantGatewaySigner } from './gateway-signer';
import { getOrCreateGatewaySigner } from './gateway-signer';
import {
  type GatewayChainKey,
  type Principal,
  circleWalletsPrincipal,
  getBalances,
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
   * Read-only principals merged into balance queries alongside `principal`.
   * Sol-primary tenants land inbound USDC on a Circle Wallets DCW that
   * the EVM signer doesn't know about; surfacing the DCW here is what
   * lets the unified-balance API aggregate Sol funds. Spend signing
   * still goes through `principal` — never include these in spend
   * sources without first re-modelling the spend path to handle
   * cross-adapter signing.
   */
  extraReadPrincipals: Principal[];
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

  const extraReadPrincipals: Principal[] = [];
  if (tenant.primaryChain === 'sol') {
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

  return {
    tenantId,
    signer,
    principal: viemPrincipal({
      privateKey: signer.privateKey,
      address: signer.address,
      label: `tenant:${tenantId}`,
    }),
    extraReadPrincipals,
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

  const result = await spend({
    sources: [{ principal: ctx.principal, sourceAccount: ctx.signer.address }],
    toChainKey: destinationChain,
    recipient,
    amount: args.amount,
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
