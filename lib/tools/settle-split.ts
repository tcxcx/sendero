import { z } from 'zod';
import { canonicalSplit, settleCommissionSplit } from '../nanopayments';
import type { ToolDef } from './types';

const inputSchema = z.object({
  gross: z.string().describe('Total booking amount in USDC (decimal string).'),
  supplier: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  commissionBps: z.number().int().default(1000),
  senderoFeeBps: z.number().int().default(100),
});

export const settleSplitTool: ToolDef = {
  name: 'settle_split',
  description:
    'Execute a canonical commission fan-out on Arc Testnet in a single batch: gross splits atomically into supplier net + agency commission + Sendero rail + validator tip. Pass gross + supplier address; defaults fill other parties.',
  inputSchema,
  jsonSchema: {
    type: 'object',
    required: ['gross', 'supplier'],
    properties: {
      gross: {
        type: 'string',
        description: 'Total booking amount in USDC (decimal string).',
      },
      supplier: { type: 'string', pattern: '^0x[a-fA-F0-9]{40}$' },
      commissionBps: { type: 'integer', default: 1000 },
      senderoFeeBps: { type: 'integer', default: 100 },
    },
  },
  async handler(input: any) {
    const legs = canonicalSplit({
      gross: input.gross,
      supplier: input.supplier,
      agency:
        (process.env.DEMO_CLIENT_ADDRESS as `0x${string}`) ||
        '0x6a5d2a2e56ed5162f5e29fe1179e59f2b07140e7',
      sendero:
        (process.env.SENDERO_PROVIDER_ADDRESS as `0x${string}`) ||
        '0x2dd43b06e707d45b40790abd5fa6e39403225425',
      validator:
        (process.env.AUX_VALIDATOR_1_ADDRESS as `0x${string}`) ||
        '0x22f7536934d6a00ade239474465b823418dd84bc',
      commissionBps: input.commissionBps ?? 1000,
      senderoFeeBps: input.senderoFeeBps ?? 100,
    });
    return settleCommissionSplit(legs);
  },
};
