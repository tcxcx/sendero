/**
 * `get_moonpay_topup_status` — read recent MoonPay top-ups for the
 * resolved traveler so the agent can answer "did my deposit go
 * through?" without bouncing the user to /me/wallet.
 *
 * Bound to `ctx.traveler.userId` server-side — there is no input field
 * for `userId`, so a malicious LLM can't read another traveler's
 * top-ups by passing a different id.
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
    .describe('How many recent top-ups to return (newest first).'),
});

type Input = z.infer<typeof inputSchema>;

interface TopUpSummary {
  id: string;
  amountUsd: string;
  currencyCode: string;
  status: string;
  failureReason: string | null;
  cryptoTransactionHash: string | null;
  walletAddress: string;
  createdAt: string;
  completedAt: string | null;
}

export const getMoonpayTopupStatusTool: ToolDef<Input> = {
  name: 'get_moonpay_topup_status',
  description:
    "Return the resolved traveler's most recent MoonPay top-ups with status (pending / waitingPayment / completed / failed / abandoned). Use this when the traveler asks 'did my deposit go through?' or after they tap a checkout link, to confirm completion before retrying a booking.",
  inputSchema,
  jsonSchema: {
    type: 'object',
    properties: {
      limit: {
        type: 'integer',
        default: 5,
        minimum: 1,
        maximum: 20,
        description: 'How many recent top-ups to return (newest first).',
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

    const rows = await prisma.moonPayTopUp.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: input.limit,
      select: {
        id: true,
        baseCurrencyAmount: true,
        cryptoCurrencyCode: true,
        status: true,
        failureReason: true,
        cryptoTransactionHash: true,
        walletAddress: true,
        createdAt: true,
        completedAt: true,
      },
    });

    const topups: TopUpSummary[] = rows.map(r => ({
      id: r.id,
      amountUsd: r.baseCurrencyAmount.toFixed(2),
      currencyCode: r.cryptoCurrencyCode,
      status: r.status,
      failureReason: r.failureReason,
      cryptoTransactionHash: r.cryptoTransactionHash,
      walletAddress: r.walletAddress,
      createdAt: r.createdAt.toISOString(),
      completedAt: r.completedAt?.toISOString() ?? null,
    }));

    const newest = topups[0] ?? null;
    const summary = newest
      ? `Most recent: *${newest.amountUsd} USD* via ${newest.currencyCode} → \`${newest.status}\`${newest.cryptoTransactionHash ? ` (tx ${newest.cryptoTransactionHash.slice(0, 10)}…)` : ''}.`
      : 'No MoonPay top-ups on file for this traveler yet.';

    return {
      status: 'ok',
      count: topups.length,
      newest,
      topups,
      message: summary,
    };
  },
};
