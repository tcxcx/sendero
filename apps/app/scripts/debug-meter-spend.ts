/**
 * Debug script — investigate why /dashboard/spend shows $0 despite
 * recent paid meter events. Run with:
 *   bun apps/app/scripts/debug-meter-spend.ts
 */

import { prisma } from '@sendero/database';

async function main() {
  const tenants = await prisma.tenant.findMany({
    select: { id: true, displayName: true, billingTier: true },
    orderBy: { createdAt: 'desc' },
  });

  for (const t of tenants) {
    const total = await prisma.meterEvent.count({ where: { tenantId: t.id } });
    if (total === 0) continue;

    const byStatus = await prisma.meterEvent.groupBy({
      by: ['status'],
      where: { tenantId: t.id },
      _count: true,
      _sum: { priceMicroUsdc: true },
    });

    const byTool = await prisma.meterEvent.groupBy({
      by: ['toolName'],
      where: { tenantId: t.id, status: 'paid' },
      _count: true,
      _sum: { priceMicroUsdc: true },
    });

    console.log(`\n=== ${t.displayName} (${t.id}) tier=${t.billingTier} ===`);
    console.log(`total events: ${total}`);
    console.log('by status:');
    for (const s of byStatus) {
      const micro = s._sum.priceMicroUsdc ?? 0n;
      console.log(
        `  ${s.status.padEnd(10)} ${String(s._count).padStart(4)} events  ${micro.toString().padStart(12)} micro  $${(Number(micro) / 1_000_000).toFixed(6)}`
      );
    }
    console.log('paid events by tool:');
    for (const r of byTool) {
      const micro = r._sum.priceMicroUsdc ?? 0n;
      console.log(
        `  ${r.toolName.padEnd(28)} ${String(r._count).padStart(4)} calls  ${micro.toString().padStart(12)} micro  $${(Number(micro) / 1_000_000).toFixed(6)}`
      );
    }

    const last10 = await prisma.meterEvent.findMany({
      where: { tenantId: t.id },
      orderBy: { at: 'desc' },
      take: 10,
      select: {
        toolName: true,
        status: true,
        priceMicroUsdc: true,
        at: true,
        note: true,
      },
    });
    console.log('last 10 events:');
    for (const e of last10) {
      const usd = (Number(e.priceMicroUsdc) / 1_000_000).toFixed(6);
      console.log(
        `  ${e.at.toISOString()}  ${e.status.padEnd(10)} ${e.toolName.padEnd(28)} $${usd}  ${e.note ?? ''}`
      );
    }
  }

  await prisma.$disconnect();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
