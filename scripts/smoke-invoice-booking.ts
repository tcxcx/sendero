#!/usr/bin/env bun
/**
 * Booking invoice E2E:
 *   1. Seeds Tenant + Trip + Booking with externalId=<hex32>
 *   2. Invokes generateBookingInvoiceTool.handler directly
 *   3. Asserts Invoice row + LineItem + (optional) Payment + publicUrl + (optional) pdfBlobUrl
 *   4. Cleans up (optional — keep for inspection by default)
 *
 * Requires: DATABASE_URL, DIRECT_URL, INVOICE_SIGNING_SECRET.
 * Optional: BLOB_READ_WRITE_TOKEN (skips blob upload if absent),
 *           RESEND_API_KEY (skips email if absent).
 *
 * Usage: bun run smoke:invoice-booking
 */

import { prisma } from '../packages/database/src';
import { generateBookingInvoiceTool } from '../packages/tools/src/generate-booking-invoice';

const TEST_SUFFIX = `${Date.now()}`;
const TEST_TENANT_ID = `smoke-inv-${TEST_SUFFIX}`;
const TEST_USER_ID = `smoke-user-${TEST_SUFFIX}`;
const TEST_TRIP_ID = `smoke-trip-${TEST_SUFFIX}`;
const TEST_EXTERNAL = `0x${'a'.repeat(64)}`;
const SETTLE_TX = `0x${'b'.repeat(64)}`;

async function main() {
  console.log('--- Phase-11b booking-invoice smoke ---');

  // 1. Seed tenant, user, trip, booking
  const tenant = await prisma.tenant.create({
    data: {
      id: TEST_TENANT_ID,
      clerkOrgId: `org_smoke_${TEST_SUFFIX}`,
      slug: `smoke-inv-${TEST_SUFFIX}`,
      displayName: 'Smoke Invoice Tenant',
      legalName: 'Smoke Invoice Tenant LLC',
      taxId: 'SMOKE-TAX-1',
      billingTier: 'pro',
    },
  });

  const user = await prisma.user.create({
    data: {
      id: TEST_USER_ID,
      clerkUserId: `user_smoke_${TEST_SUFFIX}`,
      email: `smoke-traveler-${TEST_SUFFIX}@example.com`,
      displayName: 'Smoke Traveler',
    },
  });

  const trip = await prisma.trip.create({
    data: {
      id: TEST_TRIP_ID,
      tenantId: tenant.id,
      createdById: user.id,
      intent: {
        origin: 'SFO',
        dest: 'LHR',
        summary: 'SFO → LHR · smoke-test',
        budgetUsd: '1350.50',
      },
      status: 'booked',
      totalUsdc: '1350.50',
    },
  });

  const booking = await prisma.booking.create({
    data: {
      tenantId: tenant.id,
      tripId: trip.id,
      createdById: user.id,
      kind: 'flight',
      status: 'ticketed',
      externalId: TEST_EXTERNAL,
      pnr: 'ABC123',
      totalUsd: '1350.50',
    },
  });

  console.log(`seeded booking ${booking.id} externalId=${TEST_EXTERNAL}`);

  // 2. Invoke tool
  const result = (await generateBookingInvoiceTool.handler({
    bookingId: TEST_EXTERNAL,
    settleTxHash: SETTLE_TX,
  })) as {
    invoiceId: string;
    number: string;
    publicUrl: string;
    pdfBlobUrl: string | null;
    alreadyExisted: boolean;
  };
  console.log('tool result:', JSON.stringify(result, null, 2));

  // 3. Assert
  const invoice = await prisma.invoice.findUnique({
    where: { id: result.invoiceId },
    include: { lineItems: true, payments: true },
  });
  if (!invoice) throw new Error('invoice row not created');
  if (invoice.status !== 'sent' && invoice.status !== 'paid') throw new Error(`unexpected status=${invoice.status}`);
  if (invoice.lineItems.length !== 1) throw new Error(`expected 1 line item, got ${invoice.lineItems.length}`);
  if (invoice.payments.length !== 1) throw new Error(`expected 1 payment, got ${invoice.payments.length}`);
  if (invoice.payments[0].method !== 'escrow_settle') throw new Error('payment method != escrow_settle');
  if (!result.publicUrl.includes('/invoice/')) throw new Error('publicUrl malformed');

  console.log(`✓ invoice ${result.number} created with ${invoice.lineItems.length} line items + payment`);
  if (result.pdfBlobUrl) console.log(`  PDF: ${result.pdfBlobUrl}`);
  else console.log('  (no blob — BLOB_READ_WRITE_TOKEN not set or upload failed)');

  // 4. Idempotency check
  const second = (await generateBookingInvoiceTool.handler({
    bookingId: TEST_EXTERNAL,
    settleTxHash: SETTLE_TX,
  })) as { alreadyExisted: boolean; invoiceId: string };
  if (!second.alreadyExisted) throw new Error('idempotency broken — second call created a duplicate');
  if (second.invoiceId !== result.invoiceId) throw new Error('idempotency broken — different id');
  console.log('✓ idempotent (second call returned existing invoice)');

  console.log('--- SMOKE PASSED ---');
  console.log(`\nTo clean up manually:`);
  console.log(`  DELETE FROM invoices WHERE "tenantId" = '${tenant.id}';`);
  console.log(`  DELETE FROM bookings WHERE "tenantId" = '${tenant.id}';`);
  console.log(`  DELETE FROM trips WHERE "tenantId" = '${tenant.id}';`);
  console.log(`  DELETE FROM tenants WHERE id = '${tenant.id}';`);
  console.log(`  DELETE FROM users WHERE id = '${user.id}';`);
}

main()
  .catch(err => {
    console.error('✗ smoke failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
