import {
  type GetBalancesResult,
  type SpendResult,
  UnifiedBalanceKit,
} from '@circle-fin/unified-balance-kit';
import { prisma } from '@sendero/database';
import type { Address } from 'viem';

import { createAdapterForSigner } from './app-kit';
import { GATEWAY_CHAINS } from './gateway';
import type { TenantGatewaySigner } from './gateway-signer';
import { getOrCreateGatewaySigner } from './gateway-signer';

const ARC_CHAIN_KEY = 'Arc_Testnet' as const;

let kit: UnifiedBalanceKit | null = null;

function getUnifiedBalanceKit(): UnifiedBalanceKit {
  kit ??= new UnifiedBalanceKit();
  return kit;
}

export function resolveUnifiedBalanceChain(input: string | undefined): keyof typeof GATEWAY_CHAINS {
  if (!input) return ARC_CHAIN_KEY;
  if (input in GATEWAY_CHAINS) return input as keyof typeof GATEWAY_CHAINS;
  for (const [key, chain] of Object.entries(GATEWAY_CHAINS)) {
    if (chain.kitName === input || chain.circleId === input) {
      return key as keyof typeof GATEWAY_CHAINS;
    }
  }
  if (input === 'Solana_Devnet') return 'Sol_Devnet';
  throw new Error(`Unsupported unified-balance chain: ${input}`);
}

function unifiedBalanceChainName(chainKey: keyof typeof GATEWAY_CHAINS): string {
  if (chainKey === 'Sol_Devnet') return 'Solana_Devnet';
  if (chainKey === 'Sol') return 'Solana';
  return GATEWAY_CHAINS[chainKey].kitName;
}

function chainsForDomains(domains: number[]): string[] {
  const seen = new Set<string>();
  for (const [key, chain] of Object.entries(GATEWAY_CHAINS)) {
    if (domains.includes(chain.domain)) {
      seen.add(unifiedBalanceChainName(key as keyof typeof GATEWAY_CHAINS));
    }
  }
  return [...seen];
}

export interface TenantUnifiedBalanceContext {
  tenantId: string;
  signer: TenantGatewaySigner;
  adapter: ReturnType<typeof createAdapterForSigner>;
  enabledChains: string[];
}

export async function getTenantUnifiedBalanceContext(
  tenantId: string
): Promise<TenantUnifiedBalanceContext> {
  const [tenant, signer] = await Promise.all([
    prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { gatewayConfig: { select: { enabledDomains: true } } },
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
  return {
    tenantId,
    signer,
    adapter: createAdapterForSigner(signer.privateKey),
    enabledChains,
  };
}

export async function getTenantUnifiedBalances(args: {
  tenantId: string;
  includePending?: boolean;
}): Promise<GetBalancesResult> {
  const ctx = await getTenantUnifiedBalanceContext(args.tenantId);
  return getUnifiedBalanceKit().getBalances({
    token: 'USDC',
    sources: [{ adapter: ctx.adapter }],
    includePending: args.includePending ?? true,
    networkType: 'testnet',
  } as never);
}

export interface TenantUnifiedSpendArgs {
  tenantId: string;
  amount: string;
  destinationChain?: string;
  recipient?: string;
  useForwarder?: boolean;
}

export interface TenantUnifiedSpendResult {
  signerAddress: Address;
  source: 'unified_balance';
  destinationChain: keyof typeof GATEWAY_CHAINS;
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
  const destination = GATEWAY_CHAINS[destinationChain];
  const recipient = args.recipient ?? ctx.signer.address;

  const result = await getUnifiedBalanceKit().spend({
    from: {
      adapter: ctx.adapter,
      sourceAccount: ctx.signer.address,
    },
    to: {
      adapter: ctx.adapter,
      chain: unifiedBalanceChainName(destinationChain),
      recipientAddress: recipient,
      useForwarder: args.useForwarder ?? false,
    },
    amount: args.amount,
    token: 'USDC',
  } as never);

  return {
    signerAddress: ctx.signer.address,
    source: 'unified_balance',
    destinationChain,
    destinationChainName: destination.kitName,
    recipient,
    amount: args.amount,
    txHash: result.txHash,
    explorerUrl: result.explorerUrl ?? null,
    allocations: result.allocations,
    raw: result,
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
