/**
 * Look up the QA Corporate org's treasury wallet so we can deposit demo USDC.
 *
 * Run with:  bun scripts/lookup-demo-treasury.ts
 */

import { prisma } from '@sendero/database';

const QA_CORPORATE_USER_ID = 'user_3Ch6n9weA3KflcBOm22hb6g4Upn';

async function main() {
  const user = await prisma.user.findFirst({
    where: { clerkUserId: QA_CORPORATE_USER_ID },
    include: { memberships: { include: { tenant: true } } },
  });
  if (!user) {
    console.error('User row not found for clerkUserId', QA_CORPORATE_USER_ID);
    process.exit(1);
  }

  console.log('User:', user.id, user.email);
  for (const m of user.memberships) {
    console.log(
      `\nMembership · tenant=${m.tenant.id} clerkOrg=${m.tenant.clerkOrgId} role=${m.role}`
    );
    console.log('  Tenant.arcAddress:', (m.tenant as any).arcAddress ?? '(not set)');

    const wallets = await prisma.circleWallet.findMany({
      where: { tenantId: m.tenant.id },
    });
    if (wallets.length === 0) {
      console.log('  CircleWallets: (none)');
    } else {
      for (const w of wallets) {
        console.log(
          `  · ${w.kind.padEnd(12)} ${w.address}  USDC=${w.usdcBalanceMicro ?? 0n}  EURC=${w.eurcBalanceMicro ?? 0n}`
        );
      }
    }
  }

  await prisma.$disconnect();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
