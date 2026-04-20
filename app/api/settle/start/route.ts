/**
 * POST /api/settle/start
 *
 * Step 2 of the ERC-8183 settlement flow: provider pins the job budget.
 * Called by the frontend AFTER the client's `createJob` userOp lands, but
 * BEFORE the client's `approve` + `fund` userOps.
 *
 * Uses Circle Developer-Controlled Wallets for the provider tx.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { setBudget, toUsdcUnits } from '@/lib/arc-jobs';

const BodySchema = z.object({
  jobId: z.string().regex(/^\d+$/, 'jobId must be a decimal string'),
  totalAmountUsdc: z
    .string()
    .regex(/^\d+(\.\d+)?$/, 'totalAmountUsdc must be a decimal string'),
});

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const providerWalletId = process.env.SENDERO_PROVIDER_WALLET_ID;
  const providerAddress = process.env.SENDERO_PROVIDER_ADDRESS;
  if (!providerWalletId || !providerAddress) {
    return NextResponse.json(
      {
        error: 'provider_not_configured',
        message:
          'Set SENDERO_PROVIDER_WALLET_ID and SENDERO_PROVIDER_ADDRESS in .env.local (run scripts/bootstrap-agent.ts).',
      },
      { status: 503 },
    );
  }

  try {
    const body = BodySchema.parse(await req.json());
    const { txHash } = await setBudget({
      providerWalletAddress: providerAddress,
      jobId: BigInt(body.jobId),
      amount: toUsdcUnits(body.totalAmountUsdc),
    });
    return NextResponse.json({ budgetTxHash: txHash });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'invalid_input', issues: err.issues },
        { status: 400 },
      );
    }
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: 'set_budget_failed', message },
      { status: 500 },
    );
  }
}
