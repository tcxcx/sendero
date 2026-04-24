'use client';

/**
 * Clerk — client wiring.
 *
 * Env vars (required):
 *   NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
 *   CLERK_SECRET_KEY                 (server-only, see clerk.server.ts)
 *   NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
 *   NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up
 *   NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL=/dashboard
 *   NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL=/dashboard/onboarding/passkey
 *
 * The Clerk org → Sendero tenant mapping is 1:1. Clerk `organization` is
 * the authoritative tenant; we mirror it into Prisma (`Tenant`) on first
 * webhook / first request so joins against ledger / ERC-8004 tables don't
 * have to hit Clerk on every query.
 */

import {
  ClerkProvider,
  useUser,
  useOrganization,
  useOrganizationList,
  useAuth,
} from '@clerk/nextjs';
import type { ReactNode } from 'react';
import type { SenderoRole, SenderoTenant, SenderoUser } from './types';

export { ClerkProvider, useUser, useOrganization, useOrganizationList, useAuth };

/** Clerk org role string → Sendero role. */
export function clerkRoleToSendero(clerkRole: string | null | undefined): SenderoRole {
  switch (clerkRole) {
    case 'org:admin':
    case 'admin':
      return 'agency-admin';
    case 'org:finance':
    case 'finance':
      return 'finance';
    case 'org:member':
    case 'basic_member':
      return 'traveler';
    default:
      return 'guest';
  }
}

/** Shape Clerk's `useUser` + `useOrganization` into `SenderoUser` / `SenderoTenant`. */
type MembershipItem = NonNullable<
  ReturnType<typeof useOrganizationList>['userMemberships']['data']
>[number];

export function shapeClerkSession(args: {
  clerkUser: ReturnType<typeof useUser>['user'];
  organization: ReturnType<typeof useOrganization>['organization'];
  memberships: { data?: readonly MembershipItem[] | null } | null | undefined;
  role: string | null | undefined;
}): { user: SenderoUser | null; tenant: SenderoTenant | null } {
  const { clerkUser, organization, memberships, role } = args;
  if (!clerkUser) return { user: null, tenant: null };

  const user: SenderoUser = {
    clerkUserId: clerkUser.id,
    email: clerkUser.primaryEmailAddress?.emailAddress ?? '',
    displayName:
      clerkUser.fullName ||
      clerkUser.username ||
      clerkUser.primaryEmailAddress?.emailAddress ||
      'traveler',
    imageUrl: clerkUser.imageUrl ?? null,
    role: clerkRoleToSendero(role),
    memberships: (memberships?.data ?? []).map(m => ({
      tenantId: m.organization.id,
      role: clerkRoleToSendero(m.role),
    })),
  };

  const tenant: SenderoTenant | null = organization
    ? {
        id: organization.id,
        slug: organization.slug ?? organization.id,
        displayName: organization.name,
        billingTier:
          (organization.publicMetadata?.billingTier as string | undefined as
            | SenderoTenant['billingTier']
            | undefined) ?? 'free',
        parentTenantId: (organization.publicMetadata?.parentTenantId as string | null) ?? null,
        createdAt: new Date(organization.createdAt ?? Date.now()).toISOString(),
      }
    : null;

  return { user, tenant };
}

/** Thin wrapper — lets apps/app do `<SenderoClerkProvider>` without re-reading env. */
export function SenderoClerkProvider({ children }: { children: ReactNode }) {
  return <ClerkProvider>{children}</ClerkProvider>;
}
