/**
 * Booking metadata helpers — Track C2 of the markup feature.
 *
 * Lives outside the Booking schema because the v1 ship is additive-only
 * (no new columns this round). Both `policySnapshot` and
 * `invoiceItemization` ride inside `Booking.metadata` JSON, mirroring
 * each other.
 *
 * Why itemization is a per-booking metadata key (not a Tenant-level
 * column or a TenantPricingPolicy field):
 *   - The default is segment-driven (`corporate` / `agency` → itemized,
 *     consumer → single-line) but the agent has the option to override
 *     per booking (e.g. a corporate booking that the traveler wants to
 *     receive as a single-line consumer-style invoice).
 *   - Stamping it onto Booking.metadata at confirm time freezes the
 *     decision against the same race-protection guarantees as
 *     policySnapshot — a tenant flipping the default mid-trip does NOT
 *     re-itemize an open invoice.
 *   - Keeps the schema migration light. We can promote to a column in v2
 *     without breaking existing callers.
 *
 * v2 addition (PR #53 split-ticket follow-up, Codex finding f):
 * a discriminated `BookingMetadataV1` union + `bookingMetadataSchema`
 * zod validator + safe reader/writer. Today only the `book_trip`
 * (split-ticket) write site is migrated to the typed writer — the
 * `book_flight` variant stays a passthrough record because its shape
 * evolves frequently and we don't want to break the existing legacy
 * writes. Future per-source variants can tighten the schema one
 * source at a time without breaking back-compat.
 */

import { z } from 'zod';

/**
 * Customer-facing invoice itemization mode.
 *
 *   - `single`   → one line at the customer total. What Booking.com /
 *                  Hopper / Expedia show consumers. Cleaner UX, no
 *                  breakdown of what the agency made.
 *   - `itemized` → three lines (cost · agency markup · Sendero service
 *                  fee). What corporate / agency customers want for
 *                  expense compliance + per-trip reconciliation.
 */
export type InvoiceItemization = 'single' | 'itemized';

/**
 * Default itemization for a booking based on the trip / tenant segment.
 *
 *   - `corporate` / `agency` → itemized (B2B clients want the breakdown
 *     for expense compliance + per-trip reconciliation).
 *   - `consumer` / `leisure` / null / undefined → single-line (cleaner
 *     UX, matches what consumers see on Booking.com / Hopper).
 *
 * Pure function, no IO. Callers persist the result onto
 * `Booking.metadata.invoiceItemization` at quote-confirm time so the
 * decision is frozen alongside the policy snapshot (Eng A3 race
 * protection extends to the customer-facing invoice mode).
 */
export function defaultItemizationForSegment(
  segment: string | null | undefined
): InvoiceItemization {
  if (segment === 'corporate' || segment === 'agency') return 'itemized';
  return 'single';
}

/**
 * Read the itemization off a Booking.metadata blob safely. Returns
 * `null` when the key is absent or malformed — the invoice generator
 * falls back to its own segment-based default in that case.
 */
export function readInvoiceItemization(
  metadata: Record<string, unknown> | null | undefined
): InvoiceItemization | null {
  const v = metadata?.invoiceItemization;
  if (v === 'single' || v === 'itemized') return v;
  return null;
}

/**
 * Read the segment off a Booking.metadata blob safely. The segment is
 * optional in the schema; we return null when absent.
 */
export function readBookingSegment(
  metadata: Record<string, unknown> | null | undefined
): string | null {
  const v = metadata?.segment;
  return typeof v === 'string' ? v : null;
}

