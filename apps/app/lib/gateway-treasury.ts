import { GATEWAY_CHAINS, isEvmChain, transferViaGateway } from '@sendero/circle/gateway';
import { getOrCreateGatewaySigner } from '@sendero/circle/gateway-signer';
import type { TenantGatewaySigner } from '@sendero/circle/gateway-signer';
import { prisma } from '@sendero/database';
import type { Address } from 'viem';

const GATEWAY_API = 'https://gateway-api-testnet.circle.com/v1';
const ARC_CHAIN_KEY = 'Arc_Testnet' as const;

interface GatewayBalanceApiResponse {
  balances?: Array<{ domain: number; depositor: string; balance: string }>;
}

function decimalToMicro(decimal: string): bigint {
  const [whole, frac = ''] = decimal.split('.');
  const padded = `${frac}000000`.slice(0, 6);
  return BigInt(whole || '0') * 1_000_000n + BigInt(padded || '0');
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
  signer: TenantGatewaySigner;
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
  const amountMicro = decimalToMicro(args.amount);
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
        balanceMicro: decimalToMicro(row.balance),
      };
    })
    .filter(row => row.key && row.chain && isEvmChain(row.chain));

  const preferred = gatewayKeyForBridgeChain(args.preferredSourceChain);
  const preferredRow = preferred
    ? rows.find(row => row.key === preferred && row.balanceMicro >= amountMicro)
    : null;
  const sourceRow =
    preferredRow ??
    rows
      .filter(row => row.balanceMicro >= amountMicro)
      .sort((a, b) => {
        if (a.key === ARC_CHAIN_KEY) return -1;
        if (b.key === ARC_CHAIN_KEY) return 1;
        return Number(b.balanceMicro - a.balanceMicro);
      })[0];

  if (!sourceRow?.key) {
    const totalEvm = rows.reduce((sum, row) => sum + row.balanceMicro, 0n);
    throw new Error(
      `Insufficient EVM Gateway USDC. Need ${args.amount}; available EVM Gateway balance is ${(
        Number(totalEvm) / 1_000_000
      ).toFixed(6)}. Solana Gateway source burns are not supported by this server path yet.`
    );
  }

  const signer = await getOrCreateGatewaySigner(args.tenantId);
  return { signer, from: sourceRow.key };
}

export async function materializeGatewayUsdcToArc(args: {
  tenantId: string;
  amount: string;
  recipient?: string;
  preferredSourceChain?: string;
}): Promise<GatewayMaterializeResult> {
  const { signer, from } = await selectTenantGatewayEvmSource({
    tenantId: args.tenantId,
    amount: args.amount,
    preferredSourceChain: args.preferredSourceChain,
  });
  const recipient = args.recipient ?? signer.address;
  const transfer = await transferViaGateway({
    from,
    to: ARC_CHAIN_KEY,
    amountUsdc: args.amount,
    recipient,
    signer: signer.account,
  });

  return {
    signer,
    from,
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
