/**
 * MSCA — Circle Modular Wallets passkey layer.
 *
 * This module is the *glue* between Clerk and `lib/user-wallet.ts`. It does
 * NOT reimplement the WebAuthn ceremony — `lib/user-wallet.ts` is the single
 * source of truth for that, and we preserve its behavior exactly. We only:
 *   1. Re-export the three client entry points (`registerPasskey`,
 *      `loginPasskey`, `restoreFromStorage`, plus `stableWalletName` for
 *      debugging / recovery tools).
 *   2. Push results into the zustand store so `useSenderoAuth()` can read.
 *   3. Expose a server-side `linkMscaToClerkUser()` that writes the mapping
 *      into Prisma (via `@sendero/database`) — called from a Next.js route
 *      handler at `POST /api/auth/link-msca` after the user completes the
 *      onboarding passkey step.
 */

import type { Hex } from 'viem';
import { z } from 'zod';

// Re-export the client helpers verbatim. Do NOT wrap — `lib/user-wallet.ts`
// already handles localStorage, rpId, Arc fee floor, and stableWalletName.
export {
  registerPasskey,
  loginPasskey,
  restoreFromStorage,
  logout as clearMscaSession,
  sendUserOp,
  isPasskeyConfigured,
  passkeyConfigIssue,
} from '../../../lib/user-wallet';
export type {
  UserWallet,
  StoredCredential,
  UserProfile,
} from '../../../lib/user-wallet';

// Re-export for callers that need to recover / debug deterministic names.
export function stableWalletName(credential: {
  id: string;
  publicKey: Hex;
}): string {
  const idSlug = credential.id.replace(/[^A-Za-z0-9]/g, '').slice(0, 24);
  const pkSuffix = credential.publicKey.slice(-8);
  return `sendero-${idSlug}-${pkSuffix}`;
}

// ──────────────────────────────────────────────────────────────────────
// Server-side: Prisma mapping
// ──────────────────────────────────────────────────────────────────────

export const LinkMscaInput = z.object({
  clerkUserId: z.string().min(1).startsWith('user_'),
  mscaAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/) as z.ZodType<Hex>,
  credentialId: z.string().min(1),
  publicKey: z.string().regex(/^0x[a-fA-F0-9]+$/) as z.ZodType<Hex>,
  rpId: z.string().min(1),
});
export type LinkMscaInput = z.infer<typeof LinkMscaInput>;

/**
 * Upsert the `clerk_user_id ↔ msca_address` mapping in Prisma.
 *
 * Expected Prisma model (add to packages/database/prisma/schema.prisma):
 *
 *   model UserWallet {
 *     clerkUserId  String   @id
 *     mscaAddress  String   @unique
 *     credentialId String
 *     publicKey    String
 *     rpId         String
 *     createdAt    DateTime @default(now())
 *     lastUsedAt   DateTime @updatedAt
 *     tenantId     String?  // denormalized for tenant-scoped queries
 *     tenant       Tenant?  @relation(fields: [tenantId], references: [id])
 *   }
 *
 * The Prisma client comes from `@sendero/database` (peer dep). This file
 * stays runtime-neutral — caller passes the client in.
 */
export async function linkMscaToClerkUser(
  prisma: {
    userWallet: {
      upsert: (args: {
        where: { clerkUserId: string };
        create: any;
        update: any;
      }) => Promise<any>;
    };
  },
  input: LinkMscaInput,
  opts: { tenantId?: string | null } = {},
) {
  const parsed = LinkMscaInput.parse(input);
  return prisma.userWallet.upsert({
    where: { clerkUserId: parsed.clerkUserId },
    create: {
      clerkUserId: parsed.clerkUserId,
      mscaAddress: parsed.mscaAddress.toLowerCase(),
      credentialId: parsed.credentialId,
      publicKey: parsed.publicKey,
      rpId: parsed.rpId,
      tenantId: opts.tenantId ?? null,
    },
    update: {
      mscaAddress: parsed.mscaAddress.toLowerCase(),
      credentialId: parsed.credentialId,
      publicKey: parsed.publicKey,
      rpId: parsed.rpId,
      tenantId: opts.tenantId ?? undefined,
    },
  });
}

/** Read the mapping for a Clerk user. Returns null if unlinked. */
export async function getMscaForClerkUser(
  prisma: {
    userWallet: {
      findUnique: (args: { where: { clerkUserId: string } }) => Promise<any>;
    };
  },
  clerkUserId: string,
) {
  return prisma.userWallet.findUnique({ where: { clerkUserId } });
}
