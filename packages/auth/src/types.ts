import type { Hex } from 'viem';

export type SenderoRole = 'agency-admin' | 'traveler' | 'finance' | 'guest';

export type BillingTier = 'free' | 'starter' | 'growth' | 'enterprise';

/** Clerk org → Sendero tenant (one Clerk org == one agency == one tenant). */
export interface SenderoTenant {
  /** Clerk org id (`org_xxx`) — canonical tenant id. */
  id: string;
  /** Slug like "sp-corporate-travel" — routable. */
  slug: string;
  displayName: string;
  billingTier: BillingTier;
  /** Agencies that resell under a host agency (e.g. SP Corporate Travel → sub-agents). */
  parentTenantId: string | null;
  createdAt: string;
}

export interface SenderoUser {
  /** Clerk user id (`user_xxx`) — canonical user id in Postgres. */
  clerkUserId: string;
  email: string;
  displayName: string;
  imageUrl: string | null;
  /** Role within the active tenant. */
  role: SenderoRole;
  /** All tenants this user is a member of (for the tenant switcher). */
  memberships: Array<{ tenantId: string; role: SenderoRole }>;
}

/** MSCA mapping row in Prisma (`model UserWallet`). */
export interface MscaLink {
  clerkUserId: string;
  mscaAddress: Hex;
  credentialId: string;
  publicKey: Hex;
  rpId: string;
  createdAt: string;
  lastUsedAt: string;
}

/** What `useSenderoAuth()` / `getServerAuth()` return. */
export interface SenderoAuth {
  user: SenderoUser | null;
  tenant: SenderoTenant | null;
  msca: {
    address: Hex;
    credentialId: string;
    /** True when the passkey is on this device; false if user needs to re-link. */
    onThisDevice: boolean;
  } | null;
  isReady: boolean;
  /** Convenience: true iff `user && tenant && msca`. */
  isFullyLinked: boolean;
}
