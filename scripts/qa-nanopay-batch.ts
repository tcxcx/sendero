import { prisma } from '../packages/database/src';

async function main() {
  const since = new Date(Date.now() - 60 * 60 * 1000);

  // Recent NanopayBatch state — has cron run? Are batches settling?
  const batches = await prisma.nanopayBatch.findMany({
    where: { createdAt: { gte: since } },
    orderBy: { createdAt: 'desc' },
    take: 5,
    select: {
      id: true,
      tenantId: true,
      status: true,
      createdAt: true,
      settledAt: true,
      txHash: true,
      totalMicroUsdc: true,
    },
  });

  console.log(`NanopayBatch in last 60min: ${batches.length}`);
  for (const b of batches) {
    const usd = (Number(b.totalMicroUsdc) / 1_000_000).toFixed(6);
    console.log(
      `  ${b.id.slice(0, 16)} tenant=${b.tenantId.slice(0, 16)} status=${b.status.padEnd(10)} created=${b.createdAt.toISOString().slice(11, 19)}Z settled=${b.settledAt?.toISOString().slice(11, 19) ?? '-'} total=$${usd} tx=${b.txHash?.slice(0, 12) ?? '-'}`
    );
  }

  // Unbatched MeterEvent rows (status=paid, settlementRef IS NULL) — pending settlement
  const pending = await prisma.meterEvent.count({
    where: {
      tenantId: 'cmo9hhqg60001zwr3ygpfqns4',
      status: 'paid',
      settlementRef: null,
    },
  });
  const settled = await prisma.meterEvent.count({
    where: {
      tenantId: 'cmo9hhqg60001zwr3ygpfqns4',
      status: 'paid',
      settlementRef: { not: null },
    },
  });
  console.log(`\nMeterEvents for tenant cmo9hhqg6...:`);
  console.log(`  pending settlement (settlementRef IS NULL): ${pending}`);
  console.log(`  settled (settlementRef IS NOT NULL):        ${settled}`);

  // Recent settled events
  const recentSettled = await prisma.meterEvent.findMany({
    where: {
      tenantId: 'cmo9hhqg60001zwr3ygpfqns4',
      settlementRef: { not: null },
    },
    orderBy: { at: 'desc' },
    take: 3,
    select: { id: true, at: true, settlementRef: true, priceMicroUsdc: true },
  });
  for (const r of recentSettled) {
    const usd = (Number(r.priceMicroUsdc) / 1_000_000).toFixed(6);
    console.log(`  → ${r.id.slice(0, 8)} ${r.at.toISOString().slice(0, 19)} settledTo=${r.settlementRef?.slice(0, 24)} $${usd}`);
  }

  await prisma.$disconnect();
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
