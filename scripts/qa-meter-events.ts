import { prisma } from '../packages/database/src';

async function main() {
  const since = new Date(Date.now() - 5 * 60 * 1000);
  const rows = await prisma.meterEvent.findMany({
    where: {
      tenantId: 'cmo9hhqg60001zwr3ygpfqns4',
      at: { gte: since },
    },
    orderBy: { at: 'desc' },
    take: 10,
    select: {
      id: true,
      at: true,
      toolName: true,
      priceMicroUsdc: true,
      status: true,
      note: true,
      metadata: true,
    },
  });
  console.log(`MeterEvents in last 5min for tenant cmo9hhqg6...: ${rows.length}`);
  for (const r of rows) {
    const meta = r.metadata as Record<string, unknown> | null;
    const turnId = meta?.turnId ?? '-';
    const surface = meta?.surface ?? '-';
    const toolNames = Array.isArray(meta?.toolNames) ? (meta.toolNames as string[]).join(',') : '-';
    const priceUsd = (Number(r.priceMicroUsdc) / 1_000_000).toFixed(6);
    console.log(
      `  ${r.id.slice(0, 16)} at=${r.at.toISOString().slice(11, 19)}Z tool=${r.toolName.padEnd(12)} price=$${priceUsd} status=${r.status} turnId=${turnId} surface=${surface} tools=[${toolNames}]`
    );
  }
  await prisma.$disconnect();
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
