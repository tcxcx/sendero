/**
 * sweep_dcw_to_gateway — manual recovery for USDC stranded at a
 * traveler's Circle DCW on a chain where Sendero never registered
 * the Wallet row with Circle.
 *
 * Why this exists: Circle DCW addresses are deterministic across all
 * EVM chains. We provision DCW Wallet rows on Arc Testnet (canonical
 * settlement chain) + Solana Devnet — but NOT on every Gateway chain.
 * MoonPay sandbox forces Sepolia (their test catalog only has plain
 * `usdc` ERC-20 on Ethereum / Sepolia substituted by MoonPayToken).
 * Funds land at the same `0x...` address but Circle has no wallet
 * registered there → no `transactions.inbound` webhook fires → the
 * auto-deposit-to-Gateway flow never runs.
 *
 * This tool calls `depositTravelerToGateway` directly with
 * `triggeredBy: 'manual'` so the audit row reflects that this was a
 * recovery sweep, not a regular auto-sweep. Pass the chainKey + the
 * actual on-chain amount (the traveler can read it off MoonPay's
 * confirmation; we don't query the chain ourselves to keep this tool
 * fast).
 *
 * Companion to the proper fix (extending `ensureTravelerWallet` to
 * register Wallet rows on every Gateway EVM chain at provision time)
 * — that's a one-time backfill; this tool stays useful for the
 * inevitable edge cases (MoonPay adds a new chain we haven't
 * provisioned, prod migration in flight, etc.).
 */

import { z } from 'zod';

import { prisma } from '@sendero/database';
import { depositTravelerToGateway, GATEWAY_CHAINS, type GatewayChainKey } from '@sendero/circle';

import { ensureTravelerWallet } from './ensure-traveler-wallet';
import type { ToolContext, ToolDef } from './types';

const inputSchema = z.object({
  chainKey: z.string().describe('Gateway chain key, e.g. Eth_Sepolia, Arc_Testnet, Base_Sepolia.'),
  amount: z
    .string()
    .regex(/^\d+(\.\d{1,6})?$/, 'amount must be a USDC decimal (e.g. "21.43").')
    .describe('Human-readable USDC amount sitting at the DCW (e.g. "21.43").'),
});

export type SweepDcwToGatewayInput = z.infer<typeof inputSchema>;

export interface SweepDcwToGatewayResult {
  status: 'ok' | 'no_traveler' | 'unknown_chain' | 'no_dcw' | 'failed';
  message?: string;
  chainKey?: string;
  dcwAddress?: string;
  amount?: string;
  depositTxHash?: string;
  depositLogId?: string;
}

