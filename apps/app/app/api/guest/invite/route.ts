/**
 * POST /api/guest/invite
 *
 * Buyer-facing endpoint that wraps the `prefund_trip` MCP tool so the
 * corporate UI (or a Slack/WhatsApp command) can issue a guest invite
 * in a single call:
 *
 *   1. Generate tripId + claim keypair (Peanut-style)
 *   2. Generate OTP + nonce when require2fa=true
 *   3. Return the on-chain approve+createTrip calls for the buyer MSCA
 *   4. Email the invitee the claim link + OTP via @sendero/notifications
 *
 * The tool never submits the on-chain transaction — the caller does that
 * from the buyer's MSCA (or Slack approval, or a scheduled Trigger.dev
 * task). That keeps this endpoint channel-agnostic and idempotent at
 * the MCP boundary.
 */

import { auth } from '@clerk/nextjs/server';
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prefundTripTool } from '@sendero/tools';
import { capture } from '@sendero/analytics/server';
import { prisma } from '@sendero/database';
import { notifier } from '@sendero/notifications';

import { getTenantNotificationEmail } from '@/lib/tenant-notification-email';
import { dispatchToTraveler } from '@/lib/channel-dispatch';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const BodySchema = z.object({
  budgetUsdc: z.string().regex(/^\d+(\.\d{1,6})?$/),
  guestEmail: z.string().email(),
  guestName: z.string().min(1).max(80).optional(),
  buyerName: z.string().min(1).max(120).optional(),
  tripSummary: z.string().max(200).optional(),
  expiresInDays: z.number().int().min(1).max(365).optional(),
  require2fa: z.boolean().optional(),
  linkOrigin: z.string().url().optional(),
});

