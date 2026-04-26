/**
 * Internal endpoint — invoked by `apps/ponder` when the indexer
 * processes `SenderoGuestEscrow:ClaimLockoutTriggered`.
 *
 * Why an HTTP boundary at all? `apps/ponder` is a separate runtime
 * (Railway) and is intentionally lean — no Resend, no Slack client,
 * no Prisma in some deploy configs. Centralizing the dispatch here
 * lets the indexer stay small and lets us swap senders / audit shape
 * without redeploying the indexer.
 *
 * Auth: bearer `INDEXER_DISPATCH_SECRET` (or, for dev convenience,
 * `AGENT_DISPATCH_SECRET` — same shared-secret pattern used by the
 * cron + channel webhooks). Constant-time compare per CLAUDE.md
 * → "Agent dispatch shared secret".
 *
 * Idempotency: the indexer's `claimLockout` row is keyed on
 * `(tripId, lockedUntil)` and only fires this endpoint once per
 * unique pair — so a re-org / replay won't duplicate notifications.
 * Belt-and-braces: this route also checks for an existing
 * `SecurityAlert` with the same `(onchainTripId, lockedUntil)` payload
 * before persisting + dispatching.
 */

import { type NextRequest, NextResponse } from 'next/server';

import { getArcClient } from '@sendero/arc/chain';
import { prisma } from '@sendero/database';
import {
  type ClaimLockoutEvent,
  handleClaimLockoutTriggered,
  type SecurityAlertDeps,
  type TenantRow,
} from '@sendero/notifications/security-alerts';
import { z } from 'zod';

import crypto from 'node:crypto';

// `trips(bytes32)` is not in `SENDERO_GUEST_ESCROW_ABI` (the canonical
// abi-subset focuses on writes + getters used at boot). Defining it
// inline keeps the call site self-contained and avoids broadening the
// shared subset for a one-shot read. Hand-rolled JSON ABI rather than
// `parseAbi(['function trips(...) returns (Trip)'])` because viem's
// inferred return type for the human-readable struct form trips up
// the strict generic narrowing in `readContract`.
const ESCROW_TRIPS_ABI = [
  {
    type: 'function',
    name: 'trips',
    stateMutability: 'view',
    inputs: [{ name: 'tripId', type: 'bytes32' }],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'claimPubKey20', type: 'address' },
          { name: 'buyer', type: 'address' },
          { name: 'guestWallet', type: 'address' },
          { name: 'budget', type: 'uint256' },
          { name: 'reserved', type: 'uint256' },
          { name: 'spent', type: 'uint256' },
          { name: 'expiresAt', type: 'uint64' },
          { name: 'cancelled', type: 'bool' },
          { name: 'swept', type: 'bool' },
          { name: 'metadataHash', type: 'bytes32' },
          { name: 'metadataCID', type: 'string' },
          { name: 'agentTokenId', type: 'uint256' },
          { name: 'claimCodeHash', type: 'bytes32' },
        ],
      },
    ],
  },
] as const;

import { apiErrorResponse } from '@/lib/api-errors';
import { buildSecurityAlertSenders } from '@/lib/security-alert-senders';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const BodySchema = z.object({
  tripId: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  /** bigint serialized as decimal string. */
  lockedUntil: z.string().regex(/^\d+$/),
  txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  /** bigint serialized as decimal string. */
  blockNumber: z.string().regex(/^\d+$/),
});

function safeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

type AuthOutcome =
  | { ok: true; reason: null }
  | { ok: false; reason: 'dispatch_secret_missing' | 'unauthorized' };

function authorize(req: NextRequest): AuthOutcome {
  const expected = process.env.INDEXER_DISPATCH_SECRET ?? process.env.AGENT_DISPATCH_SECRET;
  if (!expected) return { ok: false, reason: 'dispatch_secret_missing' };
  const bearer = req.headers.get('authorization') ?? '';
  if (safeEqual(bearer, `Bearer ${expected}`)) return { ok: true, reason: null };
  return { ok: false, reason: 'unauthorized' };
}

function escrowAddress(): `0x${string}` | null {
  const addr =
    process.env.ARC_ESCROW_ADDRESS ??
    process.env.NEXT_PUBLIC_ARC_ESCROW_ADDRESS ??
    process.env.NEXT_PUBLIC_SENDERO_GUEST_ESCROW ??
    process.env.SENDERO_GUEST_ESCROW;
  if (!addr) return null;
  return addr as `0x${string}`;
}