export async function sweepDcwToGateway(
  input: SweepDcwToGatewayInput,
  ctx?: ToolContext
): Promise<SweepDcwToGatewayResult> {
  const tenantId = ctx?.traveler?.tenantId;
  const userId = ctx?.traveler?.userId;
  if (!tenantId || !userId || userId.startsWith('svc:')) {
    return {
      status: 'no_traveler',
      message: 'Pass `travelerPhone` on `call_sendero` so I know whose DCW to sweep from.',
    };
  }

  const chainKey = input.chainKey as GatewayChainKey;
  const chain = GATEWAY_CHAINS[chainKey];
  if (!chain) {
    return {
      status: 'unknown_chain',
      message: `Unknown chain: ${input.chainKey}. Valid keys: ${Object.keys(GATEWAY_CHAINS).join(', ')}.`,
    };
  }

  // Self-heal — make sure the traveler has Wallet rows on all
  // Gateway EVM chains. ensureTravelerWallet is idempotent and the
  // cache-hit path it runs internally will provision missing chains
  // (Sepolia / Base / etc.) without touching Arc. Without this, the
  // sweep finds the Arc DCW row but Circle's underlying wallet
  // registration on the target chain is missing → reads 0 balance →
  // "Insufficient USDC balance" error even when funds are on-chain.
  await ensureTravelerWallet({ userId }).catch(err => {
    console.warn('[sweep_dcw_to_gateway] ensureTravelerWallet failed (non-fatal)', {
      userId,
      error: err instanceof Error ? err.message : String(err),
    });
  });

  // The traveler's EVM DCW address is deterministic across all EVM
  // chains. Pull whichever Wallet row we have for this specific chain.
  // Solana is its own kind so we pull the Solana DCW separately when
  // sweeping a Solana chain.
  const isSolana = chain.kind === 'solana';
  const SOL_DEVNET_CHAIN_ID = 5;

  // Prefer the row matching the requested chainId so Circle's wallet
  // registration on the target chain is what we sweep against. Fall
  // back to any DCW row (deterministic address) when the per-chain
  // row hasn't propagated yet — at minimum we know the address.
  const targetChainId =
    chain.kind === 'evm'
      ? (chain as { viemChain: { id: number } }).viemChain.id
      : SOL_DEVNET_CHAIN_ID;
  let dcw = await prisma.wallet.findFirst({
    where: { userId, provisioner: 'dcw', chainId: targetChainId },
    select: { address: true },
  });
  if (!dcw) {
    dcw = await prisma.wallet.findFirst({
      where: isSolana
        ? { userId, provisioner: 'dcw', chainId: SOL_DEVNET_CHAIN_ID }
        : { userId, provisioner: 'dcw', NOT: { chainId: SOL_DEVNET_CHAIN_ID } },
      orderBy: { createdAt: 'asc' },
      select: { address: true },
    });
  }
  if (!dcw?.address) {
    return {
      status: 'no_dcw',
      message: `No ${isSolana ? 'Solana' : 'EVM'} DCW provisioned for this traveler. Run the resolver via a fresh inbound first.`,
    };
  }

  // Compute base units (10^6 USDC) for the audit log.
  const cleaned = input.amount.replace(/[^0-9.]/g, '');
  const [whole, frac = ''] = cleaned.split('.');
  const fracPadded = (frac + '000000').slice(0, 6);
  const amountBaseUnits = BigInt(whole + fracPadded);

  try {
    const result = await depositTravelerToGateway({
      userId,
      tenantId,
      chainKey,
      dcwAddress: dcw.address,
      amount: input.amount,
      amountBaseUnits,
      triggeredBy: 'manual',
      // No webhookEventId — manual sweep produces a fresh audit row.
    });

    if (result.status === 'failed') {
      return {
        status: 'failed',
        message: result.error ?? 'Deposit failed for unknown reason.',
        chainKey,
        dcwAddress: dcw.address,
        amount: input.amount,
        depositLogId: result.depositLogId,
      };
    }

    return {
      status: 'ok',
      message:
        result.status === 'already-processed'
          ? `${input.amount} USDC was already swept from ${chainKey} previously. Unified balance reflects it.`
          : `Swept ${input.amount} USDC from ${chainKey} → Gateway. Unified balance updates within ~10s.`,
      chainKey,
      dcwAddress: dcw.address,
      amount: input.amount,
      ...(result.depositTxHash ? { depositTxHash: result.depositTxHash } : {}),
      depositLogId: result.depositLogId,
    };
  } catch (err) {
    return {
      status: 'failed',
      message: err instanceof Error ? err.message : String(err),
      chainKey,
      dcwAddress: dcw.address,
      amount: input.amount,
    };
  }
}

export const sweepDcwToGatewayTool: ToolDef<SweepDcwToGatewayInput, SweepDcwToGatewayResult> = {
  name: 'sweep_dcw_to_gateway',
  description:
    "Manual recovery sweep — push USDC sitting at the traveler's Circle DCW on a specific chain into their Gateway unified balance. Use this when MoonPay sandbox lands funds on Sepolia (or any Gateway chain we haven't pre-registered the DCW Wallet row on), so the auto-webhook flow never fires. Caller passes `chainKey` + `amount`. Returns the deposit tx hash; unified balance updates within ~10s.",
  inputSchema,
  jsonSchema: {
    type: 'object',
    required: ['chainKey', 'amount'],
    properties: {
      chainKey: {
        type: 'string',
        description:
          'Gateway chain key — Arc_Testnet, Ethereum_Sepolia, Base_Sepolia, Avalanche_Fuji, Optimism_Sepolia, Arbitrum_Sepolia, Polygon_Amoy, Sol_Devnet.',
      },
      amount: {
        type: 'string',
        description:
          'Human-readable USDC amount (e.g. "21.43"). Caller reads from MoonPay confirmation.',
      },
    },
  },
  async handler(input, ctx) {
    return sweepDcwToGateway(input, ctx);
  },
};
