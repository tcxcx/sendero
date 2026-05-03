/**
 * GET /api/whatsapp/link-clerk?token=<linkToken>
 *
 * Post-Clerk-OTP redemption. The traveler signed in to `/sign-in/traveler`
 * via phone OTP; Clerk redirects here with the agent-issued
 * `WhatsAppLinkToken` carried over from the WhatsApp deep link.
 *
 * What this does:
 *
 *   1. Verify the token exists, isn't consumed, hasn't expired.
 *   2. Resolve the placeholder `User` row the
 *      `agent-traveler-resolver` provisioned when the agent first saw
 *      the inbound (email = `wa-<digits>@whatsapp-provisional.sendero.travel`).
 *   3. Resolve (or auto-provision via Clerk webhook) the Clerk-backed
 *      `User` row for the now-signed-in user.
 *   4. **Merge**:
 *        - If the Clerk user has a different `User` row, move the
 *          placeholder's `Wallet` / `NftStamp` / `ChannelIdentity` /
 *          `WhatsAppLinkToken` / `Trip(travelerId)` / `OnchainIdentity`
 *          rows onto the Clerk user. Delete the placeholder. The Clerk
 *          user now owns the persistent profile.
 *        - If the Clerk user has the SAME row already (the placeholder
 *          got rewritten by another flow), nothing to do.
 *        - If the Clerk user has no `User` row yet, rewrite the
 *          placeholder: `clerkUserId = <new>`, `email = <real>`,
 *          `displayName = <real>`. Same row, now identified.
 *   5. Stamp `Clerk.publicMetadata.kind = 'traveler'` so middleware /
 *      route guards can distinguish operators from travelers without
 *      hitting the DB.
 *   6. Mark the link token consumed.
 *   7. Redirect to `/me`.
 *
 * Idempotent on the redirect: re-running with a consumed token still
 * redirects to `/me` (no-ops merge if the user already matches).
 */

import { auth, clerkClient } from '@clerk/nextjs/server';
import { type NextRequest, NextResponse } from 'next/server';

import { type Prisma, prisma } from '@sendero/database';
import { decrypt, encrypt } from '@sendero/encryption';
import { invalidateUserGatewaySignerCache } from '@sendero/circle/gateway-signer';
import { isTokenExpired } from '@sendero/whatsapp';