export async function POST(req: NextRequest) {
  const authResult = authorize(req);
  if (!authResult.ok) {
    const reason = authResult.reason;
    return apiErrorResponse({
      status: reason === 'dispatch_secret_missing' ? 503 : 401,
      code: reason,
      message:
        reason === 'dispatch_secret_missing'
          ? 'INDEXER_DISPATCH_SECRET (or AGENT_DISPATCH_SECRET) is not set on this app.'
          : 'Bearer secret did not match.',
      docsUrl: '/docs/security#indexer-dispatch',
    });
  }

  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json());
  } catch (err) {
    return apiErrorResponse({
      status: 400,
      code: 'invalid_input',
      message: 'Body did not match the expected ClaimLockoutDispatchInput shape.',
      details: err instanceof z.ZodError ? err.issues : String(err),
    });
  }

  const escrow = escrowAddress();
  if (!escrow) {
    return apiErrorResponse({
      status: 503,
      code: 'escrow_address_missing',
      message:
        'ARC_ESCROW_ADDRESS (or NEXT_PUBLIC_ARC_ESCROW_ADDRESS / SENDERO_GUEST_ESCROW) is not set.',
    });
  }

  // Belt-and-braces idempotency check: if a SecurityAlert already
  // exists for this (tripId, lockedUntil) tuple, we've fanned out
  // before. The indexer's own dedup table should make this branch
  // very rare in practice but is cheap to keep.
  const existing = await prisma.securityAlert.findFirst({
    where: {
      onchainTripId: body.tripId.toLowerCase(),
      kind: 'claim_lockout',
      payload: { path: ['lockedUntil'], equals: body.lockedUntil },
    },
    select: { id: true },
  });
  if (existing) {
    return NextResponse.json({
      ok: true,
      duplicate: true,
      alertId: existing.id,
    });
  }

  const senders = buildSecurityAlertSenders();

  const event: ClaimLockoutEvent = {
    tripId: body.tripId.toLowerCase() as `0x${string}`,
    lockedUntil: BigInt(body.lockedUntil),
    txHash: body.txHash.toLowerCase() as `0x${string}`,
    blockNumber: BigInt(body.blockNumber),
  };

  const deps: SecurityAlertDeps = {
    appOrigin:
      process.env.SENDERO_APP_ORIGIN ?? process.env.APP_ORIGIN ?? 'https://app.sendero.travel',
    senders,
    async readBuyerAddress(tripId) {
      const client = getArcClient();
      // The cached PublicClient's typing widens through `let | null`,
      // which trips up viem's strict overload selector for
      // readContract. Cast at the boundary — the runtime call works
      // identically. See packages/sendero-arc/src/identity.ts for the
      // same `as any` workaround.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const record = (await (client.readContract as any)({
        address: escrow,
        abi: ESCROW_TRIPS_ABI,
        functionName: 'trips',
        args: [tripId],
      })) as { buyer: `0x${string}` };
      return record.buyer;
    },
    async findTenantByBuyer(buyerAddressLower): Promise<TenantRow | null> {
      // The CircleWallet table holds the buyer address case-folded to
      // lowercase already; case-fold the lookup defensively in case
      // legacy rows slipped through.
      const wallet = await prisma.circleWallet.findFirst({
        where: { address: buyerAddressLower },
        select: {
          tenant: {
            select: {
              id: true,
              displayName: true,
              metadata: true,
            },
          },
        },
      });
      if (!wallet?.tenant) return null;
      return {
        id: wallet.tenant.id,
        displayName: wallet.tenant.displayName,
        metadata: (wallet.tenant.metadata as TenantRow['metadata']) ?? null,
      };
    },
    async persistAlert(input) {
      const row = await prisma.securityAlert.create({
        data: {
          tenantId: input.tenantId,
          kind: input.kind,
          severity: input.severity,
          onchainTripId: input.onchainTripId.toLowerCase(),
          payload: input.payload as object,
        },
        select: { id: true },
      });
      return { id: row.id };
    },
  };

  try {
    const result = await handleClaimLockoutTriggered(event, deps);
    return NextResponse.json({
      ok: true,
      alertId: result.alertId,
      notificationsSent: result.notificationsSent,
      unknownBuyer: result.unknownBuyer,
    });
  } catch (err) {
    return apiErrorResponse({
      status: 500,
      code: 'handler_failed',
      message: err instanceof Error ? err.message : String(err),
      agentInstruction:
        'The indexer should mark the claim_lockout row as failed and retry on the next replay.',
    });
  }
}
