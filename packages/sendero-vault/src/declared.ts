/**
 * Declared signals — the T0/T1 tiers above the encrypted vault.
 *
 * Not every trip needs a full MRZ-validated passport upload. A user
 * who's just signed up and is searching "SFO → JFK on Tuesday" doesn't
 * need to wave their passport at the camera first — the agent can
 * quote the trip, show visa status, and plan the day on nothing more
 * than a self-declared nationality + expiry month.  The upload gate
 * fires only when the trip genuinely requires it (international +
 * visa-required corridor, expiry within 12 months of return, trip
 * total over the tenant ceiling, or tenant policy demands it).
 *
 * Two signal sources live here:
 *
 *   T0 — tenant default.  Admin sets it once ("we're a US-based TMC,
 *        assume US unless told otherwise").  Stored on
 *        `tenant.metadata.defaultNationalityIso3`.
 *
 *   T1 — user self-declared.  Traveler picks nationality + expiry
 *        month in a 10s onboarding card.  Stored on
 *        `user.metadata.travelerProfile = { declaredNationalityIso3,
 *        declaredPassportExpiry, declaredAt }`.
 *
 * Both are ISO-3 codes + a date — there's nothing PII-shaped in either
 * tier, so we don't encrypt them.  The encrypted PassportVault (T2) is
 * reserved for MRZ-validated records with names, document numbers,
 * DOB, and the raw MRZ strings.
 *
 * Trust order at read time: T2 (vault) → T1 (user declared) → T0
 * (tenant default) → unknown.  `verifyTravelDocuments` picks the
 * highest-confidence source it has and tags the verdict so the UI
 * (and the agent) knows which tier it's leaning on.
 */

import type { PrismaClient } from '@sendero/database';

export interface DeclaredTravelerSignals {
  /** ISO 3166-1 alpha-3 nationality code (e.g. "USA", "BRA"). */
  declaredNationalityIso3: string;
  /**
   * Passport expiry.  Traveler picks a month/year in onboarding; we
   * store the first of the month as the effective date.
   */
  declaredPassportExpiry: Date;
  /** When the user entered this. Drives stale-declaration nudges. */
  declaredAt: Date;
}

/**
 * Read the user's self-declared signals from `User.metadata.travelerProfile`.
 * Returns null when not set.
 */
export async function readDeclaredTravelerSignals(
  prisma: PrismaClient,
  userId: string
): Promise<DeclaredTravelerSignals | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { metadata: true },
  });
  return parseDeclaredFromMetadata(user?.metadata ?? null);
}

/**
 * Read the tenant's admin-set default nationality from
 * `Tenant.metadata.defaultNationalityIso3`.  Returns null when not set.
 */
export async function readTenantDefaultNationality(
  prisma: PrismaClient,
  tenantId: string
): Promise<string | null> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { metadata: true },
  });
  const meta = tenant?.metadata;
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return null;
  const code = (meta as Record<string, unknown>).defaultNationalityIso3;
  return isIso3(code) ? (code as string).toUpperCase() : null;
}

/**
 * Write the user's declared profile into `User.metadata.travelerProfile`.
 * Non-destructive on other metadata keys — we merge, never clobber.
 */
export async function writeDeclaredTravelerSignals(
  prisma: PrismaClient,
  userId: string,
  signals: Omit<DeclaredTravelerSignals, 'declaredAt'>
): Promise<DeclaredTravelerSignals> {
  const nationality = signals.declaredNationalityIso3.trim().toUpperCase();
  if (!isIso3(nationality)) {
    throw new Error(
      `declaredNationalityIso3 must be a 3-letter ISO 3166-1 code (got "${nationality}")`
    );
  }
  if (
    !(signals.declaredPassportExpiry instanceof Date) ||
    Number.isNaN(signals.declaredPassportExpiry.getTime())
  ) {
    throw new Error('declaredPassportExpiry must be a valid Date');
  }

  const now = new Date();
  const existing = await prisma.user.findUnique({
    where: { id: userId },
    select: { metadata: true },
  });
  const baseMeta =
    existing?.metadata && typeof existing.metadata === 'object' && !Array.isArray(existing.metadata)
      ? (existing.metadata as Record<string, unknown>)
      : {};

  const nextTravelerProfile = {
    declaredNationalityIso3: nationality,
    declaredPassportExpiry: signals.declaredPassportExpiry.toISOString().slice(0, 10),
    declaredAt: now.toISOString(),
  };

  await prisma.user.update({
    where: { id: userId },
    data: {
      metadata: {
        ...baseMeta,
        travelerProfile: nextTravelerProfile,
      },
    },
  });

  return {
    declaredNationalityIso3: nationality,
    declaredPassportExpiry: signals.declaredPassportExpiry,
    declaredAt: now,
  };
}

/**
 * Parse a user metadata JSON blob into declared signals, tolerating
 * partial / legacy shapes (returns null when unusable).
 */
export function parseDeclaredFromMetadata(meta: unknown): DeclaredTravelerSignals | null {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return null;
  const profile = (meta as Record<string, unknown>).travelerProfile;
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) return null;
  const p = profile as Record<string, unknown>;
  const code =
    typeof p.declaredNationalityIso3 === 'string' ? p.declaredNationalityIso3.toUpperCase() : null;
  const expiryStr = typeof p.declaredPassportExpiry === 'string' ? p.declaredPassportExpiry : null;
  const declaredAtStr = typeof p.declaredAt === 'string' ? p.declaredAt : null;
  if (!code || !isIso3(code) || !expiryStr) return null;
  const expiry = new Date(expiryStr);
  const declaredAt = declaredAtStr ? new Date(declaredAtStr) : new Date();
  if (Number.isNaN(expiry.getTime())) return null;
  return {
    declaredNationalityIso3: code,
    declaredPassportExpiry: expiry,
    declaredAt,
  };
}

function isIso3(code: unknown): code is string {
  return typeof code === 'string' && /^[A-Za-z]{3}$/.test(code);
}