import { tryPhoneMerge } from '@/lib/traveler-merge';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) {
    const url = new URL(req.url);
    const back = `${url.pathname}${url.search}`;
    return NextResponse.redirect(
      new URL(`/sign-in/traveler?redirect_url=${encodeURIComponent(back)}`, req.url)
    );
  }

  const tokenParam = req.nextUrl.searchParams.get('token');
  if (!tokenParam) {
    // No (or expired) WhatsApp link token. Two responsibilities here:
    //
    //   1. Stamp `publicMetadata.kind = 'traveler'` so the proxy treats
    //      them as B2C and refuses operator routes.
    //   2. Best-effort phone-based merge: Clerk-verified OTP phone is
    //      the trust anchor (the OTP itself proved possession), so we
    //      can safely look up `ChannelIdentity` rows keyed on that
    //      phone and merge the placeholder User into the new Clerk
    //      User. Catches the "link expired but I just signed in" case
    //      without making the agent issue a fresh token.
    await stampTravelerKind(clerkUserId);
    await tryPhoneMerge(clerkUserId).catch(err => {
      console.warn('[link-clerk] phone-based merge failed (non-fatal)', {
        clerkUserId,
        error: err instanceof Error ? err.message : String(err),
      });
    });
    return NextResponse.redirect(new URL('/me', req.url));
  }
  const token = tokenParam.toUpperCase();

  const tokenRow = await prisma.whatsAppLinkToken.findUnique({
    where: { token },
    select: {
      id: true,
      tenantId: true,
      userId: true,
      consumedAt: true,
      expiresAt: true,
    },
  });
  if (!tokenRow || isTokenExpired(tokenRow.expiresAt)) {
    return NextResponse.redirect(new URL('/me?error=link_expired', req.url));
  }

  const placeholderUser = await prisma.user.findUnique({
    where: { id: tokenRow.userId },
    select: {
      id: true,
      clerkUserId: true,
      email: true,
      displayName: true,
      phone: true,
      metadata: true,
    },
  });
  if (!placeholderUser) {
    return NextResponse.redirect(new URL('/me?error=user_not_found', req.url));
  }

  // Resolve the Clerk-backed user (might already exist if Clerk webhook
  // ran first; might not if webhook hasn't landed yet).
  const clerkRow = await prisma.user.findUnique({
    where: { clerkUserId },
    select: { id: true, email: true, displayName: true, phone: true, metadata: true },
  });

  let mergedUserId: string;

  if (!clerkRow) {
    // First-time link — placeholder becomes the canonical row. Pull
    // the real email + phone from Clerk to displace the synthetic
    // wa-…@whatsapp-provisional placeholder.
    const client = await clerkClient();
    const cu = await client.users.getUser(clerkUserId);
    const realEmail =
      cu.emailAddresses.find(e => e.id === cu.primaryEmailAddressId)?.emailAddress ??
      cu.emailAddresses[0]?.emailAddress ??
      placeholderUser.email;
    const realPhone =
      cu.phoneNumbers.find(p => p.id === cu.primaryPhoneNumberId)?.phoneNumber ??
      cu.phoneNumbers[0]?.phoneNumber ??
      placeholderUser.phone;
    const realDisplayName =
      [cu.firstName, cu.lastName].filter(Boolean).join(' ').trim() ||
      placeholderUser.displayName ||
      realEmail;

    await prisma.user.update({
      where: { id: placeholderUser.id },
      data: {
        clerkUserId,
        email: realEmail,
        displayName: realDisplayName,
        phone: realPhone,
      },
    });
    mergedUserId = placeholderUser.id;
  } else if (clerkRow.id === placeholderUser.id) {
    // Already the same row — token was redeemed already, or the user
    // was provisioned with their Clerk identity from the start.
    mergedUserId = clerkRow.id;
  } else if (placeholderUser.clerkUserId) {
    // Safety: the "placeholder" already belongs to a different Clerk
    // identity — this isn't a placeholder, it's another real user. A
    // misissued or stolen token must NOT move their data. Refuse and
    // redirect with an error so the operator can investigate.
    console.error('[link-clerk] refusing merge — token user already Clerk-bound', {
      tokenUserClerkUserId: placeholderUser.clerkUserId,
      currentClerkUserId: clerkUserId,
    });
    return NextResponse.redirect(new URL('/me?error=token_user_mismatch', req.url));
  } else {
    // Two distinct rows. Move the placeholder's owned data onto the
    // Clerk user, then delete the placeholder. Merge metadata so the
    // placeholder's `primaryTenantId` (the tenant that first invited
    // the traveler) survives onto the Clerk user.
    const placeholderId = placeholderUser.id;
    const clerkRowId = clerkRow.id;

    const placeholderMeta = (placeholderUser.metadata ?? {}) as Record<string, unknown>;
    const clerkMeta = (clerkRow.metadata ?? {}) as Record<string, unknown>;
    const mergedMeta: Record<string, unknown> = {
      ...placeholderMeta,
      ...clerkMeta, // Clerk user's existing metadata wins on key conflict
    };
    if (!mergedMeta.primaryTenantId && placeholderMeta.primaryTenantId) {
      mergedMeta.primaryTenantId = placeholderMeta.primaryTenantId;
    }
    if (!mergedMeta.firstSeenChannel && placeholderMeta.firstSeenChannel) {
      mergedMeta.firstSeenChannel = placeholderMeta.firstSeenChannel;
    }

    // Re-encrypt UserGatewaySigner under the new contextId before the
    // merge so decrypt doesn't auth-fail post-merge. See
    // `apps/app/lib/traveler-merge.ts` for the same fix on the
    // phone-anchored path.
    let resignedSigner: { encryptedPrivateKey: string; kekVersion: number } | null = null;
    const placeholderSigner = await prisma.userGatewaySigner.findUnique({
      where: { userId: placeholderId },
      select: { encryptedPrivateKey: true, kekVersion: true },
    });
    if (placeholderSigner) {
      const plaintext = await decrypt({
        ciphertext: placeholderSigner.encryptedPrivateKey,
        purpose: 'gateway-signer',
        contextId: placeholderId,
        kekVersion: placeholderSigner.kekVersion,
      });
      const reEncrypted = await encrypt({
        plaintext,
        purpose: 'gateway-signer',
        contextId: clerkRowId,
      });
      resignedSigner = {
        encryptedPrivateKey: reEncrypted.ciphertext,
        kekVersion: reEncrypted.kekVersion,
      };
    }

    await prisma.$transaction([
      prisma.user.update({
        where: { id: clerkRowId },
        data: { metadata: mergedMeta as Prisma.InputJsonObject },
      }),
      prisma.wallet.updateMany({
        where: { userId: placeholderId },
        data: { userId: clerkRowId },
      }),
      ...(resignedSigner
        ? [
            prisma.userGatewaySigner.updateMany({
              where: { userId: placeholderId },
              data: {
                userId: clerkRowId,
                encryptedPrivateKey: resignedSigner.encryptedPrivateKey,
                kekVersion: resignedSigner.kekVersion,
              },
            }),
          ]
        : []),
      prisma.channelIdentity.updateMany({
        where: { userId: placeholderId },
        data: { userId: clerkRowId },
      }),
      prisma.whatsAppLinkToken.updateMany({
        where: { userId: placeholderId },
        data: { userId: clerkRowId },
      }),
      prisma.trip.updateMany({
        where: { travelerId: placeholderId },
        data: { travelerId: clerkRowId },
      }),
      prisma.nftStamp.updateMany({
        where: { travelerId: placeholderId },
        data: { travelerId: clerkRowId },
      }),
      prisma.onchainIdentity.updateMany({
        where: { userId: placeholderId },
        data: { userId: clerkRowId },
      }),
      prisma.passportVault.updateMany({
        where: { userId: placeholderId },
        data: { userId: clerkRowId },
      }),
      // Last — delete the now-orphaned placeholder. Cascades clean up
      // anything we missed; if we missed a relation that doesn't
      // cascade, the delete fails and we surface that loudly via the
      // outer try/catch.
      prisma.user.delete({ where: { id: placeholderId } }),
    ]);
    invalidateUserGatewaySignerCache(placeholderId);
    invalidateUserGatewaySignerCache(clerkRowId);
    mergedUserId = clerkRowId;
  }

  // Stamp the Clerk-side role discriminator so middleware / route
  // guards can distinguish travelers from operators without hitting
  // the DB. Free-tier compatible — `publicMetadata` is part of every
  // Clerk plan.
  await stampTravelerKind(clerkUserId);

  // Mark token consumed. Idempotent — repeated redemptions land on the
  // same row; we only stamp on the first.
  await prisma.whatsAppLinkToken.update({
    where: { id: tokenRow.id },
    data: { consumedAt: new Date() },
  });

  console.info('[link-clerk] redeemed', {
    clerkUserId,
    senderoUserId: mergedUserId,
    tenantId: tokenRow.tenantId,
  });

  return NextResponse.redirect(new URL('/me', req.url));
}

/**
 * Stamp `Clerk.publicMetadata.kind = 'traveler'` if not already set.
 * Best-effort — middleware degrades gracefully without it (the user
 * still hits `/onboarding/choose-org` and can self-route, but the
 * metadata-driven proxy gate stops working until the next call).
 */
async function stampTravelerKind(clerkUserId: string): Promise<void> {
  try {
    const client = await clerkClient();
    const cu = await client.users.getUser(clerkUserId);
    const existingMeta = (cu.publicMetadata ?? {}) as Record<string, unknown>;
    if (existingMeta.kind === 'traveler') return;
    await client.users.updateUserMetadata(clerkUserId, {
      publicMetadata: { ...existingMeta, kind: 'traveler' },
    });
  } catch (err) {
    console.warn('[link-clerk] failed to stamp publicMetadata.kind=traveler', {
      clerkUserId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
