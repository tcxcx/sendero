/**
 * Manually sync the QA Corporate treasury wallet's USDC/EURC balance from
 * Circle into the DB cache. Use after a fresh deposit when the event-monitor
 * webhook hasn't fired yet.
 *
 * Run:  bun scripts/sync-demo-treasury-balance.ts
 */

import { prisma } from '@sendero/database';
import { syncWalletBalance } from '@sendero/circle/balance-sync';

const TREASURY_ADDRESS = '0xfa5c635c1db7472a604d042355a184ef11af3204';

async function main() {
  const wallet = await prisma.circleWallet.findFirst({
    where: { address: TREASURY_ADDRESS, kind: 'treasury' },
  });
  if (!wallet?.circleWalletId) throw new Error('CircleWallet row missing or has no circleWalletId');

  const before = wallet.usdcBalanceMicro ?? 0n;

  const balances = await syncWalletBalance(
    {
      updateByCircleId: async (circleWalletId, patch) => {
        await prisma.circleWallet.updateMany({
          where: { circleWalletId },
          data: patch,
        });
      },
    },
    wallet.circleWalletId
  );

  console.log(`USDC before: ${Number(before) / 1e6} USDC`);
  console.log(`USDC now   : ${Number(balances.usdcMicro) / 1e6} USDC`);
  console.log(`EURC now   : ${Number(balances.eurcMicro) / 1e6} EURC`);
  await prisma.$disconnect();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
