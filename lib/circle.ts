/**
 * Circle Developer-Controlled Wallets client.
 *
 * Treasury-side operations: check USDC/EURC balances, initiate transfers,
 * fund the Duffel Balance via CCTP v2 on Arc L2.
 */

import { initiateDeveloperControlledWalletsClient } from '@circle-fin/developer-controlled-wallets';
import { env } from './env';

type CircleClient = ReturnType<typeof initiateDeveloperControlledWalletsClient>;

let client: CircleClient | null = null;

export function getCircle(): CircleClient {
  if (!client) {
    const apiKey = env.circleApiKey();
    const entitySecret = env.circleEntitySecret();
    if (!apiKey || !entitySecret) {
      throw new Error(
        'Circle credentials missing. Set CIRCLE_API_KEY + CIRCLE_ENTITY_SECRET in .env.local',
      );
    }
    client = initiateDeveloperControlledWalletsClient({
      apiKey,
      entitySecret,
    });
  }
  return client;
}

export interface TokenBalance {
  symbol: string;
  amount: string;
  decimals: number;
  tokenAddress?: string;
  chain: string;
}

export async function getTreasuryBalances(): Promise<TokenBalance[]> {
  const walletId = env.circleTreasuryWalletId();
  if (!walletId) {
    throw new Error('CIRCLE_TREASURY_WALLET_ID not set');
  }

  const circle = getCircle();
  const response = await circle.getWalletTokenBalance({ id: walletId });
  const balances = (response.data as any)?.tokenBalances || [];

  return balances.map((b: any) => ({
    symbol: b.token?.symbol || 'UNKNOWN',
    amount: b.amount || '0',
    decimals: b.token?.decimals || 6,
    tokenAddress: b.token?.tokenAddress,
    chain: b.token?.blockchain || 'ARC',
  }));
}

export interface TransferParams {
  destinationAddress: string;
  amount: string;
  tokenId: string;
  refId?: string;
}

export async function transferUSDC(
  params: TransferParams,
): Promise<{ transactionId: string; state: string }> {
  const walletId = env.circleTreasuryWalletId();
  if (!walletId) {
    throw new Error('CIRCLE_TREASURY_WALLET_ID not set');
  }

  const circle = getCircle();
  const response = await circle.createTransaction({
    walletId,
    tokenId: params.tokenId,
    destinationAddress: params.destinationAddress,
    amount: [params.amount],
    fee: {
      type: 'level',
      config: { feeLevel: 'MEDIUM' as any },
    },
    refId: params.refId,
  } as any);

  return {
    transactionId: (response.data as any)?.id || '',
    state: (response.data as any)?.state || 'INITIATED',
  };
}

export async function getTransaction(transactionId: string) {
  const circle = getCircle();
  const response = await circle.getTransaction({ id: transactionId });
  return response.data;
}
