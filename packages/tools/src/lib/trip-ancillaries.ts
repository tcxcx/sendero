/**
 * Shared helpers for staging flight ancillaries (seats + bags) on a
 * Trip before `book_flight` is called. The agent stages selections via
 * `select_seat` / `add_baggage`; `book_flight` merges them into the
 * Duffel `services[]` payload at order-creation time.
 *
 * Pre-booking only. Post-confirmation modification (Duffel order_change)
 * is a separate flow — see docs/architecture/ancillaries-next-wave.md.
 */

import type { Prisma } from '@sendero/database';

export interface PendingSeatSelection {
  passengerId: string;
  serviceId: string;
  designator?: string;
  price?: string;
  currency?: string;
  /** ISO timestamp when this selection was staged. */
  stagedAt: string;
}

export interface PendingBagSelection {
  passengerId: string;
  serviceId: string;
  label?: string;
  price?: string;
  currency?: string;
  quantity: number;
  stagedAt: string;
}

export interface PendingFlightAncillaries {
  seats: PendingSeatSelection[];
  bags: PendingBagSelection[];
}

export interface PendingAncillariesShape {
  flight?: Record<string, PendingFlightAncillaries>;
}

interface MetadataWithAncillaries {
  pendingAncillaries?: PendingAncillariesShape;
  [key: string]: unknown;
}

function asObject(value: Prisma.JsonValue | null | undefined): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

export function readPendingAncillaries(
  metadata: Prisma.JsonValue | null | undefined,
  offerId: string
): PendingFlightAncillaries {
  const meta = asObject(metadata) as MetadataWithAncillaries;
  const flightMap = meta.pendingAncillaries?.flight ?? {};
  const entry = flightMap[offerId] ?? { seats: [], bags: [] };
  return {
    seats: Array.isArray(entry.seats) ? entry.seats : [],
    bags: Array.isArray(entry.bags) ? entry.bags : [],
  };
}

/**
 * Stage a seat selection. Replaces any prior selection for the same
 * (passengerId, designator) — one seat per passenger per segment.
 * If the new selection has no designator, dedup by serviceId instead
 * (defensive: still avoids exact-id duplicates).
 */
export function stageSeat(
  current: PendingFlightAncillaries,
  selection: PendingSeatSelection
): PendingFlightAncillaries {
  const dedupKey = (s: PendingSeatSelection): string =>
    s.designator ? `${s.passengerId}|${s.designator}` : `${s.passengerId}|${s.serviceId}`;
  const key = dedupKey(selection);
  const seats = current.seats.filter(s => dedupKey(s) !== key);
  seats.push(selection);
  return { ...current, seats };
}

/**
 * Stage a bag. Replaces any prior staging of the same
 * (passengerId, serviceId) — quantity wins on the latest call.
 */
export function stageBag(
  current: PendingFlightAncillaries,
  selection: PendingBagSelection
): PendingFlightAncillaries {
  const bags = current.bags.filter(
    b => !(b.passengerId === selection.passengerId && b.serviceId === selection.serviceId)
  );
  bags.push(selection);
  return { ...current, bags };
}

/**
 * Merge a per-offer ancillary block back into the Trip.metadata Json
 * tree non-destructively (preserves other metadata keys + other offers).
 */
export function writePendingAncillaries(
  metadata: Prisma.JsonValue | null | undefined,
  offerId: string,
  next: PendingFlightAncillaries
): Prisma.InputJsonValue {
  const base = asObject(metadata) as MetadataWithAncillaries;
  const pendingAncillaries: PendingAncillariesShape = base.pendingAncillaries ?? {};
  const flight = pendingAncillaries.flight ?? {};
  const merged: MetadataWithAncillaries = {
    ...base,
    pendingAncillaries: {
      ...pendingAncillaries,
      flight: { ...flight, [offerId]: next },
    },
  };
  return merged as unknown as Prisma.InputJsonValue;
}

/**
 * Project staged ancillaries → the Duffel `services[]` payload shape
 * that `book_flight` forwards to `createHoldOrder`. Each bag selection
 * may carry `quantity > 1`; seats are always quantity 1.
 */
export function stagedAncillariesToServices(
  staged: PendingFlightAncillaries
): Array<{ id: string; quantity: number }> {
  const out: Array<{ id: string; quantity: number }> = [];
  for (const s of staged.seats) {
    out.push({ id: s.serviceId, quantity: 1 });
  }
  for (const b of staged.bags) {
    out.push({ id: b.serviceId, quantity: Math.max(1, b.quantity ?? 1) });
  }
  return out;
}

/**
 * Merge explicit `services` (passed by caller) with staged ones.
 * Explicit args win on conflict — preserves existing `book_flight`
 * call shapes that pass services directly.
 */
export function mergeServices(
  explicit: Array<{ id: string; quantity: number }> | undefined,
  staged: PendingFlightAncillaries
): Array<{ id: string; quantity: number }> {
  const fromStaged = stagedAncillariesToServices(staged);
  if (!explicit || explicit.length === 0) return fromStaged;
  const explicitIds = new Set(explicit.map(s => s.id));
  return [...explicit, ...fromStaged.filter(s => !explicitIds.has(s.id))];
}
