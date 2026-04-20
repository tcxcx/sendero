import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { canonicalSplit, settleCommissionSplit } from '@sendero/nanopayments';
import { env } from '@sendero/env';

/**
 * POST /api/settle/split
 * Execute a canonical commission fan-out on Arc Testnet.
 *
 * Two modes:
 *   (a) pass `gross` + `supplier` (+ optional agency/validator) and the
 *       route derives 4 legs via canonicalSplit.
 *   (b) pass `legs: [{to, amount, label}]` directly for a custom split.
 */
const CanonicalBody = z.object({
  gross: z.string().regex(/^\d+(\.\d{1,6})?$/),
  supplier: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  agency: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/)
    .optional(),
  sendero: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/)
    .optional(),
  validator: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/)
    .optional(),
  commissionBps: z.number().int().min(0).max(5000).optional(),
  senderoFeeBps: z.number().int().min(0).max(1000).optional(),
});

const CustomBody = z.object({
  legs: z
    .array(
      z.object({
        to: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
        amount: z.string().regex(/^\d+(\.\d{1,6})?$/),
        label: z.string().min(1),
      })
    )
    .min(1)
    .max(10),
});

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  if (!env.treasuryPrivateKey()) {
    return NextResponse.json(
      {
        error: 'treasury_not_configured',
        message: 'TREASURY_PRIVATE_KEY required.',
      },
      { status: 503 }
    );
  }

  try {
    const raw = await req.json();

    // Fallback defaults for agency/sendero/validator — reuse demo
    // wallets from env so the demo works without supplying 4 addresses.
    const providerAddr =
      process.env.SENDERO_PROVIDER_ADDRESS || '0x2dd43b06e707d45b40790abd5fa6e39403225425';
    const validatorAddr =
      process.env.AUX_VALIDATOR_1_ADDRESS || '0x22f7536934d6a00ade239474465b823418dd84bc';
    const agencyAddr =
      process.env.DEMO_CLIENT_ADDRESS || '0x6a5d2a2e56ed5162f5e29fe1179e59f2b07140e7';

    let legs;
    if ('legs' in (raw ?? {})) {
      legs = CustomBody.parse(raw).legs;
    } else {
      const body = CanonicalBody.parse(raw);
      legs = canonicalSplit({
        gross: body.gross,
        supplier: body.supplier as `0x${string}`,
        agency: (body.agency ?? agencyAddr) as `0x${string}`,
        sendero: (body.sendero ?? providerAddr) as `0x${string}`,
        validator: (body.validator ?? validatorAddr) as `0x${string}`,
        commissionBps: body.commissionBps,
        senderoFeeBps: body.senderoFeeBps,
      });
    }

    const result = await settleCommissionSplit(legs);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'invalid_input', issues: err.issues }, { status: 400 });
    }
    const detail = err instanceof Error ? err.message : String(err);
    console.error('[settle/split] error:', detail);
    return NextResponse.json({ error: 'split_failed', message: detail }, { status: 500 });
  }
}
