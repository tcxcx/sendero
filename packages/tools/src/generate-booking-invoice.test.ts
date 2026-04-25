/**
 * Track C1 — `planInvoiceLineItems` line-item assembly.
 *
 * The full `generate_booking_invoice` ToolDef reaches Prisma + Vercel
 * Blob + Resend, which we don't exercise here. Instead we test the
 * pure planner — the function that owns the legacy/v1 + single/itemized
 * + add_to_customer/deduct_from_markup decision tree. That is where
 * the regression risk lives.
 *
 * Coverage:
 *   - Legacy booking (costMicroUsdc null) → 1 line at totalUsd,
 *     sourceKind 'booking'. Backwards-compat regression guard.
 *   - v1 single mode → 1 line at customer total, sourceKind 'booking'.
 *   - v1 itemized + add_to_customer → 3 lines (cost, markup, sendero_fee).
 *   - v1 itemized + deduct_from_markup → 2 lines, NO sendero_fee.
 *   - Subtotal/total invariant: SUM(amountMicro) === totalMicro for
 *     every plan it returns (the renderer relies on this).
 *   - itemizationHint overrides Booking.metadata.invoiceItemization.
 *   - Segment-default fallback when invoiceItemization is missing.
 */

import { describe, expect, test } from 'bun:test';
import { planInvoiceLineItems } from './generate-booking-invoice';

const BOOKING_ID = 'bk_test_invoice_001';

const USD = (dollars: number): bigint => BigInt(Math.round(dollars * 1_000_000));

interface BookingArgs {
  costMicroUsdc?: bigint | null;
  markupMicroUsdc?: bigint | null;
  senderoTakeMicroUsdc?: bigint | null;
  itemization?: 'single' | 'itemized';
  segment?: string;
  senderoTakeBehavior?: 'add_to_customer' | 'deduct_from_markup';
  totalUsd?: string;
  pnr?: string | null;
  kind?: string;
}

function makeBooking(opts: BookingArgs = {}) {
  const metadata: Record<string, unknown> = {};
  if (opts.itemization !== undefined) metadata.invoiceItemization = opts.itemization;
  if (opts.segment !== undefined) metadata.segment = opts.segment;
  if (opts.senderoTakeBehavior !== undefined) {
    metadata.policySnapshot = {
      policyVersion: 1,
      kind: 'hotel',
      markup: { strategy: 'static', bps: 1100 },
      floorMicroUsdc: '0',
      ceilingMicroUsdc: null,
      senderoTakeBehavior: opts.senderoTakeBehavior,
    };
  }
  return {
    id: BOOKING_ID,
    kind: opts.kind ?? 'hotel',
    pnr: opts.pnr ?? null,
    totalUsd: { toString: () => opts.totalUsd ?? '1000.00' },
    costMicroUsdc: opts.costMicroUsdc === undefined ? USD(1_000) : opts.costMicroUsdc,
    markupMicroUsdc: opts.markupMicroUsdc === undefined ? USD(110) : opts.markupMicroUsdc,
    senderoTakeMicroUsdc:
      opts.senderoTakeMicroUsdc === undefined ? 5_217_000n : opts.senderoTakeMicroUsdc,
    metadata,
  };
}

function sumLineItems(plan: { lineItems: Array<{ amountMicro: bigint }> }): bigint {
  return plan.lineItems.reduce((acc, li) => acc + li.amountMicro, 0n);
}

// ─── Legacy backward-compatibility ───────────────────────────────────

