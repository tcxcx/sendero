import { z } from 'zod';
import { getAppKit, getTreasuryAdapter, summarizeBridge } from '../../../lib/appkit';
import type { BridgeParams } from '@circle-fin/app-kit';
import { BRIDGE_CHAINS } from '../../../lib/bridge-chains';
import type { ToolDef } from './types';

const inputSchema = z.object({
  fromChain: z.enum(BRIDGE_CHAINS),
  amount: z.string(),
});

export const bridgeToArcTool: ToolDef = {
  name: 'bridge_to_arc',
  description:
    'Bridge USDC from any App Kit–supported chain INTO Arc Testnet via Circle CCTP. Use when Arc treasury liquidity is low. Supports EVM chains (Ethereum, Base, Polygon, Avalanche, Arbitrum, Optimism, Unichain, Linea, etc.) plus Solana — mainnet and testnet variants (see BRIDGE_CHAINS for the full list).',
  inputSchema,
  jsonSchema: {
    type: 'object',
    required: ['fromChain', 'amount'],
    properties: {
      fromChain: {
        type: 'string',
        enum: BRIDGE_CHAINS as unknown as string[],
      },
      amount: { type: 'string' },
    },
  },
  async handler(input: any) {
    const kit = getAppKit();
    const adapter = getTreasuryAdapter();
    const params: BridgeParams = {
      from: { adapter, chain: input.fromChain },
      to: { adapter, chain: 'Arc_Testnet' },
      amount: input.amount,
    };
    const result = await kit.bridge(params);
    const summary = summarizeBridge(result);
    return {
      state: summary.state,
      fromChain: input.fromChain,
      toChain: 'Arc_Testnet',
      amount: input.amount,
      txHash: summary.txHash,
      explorerUrl: summary.explorerUrl,
      stepCount: summary.steps.length,
    };
  },
};
