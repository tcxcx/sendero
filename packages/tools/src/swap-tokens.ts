import { z } from 'zod';
import {
  createAdapterForSigner,
  getAppKit,
  getKitKey,
  getTreasuryAdapter,
  summarizeSwap,
} from '@sendero/circle/app-kit';
import type { SwapParams } from '@circle-fin/app-kit';
import { getOrCreateGatewaySigner } from '@sendero/circle/gateway-signer';
import { materializeGatewayUsdcToArc } from './gateway-service';
import type { ToolDef } from './types';

const inputSchema = z.object({
  fromToken: z.enum(['USDC', 'EURC']),
  toToken: z.enum(['USDC', 'EURC']),
  amount: z.string().describe('Decimal amount, e.g. "5.00"'),
});

export const swapTokensTool: ToolDef = {
  name: 'swap_tokens',
  description:
    'Rebalance the Sendero corporate treasury on Arc Testnet by swapping USDC ↔ EURC via Circle App Kit. Use when the treasury lacks the right token to pay for a booking, or the user explicitly asks to swap. Returns tx hashes.',
  inputSchema,
  jsonSchema: {
    type: 'object',
    required: ['fromToken', 'toToken', 'amount'],
    properties: {
      fromToken: { type: 'string', enum: ['USDC', 'EURC'] },
      toToken: { type: 'string', enum: ['USDC', 'EURC'] },
      amount: { type: 'string', description: 'Decimal amount, e.g. "5.00"' },
    },
  },
  async handler(input: any, ctx) {
    if (input.fromToken === input.toToken) {
      return { error: 'fromToken and toToken must differ' };
    }
    const kit = getAppKit();
    const signer = ctx?.traveler?.tenantId
      ? await getOrCreateGatewaySigner(ctx.traveler.tenantId)
      : null;
    if (ctx?.traveler?.tenantId && input.fromToken === 'USDC') {
      await materializeGatewayUsdcToArc({
        tenantId: ctx.traveler.tenantId,
        amount: input.amount,
        recipient: signer?.address,
      });
    }
    const adapter = signer ? createAdapterForSigner(signer.privateKey) : getTreasuryAdapter();
    const params: SwapParams = {
      from: { adapter, chain: 'Arc_Testnet' },
      tokenIn: input.fromToken,
      tokenOut: input.toToken,
      amountIn: input.amount,
      config: { kitKey: getKitKey() },
    };
    const result = await kit.swap(params);
    const summary = summarizeSwap(result);
    return {
      state: summary.state,
      fromToken: input.fromToken,
      toToken: input.toToken,
      amountIn: result.amountIn,
      amountOut: result.amountOut,
      txHash: summary.txHash,
      explorerUrl: summary.explorerUrl,
    };
  },
};
