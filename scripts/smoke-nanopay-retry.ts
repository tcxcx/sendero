#!/usr/bin/env bun
/**
 * Nanopay retry queue smoke. Exercises buildAndSettleBatch + retrySettlingBatches
 * with a deterministic failing SettleFn to prove:
 *  1. Transient failure → batch stays in `settling` with retryCount=1
 *  2. Success on retry → batch transitions to `settled`
 *  3. MAX_RETRIES consecutive failures → batch transitions to `failed`
 *     (no alert dispatched in smoke; Slack alert is fire-and-forget
 *     best-effort from the cron route).
 *
 * Uses the same Prisma-backed BatchStore shape as the cron route. Seeds real
 * MeterEvents into a freshly created tenant; writes real NanopayBatch rows;
 * cleans up at end (regardless of pass/fail) so the DB stays pristine.
 *
 * No dev server needed — writes directly to Neon via Prisma.
 *
 * Usage: bun run smoke:retry
 */

// Relative import — matches smoke-nanopay-batch.ts (no workspace symlink
// at the root level for @sendero/database).
import { prisma } from '../packages/database/src';
import {
  buildAndSettleBatch,
  retrySettlingBatches,
  MAX_RETRIES,
  type BatchStore,
  type SettleFn,
} from '../packages/billing/src/batch';

const SUFFIX = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
const TENANT = `smoke-retry-${SUFFIX}`;

function makePrismaStore(): BatchStore {
  return {
    findClaimableEvents: async ({ tenantId, windowEndedAt, limit }) => {
      const events = await prisma.meterEvent.findMany({
        where: { tenantId, status: 'paid', settlementRef: null, at: { lte: windowEndedAt } },
        select: { id: true, priceMicroUsdc: true },
        orderBy: { at: 'asc' },
        take: limit,
      });
      return events;
    },
    openBatch: async args => {
      const row = await prisma.nanopayBatch.create({
        data: {
          tenantId: args.tenantId,
          status: 'pending',
          totalMicroUsdc: args.totalMicroUsdc,
          eventCount: args.eventCount,
          windowStartedAt: args.windowStartedAt,
          windowEndedAt: args.windowEndedAt,
        },
        select: { id: true },
      });
      return { id: row.id };
    },
    claimEventsForBatch: async ({ batchId, eventIds }) => {
      await prisma.meterEvent.updateMany({
        where: { id: { in: eventIds } },
        data: { settlementRef: batchId },
      });
    },
    updateBatchStatus: async args => {
      await prisma.nanopayBatch.update({
        where: { id: args.batchId },
        data: {
          status: args.status,
          txHash: args.txHash ?? undefined,
          error: args.error ?? undefined,
          settledAt: args.settledAt ?? undefined,
        },
      });
    },
    incrementRetry: async ({ batchId, lastError }) => {
      const row = await prisma.nanopayBatch.update({
        where: { id: batchId },
        data: { retryCount: { increment: 1 }, lastError },
        select: { retryCount: true },
      });
      return { retryCount: row.retryCount };
    },
    findSettlingBatches: async ({ olderThan, limit, maxRetryCount }) => {
      const rows = await prisma.nanopayBatch.findMany({
        where: {
          tenantId: TENANT,
          status: 'settling',
          updatedAt: { lte: olderThan },
          retryCount: { lt: maxRetryCount },
        },
        select: { id: true, tenantId: true, totalMicroUsdc: true, retryCount: true },
        orderBy: { updatedAt: 'asc' },
        take: limit,
      });
      return rows;
    },
  };
}

async function seed(count: number) {
  await prisma.tenant.upsert({
    where: { id: TENANT },
    update: {},
    create: {
      id: TENANT,
      // Tenant.clerkOrgId + slug are @unique; use the suffix so repeated runs don't collide.
      clerkOrgId: `org_${TENANT}`,
      slug: TENANT,
      displayName: 'Retry smoke',
      billingTier: 'free',
    },
  });
  for (let i = 0; i < count; i++) {
    await prisma.meterEvent.create({
      data: {
        tenantId: TENANT,
        toolName: 'smoke_retry',
        priceMicroUsdc: 100n,
        status: 'paid',
        at: new Date(Date.now() - i * 60_000),
      },
    });
  }
}

