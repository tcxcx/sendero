/**
 * Traveler-profile write helpers.
 *
 * Fire-and-forget upserts that accumulate cross-trip memory on
 * `TravelerProfile`. Mutated by ancillary tools (`book_flight`,
 * `book_stay`, audio inbound, restaurant taps); read once per turn
 * during prefetch_trip. Failures NEVER block the user-facing reply.
 *
 * Idempotency: every helper uses `prisma.travelerProfile.upsert` keyed
 * on `userId`. Tenant-scoped — the (tenantId, userId) pair is the
 * authority.
 *
 * Spec: docs/architecture/concierge-magic.md §4.
 */

import { prisma, type Prisma } from '@sendero/database';

export interface VisitedCity {
  iso2: string;
  citySlug: string;
  lastVisitedAt: string; // ISO
}

export interface LoyaltyAccount {
  airlines: Record<string, string>; // { AA: '12345' }
  hotels: Record<string, string>; // { HH: '99' }
}

// ── visitedCities merge ──────────────────────────────────────────────

function asVisitedCities(raw: Prisma.JsonValue | undefined | null): VisitedCity[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry): VisitedCity[] => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
    const r = entry as Record<string, unknown>;
    if (typeof r.iso2 !== 'string' || typeof r.citySlug !== 'string') return [];
    if (typeof r.lastVisitedAt !== 'string') return [];
    return [{ iso2: r.iso2, citySlug: r.citySlug, lastVisitedAt: r.lastVisitedAt }];
  });
}

