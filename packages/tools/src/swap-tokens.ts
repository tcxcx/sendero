import { z } from 'zod';
import {
  getAppKit,
  getKitKey,
  getTreasuryAdapter,
  summarizeSwap,
} from '../../../lib/appkit';
import type { SwapParams } from '@circle-fin/app-kit';
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
  async handler(input: any) {
    if (input.fromToken === input.toToken) {
      return { error: 'fromToken and toToken must differ' };
    }
    const kit = getAppKit();
    const adapter = getTreasuryAdapter();
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
