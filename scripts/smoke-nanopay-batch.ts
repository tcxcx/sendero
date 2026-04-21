#!/usr/bin/env bun
/**
 * End-to-end nanopay batch smoke. Inserts fake paid MeterEvents for a
 * test tenant, hits the cron endpoint, verifies an on-chain USDC
 * transfer settled with a real tx hash (NOT the legacy synthetic
 * 0xdemo/0xlive placeholders).
 *
 * Prereqs:
 *   - DATABASE_URL, SENDERO_TREASURY_ADDRESS, TREASURY_PRIVATE_KEY, CRON_SECRET
 *   - A running dev server (bun run dev) OR SMOKE_BASE_URL pointing at prod
 *   - Treasury EOA funded with USDC on Arc (use `bun run faucet:drip $TREASURY_VIEM_ADDRESS`)
 *
 * Usage: bun run smoke:nanopay
 */

// Relative import — the root package.json doesn't list @sendero/database
// as a workspace dep, so the symlink isn't planted at ./node_modules.
import { prisma } from '../packages/database/src';

const BASE_URL = process.env.SMOKE_BASE_URL ?? 'http://localhost:3000';
const CRON_SECRET = process.env.CRON_SECRET;
const TEST_TENANT_ID = process.env.SMOKE_TENANT_ID ?? 'smoke-test-tenant';
const TEST_TENANT_SLUG = 'smoke-test-tenant';
const TEST_CLERK_ORG = 'org_smoke_test_tenant';

async function main() {
  if (!CRON_SECRET) {
    console.error('✗ CRON_SECRET env var required');
    process.exit(1);
  }

  // Ensure the tenant row exists (cron filters by tenantId). Schema
  // requires clerkOrgId + slug + displayName; fabricate stable values
  // so repeat runs converge on the same row.
  await prisma.tenant.upsert({
    where: { id: TEST_TENANT_ID },
    update: {},
    create: {
      id: TEST_TENANT_ID,
      clerkOrgId: TEST_CLERK_ORG,
      slug: TEST_TENANT_SLUG,
      displayName: 'Smoke test tenant',
      billingTier: 'free',
    },
  });

  // Clear any previously stuck paid-but-unsettled events for this
  // tenant so we don't accidentally pick up leftovers from a prior run.
  // (Settled events have settlementRef != null and are ignored anyway.)
  // We intentionally DO NOT delete old batches — they're useful history.

  // Seed 3 paid MeterEvents totaling 300 micro USDC (= $0.0003).
  const at = new Date();
  const events = await Promise.all(
    Array.from({ length: 3 }).map((_, i) =>
      prisma.meterEvent.create({
        data: {
          tenantId: TEST_TENANT_ID,
          toolName: 'smoke_test',
          priceMicroUsdc: 100n,
          status: 'paid',
          at: new Date(at.getTime() - i * 60_000),
        },
        select: { id: true },
      })
    )
  );
  console.log(`seeded ${events.length} paid meter events (100 micro each)`);

  // Trigger the cron.
  const res = await fetch(`${BASE_URL}/api/cron/settle-nanopay-batches`, {
    headers: { authorization: `Bearer ${CRON_SECRET}` },
  });
  if (!res.ok) {
    console.error(`✗ cron returned ${res.status}: ${await res.text()}`);
    process.exit(1);
  }
  const body = (await res.json()) as unknown;
  console.log('cron response:', JSON.stringify(body, null, 2));

  // Verify a real batch row landed for our tenant.
  const batch = await prisma.nanopayBatch.findFirst({
    where: { tenantId: TEST_TENANT_ID },
    orderBy: { createdAt: 'desc' },
  });
  if (!batch) {
    console.error('✗ no batch row created for tenant', TEST_TENANT_ID);
    process.exit(1);
  }
  if (batch.status !== 'settled') {
    console.error(
      `✗ expected status=settled, got ${batch.status} (error: ${batch.error ?? 'none'}, retryCount: ${batch.retryCount})`
    );
    process.exit(1);
  }
  if (!batch.txHash || batch.txHash.startsWith('0xdemo') || batch.txHash.startsWith('0xlive')) {
    console.error(`✗ expected real tx hash, got synthetic: ${batch.txHash}`);
    process.exit(1);
  }
  console.log(`✓ batch settled with real tx: ${batch.txHash}`);
  console.log(`  https://testnet.arcscan.app/tx/${batch.txHash}`);
  console.log(`  totalMicroUsdc = ${batch.totalMicroUsdc}  eventCount = ${batch.eventCount}`);
}

main()
  .catch(err => {
    console.error('smoke failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