/* -------------------------------------------------------------------- *
 * BookingMetadataV1 — discriminated union (Codex review finding f)
 * -------------------------------------------------------------------- *
 *
 * Background. `Booking.metadata` is `Json?` in Prisma. Until this v2
 * iteration of the split-ticket PR, the `book_trip` write at
 * `book-trip.ts::persistBookingForSlice` was a plain object literal:
 *
 *   metadata: { source: 'book_trip', sliceIndex, offerId, splitTicket: true }
 *
 * No shared TS type, no runtime validator. A typo at the write site
 * silently produced bad metadata that the reader couldn't trust.
 *
 * The union below pins down the shape per `source` discriminator,
 * with a runtime zod validator (`bookingMetadataSchema`), a safe
 * defensive reader (`parseBookingMetadata`), and a typed writer
 * (`serializeBookTripMetadata`).
 *
 * The `book_flight` variant is INTENTIONALLY a passthrough record
 * (`.passthrough()` in zod terms). `book_flight` writes a much
 * wider set of fields (policySnapshot, invoiceItemization, segment,
 * markup, payer, etc.) and migrating that surface lives in a
 * follow-up — we don't want to break legacy writes today. The
 * passthrough variant lets `parseBookingMetadata` still safely
 * accept those reads and surface the discriminator without
 * over-constraining the shape. */

/**
 * Forward-looking variant for the day book_flight is migrated to stamp
 * `source: 'book_flight'` on its metadata writes. Today book_flight
 * writes `{ paymentStatus, usdcSettlement? }` with NO source field
 * (book-flight.ts:1378) — those rows fail the discriminator and fall
 * through `parseBookingMetadata` to `null`, which is the safe defensive
 * behavior.
 *
 * When the future migration lands, this variant ensures the stamped
 * metadata carries at least `paymentStatus` (the field every
 * book_flight write site already produces). Codex PR54-5: prevents a
 * malformed-but-source-tagged blob from passing the discriminator
 * unchallenged. Other fields stay passthrough since `book_flight`
 * writes a wide set (segments projection, eTicket URLs, journey state,
 * markup snapshot, etc.) and locking them all here would over-constrain.
 */
const bookFlightMetadataSchema = z
  .object({
    source: z.literal('book_flight'),
    paymentStatus: z.string().min(1),
  })
  .passthrough();

const bookTripMetadataSchema = z.object({
  source: z.literal('book_trip'),
  sliceIndex: z.number().int().min(0).max(5),
  offerId: z.string().regex(/^off_/),
  splitTicket: z.literal(true),
});

/**
 * Runtime validator. Use `parseBookingMetadata` for defensive parsing —
 * this is exported for advanced callers (e.g. typed inference, tests).
 */
export const bookingMetadataSchema = z.discriminatedUnion('source', [
  bookFlightMetadataSchema,
  bookTripMetadataSchema,
]);

/**
 * Typed metadata blob the rest of the codebase can rely on for the two
 * known sources. Other (legacy / segment-only / policy-only) reads of
 * `Booking.metadata` that lack a `source` field stay safe — they just
 * fall through `parseBookingMetadata` as `null`.
 */
export type BookingMetadataV1 = z.infer<typeof bookingMetadataSchema>;

export type BookTripBookingMetadata = z.infer<typeof bookTripMetadataSchema>;
export type BookFlightBookingMetadata = z.infer<typeof bookFlightMetadataSchema>;

/**
 * Defensive reader. Returns the parsed union on a match, `null` on
 * anything else (missing discriminator, bad shape, non-object). Reads
 * MUST NOT throw — `Booking.metadata` carries legacy / out-of-union
 * blobs on existing rows and we don't want a single bad row to brick
 * the invoice generator or the audit export.
 */
export function parseBookingMetadata(raw: unknown): BookingMetadataV1 | null {
  const parsed = bookingMetadataSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/**
 * Typed writer for the `book_trip` (split-ticket) persist path. Returns
 * a fully-typed `BookTripBookingMetadata` the caller hands directly to
 * Prisma's `metadata` field. Validates input at the boundary so a typo
 * at the call site (`sliceIdx` for `sliceIndex`, missing `offerId`,
 * etc.) becomes a TypeScript error.
 */
export function serializeBookTripMetadata(input: {
  sliceIndex: number;
  offerId: string;
}): BookTripBookingMetadata {
  return {
    source: 'book_trip',
    sliceIndex: input.sliceIndex,
    offerId: input.offerId,
    splitTicket: true,
  };
}
