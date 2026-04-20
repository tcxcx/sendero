/**
 * Clerk — server wiring (Next.js App Router + Hono).
 *
 * Uses `@clerk/backend` so the same helpers work in:
 *   - Next.js route handlers (App Router) via `auth()` / `currentUser()`
 *   - Hono handlers in `apps/edge` via `verifyToken` from a Bearer header
 */

import { auth, currentUser, clerkClient } from '@clerk/nextjs/server';
import { createClerkClient, verifyToken } from '@clerk/backend';
import type { Context } from 'hono';
import type { SenderoRole, SenderoTenant, SenderoUser } from './types';
import { clerkRoleToSendero } from './clerk';

export { auth, currentUser, clerkClient, createClerkClient, verifyToken };

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`[auth] Missing env ${name}`);
  return v;
}

/** Server-side Clerk session → Sendero shapes. Works in Next.js RSC / route handlers. */
export async function getClerkSessionNext(): Promise<{
  user: SenderoUser | null;
  tenant: SenderoTenant | null;
  clerkUserId: string | null;
  orgId: string | null;
  orgRole: string | null;
}> {
  const { userId, orgId, orgRole } = await auth();
  if (!userId) {
    return { user: null, tenant: null, clerkUserId: null, orgId: null, orgRole: null };
  }

  const cu = await currentUser();
  const memberships = await (await clerkClient()).users.getOrganizationMembershipList({
    userId,
  });

  const user: SenderoUser | null = cu
    ? {
        clerkUserId: cu.id,
        email: cu.primaryEmailAddress?.emailAddress ?? '',
        displayName: cu.fullName || cu.username || 'traveler',
        imageUrl: cu.imageUrl ?? null,
        role: clerkRoleToSendero(orgRole),
        memberships: memberships.data.map((m) => ({
          tenantId: m.organization.id,
          role: clerkRoleToSendero(m.role),
        })),
      }
    : null;

  let tenant: SenderoTenant | null = null;
  if (orgId) {
    const org = await (await clerkClient()).organizations.getOrganization({
      organizationId: orgId,
    });
    tenant = {
      id: org.id,
      slug: org.slug ?? org.id,
      displayName: org.name,
      billingTier:
        ((org.publicMetadata?.billingTier as string | undefined) as
          | SenderoTenant['billingTier']
          | undefined) ?? 'free',
      parentTenantId:
        (org.publicMetadata?.parentTenantId as string | null) ?? null,
      createdAt: new Date(org.createdAt).toISOString(),
    };
  }

  return { user, tenant, clerkUserId: userId, orgId, orgRole: orgRole ?? null };
}

/**
 * Hono (apps/edge) — verify a Clerk session token passed as `Authorization: Bearer <jwt>`.
 * The Next.js app forwards the token it got from `auth().getToken()` to the edge API.
 */
export async function getClerkSessionHono(c: Context): Promise<{
  clerkUserId: string | null;
  orgId: string | null;
  orgRole: string | null;
}> {
  const authz = c.req.header('authorization') ?? c.req.header('Authorization');
  if (!authz?.startsWith('Bearer ')) {
    return { clerkUserId: null, orgId: null, orgRole: null };
  }
  const token = authz.slice('Bearer '.length);
  try {
    const payload = await verifyToken(token, {
      secretKey: requireEnv('CLERK_SECRET_KEY'),
    });
    return {
      clerkUserId: (payload.sub as string) ?? null,
      orgId: (payload.org_id as string | undefined) ?? null,
      orgRole: (payload.org_role as string | undefined) ?? null,
    };
  } catch {
    return { clerkUserId: null, orgId: null, orgRole: null };
  }
}
