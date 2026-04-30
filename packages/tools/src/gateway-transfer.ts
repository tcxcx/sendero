import { z } from 'zod';
import { transferViaGateway, GATEWAY_CHAINS } from '@sendero/circle/gateway';
import { getOrCreateGatewaySigner } from '@sendero/circle/gateway-signer';
import { selectTenantGatewayEvmSource } from './gateway-service';
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
  async handler(input: any, ctx) {
    const selected = ctx?.traveler?.tenantId
      ? input.from
        ? {
            signer: await getOrCreateGatewaySigner(ctx.traveler.tenantId),
            from: input.from,
          }
        : await selectTenantGatewayEvmSource({
            tenantId: ctx.traveler.tenantId,
            amount: input.amount,
          })
      : { signer: null, from: input.from };
    if (!selected.from) {
      return { error: 'from is required when no tenant context is available' };
    }
    const r = await transferViaGateway({
      from: selected.from,
      to: input.to,
      amountUsdc: input.amount,
      recipient: input.recipient,
      signer: selected.signer?.account,
    });
    return {
      state: 'success',
      from: selected.from,
      requestedFrom: input.from ?? null,
      to: input.to,
      amount: input.amount,
      mintHash: r.mintHash,
      explorerUrl: r.explorerUrl,
    };
  },
};
