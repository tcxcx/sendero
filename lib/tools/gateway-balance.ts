import { z } from 'zod';
import { queryUnifiedBalance } from '../gateway';
import type { ToolDef } from './types';

export const gatewayBalanceTool: ToolDef = {
  name: 'gateway_balance',
  description:
    'Return the treasury USDC unified balance across every Gateway-supported testnet (Arc, Ethereum Sepolia, Base Sepolia, Avalanche Fuji, etc.). Fast — queries Circle Gateway API.',
  inputSchema: z.object({}),
  jsonSchema: { type: 'object', properties: {} },
  async handler() {
    return queryUnifiedBalance();
  },
};
