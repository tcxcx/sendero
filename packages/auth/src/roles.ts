export const ROLES = {
  ADMIN: 'org:admin',
  FINANCE: 'org:finance',
  MEMBER: 'org:member',
} as const;

export type ClerkRole = (typeof ROLES)[keyof typeof ROLES];

/** Prisma Role enum values — must stay in sync with schema.prisma. */
export type PrismaRole = 'agency_admin' | 'finance' | 'traveler' | 'guest';

/**
 * Maps a Clerk role string to the Prisma Role enum used on Membership.
 * Defaults to 'traveler' for unknown/empty inputs — fail-closed to the
 * least-privileged role. The Prisma enum uses underscores (agency_admin);
 * the existing `clerkRoleToSendero` in ./clerk.tsx returns a different
 * shape (agency-admin with a hyphen) — keep both for backward compat;
 * this mapper is what the webhook handler (Epic 8) + seed writer use.
 */
export function mapClerkRoleToPrisma(clerkRole: string): PrismaRole {
  switch (clerkRole) {
    case ROLES.ADMIN:
    case 'admin':
      return 'agency_admin';
    case ROLES.FINANCE:
    case 'finance':
      return 'finance';
    case ROLES.MEMBER:
    case 'basic_member':
    case 'member':
      return 'traveler';
    default:
      return 'traveler';
  }
}
