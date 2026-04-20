import { z } from 'zod';
import { getTreasuryBalances } from '../../../lib/circle';
import type { ToolDef } from './types';

export const checkTreasuryTool: ToolDef = {
  name: 'check_treasury',
  description:
    "Check Circle treasury USDC/EURC balance on Arc. Use when the user asks about funds.",
  inputSchema: z.object({}),
  jsonSchema: { type: 'object', properties: {} },
  async handler() {
    const balances = await getTreasuryBalances();
    return { balances };
  },
};