export async function POST(req: NextRequest) {
  const { userId, orgId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  if (!orgId) {
    return NextResponse.json({ error: 'no_org' }, { status: 400 });
  }

  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      { error: 'invalid_input', issues: err instanceof z.ZodError ? err.issues : [] },
      { status: 400 }
    );
  }

  // Default 2FA ON for emailed invites — treating email inboxes as a
  // soft credential boundary. Buyer can opt out by passing require2fa=false.
  const require2fa = body.require2fa ?? true;

  // Resolve tenant + user FIRST so we can hand the prefund tool a
  // proper ToolContext. Without this, the tool's `resolveTenantPrimaryChain`
  // call falls back to 'arc' (because `ctx?.traveler?.tenantId` is
  // undefined) and Sol-primary tenants get the wrong chain's on-chain
  // calls. Reading the tenant + user is cheap (~10ms) and the rest of
  // the route already needs them.
  const tenant = await prisma.tenant.findUnique({ where: { clerkOrgId: orgId } });
  if (!tenant) {
    return NextResponse.json({ error: 'tenant_not_found' }, { status: 404 });
  }
  const user = await prisma.user.findUnique({
    where: { clerkUserId: userId },
    select: { id: true },
  });

  let result: Awaited<ReturnType<typeof prefundTripTool.handler>>;
  try {
    result = await prefundTripTool.handler(
      {
        budgetUsdc: body.budgetUsdc,
        guestEmail: body.guestEmail,
        guestName: body.guestName,
        buyerName: body.buyerName,
        tripSummary: body.tripSummary,
        expiresInDays: body.expiresInDays ?? 30,
        require2fa,
        ...(body.linkOrigin ? { linkOrigin: body.linkOrigin } : {}),
      },
      // ToolContext — traveler.tenantId routes prefund to Sol/Arc per
      // `Tenant.primaryChain`. `userId` lets downstream audit + DCW
      // resolvers attribute the call to the operator who triggered it.
      { traveler: { tenantId: tenant.id, userId: user?.id } }
    );
  } catch (err) {
    return NextResponse.json(
      { error: 'prefund_failed', message: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
  const safeResult = result as {
    tripId: string;
    budgetUsdc: string;
    guestLink: string;
    claimCode?: string | null;
    expiresAt?: string;
    escrowAddress?: string;
    /** Arc shape — 20-byte address-style claim pubkey (`bytes20`). */
    claimPubKey20?: string;
    /** Sol shape — full 32-byte Ed25519 pubkey, base58. The /api/guest/claim
     *  route uses this to fail-fast on Sol claims with a malformed
     *  fragment before broadcasting. */
    claimPubKey?: string;
    /** Solana program id when the trip was prefunded on Sol. */
    programId?: string;
    require2fa?: boolean;
    invite?: { ok?: boolean; skipped?: boolean; error?: string };
    onchainCalls?: Array<{ to: string; data: string; value: string }>;
    onchainInstructions?: Array<{
      programId: string;
      accounts: Array<{ pubkey: string; isSigner: boolean; isWritable: boolean }>;
      data: string;
    }>;
    chain?: 'arc' | 'sol';
  };

  // Stamp `linkChannel` so the OTP resend route can prefer a DIFFERENT
  // medium for the resend (channel-routing 2FA — see
  // `selectOtpChannel` in `@sendero/notifications/otp`). For this
  // route the link is always emailed (Resend), so 'email' is the
  // canonical value. WhatsApp / Slack-driven prefund flows stamp
  // their own value via the same metadata key.
  const linkChannel: 'whatsapp' | 'email' | 'sms' = 'email';

  // Verified contacts the buyer attached to the trip. Phone is null
  // here because /api/guest/invite is the email-only entry point;
  // phone-bearing flows (WhatsApp wizard, dashboard form with phone
  // field) populate `phone` directly. The OTP resend route prefers
  // this column over the legacy `metadata.invite.guestEmail` shape.
  const guestVerifiedContacts = { email: body.guestEmail };

  await prisma.trip.upsert({
    where: { id: safeResult.tripId },
    create: {
      id: safeResult.tripId,
      tenantId: tenant.id,
      createdById: user?.id ?? null,
      status: 'awaiting_approval',
      totalUsdc: safeResult.budgetUsdc,
      intent: {
        budgetUsdc: body.budgetUsdc,
        guestEmail: body.guestEmail,
        guestName: body.guestName ?? null,
        tripSummary: body.tripSummary ?? null,
        source: 'buyer_ui_prefund',
      },
      guestVerifiedContacts,
      metadata: {
        tripSummary: body.tripSummary ?? null,
        // Stamped only when the notify call returned ok — failed sends
        // shouldn't influence the resend channel selector. Falls back
        // to 'email' on the read side for legacy rows so consumers
        // never see undefined.
        ...(safeResult.invite?.ok ? { linkChannel } : {}),
        invite: {
          guestEmail: body.guestEmail,
          guestName: body.guestName ?? null,
          expiresAt: safeResult.expiresAt ?? null,
          require2fa,
          emailOk: safeResult.invite?.ok ?? false,
          emailSkipped: safeResult.invite?.skipped ?? false,
          emailError: safeResult.invite?.error ?? null,
        },
        escrow: {
          fundingStatus: 'pending_onchain_submission',
          chain: safeResult.chain ?? 'arc',
          address: safeResult.escrowAddress ?? safeResult.programId ?? null,
          // Arc: 20-byte claim pubkey address. Sol: full base58 Ed25519
          // pubkey. The /api/guest/claim route reads `claimPubKey` to
          // verify Sol claim secrets before broadcasting on-chain.
          claimPubKey20: safeResult.claimPubKey20 ?? null,
          claimPubKey: safeResult.claimPubKey ?? null,
          // Persist the on-chain calls / ixs so the buyer-side
          // "Fund with Sendero" button at `/api/trips/prefund/fund` can
          // submit them server-side without the buyer signing anything.
          onchainCalls: safeResult.onchainCalls ?? null,
          onchainInstructions: safeResult.onchainInstructions ?? null,
          onchainCallCount:
            safeResult.onchainCalls?.length ?? safeResult.onchainInstructions?.length ?? 0,
        },
      },
    },
    update: {
      status: 'awaiting_approval',
      totalUsdc: safeResult.budgetUsdc,
      guestVerifiedContacts,
      metadata: {
        tripSummary: body.tripSummary ?? null,
        ...(safeResult.invite?.ok ? { linkChannel } : {}),
        invite: {
          guestEmail: body.guestEmail,
          guestName: body.guestName ?? null,
          expiresAt: safeResult.expiresAt ?? null,
          require2fa,
          emailOk: safeResult.invite?.ok ?? false,
          emailSkipped: safeResult.invite?.skipped ?? false,
          emailError: safeResult.invite?.error ?? null,
        },
        escrow: {
          fundingStatus: 'pending_onchain_submission',
          chain: safeResult.chain ?? 'arc',
          address: safeResult.escrowAddress ?? safeResult.programId ?? null,
          // Arc: 20-byte claim pubkey address. Sol: full base58 Ed25519
          // pubkey. The /api/guest/claim route reads `claimPubKey` to
          // verify Sol claim secrets before broadcasting on-chain.
          claimPubKey20: safeResult.claimPubKey20 ?? null,
          claimPubKey: safeResult.claimPubKey ?? null,
          // Persist the on-chain calls / ixs so the buyer-side
          // "Fund with Sendero" button at `/api/trips/prefund/fund` can
          // submit them server-side without the buyer signing anything.
          onchainCalls: safeResult.onchainCalls ?? null,
          onchainInstructions: safeResult.onchainInstructions ?? null,
          onchainCallCount:
            safeResult.onchainCalls?.length ?? safeResult.onchainInstructions?.length ?? 0,
        },
      },
    },
  });

  // Channel-bound DCW lookup: when a User row exists for guestEmail AND
  // has tenant scope here (membership OR prior traveler trip) AND has a
  // provisioned Circle DCW on Arc-Testnet, the success card can offer
  // "auto-claim for traveler via DCW" instead of (only) sharing the
  // peanut link. The peanut link is still generated unconditionally —
  // it's the canonical share artifact and the cold-guest fallback.
  //
  // The User table is platform-global (one email = one user); tenant
  // scoping comes from Membership (operators) or TripTraveler (travelers).
  // We require ONE of those so an operator can't claim on behalf of any
  // user with a DCW across tenants.
  const ARC_TESTNET_CHAIN_ID = 5042002;
  const boundUser = await prisma.user.findFirst({
    where: {
      email: { equals: body.guestEmail, mode: 'insensitive' },
      OR: [
        { memberships: { some: { tenantId: tenant.id } } },
        { travelerTrips: { some: { tenantId: tenant.id } } },
      ],
    },
    select: {
      id: true,
      displayName: true,
      email: true,
      wallets: {
        where: { provisioner: 'dcw', chainId: ARC_TESTNET_CHAIN_ID },
        select: { circleWalletId: true, address: true },
        take: 1,
      },
    },
  });
  const boundWallet = boundUser?.wallets[0];
  const boundTraveler =
    boundUser && boundWallet?.circleWalletId
      ? {
          userId: boundUser.id,
          displayName: boundUser.displayName ?? boundUser.email ?? 'Traveler',
          dcwWalletId: boundWallet.circleWalletId,
          dcwAddress: boundWallet.address,
        }
      : null;

  let channelInvite:
    | { sent: true; channel: 'whatsapp' | 'slack' }
    | { sent: false; reason: string; channel?: 'whatsapp' | 'slack' }
    | null = null;
  if (boundUser) {
    const dispatch = await dispatchToTraveler({
      tenantId: tenant.id,
      tripId: safeResult.tripId,
      travelerUserId: boundUser.id,
      message: {
        kind: 'card',
        id: `guest_claim_${safeResult.tripId}_${Date.now()}`,
        author: { role: 'agent', name: tenant.displayName },
        title: 'Your prepaid trip is ready',
        body:
          `${tenant.displayName} created a prepaid Sendero trip for you. ` +
          'Open the claim link, claim the escrow, then keep booking here.',
        bullets: [
          `Budget: ${safeResult.budgetUsdc} USDC`,
          `Trip: ${body.tripSummary ?? body.guestEmail}`,
          safeResult.expiresAt
            ? `Expires: ${new Date(Number(safeResult.expiresAt) * 1000).toISOString()}`
            : null,
          safeResult.claimCode ? 'A 6-digit claim code is required.' : null,
        ].filter((line): line is string => Boolean(line)),
        ctas: [
          {
            label: 'Claim prepaid trip',
            kind: 'open_link',
            href: safeResult.guestLink,
            emphasis: 'primary',
          },
        ],
        createdAt: new Date().toISOString(),
      },
    });
    if ('reason' in dispatch) {
      channelInvite = { sent: false, reason: dispatch.reason, channel: dispatch.channel };
    } else {
      channelInvite = { sent: true, channel: dispatch.channel };
    }

    if (dispatch.sent) {
      const current = await prisma.trip.findUnique({
        where: { id: safeResult.tripId },
        select: { metadata: true },
      });
      const metadata =
        current?.metadata &&
        typeof current.metadata === 'object' &&
        !Array.isArray(current.metadata)
          ? (current.metadata as Record<string, unknown>)
          : {};
      await prisma.trip.update({
        where: { id: safeResult.tripId },
        data: {
          metadata: {
            ...metadata,
            linkChannel: dispatch.channel,
            invite: {
              ...((metadata.invite && typeof metadata.invite === 'object'
                ? metadata.invite
                : {}) as Record<string, unknown>),
              channelOk: true,
              channel: dispatch.channel,
            },
          },
        },
      });
    }
  }

  capture({
    event: 'guest_invite_issued',
    distinctId: userId,
    properties: {
      tenantId: tenant.id,
      tripId: (result as { tripId: string }).tripId,
      budgetUsdc: body.budgetUsdc,
      require2fa,
      emailOk: (result as { invite?: { ok?: boolean } }).invite?.ok ?? false,
      channel: 'web',
    },
  });

  // Out-of-band approval ping for the org admin so tenants without a
  // Slack install still see hold-needs-approval. Fails-soft: a Resend
  // error must never break the prefund response.
  void (async () => {
    try {
      const adminEmail = await getTenantNotificationEmail(tenant.id);
      if (!adminEmail) return;
      const linkOrigin =
        body.linkOrigin ?? process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3010';
      await notifier().sendHoldApproval(adminEmail, {
        travelerName: body.guestName ?? body.guestEmail,
        tripSummary: body.tripSummary ?? `${body.guestEmail} · prepaid invite`,
        amount: body.budgetUsdc,
        currency: 'USDC',
        expiresAtIso: safeResult.expiresAt ?? new Date(Date.now() + 7 * 86400 * 1000).toISOString(),
        reason: 'guest_invite_issued',
        consoleUrl: `${linkOrigin.replace(/\/$/, '')}/dashboard/console?tripId=${encodeURIComponent(safeResult.tripId)}`,
      });
    } catch (err) {
      console.warn('[guest/invite] sendHoldApproval failed', err);
    }
  })();

  return NextResponse.json({ ...result, boundTraveler, channelInvite });
}
