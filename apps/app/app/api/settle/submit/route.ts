/**
 * POST /api/settle/submit
 *
 * Step 5 of the ERC-8183 settlement flow: provider submits the deliverable
 * hash (keccak256(pnr)). Called by the frontend AFTER the client's `fund`
 * userOp lands, but BEFORE the client's `complete` + `giveFeedback` userOps.
 *
 * Uses Circle Developer-Controlled Wallets for the provider tx.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { hashDeliverable, submitDeliverable } from '@sendero/arc/jobs';

const BodySchema = z.object({
  jobId: z.string().regex(/^\d+$/, 'jobId must be a decimal string'),
  pnr: z.string().min(1),
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
      { status: 503 }
    );
  }

  try {
    const body = BodySchema.parse(await req.json());
    const deliverableHash = hashDeliverable(body.pnr);
    const { txHash } = await submitDeliverable({
      // Circle DCW signs by walletId UUID, not on-chain address.
      providerWalletAddress: providerWalletId,
      jobId: BigInt(body.jobId),
      deliverableHash,
    });
    return NextResponse.json({
      submitTxHash: txHash,
      deliverableHash,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'invalid_input', issues: err.issues }, { status: 400 });
    }
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: 'submit_failed', message }, { status: 500 });
  }
}
