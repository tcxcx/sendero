import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { GATEWAY_CHAINS, transferViaGateway } from '@/lib/gateway';
import { env } from '@/lib/env';

/**
 * POST /api/gateway/transfer
 * Burn USDC on any source Gateway chain, mint on any destination
 * Gateway chain in under a second via the Circle Gateway API.
 * Body: { from: chainKey, to: chainKey, amount: decimal, recipient?: 0x… }
 */
const BodySchema = z.object({
  from: z.enum(Object.keys(GATEWAY_CHAINS) as [string, ...string[]]),
  to: z.enum(Object.keys(GATEWAY_CHAINS) as [string, ...string[]]),
  amount: z.string().regex(/^\d+(\.\d{1,6})?$/),
  recipient: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/)
    .optional(),
});

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  if (!env.treasuryPrivateKey()) {
    return NextResponse.json(
      {
        error: 'treasury_not_configured',
        message: 'TREASURY_PRIVATE_KEY required for Gateway.',
      },
      { status: 503 },
    );
  }
  try {
    const body = BodySchema.parse(await req.json());
    if (body.from === body.to) {
      return NextResponse.json(
        {
          error: 'invalid_input',
          message: 'from and to must differ.',
        },
        { status: 400 },
      );
    }
    const result = await transferViaGateway({
      from: body.from as keyof typeof GATEWAY_CHAINS,
      to: body.to as keyof typeof GATEWAY_CHAINS,
      amountUsdc: body.amount,
      recipient: body.recipient as `0x${string}` | undefined,
    });
    return NextResponse.json({
      state: 'success',
      from: body.from,
      to: body.to,
      amount: body.amount,
      recipient: body.recipient ?? null,
      mintHash: result.mintHash,
      explorerUrl: result.explorerUrl,
      burnSignature: result.burnSignature,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'invalid_input', issues: err.issues },
        { status: 400 },
      );
    }
    const detail = err instanceof Error ? err.message : String(err);
    console.error('[gateway/transfer] error:', detail);
    return NextResponse.json(
      { error: 'gateway_transfer_failed', message: detail },
      { status: 500 },
    );
  }
}
