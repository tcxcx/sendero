/**
 * `get_moonpay_offramp_status` — read recent MoonPay sell (cash-out)
 * attempts for the resolved traveler. Bound to `ctx.traveler.userId`
 * server-side so the agent can't read another traveler's history.
 */

import { z } from 'zod';

import { prisma } from '@sendero/database';

import type { ToolContext, ToolDef } from './types';

const inputSchema = z.object({
  limit: z
    .number()
    .int()
    .min(1)
    .max(20)
    .default(5)
    .describe('How many recent off-ramps to return (newest first).'),
});

type Input = z.infer<typeof inputSchema>;

interface OffRampSummary {
  id: string;
  amountUsdc: string;
  currencyCode: string;
  quoteAmountUsd: string | null;
  status: string;
  failureReason: string | null;
  cryptoTransactionHash: string | null;
  refundWalletAddress: string;
  createdAt: string;
  completedAt: string | null;
}

export const getMoonpayOfframpStatusTool: ToolDef<Input> = {
  name: 'get_moonpay_offramp_status',
  description:
    "Return the resolved traveler's most recent MoonPay off-ramps with status (pending / waitingForDeposit / completed / failed / abandoned). Use this when the traveler asks 'did my cash-out go through?' or after they tap a sell-widget link.",
  inputSchema,
  jsonSchema: {
    type: 'object',
    properties: {
      limit: {
        type: 'integer',
        default: 5,
        minimum: 1,
        maximum: 20,
        description: 'How many recent off-ramps to return (newest first).',
      },
    },
  },
  async handler(input: Input, ctx?: ToolContext) {
    const userId = ctx?.traveler?.userId;
    if (!userId || userId.startsWith('svc:')) {
      return {
        status: 'no_traveler',
        message:
          'No resolved traveler on this turn. Pass `travelerPhone` on `call_sendero` so the resolver can stamp a real user id.',
      };
    }

    const rows = await prisma.moonPayOffRamp.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: input.limit,
      select: {
        id: true,
        baseCurrencyAmount: true,
        baseCurrencyCode: true,
        quoteCurrencyAmount: true,
        status: true,
        failureReason: true,
        cryptoTransactionHash: true,
        refundWalletAddress: true,
        createdAt: true,
        completedAt: true,
      },
    });

    const offramps: OffRampSummary[] = rows.map(r => ({
      id: r.id,
      amountUsdc: r.baseCurrencyAmount.toFixed(2),
      currencyCode: r.baseCurrencyCode,
      quoteAmountUsd: r.quoteCurrencyAmount?.toFixed(2) ?? null,
      status: r.status,
      failureReason: r.failureReason,
      cryptoTransactionHash: r.cryptoTransactionHash,
      refundWalletAddress: r.refundWalletAddress,
      createdAt: r.createdAt.toISOString(),
      completedAt: r.completedAt?.toISOString() ?? null,
    }));

    const newest = offramps[0] ?? null;
    const summary = newest
      ? `Most recent: *${newest.amountUsdc} ${newest.currencyCode.toUpperCase()}* → \`${newest.status}\`${newest.quoteAmountUsd ? ` (${newest.quoteAmountUsd} USD payout)` : ''}.`
      : 'No MoonPay off-ramps on file for this traveler yet.';

    return {
      status: 'ok',
      count: offramps.length,
      newest,
      offramps,
      message: summary,
    };
  },
};
