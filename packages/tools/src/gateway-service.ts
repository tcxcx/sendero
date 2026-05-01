import { GATEWAY_CHAINS, type GatewayChain, isEvmChain } from '@sendero/circle/gateway';
import type { TenantGatewaySigner } from '@sendero/circle/gateway-signer';
import { getOrCreateGatewaySigner } from '@sendero/circle/gateway-signer';
import { materializeTenantUnifiedUsdToArc } from '@sendero/circle/unified-balance';
import { prisma } from '@sendero/database';

const GATEWAY_API = 'https://gateway-api-testnet.circle.com/v1';

interface GatewayBalanceApiResponse {
  balances?: Array<{ domain: number; depositor: string; balance: string }>;
}

function decimalToMicro(decimal: string): bigint {
  const [whole, frac = ''] = decimal.split('.');
  const padded = `${frac}000000`.slice(0, 6);
  return BigInt(whole || '0') * 1_000_000n + BigInt(padded || '0');
}

function keyForDomain(domain: number): keyof typeof GATEWAY_CHAINS | null {
  for (const [key, chain] of Object.entries(GATEWAY_CHAINS)) {
    if (chain.domain === domain) return key as keyof typeof GATEWAY_CHAINS;
  }
  return null;
}

function keyForAppKitChain(chain: string | undefined): keyof typeof GATEWAY_CHAINS | null {
  if (!chain) return null;
  if (chain in GATEWAY_CHAINS) return chain as keyof typeof GATEWAY_CHAINS;
  if (chain === 'Polygon_Amoy_Testnet') return 'Polygon_Amoy';
  if (chain === 'Solana_Devnet') return 'Sol_Devnet';
  return null;
}

export async function selectTenantGatewayEvmSource(args: {
  tenantId: string;
  amount: string;
  preferredSourceChain?: string;
}): Promise<{ signer: TenantGatewaySigner; from: keyof typeof GATEWAY_CHAINS }> {
  const amountMicro = decimalToMicro(args.amount);
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
  if (!config) throw new Error('TenantGatewayConfig missing; provision Gateway before spending.');

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
  if (!res.ok) throw new Error(`Gateway /balances failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as GatewayBalanceApiResponse;
  const rows = (data.balances ?? [])
    .map(row => {
      const key = keyForDomain(row.domain);
      const chain: GatewayChain | null = key ? GATEWAY_CHAINS[key] : null;
      return { key, chain, balanceMicro: decimalToMicro(row.balance) };
    })
    .filter(row => row.key && row.chain && isEvmChain(row.chain));

  const preferred = keyForAppKitChain(args.preferredSourceChain);
  const selected =
    (preferred && rows.find(row => row.key === preferred && row.balanceMicro >= amountMicro)) ||
    rows
      .filter(row => row.balanceMicro >= amountMicro)
      .sort((a, b) => {
        if (a.key === 'Arc_Testnet') return -1;
        if (b.key === 'Arc_Testnet') return 1;
        return Number(b.balanceMicro - a.balanceMicro);
      })[0];

  if (!selected?.key) {
    const totalEvm = rows.reduce((sum, row) => sum + row.balanceMicro, 0n);
    throw new Error(
      `Insufficient EVM Gateway USDC. Need ${args.amount}; available EVM Gateway balance is ${(
        Number(totalEvm) / 1_000_000
      ).toFixed(6)}.`
    );
  }

  return { signer: await getOrCreateGatewaySigner(args.tenantId), from: selected.key };
}

export async function materializeGatewayUsdcToArc(args: {
  tenantId: string;
  amount: string;
  recipient?: string;
  preferredSourceChain?: string;
}) {
  const result = await materializeTenantUnifiedUsdToArc({
    tenantId: args.tenantId,
    amount: args.amount,
    recipient: args.recipient,
  });
  return {
    signer: { address: result.signerAddress },
    from: result.allocations?.[0]?.chain ?? null,
    recipient: result.recipient,
    mintHash: result.txHash,
    explorerUrl: result.explorerUrl,
    allocations: result.allocations,
    source: result.source,
  };
}
