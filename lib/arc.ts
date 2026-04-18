/**
 * Arc L2 RPC client — Circle's USDC-native chain.
 *
 * Read-only: block height, gas price, tx status, token balances.
 * All writes go through Circle DCW (see circle.ts).
 */

import { createPublicClient, http, type Address, type Hex } from 'viem';
import { env } from './env';

const ERC20_BALANCE_ABI = [
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'decimals',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint8' }],
  },
  {
    name: 'symbol',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'string' }],
  },
] as const;

let cachedClient: ReturnType<typeof createPublicClient> | null = null;

export function getArcClient() {
  if (!cachedClient) {
    cachedClient = createPublicClient({
      transport: http(env.arcRpcUrl()),
      chain: {
        id: env.arcChainId(),
        name: 'Arc Sepolia',
        nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 6 },
        rpcUrls: { default: { http: [env.arcRpcUrl()] } },
      },
    });
  }
  return cachedClient;
}

export interface ArcStatus {
  blockNumber: string;
  gasPrice: string;
  chainId: number;
  rpcUrl: string;
  explorerUrl: string;
}

export async function getArcStatus(): Promise<ArcStatus> {
  const client = getArcClient();
  const [blockNumber, gasPrice] = await Promise.all([
    client.getBlockNumber(),
    client.getGasPrice(),
  ]);
  return {
    blockNumber: blockNumber.toString(),
    gasPrice: gasPrice.toString(),
    chainId: env.arcChainId(),
    rpcUrl: env.arcRpcUrl(),
    explorerUrl: env.arcExplorerUrl(),
  };
}

export async function getErc20Balance(
  tokenAddress: Address,
  wallet: Address,
): Promise<{ amount: string; decimals: number; symbol: string }> {
  const client = getArcClient();

  const readArgs = {
    address: tokenAddress,
    abi: ERC20_BALANCE_ABI,
  } as any;
  const [rawAmount, decimals, symbol] = await Promise.all([
    client.readContract({
      ...readArgs,
      functionName: 'balanceOf',
      args: [wallet],
    }) as Promise<bigint>,
    client.readContract({
      ...readArgs,
      functionName: 'decimals',
    }) as Promise<number>,
    client.readContract({
      ...readArgs,
      functionName: 'symbol',
    }) as Promise<string>,
  ]);

  return {
    amount: formatUnits(rawAmount, Number(decimals)),
    decimals: Number(decimals),
    symbol,
  };
}

export async function getTxStatus(hash: Hex): Promise<{
  status: 'success' | 'reverted' | 'pending';
  blockNumber?: string;
  gasUsed?: string;
}> {
  const client = getArcClient();
  try {
    const receipt = await client.getTransactionReceipt({ hash });
    return {
      status: receipt.status === 'success' ? 'success' : 'reverted',
      blockNumber: receipt.blockNumber.toString(),
      gasUsed: receipt.gasUsed.toString(),
    };
  } catch {
    return { status: 'pending' };
  }
}

function formatUnits(value: bigint, decimals: number): string {
  if (decimals === 0) return value.toString();
  const divisor = 10n ** BigInt(decimals);
  const whole = value / divisor;
  const fraction = value % divisor;
  const fractionStr = fraction.toString().padStart(decimals, '0');
  return `${whole}.${fractionStr}`;
}
