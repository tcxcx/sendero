/**
 * POST /api/guest/claim-via-dcw
 *
 * Channel-bound claim path. Called from `prefund-success.tsx` (and any
 * future channel adapter — Slack approval handler, WhatsApp message
 * router) when the traveler has a Circle DCW provisioned in the same
 * tenant. Skips the browser passkey ceremony entirely: the peanut
 * privkey signs the EIP-191 claim, the DCW signs the userOp envelope.
 *
 * Why have a server route instead of calling the MCP tool from the
 * client? The peanut privkey lives in the URL fragment on the buyer's
 * machine — passing it through an authenticated session-cookie POST is
 * fine (HTTPS + tenant-scoped audit), but the DCW UUID + Circle API
 * key must stay server-side. So the client posts the privkey + DCW
 * info; the server runs `guest_claim_link` with `signerWalletId`.
 *
 * Trip lifecycle: on a 'submitted' result, we stamp `metadata.claim`
 * with `txHash`, `claimedAt`, `claimedByDcwAddress`, and `claimedVia:
 * 'dashboard'`. The on-chain ClaimedTrip event is the source of truth;
 * a drift sweeper can reconcile if this DB write fails.
 */

import { auth } from '@clerk/nextjs/server';
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { prisma } from '@sendero/database';
import { guestClaimLinkTool } from '@sendero/tools';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 180;

const BodySchema = z.object({
  tripId: z.string().regex(/^0x[0-9a-fA-F]{64}$/, 'tripId must be a 32-byte hex'),
  /**
   * Full guest link (with the `#t=…&k=…` fragment intact). The fragment
   * carries the peanut privkey + 2FA nonce. The server parses it via
   * `parseGuestLink` inside the tool — never persists it.
   */
  guestLink: z.string().url(),
  /** Traveler EOA address — Circle DCW address from the bound wallet. */
  guestWallet: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  /** Circle DCW wallet UUID for the traveler. */
  signerWalletId: z.string().uuid(),
  /** 6-digit OTP — required when the trip was funded with require2fa=true. */
  claimCode: z
    .string()
    .regex(/^\d{6}$/)
    .optional(),
});

export async function POST(req: NextRequest) {
  const { userId, orgId } = await auth();
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!orgId) return NextResponse.json({ error: 'no_org' }, { status: 400 });

  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      { error: 'invalid_input', issues: err instanceof z.ZodError ? err.issues : [] },
      { status: 400 }
    );
  }

  const tenant = await prisma.tenant.findUnique({ where: { clerkOrgId: orgId } });
  if (!tenant) return NextResponse.json({ error: 'tenant_not_found' }, { status: 404 });

  const trip = await prisma.trip.findFirst({
    where: { id: body.tripId, tenantId: tenant.id },
    select: { id: true, metadata: true },
  });
  if (!trip) return NextResponse.json({ error: 'trip_not_found' }, { status: 404 });

  // The `signerWalletId` MUST belong to a Wallet whose user is scoped to
  // this tenant — otherwise an authed operator could claim trips on behalf
  // of any traveler across tenants. User table is platform-global, so we
  // require ONE of: tenant membership OR a prior traveler trip in this
  // tenant. Same scope rule as /api/guest/invite::boundTraveler lookup.
  const wallet = await prisma.wallet.findFirst({
    where: {
      circleWalletId: body.signerWalletId,
      address: { equals: body.guestWallet, mode: 'insensitive' },
      user: {
        OR: [
          { memberships: { some: { tenantId: tenant.id } } },
          { travelerTrips: { some: { tenantId: tenant.id } } },
        ],
      },
    },
    select: { id: true, userId: true },
  });
  if (!wallet) {
    return NextResponse.json(
      {
        error: 'wallet_not_in_tenant',
        message: 'signerWalletId does not match a DCW for any user in this tenant.',
      },
      { status: 403 }
    );
  }

  // Pull the 2FA nonce off the link fragment server-side too — saves the
  // client one extra field. The tool re-parses the link itself, so we
  // only need to forward what's required for the claim message.
  const codeNonce = extractFragmentParam(body.guestLink, 'n');
  if (codeNonce && !body.claimCode) {
    return NextResponse.json(
      {
        error: 'claim_code_required',
        message: 'This invite was funded with 2FA on. Pass `claimCode` (6-digit OTP).',
      },
      { status: 400 }
    );
  }

  let result: Awaited<ReturnType<typeof guestClaimLinkTool.handler>>;
  try {
    result = await guestClaimLinkTool.handler({
      guestLink: body.guestLink,
      guestWallet: body.guestWallet,
      signerWalletId: body.signerWalletId,
      ...(body.claimCode && codeNonce ? { claimCode: body.claimCode, codeNonce } : {}),
    });
  } catch (err) {
    return NextResponse.json(
      { error: 'claim_failed', message: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }

  const submitted = (result as { submitted?: boolean }).submitted === true;
  if (!submitted) {
    return NextResponse.json(
      {
        error: 'tool_did_not_submit',
        message: 'Tool returned calldata only — DCW path not taken.',
      },
      { status: 500 }
    );
  }
  const txHash = (result as { txHash?: string }).txHash ?? null;
  const txId = (result as { txId?: string }).txId ?? null;

  // Merge into existing metadata — never clobber sibling keys (escrow,
  // invite, tripSummary, linkChannel, etc.).
  const prevMetadata =
    trip.metadata && typeof trip.metadata === 'object'
      ? (trip.metadata as Record<string, unknown>)
      : {};
  const prevClaim =
    prevMetadata.claim && typeof prevMetadata.claim === 'object'
      ? (prevMetadata.claim as Record<string, unknown>)
      : {};
  const nextMetadata = {
    ...prevMetadata,
    claim: {
      ...prevClaim,
      claimedAt: new Date().toISOString(),
      claimedVia: 'dashboard_dcw',
      claimedByDcwAddress: body.guestWallet.toLowerCase(),
      claimedByUserId: wallet.userId,
      claimTxHash: txHash,
      claimTxId: txId,
    },
  };

  await prisma.trip.update({
    where: { id: trip.id },
    data: { metadata: nextMetadata as object, travelerId: wallet.userId },
  });

  return NextResponse.json({
    ok: true,
    tripId: trip.id,
    txHash,
    txId,
    claimedByUserId: wallet.userId,
  });
}

function extractFragmentParam(href: string, key: string): `0x${string}` | undefined {
  const hash = href.split('#')[1] ?? '';
  for (const part of hash.split('&')) {
    const [k, v] = part.split('=');
    if (k === key && v && /^0x[0-9a-fA-F]{64}$/.test(v)) {
      return v as `0x${string}`;
    }
  }
  return undefined;
}