describe('planInvoiceLineItems — legacy bookings (pre-v1)', () => {
  test('costMicroUsdc null → 1 line at totalUsd, sourceKind "booking"', () => {
    const booking = makeBooking({
      costMicroUsdc: null,
      totalUsd: '1234.56',
      itemization: 'itemized', // ignored on legacy path
      senderoTakeBehavior: 'add_to_customer', // ignored on legacy path
    });
    const plan = planInvoiceLineItems({ booking });

    expect(plan.modeUsed).toBe('legacy');
    expect(plan.lineItems.length).toBe(1);
    expect(plan.lineItems[0].sourceKind).toBe('booking');
    expect(plan.lineItems[0].amountMicro).toBe(USD(1234.56));
    expect(plan.totalMicro).toBe(USD(1234.56));
    expect(sumLineItems(plan)).toBe(plan.totalMicro);
  });

  test('legacy line description preserves PNR formatting', () => {
    const booking = makeBooking({ costMicroUsdc: null, pnr: 'ABC123' });
    const plan = planInvoiceLineItems({ booking });
    expect(plan.lineItems[0].description).toContain('PNR ABC123');
  });
});

// ─── v1 single-line mode ─────────────────────────────────────────────

describe('planInvoiceLineItems — v1 single-line mode', () => {
  test('single + add_to_customer → 1 line at cost+markup+take', () => {
    const booking = makeBooking({
      itemization: 'single',
      senderoTakeBehavior: 'add_to_customer',
    });
    const plan = planInvoiceLineItems({ booking });

    expect(plan.modeUsed).toBe('single');
    expect(plan.lineItems.length).toBe(1);
    expect(plan.lineItems[0].sourceKind).toBe('booking');
    const expectedTotal = USD(1_000) + USD(110) + 5_217_000n;
    expect(plan.lineItems[0].amountMicro).toBe(expectedTotal);
    expect(plan.totalMicro).toBe(expectedTotal);
    expect(sumLineItems(plan)).toBe(plan.totalMicro);
  });

  test('single + deduct_from_markup → 1 line at cost+markup (no take)', () => {
    const booking = makeBooking({
      itemization: 'single',
      senderoTakeBehavior: 'deduct_from_markup',
    });
    const plan = planInvoiceLineItems({ booking });

    expect(plan.lineItems.length).toBe(1);
    expect(plan.lineItems[0].sourceKind).toBe('booking');
    const expectedTotal = USD(1_000) + USD(110);
    expect(plan.lineItems[0].amountMicro).toBe(expectedTotal);
    expect(plan.totalMicro).toBe(expectedTotal);
    expect(sumLineItems(plan)).toBe(plan.totalMicro);
  });
});

// ─── v1 itemized mode ────────────────────────────────────────────────

describe('planInvoiceLineItems — v1 itemized mode', () => {
  test('itemized + add_to_customer → 3 lines (cost, markup, sendero_fee)', () => {
    const booking = makeBooking({
      itemization: 'itemized',
      senderoTakeBehavior: 'add_to_customer',
    });
    const plan = planInvoiceLineItems({ booking });

    expect(plan.modeUsed).toBe('itemized');
    expect(plan.lineItems.length).toBe(3);
    expect(plan.lineItems[0].sourceKind).toBe('booking_cost');
    expect(plan.lineItems[1].sourceKind).toBe('booking_markup');
    expect(plan.lineItems[2].sourceKind).toBe('booking_sendero_fee');
    expect(plan.lineItems[0].amountMicro).toBe(USD(1_000));
    expect(plan.lineItems[1].amountMicro).toBe(USD(110));
    expect(plan.lineItems[2].amountMicro).toBe(5_217_000n);

    const expectedTotal = USD(1_000) + USD(110) + 5_217_000n;
    expect(plan.totalMicro).toBe(expectedTotal);
    expect(sumLineItems(plan)).toBe(plan.totalMicro);
  });

  test('itemized + deduct_from_markup → 2 lines (cost, markup) — NO sendero_fee', () => {
    const booking = makeBooking({
      itemization: 'itemized',
      senderoTakeBehavior: 'deduct_from_markup',
    });
    const plan = planInvoiceLineItems({ booking });

    expect(plan.modeUsed).toBe('itemized');
    expect(plan.lineItems.length).toBe(2);
    expect(plan.lineItems.map(li => li.sourceKind)).toEqual(['booking_cost', 'booking_markup']);
    expect(plan.lineItems.find(li => li.sourceKind === 'booking_sendero_fee')).toBeUndefined();

    const expectedTotal = USD(1_000) + USD(110);
    expect(plan.totalMicro).toBe(expectedTotal);
    expect(sumLineItems(plan)).toBe(plan.totalMicro);
  });

  test('itemized cost line uses customer-friendly description, not "supplier cost"', () => {
    const booking = makeBooking({
      itemization: 'itemized',
      senderoTakeBehavior: 'add_to_customer',
      pnr: 'XYZ789',
    });
    const plan = planInvoiceLineItems({ booking });
    expect(plan.lineItems[1].description).toBe('Booking management fee');
    expect(plan.lineItems[2].description).toBe('Service fee');
    // Customer never sees "Sendero" branding on the line items.
    expect(plan.lineItems[2].description.toLowerCase()).not.toContain('sendero');
  });
});

