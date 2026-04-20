import { z } from 'zod';
import { transferViaGateway, GATEWAY_CHAINS } from '../../../lib/gateway';
import type { ToolDef } from './types';

const GATEWAY_CHAIN_KEYS = Object.keys(GATEWAY_CHAINS);

const inputSchema = z.object({
  from: z.string(),
  to: z.string(),
  amount: z.string().describe('Decimal USDC amount, e.g. "5.00"'),
  recipient: z
    .string()
    .optional()
    .describe('0x-address on destination (defaults to treasury)'),
});

export const gatewayTransferTool: ToolDef = {
  name: 'gateway_transfer',
  description:
    'Pull USDC from any Gateway-supported chain and mint it on Arc Testnet (or any other Gateway chain) in sub-500ms. Server signs the burn intent, Circle attests, destination mints. Use when Arc liquidity is short.',
  inputSchema,
  jsonSchema: {
    type: 'object',
    required: ['from', 'to', 'amount'],
    properties: {
      from: {
        type: 'string',
        enum: GATEWAY_CHAIN_KEYS,
        description: 'Source chain key',
      },
      to: {
        type: 'string',
        enum: GATEWAY_CHAIN_KEYS,
        description: 'Destination chain key (usually Arc_Testnet)',
      },
      amount: {
        type: 'string',
        description: 'Decimal USDC amount, e.g. "5.00"',
      },
      recipient: {
        type: 'string',
        description: '0x-address on destination (defaults to treasury)',
      },
    },
  },
  async handler(input: any) {
    if (input.from === input.to) return { error: 'from and to must differ' };
    const r = await transferViaGateway({
      from: input.from,
      to: input.to,
      amountUsdc: input.amount,
      recipient: input.recipient,
    });
    return {
      state: 'success',
      from: input.from,
      to: input.to,
      amount: input.amount,
      mintHash: r.mintHash,
      explorerUrl: r.explorerUrl,
    };
  },
};
