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

export async function getTenantUnifiedBalances(args: {
  tenantId: string;
  includePending?: boolean;
}): Promise<GetBalancesResult> {
  const ctx = await getTenantUnifiedBalanceContext(args.tenantId);
  if (ctx.extraReadPrincipals.length === 0) {
    return getBalances({ principal: ctx.principal, includePending: args.includePending });
  }
  return getBalances({
    kind: 'principals',
    principals: [ctx.principal, ...ctx.extraReadPrincipals],
    includePending: args.includePending,
  });
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
