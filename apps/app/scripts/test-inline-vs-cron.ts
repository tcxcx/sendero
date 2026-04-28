/**
 * Head-to-head test: inline (per-turn) vs cron (batched) settlement.
 *
 * Resolves the QA Corporate tenant from `qa-logins.local.json`,
 * snapshots batch state, runs both phases against the same tenant,
 * then compares.
 *
 * Phase A (inline) — simulate 3 chat turns, settle each immediately.
 *   Expect: 3 NanopayBatch rows × 1 event each × $0.001 = 3 Arc tx.
 *
 * Phase B (cron)   — write 3 turns WITHOUT settling, then run one
 *                    sweep.
 *   Expect: 1 NanopayBatch × 3 events × $0.003 = 1 Arc tx.
 *
 * Same total USDC moves either way. Inline = real-time on-chain
 * visibility (one tx per turn). Cron = gas-efficient batching
 * (one tx for the whole sweep).
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { buildAndSettleBatch } from '@sendero/billing/batch';
import { prisma } from '@sendero/database';

import { makeBatchStore, makeSettleFn } from '../lib/nanopay-settle';

interface QaLogin {
  label: string;
  persona: string;
  userId: string;
  email: string;
}

async function resolveQaCorporateTenant(): Promise<{ id: string; displayName: string }> {
  const path = resolve(process.cwd(), '..', '..', 'qa-logins.local.json');
  const json = JSON.parse(readFileSync(path, 'utf-8')) as { users: QaLogin[] };
  const corp = json.users.find(u => u.label === 'QA Corporate');
  if (!corp) throw new Error('QA Corporate user not in qa-logins.local.json');

  const user = await prisma.user.findFirst({
    where: { clerkUserId: corp.userId },
    include: { memberships: { include: { tenant: true } } },
  });
  if (!user) throw new Error(`No User row for clerkUserId ${corp.userId}`);
  const tenant = user.memberships[0]?.tenant;
  if (!tenant) throw new Error('QA Corporate user has no tenant membership');
  return { id: tenant.id, displayName: tenant.displayName };
}

async function snapshot(tenantId: string) {
  const [batchCount, eventCount, sumPaid, sumUnsettled] = await Promise.all([
    prisma.nanopayBatch.count({ where: { tenantId } }),
    prisma.meterEvent.count({ where: { tenantId, status: 'paid' } }),
    prisma.meterEvent.aggregate({
      where: { tenantId, status: 'paid' },
      _sum: { priceMicroUsdc: true },
    }),
    prisma.meterEvent.count({ where: { tenantId, status: 'paid', settlementRef: null } }),
  ]);
  return {
    batchCount,
    eventCount,
    totalMicro: sumPaid._sum.priceMicroUsdc ?? 0n,
    unsettledCount: sumUnsettled,
  };
}

async function insertMeterEvent(tenantId: string, label: string) {
  return prisma.meterEvent.create({
    data: {
      tenantId,
      toolName: 'chat_reply',
      priceMicroUsdc: 1_000n,
      status: 'paid',
      note: `inline-vs-cron-test:${label}`,
      metadata: { test: 'inline-vs-cron', label },
    },
    select: { id: true },
  });
}

function microToUsd(micro: bigint): string {
  return `$${(Number(micro) / 1_000_000).toFixed(6)}`;
}

async function main() {
  const tenant = await resolveQaCorporateTenant();
  console.log(`\n=== Tenant: ${tenant.displayName} (${tenant.id}) ===`);

  const t0 = await snapshot(tenant.id);
  console.log(
    `[t0] batches=${t0.batchCount}  paid_events=${t0.eventCount}  total=${microToUsd(t0.totalMicro)}  unsettled=${t0.unsettledCount}`
  );

  // ── Phase A: inline (per-turn) ───────────────────────────────────
  console.log('\n──────── Phase A: inline (settle per turn) ────────');
  const phaseAStart = Date.now();
  const phaseATxs: string[] = [];
  for (let i = 1; i <= 3; i += 1) {
    const ev = await insertMeterEvent(tenant.id, `A-turn-${i}`);
    console.log(`  turn ${i}: meter=${ev.id} → settling…`);
    const result = await buildAndSettleBatch(makeBatchStore(), makeSettleFn(), {
      tenantId: tenant.id,
    });
    if (result.status !== 'settled') {
      throw new Error(`Phase A turn ${i} did not settle: ${JSON.stringify(result)}`);
    }
    console.log(
      `         batch=${result.batchId}  events=${result.eventCount}  total=${microToUsd(result.totalMicroUsdc)}  tx=${result.txHash}`
    );
    phaseATxs.push(result.txHash);
  }
  const phaseADuration = Date.now() - phaseAStart;
  const t1 = await snapshot(tenant.id);
  const phaseABatches = t1.batchCount - t0.batchCount;
  console.log(
    `[A done] +${phaseABatches} batches  +${t1.eventCount - t0.eventCount} events  Δtotal=${microToUsd(t1.totalMicro - t0.totalMicro)}  duration=${phaseADuration}ms  tx_count=${phaseATxs.length}`
  );

  // ── Phase B: cron (batched sweep) ────────────────────────────────
  console.log('\n──────── Phase B: cron (write 3, then sweep) ─────');
  const phaseBStart = Date.now();
  for (let i = 1; i <= 3; i += 1) {
    const ev = await insertMeterEvent(tenant.id, `B-turn-${i}`);
    console.log(`  turn ${i}: meter=${ev.id} (no settle)`);
  }
  const t1b = await snapshot(tenant.id);
  console.log(`  pre-sweep: unsettled=${t1b.unsettledCount}  expecting one batch at next sweep`);
  console.log('  → firing buildAndSettleBatch ONCE (cron-equivalent sweep)…');
  const sweep = await buildAndSettleBatch(makeBatchStore(), makeSettleFn(), {
    tenantId: tenant.id,
  });
  if (sweep.status !== 'settled') {
    throw new Error(`Phase B sweep did not settle: ${JSON.stringify(sweep)}`);
  }
  console.log(
    `         batch=${sweep.batchId}  events=${sweep.eventCount}  total=${microToUsd(sweep.totalMicroUsdc)}  tx=${sweep.txHash}`
  );
  const phaseBDuration = Date.now() - phaseBStart;
  const t2 = await snapshot(tenant.id);
  const phaseBBatches = t2.batchCount - t1.batchCount;
  console.log(
    `[B done] +${phaseBBatches} batches  +${t2.eventCount - t1.eventCount} events  Δtotal=${microToUsd(t2.totalMicro - t1.totalMicro)}  duration=${phaseBDuration}ms  tx_count=1`
  );

  // ── Summary table ─────────────────────────────────────────────────
  console.log('\n──────── Summary ────────');
  console.log('                      inline (A)    cron (B)');
  console.log(`  events written      3             3`);
  console.log(`  batches produced    ${phaseABatches}             ${phaseBBatches}`);
  console.log(`  arc tx fired        ${phaseATxs.length}             1`);
  console.log(
    `  total settled       ${microToUsd(t1.totalMicro - t0.totalMicro)}     ${microToUsd(t2.totalMicro - t1.totalMicro)}`
  );
  console.log(`  duration            ${phaseADuration}ms        ${phaseBDuration}ms`);
  console.log('\n  Same USDC moves either way. Inline = N tx (one per turn).');
  console.log('  Cron = 1 tx per sweep regardless of N.\n');

  console.log('Phase A txs:');
  for (const tx of phaseATxs) console.log(`  https://testnet.arcscan.app/tx/${tx}`);
  console.log('Phase B tx:');
  console.log(`  https://testnet.arcscan.app/tx/${sweep.txHash}`);

  await prisma.$disconnect();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
