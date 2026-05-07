/**
 * Cross-org RBAC for the Sendero admin app.
 *
 * Two layers of identity:
 *
 * 1. **Platform scope (Sendero-internal staff).** A user's
 *    `publicMetadata.platformRoles` is the source of truth — an array
 *    so a single user can hold `["superadmin", "eng"]`,
 *    `["finance", "sales"]`, etc. They bypass per-vertical Clerk org
 *    membership (their org IS the platform).
 *
 * 2. **Org scope (per-vertical tenants).** Each vertical AI agent
 *    company is its own Clerk org. Tenants get scoped via Clerk
 *    Organizations + custom org roles + custom permissions.
 *    `has({ permission: 'org:agents:manage' })` from the Clerk SDK
 *    handles those — this module focuses on platform scope only.
 *
 * # `superadmin` godmode short-circuit
 *
 * When `superadmin` is in a user's roles, every check in this module
 * passes. No need to list `superadmin` in every `requirePlatformRole`
 * call site — but DO list it in `PLATFORM_ROUTES` for readability so
 * the matrix stays self-documenting.
 *
 * # Defense in depth (CVE-2025-29927)
 *
 * Middleware alone is not sufficient. CVE-2025-29927 (CVSS 9.1, fixed
 * in Next 12.3.5 / 13.5.9 / 14.2.25 / 15.2.3+) demonstrated a single
 * HTTP header could bypass middleware authorization. Every page in
 * `/dashboard/*` re-checks via `requirePlatformRole([...])` BEFORE
 * reading sensitive data.
 *
 * # Bootstrap (one-time, per Sendero teammate)
 *
 *   Clerk dashboard → Users → <them> → Public metadata:
 *     { "platformRoles": ["superadmin", "eng"] }
 *
 *   They sign out + back in to refresh the JWT.
 *
 * Or programmatically:
 *
 *   import { clerkClient } from '@clerk/nextjs/server';
 *   await (await clerkClient()).users.updateUserMetadata(userId, {
 *     publicMetadata: { platformRoles: ['superadmin', 'eng'] },
 *   });
 *
 * Migration from Phase 7.0 (`{ "role": "superadmin" }`):
 *   `parseRoles()` honors `role` as a fallback so existing bootstrap
 *   keeps working. Migrate at your leisure by renaming the key.
 *
 * # JWT staleness
 *
 * Roles are baked into the session JWT at sign-in. After changing
 * `publicMetadata`, the user must sign out + back in to pick up the
 * new claims. The /unauthorized page already documents this.
 */

import { auth } from '@clerk/nextjs/server';

const ALL_ROLES: readonly PlatformRole[] = [
  'superadmin',
  'sales',
  'eng',
  'support',
  'finance',
];

/**
 * Per-role landing page. Order is priority — first match wins in
 * `pickHomeRoute()` so a user with `["superadmin", "eng"]` lands on
 * the superadmin home, not the eng home.
 */
const HOME_BY_ROLE: Record<PlatformRole, string> = {
  superadmin: '/dashboard/treasury',
  finance: '/dashboard/billing',
  sales: '/dashboard/pipeline',
  support: '/dashboard/tenants',
  eng: '/dashboard/agents',
};

/**
 * Single source of truth for the platform-scope route → roles
 * matrix. Longest prefix wins, so `/dashboard/treasury` is matched
 * before `/dashboard`. List `superadmin` explicitly in each entry
 * for readability — even though the godmode short-circuit makes it
 * implicit.
 */
export const PLATFORM_ROUTES: Record<string, readonly PlatformRole[]> = {
  '/dashboard/treasury': ['superadmin'],
  '/dashboard/contracts': ['superadmin', 'eng'],
  '/dashboard/payouts': ['superadmin', 'finance'],
  '/dashboard/billing': ['superadmin', 'finance'],
  '/dashboard/pipeline': ['superadmin', 'sales'],
  '/dashboard/tenants': ['superadmin', 'sales', 'support'],
  '/dashboard/agents': ['superadmin', 'eng'],
  '/dashboard/health': ['superadmin', 'eng', 'support'],
  '/dashboard': ALL_ROLES,
};

function isPlatformRole(value: unknown): value is PlatformRole {
  return typeof value === 'string' && (ALL_ROLES as readonly string[]).includes(value);
}

/**
 * Tolerant role parsing — accepts any of these metadata shapes:
 *   { platformRoles: ["superadmin", "eng"] }   ← canonical (Phase 7.2+)
 *   { platformRole:  "superadmin" }            ← intermediate single-role
 *   { role:          "superadmin" }            ← Phase 7.0 legacy
 * Unknown role strings are filtered out.
 */
function parseRoles(meta: unknown): PlatformRole[] {
  if (!meta || typeof meta !== 'object') return [];
  const m = meta as Record<string, unknown>;
  const raw = m.platformRoles ?? m.platformRole ?? m.role;
  const arr: unknown[] = Array.isArray(raw) ? raw : raw != null ? [raw] : [];
  const seen = new Set<PlatformRole>();
  for (const v of arr) {
    if (isPlatformRole(v)) seen.add(v);
  }
  return [...seen];
}

/**
 * Reads the caller's platform roles. Fast path = session JWT claim.
 * Returns `[]` for unauthenticated users and for authenticated users
 * with no platform roles set.
 */
export async function getPlatformRoles(): Promise<PlatformRole[]> {
  const { sessionClaims } = await auth();
  return parseRoles(sessionClaims?.metadata);
}

/**
 * `true` iff the caller holds at least one of `allowed` (or
 * `superadmin` godmode).
 */
export async function hasAnyRole(allowed: readonly PlatformRole[]): Promise<boolean> {
  const roles = await getPlatformRoles();
  if (roles.includes('superadmin')) return true;
  return roles.some(r => allowed.includes(r));
}

/**
 * Synchronous variant for caller code that already has the role list
 * in hand (e.g. dashboard layout's sidebar filter — one role read,
 * many filter calls).
 */
export function hasAnyRoleSync(
  roles: readonly PlatformRole[],
  allowed: readonly PlatformRole[]
): boolean {
  if (roles.includes('superadmin')) return true;
  return roles.some(r => allowed.includes(r));
}

export type PlatformRoleGuardResult =
  | { ok: true; roles: PlatformRole[] }
  | { ok: false; roles: PlatformRole[] };

/**
 * Server-Component guard. Pass the roles allowed for THIS page; call
 * inside the page/layout body BEFORE any sensitive read.
 *
 * `superadmin` ∈ caller's roles → always passes (godmode).
 *
 * Returns `roles` even on failure so callers can render context
 * (e.g. /unauthorized shows "Your role(s) (sales, support) don't have
 * access").
 */
export async function requirePlatformRole(
  allowed: readonly PlatformRole[]
): Promise<PlatformRoleGuardResult> {
  const roles = await getPlatformRoles();
  if (roles.length === 0) return { ok: false, roles };
  if (roles.includes('superadmin')) return { ok: true, roles };
  if (roles.some(r => allowed.includes(r))) return { ok: true, roles };
  return { ok: false, roles };
}

/**
 * Pick the highest-priority dashboard home for the caller's roles.
 * Returns `null` for callers with no platform roles.
 */
export async function pickHomeRoute(): Promise<string | null> {
  const roles = await getPlatformRoles();
  if (roles.length === 0) return null;
  for (const r of Object.keys(HOME_BY_ROLE) as PlatformRole[]) {
    if (roles.includes(r)) return HOME_BY_ROLE[r];
  }
  return null;
}
