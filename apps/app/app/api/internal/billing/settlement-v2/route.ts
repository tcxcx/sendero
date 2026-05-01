/**
 * Internal endpoint — invoked by `apps/ponder` when the indexer
 * processes `SenderoGuestEscrow:BookingSettledV2`.
 *
 * Responsibility: forward the settlement payload (vendor + agency +
 * fee split) to `@sendero/billing/settlement::persistSettlementFromV2Event`.
 * The persister writes 1 Settlement row + 3 SettlementLeg rows in one
 * Prisma transaction (Eng A9 — atomicity invariant).
 *
 * Auth: same shared-secret pattern as the security-alerts endpoint
 * (`INDEXER_DISPATCH_SECRET` falling back to `AGENT_DISPATCH_SECRET`).
 *
 * Idempotency: the persister handles same-event-twice gracefully —
 * returns the existing Settlement.id without re-writing legs. Safe
 * for indexer reprocessing.
 */

import { type NextRequest, NextResponse } from 'next/server';

import {
  persistSettlementFromV1Event,
  persistSettlementFromV2Event,
  prismaSettlementStore,
} from '@sendero/billing/settlement';
import { z } from 'zod';

import { apiErrorResponse } from '@/lib/api-errors';

import crypto from 'node:crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const BodySchema = z
  .object({
    eventVersion: z.enum(['v1', 'v2']).default('v2'),
    bookingId: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
    vendor: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
    vendorAmount: z.string().regex(/^\d+$/),
    agencyAddress: z
      .string()
      .regex(/^0x[0-9a-fA-F]{40}$/)
      .optional(),
    agencyAmount: z.string().regex(/^\d+$/).optional(),
    feeAmount: z.string().regex(/^\d+$/),
    txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
    blockNumber: z.string().regex(/^\d+$/),
  })
  .superRefine((body, ctx) => {
    if (body.eventVersion === 'v2' && !body.agencyAddress) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['agencyAddress'],
        message: 'agencyAddress is required for BookingSettledV2.',
      });
    }
    if (body.eventVersion === 'v2' && body.agencyAmount == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['agencyAmount'],
        message: 'agencyAmount is required for BookingSettledV2.',
      });
    }
  });

function safeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

function authorize(req: NextRequest): boolean {
  const expected = process.env.INDEXER_DISPATCH_SECRET ?? process.env.AGENT_DISPATCH_SECRET;
  if (!expected) return false;
  const bearer = req.headers.get('authorization') ?? '';
  return safeEqual(bearer, `Bearer ${expected}`);
}

export async function POST(req: NextRequest) {
  if (!authorize(req)) {
    return apiErrorResponse({
      status: 401,
      code: 'unauthorized',
      message: 'Bearer secret missing or did not match.',
    });
  }

  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json());
  } catch (err) {
    return apiErrorResponse({
      status: 400,
      code: 'invalid_input',
      message: 'Body did not match BookingSettledV2DispatchInput.',
      details: err instanceof z.ZodError ? err.issues : String(err),
    });
  }

  // Resolve the chain tag from request header (set by the indexer)
  // or fall back to the configured chain. Defaults to 'arc-testnet'
  // since that's where we deploy v3.0.0 first.
  const chain = req.headers.get('x-sendero-chain') ?? process.env.SENDERO_CHAIN ?? 'arc-testnet';

  try {
    const common = {
      store: prismaSettlementStore(),
      txHash: body.txHash as `0x${string}`,
      blockNumber: BigInt(body.blockNumber),
      chain,
    };
    const result =
      body.eventVersion === 'v1'
        ? await persistSettlementFromV1Event({
            ...common,
            event: {
              bookingId: body.bookingId as `0x${string}`,
              vendor: body.vendor as `0x${string}`,
              vendorAmount: BigInt(body.vendorAmount),
              feeAmount: BigInt(body.feeAmount),
            },
          })
        : await persistSettlementFromV2Event({
            ...common,
            event: {
              bookingId: body.bookingId as `0x${string}`,
              vendor: body.vendor as `0x${string}`,
              vendorAmount: BigInt(body.vendorAmount),
              agencyAddress: body.agencyAddress as `0x${string}`,
              agencyAmount: BigInt(body.agencyAmount as string),
              feeAmount: BigInt(body.feeAmount),
            },
          });

    return NextResponse.json({
      ok: true,
      ...result,
    });
  } catch (err) {
    // The persister itself never throws on orphan bookings — it writes
    // a SecurityAlert and returns `{ orphan: true }`. So a thrown error
    // here means the DB / Prisma layer failed and we should let the
    // indexer retry rather than swallow it as success.
    console.error('[internal/billing/settlement-v2] persister threw', {
      bookingId: body.bookingId,
      txHash: body.txHash,
      error: err instanceof Error ? err.message : String(err),
    });
    return apiErrorResponse({
      status: 500,
      code: 'PERSIST_FAILED',
      message: 'Settlement persister threw — the indexer should retry.',
      details: {
        bookingId: body.bookingId,
        txHash: body.txHash,
      },
    });
  }
}
