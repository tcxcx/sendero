/**
 * Server-side `getServerAuth` — combines Clerk session with the Prisma
 * MSCA mapping. Use from Next.js route handlers / RSC / server actions.
 *
 * Hono (apps/edge) variant at the bottom: `getServerAuthHono(c, prisma)`.
 */

import type { NextRequest } from 'next/server';
import type { Context } from 'hono';
import type { Hex } from 'viem';
import { getClerkSessionNext, getClerkSessionHono } from './clerk.server';
import { getMscaForClerkUser } from './msca';
import type { SenderoAuth } from './types';

type PrismaClientLike = Parameters<typeof getMscaForClerkUser>[0];

/**
 * Next.js: reads Clerk session + MSCA mapping from Prisma in one call.
 * `req` is optional — Clerk's helpers pick up the request from the
 * App Router context automatically.
 */
export async function getServerAuth(
  prisma: PrismaClientLike,
  _req?: NextRequest
): Promise<SenderoAuth> {
  const { user, tenant, clerkUserId } = await getClerkSessionNext();
  if (!clerkUserId) {
    return { user: null, tenant: null, msca: null, isReady: true, isFullyLinked: false };
  }

  const link = await getMscaForClerkUser(prisma, clerkUserId);
  const msca = link
    ? {
        address: link.mscaAddress as Hex,
        credentialId: link.credentialId as string,
        /** Server can't know whether the passkey is on the CURRENT device. */
        onThisDevice: false,
      }
    : null;

  return {
    user,
    tenant,
    msca,
    isReady: true,
    isFullyLinked: Boolean(user && tenant && msca),
  };
}

/**
 * Hono (apps/edge) — verifies a Bearer Clerk JWT and looks up the MSCA.
 * The Next.js app forwards the token via `fetch(edge, { headers: { Authorization: \`Bearer ${await getToken()}\` } })`.
 */
export async function getServerAuthHono(
  c: Context,
  prisma: PrismaClientLike
): Promise<
  Pick<SenderoAuth, 'msca'> & {
    clerkUserId: string | null;
    orgId: string | null;
    orgRole: string | null;
  }
> {
  const { clerkUserId, orgId, orgRole } = await getClerkSessionHono(c);
  if (!clerkUserId) return { msca: null, clerkUserId: null, orgId: null, orgRole: null };

  const link = await getMscaForClerkUser(prisma, clerkUserId);
  const msca = link
    ? {
        address: link.mscaAddress as Hex,
        credentialId: link.credentialId as string,
        onThisDevice: false,
      }
    : null;

  return { msca, clerkUserId, orgId, orgRole };
}
