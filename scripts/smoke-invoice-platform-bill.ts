#!/usr/bin/env bun
/**
 * Platform bill cron smoke:
 *   1. Seeds Tenant + 5 paid MeterEvents in the prior month
 *   2. Hits /api/cron/generate-platform-bills with Bearer CRON_SECRET
 *   3. Asserts invoice created, MeterEvents stamped, total matches
 *
 * Requires: dev server on :3010 (or SMOKE_BASE_URL), CRON_SECRET,
 *           DATABASE_URL, INVOICE_SIGNING_SECRET.
 *
 * Usage:
 *   bun run dev &
 *   sleep 6
 *   bun run smoke:invoice-platform-bill
 */

import { prisma } from '../packages/database/src';

const BASE_URL = process.env.SMOKE_BASE_URL ?? 'http://localhost:3010';
const CRON_SECRET = process.env.CRON_SECRET;
const TEST_SUFFIX = `${Date.now()}`;
const TEST_TENANT = `smoke-pb-${TEST_SUFFIX}`;

async function main() {
  if (!CRON_SECRET) {
    console.error('✗ CRON_SECRET not set');
    process.exit(1);
  }

  console.log('--- Phase-11b platform-bill smoke ---');

  // Seed tenant + prior-month events
  await prisma.tenant.create({
    data: {
      id: TEST_TENANT,
      clerkOrgId: `org_smoke_pb_${TEST_SUFFIX}`,
      slug: `smoke-pb-${TEST_SUFFIX}`,
      displayName: 'Smoke Platform-Bill Tenant',
      billingTier: 'pro',
      billingContactEmail: 'smoke-pb@example.com',
    },
  });

  const now = new Date();
  const priorMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 15, 12, 0, 0));

  const eventIds: string[] = [];
  for (let i = 0; i < 5; i++) {
    const e = await prisma.meterEvent.create({
      data: {
        tenantId: TEST_TENANT,
        toolName: i % 2 === 0 ? 'search_flights' : 'chat',
        priceMicroUsdc: 100n,
        status: 'paid',
        at: new Date(priorMonth.getTime() - i * 60_000),
      },
      select: { id: true },
    });
    eventIds.push(e.id);
  }
  console.log(`seeded ${eventIds.length} meter events`);

  // Hit cron
  const res = await fetch(`${BASE_URL}/api/cron/generate-platform-bills`, {
    headers: { authorization: `Bearer ${CRON_SECRET}` },
  });
  if (!res.ok) {
    console.error(`✗ cron returned ${res.status}: ${await res.text()}`);
    process.exit(1);
  }
  const body = await res.json();
  const ourResult = (body.results as Array<{ tenantId: string; outcome: string; invoiceId?: string; totalMicro?: string; eventCount?: number }>)
    .find(r => r.tenantId === TEST_TENANT);
  if (!ourResult) {
    console.error('✗ our tenant missing from cron results');
    console.error(JSON.stringify(body, null, 2));
    process.exit(1);
  }
  if (ourResult.outcome !== 'invoiced') {
    console.error('✗ unexpected outcome:', JSON.stringify(ourResult));
    process.exit(1);
  }
  if (ourResult.eventCount !== 5) throw new Error(`eventCount != 5: ${ourResult.eventCount}`);
  if (ourResult.totalMicro !== '500') throw new Error(`totalMicro != 500: ${ourResult.totalMicro}`);

  console.log(`✓ invoice ${ourResult.invoiceId} created for ${TEST_TENANT}`);

  // Verify MeterEvents stamped
  const stamped = await prisma.meterEvent.findMany({
    where: { id: { in: eventIds }, invoiceRef: ourResult.invoiceId },
    select: { id: true },
  });
  if (stamped.length !== 5) throw new Error(`only ${stamped.length}/5 meter events stamped`);
  console.log('✓ all 5 meter events stamped with invoiceRef');

  // Second run: should be empty for our tenant
  const res2 = await fetch(`${BASE_URL}/api/cron/generate-platform-bills`, {
    headers: { authorization: `Bearer ${CRON_SECRET}` },
  });
  const body2 = await res2.json();
  const ourSecond = (body2.results as Array<{ tenantId: string; outcome: string }>)
    .find(r => r.tenantId === TEST_TENANT);
  if (ourSecond) {
    console.error('✗ idempotency broken — tenant re-appeared in second run:', ourSecond);
    process.exit(1);
  }
  console.log('✓ idempotent (tenant skipped on second run)');

  console.log('--- SMOKE PASSED ---');
  console.log(`\nTo clean up manually:`);
  console.log(`  DELETE FROM invoices WHERE "tenantId" = '${TEST_TENANT}';`);
  console.log(`  DELETE FROM meter_events WHERE "tenantId" = '${TEST_TENANT}';`);
  console.log(`  DELETE FROM tenants WHERE id = '${TEST_TENANT}';`);
}

main()
  .catch(err => {
    console.error('✗ smoke failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
