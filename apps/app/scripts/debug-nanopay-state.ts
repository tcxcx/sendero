/**
 * Why don't nanopayments flow on-chain? Inspect:
 *   - unsettled MeterEvents per tenant
 *   - existing NanopayBatches + their status
 *   - env vars the cron requires (SENDERO_TREASURY_ADDRESS,
 *     CRON_SECRET, the Circle keys @sendero/nanopayments needs)
 */

import { prisma } from '@sendero/database';

async function main() {
  // ── env ───────────────────────────────────────────────────────────
  const envChecks = [
    'CRON_SECRET',
    'SENDERO_TREASURY_ADDRESS',
    'SENDERO_NETWORK_MODE',
    'CIRCLE_API_KEY',
    'CIRCLE_ENTITY_SECRET',
    'SENDERO_TREASURY_WALLET_ID',
    'SENDERO_PLATFORM_TREASURY_WALLET_ID',
    'DATABASE_URL_UNPOOLED',
  ];
  console.log('=== Env present? ===');
  for (const k of envChecks) {
    const v = process.env[k];
    console.log(`  ${k.padEnd(40)} ${v ? '✓ set' : '✗ MISSING'}`);
  }

  // ── meter event settlement state ───────────────────────────────────
  console.log('\n=== Per-tenant unsettled paid events ===');
  const tenants = await prisma.tenant.findMany({
    select: { id: true, displayName: true },
  });
  for (const t of tenants) {
    const total = await prisma.meterEvent.count({
      where: { tenantId: t.id, status: 'paid' },
    });
    if (total === 0) continue;
    const unsettled = await prisma.meterEvent.count({
      where: { tenantId: t.id, status: 'paid', settlementRef: null },
    });
    const settled = total - unsettled;
    const sumUnsettled = await prisma.meterEvent.aggregate({
      where: { tenantId: t.id, status: 'paid', settlementRef: null },
      _sum: { priceMicroUsdc: true },
    });
    const microUnsettled = sumUnsettled._sum.priceMicroUsdc ?? 0n;
    console.log(
      `  ${t.displayName.padEnd(36)} paid=${String(total).padStart(3)} settled=${String(settled).padStart(3)} unsettled=${String(unsettled).padStart(3)} unsettled$=${(Number(microUnsettled) / 1_000_000).toFixed(6)}`
    );
  }

  // ── nanopay batches ────────────────────────────────────────────────
  console.log('\n=== Recent NanopayBatches ===');
  const batches = await prisma.nanopayBatch.findMany({
    orderBy: { createdAt: 'desc' },
    take: 20,
    select: {
      id: true,
      tenantId: true,
      status: true,
      totalMicroUsdc: true,
      eventCount: true,
      txHash: true,
      retryCount: true,
      lastError: true,
      createdAt: true,
      settledAt: true,
    },
  });
  if (batches.length === 0) {
    console.log('  (none)  ← cron has never produced a batch');
  }
  for (const b of batches) {
    const usd = (Number(b.totalMicroUsdc) / 1_000_000).toFixed(6);
    console.log(
      `  ${b.createdAt.toISOString()}  ${b.status.padEnd(9)} $${usd.padStart(10)} (${b.eventCount} events)  retries=${b.retryCount}  tx=${b.txHash ?? '—'}  err=${b.lastError?.slice(0, 80) ?? ''}`
    );
  }

  await prisma.$disconnect();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