function citySlug(city: string): string {
  return city
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip diacritics so "São Paulo" === "Sao Paulo"
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

/**
 * Merge a new (iso2, city) into the visitedCities array. Updates
 * `lastVisitedAt` if the city is already present; appends a new entry
 * otherwise. Preserves order — most-recent-first by virtue of placing
 * the touched/new entry at the head.
 */
export function mergeVisitedCity(
  current: Prisma.JsonValue | null | undefined,
  iso2: string,
  city: string | null | undefined,
  at: Date = new Date()
): VisitedCity[] {
  const list = asVisitedCities(current);
  const slug = city ? citySlug(city) : '';
  if (!iso2 || !slug) return list;
  const filtered = list.filter(c => !(c.iso2 === iso2 && c.citySlug === slug));
  return [{ iso2, citySlug: slug, lastVisitedAt: at.toISOString() }, ...filtered];
}

// ── Hook: flight booked ──────────────────────────────────────────────

export interface FlightBookedHookArgs {
  userId: string;
  tenantId: string;
  destinationIso2: string | null;
  destinationCity: string | null;
  preferredCabin: string | null;
}

/**
 * Called fire-and-forget after `book_flight` returns `ticketed`.
 * Increments totalTrips, stamps lastTripAt, dedup-appends to
 * visitedCities. Sets preferredCabin only when caller supplied one.
 */
export async function onFlightBooked(args: FlightBookedHookArgs): Promise<void> {
  const { userId, tenantId, destinationIso2, destinationCity, preferredCabin } = args;
  if (!userId || !tenantId) return;

  const now = new Date();
  // Read current state so we can merge visitedCities without race-y
  // jsonb concat. Single read + single upsert is fine for fire-and-forget;
  // last-writer-wins on the visitedCities is acceptable.
  const existing = await prisma.travelerProfile.findUnique({
    where: { userId },
    select: { visitedCities: true },
  });
  const visitedCities = destinationIso2
    ? mergeVisitedCity(existing?.visitedCities, destinationIso2, destinationCity, now)
    : asVisitedCities(existing?.visitedCities ?? []);

  await prisma.travelerProfile.upsert({
    where: { userId },
    create: {
      userId,
      tenantId,
      totalTrips: 1,
      lastTripAt: now,
      visitedCities: visitedCities as unknown as Prisma.InputJsonValue,
      ...(preferredCabin ? { preferredCabin } : {}),
    },
    update: {
      totalTrips: { increment: 1 },
      lastTripAt: now,
      visitedCities: visitedCities as unknown as Prisma.InputJsonValue,
      ...(preferredCabin ? { preferredCabin } : {}),
    },
  });
}

// ── Hook: stay booked ────────────────────────────────────────────────

export interface StayBookedHookArgs {
  userId: string;
  tenantId: string;
  destinationIso2: string | null;
  destinationCity: string | null;
}

/**
 * Called fire-and-forget after `book_stay` confirms. Appends
 * destination to visitedCities (no totalTrips bump — that's owned by
 * book_flight which always precedes a stay in the funnel).
 */
export async function onStayBooked(args: StayBookedHookArgs): Promise<void> {
  const { userId, tenantId, destinationIso2, destinationCity } = args;
  if (!userId || !tenantId || !destinationIso2) return;

  const existing = await prisma.travelerProfile.findUnique({
    where: { userId },
    select: { visitedCities: true },
  });
  const visitedCities = mergeVisitedCity(
    existing?.visitedCities,
    destinationIso2,
    destinationCity
  );

  await prisma.travelerProfile.upsert({
    where: { userId },
    create: {
      userId,
      tenantId,
      visitedCities: visitedCities as unknown as Prisma.InputJsonValue,
    },
    update: {
      visitedCities: visitedCities as unknown as Prisma.InputJsonValue,
    },
  });
}

// ── Hook: voice note received ────────────────────────────────────────

export interface VoiceReceivedHookArgs {
  userId: string;
  tenantId: string;
}

/**
 * Called fire-and-forget when WhatsApp delivers an audio message.
 * One-way flag — once true, stays true. Future agent turns bias copy
 * toward voice prompts (`mandá un audio si querés…`).
 */
export async function onVoiceReceived(args: VoiceReceivedHookArgs): Promise<void> {
  const { userId, tenantId } = args;
  if (!userId || !tenantId) return;

  await prisma.travelerProfile.upsert({
    where: { userId },
    create: {
      userId,
      tenantId,
      voicePreferred: true,
    },
    update: {
      voicePreferred: true,
    },
  });
}

// ── Hook: loyalty programme account ──────────────────────────────────

export interface LoyaltyAccountHookArgs {
  userId: string;
  tenantId: string;
  /** 'airlines' | 'hotels'. */
  category: 'airlines' | 'hotels';
  /** IATA airline code (AA, UA) or hotel chain code (HH, MAR). */
  supplierCode: string;
  accountNumber: string;
}

function asLoyaltyAccount(raw: Prisma.JsonValue | undefined | null): LoyaltyAccount {
  const out: LoyaltyAccount = { airlines: {}, hotels: {} };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  const r = raw as Record<string, unknown>;
  if (r.airlines && typeof r.airlines === 'object' && !Array.isArray(r.airlines)) {
    for (const [k, v] of Object.entries(r.airlines as Record<string, unknown>)) {
      if (typeof v === 'string') out.airlines[k] = v;
    }
  }
  if (r.hotels && typeof r.hotels === 'object' && !Array.isArray(r.hotels)) {
    for (const [k, v] of Object.entries(r.hotels as Record<string, unknown>)) {
      if (typeof v === 'string') out.hotels[k] = v;
    }
  }
  return out;
}

/**
 * Called fire-and-forget when a traveler hands a loyalty programme
 * account to `book_flight` (or future `book_stay` loyalty input).
 * Persisted so future searches auto-attach.
 */
export async function onLoyaltyAccountGiven(args: LoyaltyAccountHookArgs): Promise<void> {
  const { userId, tenantId, category, supplierCode, accountNumber } = args;
  if (!userId || !tenantId || !supplierCode || !accountNumber) return;

  const existing = await prisma.travelerProfile.findUnique({
    where: { userId },
    select: { loyaltyAccounts: true },
  });
  const merged = asLoyaltyAccount(existing?.loyaltyAccounts);
  merged[category][supplierCode] = accountNumber;

  await prisma.travelerProfile.upsert({
    where: { userId },
    create: {
      userId,
      tenantId,
      loyaltyAccounts: merged as unknown as Prisma.InputJsonValue,
    },
    update: {
      loyaltyAccounts: merged as unknown as Prisma.InputJsonValue,
    },
  });
}

// ── Hook: dietary inference (low confidence) ─────────────────────────

export interface DietaryInferredHookArgs {
  userId: string;
  tenantId: string;
  /** 'vegetarian', 'vegan', 'celiac', etc. */
  flag: string;
}

/**
 * Called fire-and-forget when a restaurant tap carries a cuisine
 * filter that implies a dietary preference. Low-confidence — agent
 * later bias-corrects when user contradicts. Idempotent: appending
 * an existing flag is a no-op.
 */
export async function onDietaryInferred(args: DietaryInferredHookArgs): Promise<void> {
  const { userId, tenantId, flag } = args;
  if (!userId || !tenantId || !flag) return;

  const existing = await prisma.travelerProfile.findUnique({
    where: { userId },
    select: { dietary: true },
  });
  const set = new Set(existing?.dietary ?? []);
  if (set.has(flag)) return; // already known; skip the write
  set.add(flag);

  await prisma.travelerProfile.upsert({
    where: { userId },
    create: {
      userId,
      tenantId,
      dietary: Array.from(set),
    },
    update: {
      dietary: Array.from(set),
    },
  });
}
