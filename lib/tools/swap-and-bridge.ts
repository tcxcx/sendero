import { z } from 'zod';
import {
  getAppKit,
  getKitKey,
  getTreasuryAdapter,
  summarizeBridge,
  summarizeSwap,
} from '../appkit';
import type { BridgeParams, SwapParams } from '@circle-fin/app-kit';
import { BRIDGE_CHAINS } from '../bridge-chains';
import type { ToolDef } from './types';

const inputSchema = z.object({
  fromChain: z.enum(BRIDGE_CHAINS),
  amount: z.string().describe('USDC amount to bridge and swap, e.g. "5.00"'),
  targetToken: z.enum(['USDC', 'EURC']).default('EURC'),
});

export const swapAndBridgeTool: ToolDef = {
  name: 'swap_and_bridge',
  description:
    'Composed workflow: CCTP-bridge USDC from a source chain INTO Arc Testnet, then swap to EURC on Arc. Use when a booking needs EURC but treasury only has USDC on another chain. Returns both step receipts.',
  inputSchema,
  jsonSchema: {
    type: 'object',
    required: ['fromChain', 'amount'],
    properties: {
      fromChain: {
        type: 'string',
        enum: BRIDGE_CHAINS as unknown as string[],
      },
      amount: {
        type: 'string',
        description: 'USDC amount to bridge and swap, e.g. "5.00"',
      },
      targetToken: {
        type: 'string',
        enum: ['USDC', 'EURC'],
        default: 'EURC',
      },
    },
  },
  async handler(input: any) {
    const kit = getAppKit();
    const adapter = getTreasuryAdapter();

    const bridgeParams: BridgeParams = {
      from: { adapter, chain: input.fromChain },
      to: { adapter, chain: 'Arc_Testnet' },
      amount: input.amount,
    };
    const bridgeResult = await kit.bridge(bridgeParams);
    const bridgeSummary = summarizeBridge(bridgeResult);

    if (input.targetToken === 'USDC') {
      return {
        state: bridgeSummary.state,
        fromChain: input.fromChain,
        toChain: 'Arc_Testnet',
        amount: input.amount,
        targetToken: input.targetToken,
        bridge: bridgeSummary,
        swap: null,
        txHash: bridgeSummary.txHash,
        explorerUrl: bridgeSummary.explorerUrl,
      };
    }

    const swapParams: SwapParams = {
      from: { adapter, chain: 'Arc_Testnet' },
      tokenIn: 'USDC',
      tokenOut: input.targetToken,
      amountIn: input.amount,
      config: { kitKey: getKitKey() },
    };
    const swapResult = await kit.swap(swapParams);
    const swapSummary = summarizeSwap(swapResult);

    return {
      state:
        bridgeSummary.state === 'success' && swapSummary.state === 'success'
          ? 'success'
          : `bridge=${bridgeSummary.state}|swap=${swapSummary.state}`,
      fromChain: input.fromChain,
      toChain: 'Arc_Testnet',
      amount: input.amount,
      targetToken: input.targetToken,
      bridge: bridgeSummary,
      swap: swapSummary,
      txHash: swapSummary.txHash || bridgeSummary.txHash,
      explorerUrl: swapSummary.explorerUrl || bridgeSummary.explorerUrl,
      amountOut: swapResult.amountOut,
    };
  },
};
