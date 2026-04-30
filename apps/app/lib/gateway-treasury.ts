import { GATEWAY_CHAINS, isEvmChain, transferViaGatewayFromSources } from '@sendero/circle/gateway';
import { getOrCreateGatewaySigner } from '@sendero/circle/gateway-signer';
import type { TenantGatewaySigner } from '@sendero/circle/gateway-signer';
import { prisma } from '@sendero/database';
import type { Address } from 'viem';

import { decimalUsdcToMicro, microUsdcToDecimal } from '@/lib/gateway-balance-math';

const GATEWAY_API = 'https://gateway-api-testnet.circle.com/v1';
const ARC_CHAIN_KEY = 'Arc_Testnet' as const;

interface GatewayBalanceApiResponse {
  balances?: Array<{ domain: number; depositor: string; balance: string }>;
}

function chainKeyForDomain(domain: number): keyof typeof GATEWAY_CHAINS | null {
  for (const [key, chain] of Object.entries(GATEWAY_CHAINS)) {
    if (chain.domain === domain) return key as keyof typeof GATEWAY_CHAINS;
  }
  return null;
}

function gatewayKeyForBridgeChain(chain: string | undefined): keyof typeof GATEWAY_CHAINS | null {
  if (!chain) return null;
  if (chain in GATEWAY_CHAINS) return chain as keyof typeof GATEWAY_CHAINS;
  if (chain === 'Polygon_Amoy_Testnet') return 'Polygon_Amoy';
  if (chain === 'Solana_Devnet') return 'Sol_Devnet';
  return null;
}

export interface GatewayMaterializeResult {
  signerAddress: Address;
  from: keyof typeof GATEWAY_CHAINS;
  to: typeof ARC_CHAIN_KEY;
  amount: string;
  recipient: string;
  mintHash: string;
  explorerUrl: string;
}

export async function selectTenantGatewayEvmSource(args: {
  tenantId: string;
  amount: string;
  preferredSourceChain?: string;
}): Promise<{ signer: TenantGatewaySigner; from: keyof typeof GATEWAY_CHAINS }> {
  const selected = await selectTenantGatewayEvmSources(args);
  return { signer: selected.signer, from: selected.sources[0].from };
}

export async function selectTenantGatewayEvmSources(args: {
  tenantId: string;
  amount: string;
  preferredSourceChain?: string;
}): Promise<{
  signer: TenantGatewaySigner;
  sources: Array<{ from: keyof typeof GATEWAY_CHAINS; amountUsdc: string }>;
}> {
  const amountMicro = decimalUsdcToMicro(args.amount);
  if (amountMicro <= 0n) {
    throw new Error('Gateway transfer amount must be greater than zero.');
  }

  const tenant = await prisma.tenant.findUnique({
    where: { id: args.tenantId },
    select: {
      gatewayConfig: {
        select: {
          evmDepositorAddress: true,
          solanaDepositorAddress: true,
          enabledDomains: true,
        },
      },
    },
  });
  const config = tenant?.gatewayConfig;
  if (!config) {
    throw new Error('TenantGatewayConfig missing; provision Gateway before spending.');
  }

  const sources = config.enabledDomains
    .map(domain => {
      const depositor =
        domain === 5 ? (config.solanaDepositorAddress ?? null) : config.evmDepositorAddress;
      return depositor ? { domain, depositor } : null;
    })
    .filter((source): source is { domain: number; depositor: string } => source !== null);

  const res = await fetch(`${GATEWAY_API}/balances`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: 'USDC', sources }),
  });
  if (!res.ok) {
    throw new Error(`Gateway /balances failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as GatewayBalanceApiResponse;
  const rows = (data.balances ?? [])
    .map(row => {
      const key = chainKeyForDomain(row.domain);
      const chain = key ? GATEWAY_CHAINS[key] : null;
      return {
        key,
        chain,
        domain: row.domain,
        balance: row.balance,
        balanceMicro: decimalUsdcToMicro(row.balance),
      };
    })
    .filter(row => row.key && row.chain);
  const evmRows = rows.filter(row => row.chain && isEvmChain(row.chain));

  const preferred = gatewayKeyForBridgeChain(args.preferredSourceChain);
  const sortedRows = evmRows
    .filter(row => row.balanceMicro > 0n)
    .sort((a, b) => {
      if (preferred && a.key === preferred) return -1;
      if (preferred && b.key === preferred) return 1;
      if (a.key === ARC_CHAIN_KEY) return -1;
      if (b.key === ARC_CHAIN_KEY) return 1;
      return Number(b.balanceMicro - a.balanceMicro);
    });
  let remaining = amountMicro;
  const selectedSources: Array<{ from: keyof typeof GATEWAY_CHAINS; amountUsdc: string }> = [];
  for (const row of sortedRows) {
    if (!row.key || remaining <= 0n) break;
    const take = row.balanceMicro >= remaining ? remaining : row.balanceMicro;
    selectedSources.push({ from: row.key, amountUsdc: microUsdcToDecimal(take) });
    remaining -= take;
  }

  if (remaining > 0n || selectedSources.length === 0) {
    const totalEvm = evmRows.reduce((sum, row) => sum + row.balanceMicro, 0n);
    const totalGateway = rows.reduce((sum, row) => sum + row.balanceMicro, 0n);
    const unsupported = totalGateway - totalEvm;
    const unsupportedMessage =
      unsupported > 0n
        ? ` ${microUsdcToDecimal(unsupported)} USDC is on unsupported Gateway source domains such as Solana.`
        : '';
    throw new Error(
      `Insufficient spendable EVM Gateway USDC. Need ${args.amount}; spendable EVM Gateway balance is ${microUsdcToDecimal(
        totalEvm
      )}.${unsupportedMessage} Solana Gateway source burns are not supported by this server path yet.`
    );
  }

  const signer = await getOrCreateGatewaySigner(args.tenantId);
  return { signer, sources: selectedSources };
}

export async function materializeGatewayUsdcToArc(args: {
  tenantId: string;
  amount: string;
  recipient?: string;
  preferredSourceChain?: string;
}): Promise<GatewayMaterializeResult> {
  const { signer, sources } = await selectTenantGatewayEvmSources({
    tenantId: args.tenantId,
    amount: args.amount,
    preferredSourceChain: args.preferredSourceChain,
  });
  const recipient = args.recipient ?? signer.address;
  const transfer = await transferViaGatewayFromSources({
    sources,
    to: ARC_CHAIN_KEY,
    recipient,
    signer: signer.account,
  });

  return {
    signerAddress: signer.address,
    from: sources[0].from,
    to: ARC_CHAIN_KEY,
    amount: args.amount,
    recipient,
    mintHash: transfer.mintHash,
    explorerUrl: transfer.explorerUrl,
  };
}

export function asAddress(value: string): Address {
  return value as Address;
}
