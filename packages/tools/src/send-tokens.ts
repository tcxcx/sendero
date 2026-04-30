import { z } from 'zod';
import { getAppKit, getTreasuryAdapter, summarizeSend } from '@sendero/circle/app-kit';
import type { SendParams } from '@circle-fin/app-kit';
import { materializeGatewayUsdcToArc } from './gateway-service';
import type { ToolDef } from './types';

const inputSchema = z.object({
  to: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'must be a 0x-prefixed address'),
  amount: z.string(),
  token: z.enum(['USDC', 'EURC']).default('USDC'),
});

export const sendTokensTool: ToolDef = {
  name: 'send_tokens',
  description:
    'Transfer USDC or EURC from the Sendero corporate treasury to any Arc Testnet address. Use when rebalancing or topping up the user wallet.',
  inputSchema,
  jsonSchema: {
    type: 'object',
    required: ['to', 'amount'],
    properties: {
      to: { type: 'string', pattern: '^0x[a-fA-F0-9]{40}$' },
      amount: { type: 'string' },
      token: { type: 'string', enum: ['USDC', 'EURC'], default: 'USDC' },
    },
  },
  async handler(input: any, ctx) {
    if ((input.token ?? 'USDC') === 'USDC' && ctx?.traveler?.tenantId) {
      const result = await materializeGatewayUsdcToArc({
        tenantId: ctx.traveler.tenantId,
        amount: input.amount,
        recipient: input.to,
      });
      return {
        state: 'success',
        token: 'USDC',
        amount: input.amount,
        to: input.to,
        txHash: result.mintHash,
        explorerUrl: result.explorerUrl,
        source: 'gateway',
        sourceChain: result.from,
      };
    }
    const kit = getAppKit();
    const adapter = getTreasuryAdapter();
    const params: SendParams = {
      from: { adapter, chain: 'Arc_Testnet' },
      to: input.to,
      amount: input.amount,
      token: input.token ?? 'USDC',
    };
    const result = await kit.send(params);
    const summary = summarizeSend(result);
    return {
      state: summary.state,
      token: input.token ?? 'USDC',
      amount: input.amount,
      to: input.to,
      txHash: summary.txHash,
      explorerUrl: summary.explorerUrl,
    };
  },
};
