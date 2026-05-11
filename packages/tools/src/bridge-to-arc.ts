import { z } from 'zod';
import { getAppKit, getTreasuryAdapter, summarizeBridge } from '@sendero/circle/app-kit';
import type { BridgeParams } from '@circle-fin/app-kit';
import { BRIDGE_CHAINS } from '@sendero/arc/bridge-chains';
import { prisma } from '@sendero/database';
import { materializeGatewayUsdcToArc } from './gateway-service';
import type { ToolDef } from './types';

const inputSchema = z.object({
  fromChain: z.enum(BRIDGE_CHAINS),
  amount: z.string(),
});

export const bridgeToArcTool: ToolDef = {
  name: 'bridge_to_arc',
  description:
    'Bridge USDC from any App Kit–supported chain INTO Arc Testnet via Circle CCTP. Use when Arc treasury liquidity is low. Supports EVM chains (Ethereum, Base, Polygon, Avalanche, Arbitrum, Optimism, Unichain, Linea, etc.) plus Solana — mainnet and testnet variants (see BRIDGE_CHAINS for the full list). Only available for Arc-primary tenants — Solana tenants must use a Sol-side bridge (deferred).',
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
  async handler(input: any, ctx) {
    // Sol tenants get a typed deferred error rather than silently
    // bridging USDC into the wrong chain. Mirrors the
    // GIVE_FEEDBACK_SOL_DEFERRED pattern from CLAUDE.md.
    if (ctx?.traveler?.tenantId) {
      const tenant = await prisma.tenant.findUnique({
        where: { id: ctx.traveler.tenantId },
        select: { primaryChain: true },
      });
      if (tenant?.primaryChain === 'sol') {
        return {
          state: 'deferred',
          code: 'BRIDGE_TO_ARC_SOL_DEFERRED',
          message:
            'This tenant settles on Solana. Bridging USDC into Arc would strand funds outside the tenant treasury. The Solana-side bridge (`bridge_to_sol`) ships once Circle CCTP-V2 routes are wired into the Squads V4 vault flow.',
          agentInstruction:
            'Acknowledge that bridge_to_arc is deferred for Solana tenants. Route the user to request human assistance via request_human_handoff if they need cross-chain liquidity now.',
        };
      }
      const result = await materializeGatewayUsdcToArc({
        tenantId: ctx.traveler.tenantId,
        amount: input.amount,
        preferredSourceChain: input.fromChain,
      });
      return {
        state: 'success',
        fromChain: result.from,
        requestedFromChain: input.fromChain,
        toChain: 'Arc_Testnet',
        amount: input.amount,
        txHash: result.mintHash,
        explorerUrl: result.explorerUrl,
        stepCount: 1,
        source: 'gateway',
      };
    }
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
