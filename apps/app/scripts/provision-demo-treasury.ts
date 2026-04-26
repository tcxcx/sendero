/**
 * Provision the QA Corporate org's treasury Circle wallet for the demo.
 *
 * Idempotent: if a treasury wallet already exists, prints the address and
 * exits 0. Also stamps the address back onto Tenant.arcAddress so the UI
 * picks it up everywhere.
 *
 * Run:  bun scripts/provision-demo-treasury.ts
 */

import { prisma } from '@sendero/database';
import { provisionTenantWallet } from '@sendero/circle/provision-tenant-wallet';

const QA_CORPORATE_USER_ID = 'user_3Ch6n9weA3KflcBOm22hb6g4Upn';

async function main() {
  const user = await prisma.user.findFirst({
    where: { clerkUserId: QA_CORPORATE_USER_ID },
    include: { memberships: { include: { tenant: true } } },
  });
  if (!user) throw new Error(`No user row for clerkUserId=${QA_CORPORATE_USER_ID}`);

  const m = user.memberships[0];
  if (!m) throw new Error('User has no memberships');
  const tenant = m.tenant;

  console.log(`Tenant: ${tenant.id}  clerkOrg=${tenant.clerkOrgId}`);
  console.log(`Existing arcAddress: ${(tenant as any).arcAddress ?? '(unset)'}`);

  const result = await provisionTenantWallet({
    tenantId: tenant.id,
    clerkOrgId: tenant.clerkOrgId,
  });

  console.log(`\nProvisioned (alreadyExisted=${result.alreadyExisted}):`);
  console.log(`  walletSetId: ${result.walletSetId}`);
  console.log(`  walletId:    ${result.walletId}`);
  console.log(`  address:     ${result.address}`);

  // Stamp back onto Tenant.arcAddress so UI picks it up.
  if ((tenant as any).arcAddress?.toLowerCase() !== result.address.toLowerCase()) {
    await prisma.tenant.update({
      where: { id: tenant.id },
      data: { arcAddress: result.address.toLowerCase() } as any,
    });
    console.log(`\nUpdated Tenant.arcAddress → ${result.address}`);
  }

  console.log('\n────────────────────────────────────────');
  console.log('DEPOSIT 5000 USDC ON ARC-TESTNET TO:');
  console.log(`  ${result.address}`);
  console.log('────────────────────────────────────────');

  await prisma.$disconnect();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