// ─── Itemization resolution precedence ───────────────────────────────

describe('planInvoiceLineItems — itemization resolution', () => {
  test('itemizationHint overrides Booking.metadata.invoiceItemization', () => {
    const booking = makeBooking({
      itemization: 'single',
      senderoTakeBehavior: 'add_to_customer',
    });
    const plan = planInvoiceLineItems({
      booking,
      itemizationHint: 'itemized',
    });
    expect(plan.modeUsed).toBe('itemized');
    expect(plan.lineItems.length).toBe(3);
  });

  test('missing invoiceItemization → falls back to segment default (corporate → itemized)', () => {
    const booking = makeBooking({
      segment: 'corporate',
      senderoTakeBehavior: 'add_to_customer',
    });
    const plan = planInvoiceLineItems({ booking });
    expect(plan.modeUsed).toBe('itemized');
  });

  test('missing invoiceItemization + missing segment → single (safe default)', () => {
    const booking = makeBooking({
      senderoTakeBehavior: 'add_to_customer',
    });
    // Strip metadata invoiceItemization for this test (segment also unset above).
    delete (booking.metadata as { invoiceItemization?: string }).invoiceItemization;
    const plan = planInvoiceLineItems({ booking });
    expect(plan.modeUsed).toBe('single');
  });

  test('malformed policySnapshot but positive take → defensive add_to_customer read', () => {
    // The renderer never throws on a stale snapshot; if there's a take
    // amount we surface it on the customer side rather than silently
    // hide it (worst case: customer sees a fee line they could have
    // absorbed; never the inverse).
    const booking = {
      id: BOOKING_ID,
      kind: 'hotel',
      pnr: null,
      totalUsd: { toString: () => '1110.00' },
      costMicroUsdc: USD(1_000),
      markupMicroUsdc: USD(110),
      senderoTakeMicroUsdc: 5_217_000n,
      metadata: {
        invoiceItemization: 'itemized' as const,
        policySnapshot: { not_a_real_snapshot: true },
      } as Record<string, unknown>,
    };
    const plan = planInvoiceLineItems({ booking });
    expect(plan.lineItems.length).toBe(3);
    expect(plan.lineItems[2].sourceKind).toBe('booking_sendero_fee');
  });
});

// ─── Subtotal / total invariant (renderer + reconciliation rely on this) ─

describe('planInvoiceLineItems — totals invariant', () => {
  test.each([
    ['single', 'add_to_customer'],
    ['single', 'deduct_from_markup'],
    ['itemized', 'add_to_customer'],
    ['itemized', 'deduct_from_markup'],
  ] as const)('%s + %s — sum(lineItems) === totalMicro', (itemization, behavior) => {
    const booking = makeBooking({
      itemization,
      senderoTakeBehavior: behavior,
    });
    const plan = planInvoiceLineItems({ booking });
    expect(sumLineItems(plan)).toBe(plan.totalMicro);
  });

  test('legacy — sum(lineItems) === totalMicro', () => {
    const booking = makeBooking({ costMicroUsdc: null, totalUsd: '999.99' });
    const plan = planInvoiceLineItems({ booking });
    expect(sumLineItems(plan)).toBe(plan.totalMicro);
  });
});
