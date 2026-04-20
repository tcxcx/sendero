/**
 * Tenant — agency abstraction.
 *
 * A Sendero "tenant" is a Clerk organization. Every authenticated request is
 * scoped to exactly one active tenant (the user's current Clerk org). Host
 * agencies (e.g. "SP Corporate Travel") can have sub-agents via
 * `parentTenantId` in Clerk org publicMetadata — the tenant switcher lists
 * all memberships (`useOrganizationList`) plus all children of the user's
 * primary org.
 */

import { z } from 'zod';
import type { SenderoRole, SenderoTenant, BillingTier } from './types';
import { getClerkSessionNext } from './clerk.server';

/** Per-tenant policy: what can / cannot be booked, spending limits, etc. */
export const TenantPolicy = z.object({
  tenantId: z.string(),
  maxTripPriceUsdc: z.number().nonnegative().default(10_000),
  allowedCabinClasses: z
    .array(z.enum(['economy', 'premium_economy', 'business', 'first']))
    .default(['economy', 'business']),
  requireApprovalAboveUsdc: z.number().nonnegative().default(2_500),
  allowedCurrencies: z.array(z.enum(['USDC', 'EURC'])).default(['USDC']),
  settlementMode: z.enum(['8183', '8004-only', 'direct']).default('8183'),
});
export type TenantPolicy = z.infer<typeof TenantPolicy>;

export const DEFAULT_POLICY: Omit<TenantPolicy, 'tenantId'> = {
  maxTripPriceUsdc: 10_000,
  allowedCabinClasses: ['economy', 'business'],
  requireApprovalAboveUsdc: 2_500,
  allowedCurrencies: ['USDC'],
  settlementMode: '8183',
};

/** Billing tier → feature flags. Kept here so app code can `if (tier.hasSso)`. */
export function featuresForTier(tier: BillingTier) {
  return {
    hasSso: tier === 'enterprise',
    hasMultiAgent: tier === 'growth' || tier === 'enterprise',
    hasCustomPolicy: tier !== 'free',
    maxMembers: tier === 'free' ? 3 : tier === 'starter' ? 25 : tier === 'growth' ? 250 : Infinity,
  };
}

/** Server-side: current tenant (from Clerk `auth().orgId`). */
export async function getCurrentTenant(): Promise<SenderoTenant | null> {
  const { tenant } = await getClerkSessionNext();
  return tenant;
}

/**
 * Load tenant-scoped policy. Policies live in Prisma (`TenantPolicy`), but
 * fall back to DEFAULT_POLICY for free-tier tenants that haven't customized.
 */
export async function loadTenantPolicy(
  prisma: {
    tenantPolicy: {
      findUnique: (args: { where: { tenantId: string } }) => Promise<any>;
    };
  },
  tenantId: string
): Promise<TenantPolicy> {
  const row = await prisma.tenantPolicy.findUnique({ where: { tenantId } });
  if (!row) return TenantPolicy.parse({ tenantId, ...DEFAULT_POLICY });
  return TenantPolicy.parse({ tenantId, ...DEFAULT_POLICY, ...row });
}

/**
 * Host agency with sub-agents: returns every tenant this user can switch to
 * in the current session. Clerk's `userMemberships` already covers the
 * explicit case; this helper additionally includes children of the primary
 * tenant when the user has `agency-admin` role on the parent.
 */
export async function listSwitchableTenants(prisma: {
  tenant: {
    findMany: (args: any) => Promise<
      Array<{
        id: string;
        slug: string;
        name: string;
        parentTenantId: string | null;
        billingTier: string;
        createdAt: Date;
      }>
    >;
  };
}): Promise<SenderoTenant[]> {
  const { user } = await getClerkSessionNext();
  if (!user) return [];

  const parentIds = user.memberships.filter(m => m.role === 'agency-admin').map(m => m.tenantId);

  const rows = await prisma.tenant.findMany({
    where: {
      OR: [
        { id: { in: user.memberships.map(m => m.tenantId) } },
        parentIds.length ? { parentTenantId: { in: parentIds } } : { id: '__none__' },
      ],
    },
    orderBy: { createdAt: 'asc' },
  });

  return rows.map(r => ({
    id: r.id,
    slug: r.slug,
    displayName: r.name,
    billingTier: (r.billingTier as BillingTier) ?? 'free',
    parentTenantId: r.parentTenantId,
    createdAt: r.createdAt.toISOString(),
  }));
}

// ──────────────────────────────────────────────────────────────────────
// Route guards
// ──────────────────────────────────────────────────────────────────────

export class AuthError extends Error {
  constructor(
    public code: 'UNAUTHENTICATED' | 'NO_TENANT' | 'FORBIDDEN',
    msg: string
  ) {
    super(msg);
  }
}

export async function requireTenant(): Promise<{
  clerkUserId: string;
  tenant: SenderoTenant;
}> {
  const { clerkUserId, tenant } = await getClerkSessionNext();
  if (!clerkUserId) throw new AuthError('UNAUTHENTICATED', 'Sign in required.');
  if (!tenant) throw new AuthError('NO_TENANT', 'Select an agency to continue.');
  return { clerkUserId, tenant };
}

export async function requireRole(...roles: SenderoRole[]): Promise<{
  clerkUserId: string;
  tenant: SenderoTenant;
  role: SenderoRole;
}> {
  const { user, tenant, clerkUserId } = await getClerkSessionNext();
  if (!clerkUserId || !user) throw new AuthError('UNAUTHENTICATED', 'Sign in required.');
  if (!tenant) throw new AuthError('NO_TENANT', 'Select an agency to continue.');
  if (!roles.includes(user.role)) {
    throw new AuthError('FORBIDDEN', `Requires one of: ${roles.join(', ')}`);
  }
  return { clerkUserId, tenant, role: user.role };
}

export const requireAgencyAdmin = () => requireRole('agency-admin');
export const requireFinance = () => requireRole('agency-admin', 'finance');
export const requireTraveler = () => requireRole('agency-admin', 'traveler', 'finance');