async function cleanup() {
  await prisma.meterEvent.deleteMany({ where: { tenantId: TENANT } });
  await prisma.nanopayBatch.deleteMany({ where: { tenantId: TENANT } });
  await prisma.tenant.delete({ where: { id: TENANT } }).catch(() => void 0);
}

async function scenarioA() {
  // Flake-once: first attempt fails, retry succeeds.
  console.log('\n── Scenario A: transient failure → retry succeeds ──');
  await seed(3);
  const store = makePrismaStore();
  let attempts = 0;
  const settle: SettleFn = async () => {
    attempts += 1;
    if (attempts === 1) throw new Error('smoke: injected flake');
    return { txHash: `0xsmoketx${attempts}` };
  };
  const r1 = await buildAndSettleBatch(store, settle, { tenantId: TENANT });
  if (r1.status !== 'retrying') {
    throw new Error(`expected retrying, got ${r1.status} (${JSON.stringify(r1)})`);
  }
  if (r1.retryCount !== 1) {
    throw new Error(`expected retryCount=1, got ${r1.retryCount}`);
  }
  console.log(`  ✓ first attempt → retrying (retryCount=${r1.retryCount})`);

  const r2 = await retrySettlingBatches(store, settle, { olderThanMs: 0 });
  if (r2.length !== 1) throw new Error(`expected 1 batch swept, got ${r2.length}`);
  const swept = r2[0];
  if (swept.status !== 'settled') {
    throw new Error(`expected settled, got ${swept.status} (${JSON.stringify(swept)})`);
  }
  console.log(`  ✓ retry sweep → settled (tx=${swept.txHash})`);

  // Verify the row on disk.
  const persisted = await prisma.nanopayBatch.findUnique({ where: { id: swept.batchId } });
  if (!persisted) throw new Error('batch not persisted');
  if (persisted.status !== 'settled') {
    throw new Error(`DB row status != settled: ${persisted.status}`);
  }
  if (!persisted.txHash) throw new Error('DB row missing txHash');
  console.log(`  ✓ DB row confirms status=settled txHash=${persisted.txHash}`);

  await cleanup();
}

async function scenarioB() {
  console.log(`\n── Scenario B: ${MAX_RETRIES} consecutive failures → failed ──`);
  await seed(3);
  const store = makePrismaStore();
  const settle: SettleFn = async () => {
    throw new Error('smoke: permanent fail');
  };

  const r1 = await buildAndSettleBatch(store, settle, { tenantId: TENANT });
  if (r1.status !== 'retrying' || r1.retryCount !== 1) {
    throw new Error(`round 1 mismatch: ${JSON.stringify(r1)}`);
  }
  console.log(`  ✓ round 1: retrying (retryCount=1)`);

  const r2 = await retrySettlingBatches(store, settle, { olderThanMs: 0 });
  if (r2.length !== 1 || r2[0].status !== 'retrying' || r2[0].retryCount !== 2) {
    throw new Error(`round 2 mismatch: ${JSON.stringify(r2)}`);
  }
  console.log(`  ✓ round 2: retrying (retryCount=2)`);

  const r3 = await retrySettlingBatches(store, settle, { olderThanMs: 0 });
  if (r3.length !== 1 || r3[0].status !== 'failed' || r3[0].retryCount !== MAX_RETRIES) {
    throw new Error(`round 3 mismatch: ${JSON.stringify(r3)}`);
  }
  console.log(`  ✓ round 3: failed (retryCount=${MAX_RETRIES})`);

  // Verify row on disk shows status=failed with error string.
  const persisted = await prisma.nanopayBatch.findUnique({ where: { id: r3[0].batchId } });
  if (!persisted) throw new Error('batch not persisted');
  if (persisted.status !== 'failed') {
    throw new Error(`DB row status != failed: ${persisted.status}`);
  }
  if (!persisted.error) throw new Error('DB row missing error string');
  console.log(`  ✓ DB row confirms status=failed error="${persisted.error.slice(0, 40)}..."`);

  await cleanup();
}

async function main() {
  try {
    await scenarioA();
    await scenarioB();
    console.log('\n✓ retry smoke passed');
  } finally {
    await cleanup();
    await prisma.$disconnect();
  }
}

main().catch(err => {
  console.error('✗ retry smoke failed:', err);
  prisma
    .$disconnect()
    .catch(() => void 0)
    .finally(() => process.exit(1));
});
