/**
 * Phone-anchored merge — moves placeholder Sendero User data onto the
 * Clerk-backed User when the Clerk user's verified phone matches a
 * `ChannelIdentity` row.
 *
 * Used in two places:
 *   - `/api/whatsapp/link-clerk` — runs after sign-in even when no
 *     WhatsAppLinkToken is present (token-less or expired).
 *   - `/me/layout.tsx` — runs on every traveler-portal load as a
 *     defense-in-depth backstop. Idempotent and safe to re-run.
 *
 * Trust anchor: Clerk phone OTP verifies the phone, which is the same
 * value the agent stores on `ChannelIdentity.externalUserId`. Match
 * means the same human owns both rows.
 */

import { clerkClient } from '@clerk/nextjs/server';

import { type Prisma, prisma } from '@sendero/database';
import { decrypt, encrypt } from '@sendero/encryption';
import { invalidateUserGatewaySignerCache } from '@sendero/circle/gateway-signer';

export async function tryPhoneMerge(clerkUserId: string): Promise<void> {
  const client = await clerkClient();
  const cu = await client.users.getUser(clerkUserId);
  const verifiedPhones = cu.phoneNumbers
    .filter(p => p.verification?.status === 'verified')
    .map(p => p.phoneNumber);
  if (verifiedPhones.length === 0) return;

  const clerkRow = await prisma.user.findUnique({
    where: { clerkUserId },
    select: { id: true, metadata: true },
  });
  if (!clerkRow) return;

  const identities = await prisma.channelIdentity.findMany({
    where: {
      kind: 'whatsapp',
      externalUserId: { in: verifiedPhones },
    },
    select: { id: true, userId: true, tenantId: true },
  });
  if (identities.length === 0) return;

  for (const id of identities) {
    if (!id.userId || id.userId === clerkRow.id) continue;
    const placeholder = await prisma.user.findUnique({
      where: { id: id.userId },
      select: { id: true, clerkUserId: true, metadata: true },
    });
    if (!placeholder || placeholder.clerkUserId) continue;

    await runMerge(placeholder.id, clerkRow.id, placeholder.metadata, clerkRow.metadata);
    console.info('[traveler-merge] phone-based merge', {
      clerkUserId,
      senderoUserId: clerkRow.id,
      mergedFrom: placeholder.id,
      tenantId: id.tenantId,
    });
  }
}

async function runMerge(
  placeholderId: string,
  clerkRowId: string,
  placeholderMeta: Prisma.JsonValue | null,
  clerkMeta: Prisma.JsonValue | null
): Promise<void> {
  const placeholderObj = (placeholderMeta ?? {}) as Record<string, unknown>;
  const clerkObj = (clerkMeta ?? {}) as Record<string, unknown>;
  const mergedMeta: Record<string, unknown> = { ...placeholderObj, ...clerkObj };
  if (!mergedMeta.primaryTenantId && placeholderObj.primaryTenantId) {
    mergedMeta.primaryTenantId = placeholderObj.primaryTenantId;
  }
  if (!mergedMeta.firstSeenChannel && placeholderObj.firstSeenChannel) {
    mergedMeta.firstSeenChannel = placeholderObj.firstSeenChannel;
  }

  // The UserGatewaySigner ciphertext is bound to `contextId =
  // placeholderId` at encrypt time. After we rewrite `userId =
  // clerkRowId`, decrypt would derive a different DEK and AES-GCM
  // auth-fails. Re-encrypt under the new context BEFORE the merge
  // transaction so the row leaves the merge in a coherent state. If
  // the placeholder has no signer row, this is a no-op.
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
    prisma.wallet.updateMany({ where: { userId: placeholderId }, data: { userId: clerkRowId } }),
    // Move the gateway-signer row AND swap in the re-encrypted key in
    // a single statement so a crash mid-merge doesn't leave a row
    // bound to the wrong contextId.
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
    prisma.user.delete({ where: { id: placeholderId } }),
  ]);

  // Drop the cached decrypted signer (the in-memory cache is keyed by
  // userId; a new one will get loaded under the Clerk row on next read).
  invalidateUserGatewaySignerCache(placeholderId);
  invalidateUserGatewaySignerCache(clerkRowId);
}
