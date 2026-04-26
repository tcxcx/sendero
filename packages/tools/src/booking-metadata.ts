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
 */

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
