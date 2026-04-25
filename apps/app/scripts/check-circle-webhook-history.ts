/**
 * Inspect recent Circle webhook deliveries so we know whether the
 * Console-registered webhook URL is firing for our wallets.
 *
 * Run:  bun scripts/check-circle-webhook-history.ts
 */

import { prisma } from '@sendero/database';

async function main() {
  // The DurableWebhook table dedupes inbound webhooks by externalId.
  // Each row is one Circle notification we successfully processed.
  const recent = await prisma.webhookEvent.findMany({
    where: { provider: 'circle' },
    orderBy: { receivedAt: 'desc' },
    take: 10,
  });
  console.log(`Recent Circle webhooks (${recent.length}):`);
  for (const w of recent) {
    console.log(
      `  ${w.receivedAt.toISOString()}  type=${w.eventType}  ${w.externalId.slice(0, 60)}`
    );
  }
  if (recent.length === 0) {
    console.log('  (none — Circle Console webhook may not be registered)');
  }
  await prisma.$disconnect();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
