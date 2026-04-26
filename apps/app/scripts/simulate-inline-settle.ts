/**
 * Simulate what /api/chat onFinish does on every metered turn:
 *   1. Insert a MeterEvent (status=paid, settlementRef=null)
 *   2. Call buildAndSettleBatch — same code path as the cron
 *   3. Verify the row got a settlementRef + a NanopayBatch landed
 */

import { buildAndSettleBatch } from '@sendero/billing/batch';
import { prisma } from '@sendero/database';

import { makeBatchStore, makeSettleFn } from '../lib/nanopay-settle';

const TENANT_ID = process.argv[2] ?? 'cmobokudg00008rxpgodqw1ct'; // Tomás's Org

async function main() {
  const tenant = await prisma.tenant.findUnique({
    where: { id: TENANT_ID },
    select: { id: true, displayName: true },
  });
  if (!tenant) throw new Error(`tenant ${TENANT_ID} not found`);

  const event = await prisma.meterEvent.create({
    data: {
      tenantId: tenant.id,
      toolName: 'chat_reply',
      priceMicroUsdc: 1_000n,
      status: 'paid',
      note: 'inline-settle simulation',
      metadata: { simulation: true, surface: 'simulate-inline-settle' },
    },
    select: { id: true, priceMicroUsdc: true },
  });
  console.log(
    `[sim] meter row: id=${event.id} price=${event.priceMicroUsdc.toString()} tenant=${tenant.displayName}`
  );

  console.log('[sim] firing buildAndSettleBatch…');
  const result = await buildAndSettleBatch(makeBatchStore(), makeSettleFn(), {
    tenantId: tenant.id,
  });
  console.log('[sim] result:', result);

  const row = await prisma.meterEvent.findUnique({
    where: { id: event.id },
    select: { settlementRef: true },
  });
  console.log(`[sim] post-settle settlementRef=${row?.settlementRef ?? 'NULL'}`);

  if (result.status === 'settled') {
    console.log(`[sim] ✓ tx: https://testnet.arcscan.app/tx/${result.txHash}`);
  }

  await prisma.$disconnect();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
