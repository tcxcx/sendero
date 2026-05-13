import { GATEWAY_CHAINS } from '@sendero/circle/gateway';
import { spendTenantUnifiedUsd } from '@sendero/circle/unified-balance';
import { z } from 'zod';

import type { ToolDef } from './types';

const GATEWAY_CHAIN_KEYS = Object.keys(GATEWAY_CHAINS);

const inputSchema = z.object({
  from: z.string().optional(),
  to: z.string(),
  amount: z.string().describe('Decimal USDC amount, e.g. "5.00"'),
  recipient: z.string().optional().describe('0x-address on destination (defaults to treasury)'),
});

export const gatewayTransferTool: ToolDef = {
  name: 'gateway_transfer',
  description:
    'Pull USDC from any Gateway-supported chain and mint it on Arc Testnet (or any other Gateway chain) in sub-500ms. Server signs the burn intent, Circle attests, destination mints. Use when Arc liquidity is short.',
  inputSchema,
  jsonSchema: {
    type: 'object',
    required: ['to', 'amount'],
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
  async handler(input: z.infer<typeof inputSchema>, ctx) {
    if (!ctx?.traveler?.tenantId) {
      return { error: 'tenant context is required for unified-balance spending' };
    }
    const r = await spendTenantUnifiedUsd({
      tenantId: ctx.traveler.tenantId,
      amount: input.amount,
      destinationChain: input.to,
      recipient: input.recipient,
      journalContextRef: `gateway-transfer:${ctx.traveler.tenantId}:${input.to}:${input.recipient ?? 'self'}:${input.amount}`,
      journalContextKind: input.from && input.from !== input.to ? 'bridge' : 'spend',
    });
    return {
      state: 'success',
      from: r.allocations?.[0]?.chain ?? null,
      allocations: r.allocations,
      requestedFrom: input.from ?? null,
      to: input.to,
      amount: input.amount,
      mintHash: r.txHash,
      explorerUrl: r.explorerUrl,
      source: r.source,
    };
  },
};
