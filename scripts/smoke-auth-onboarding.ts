#!/usr/bin/env bun
/**
 * Manual-gated auth + onboarding smoke. Pre-flights env + DB, then prints
 * the 4 steps to run in a browser. Not automated — requires a real human
 * signup because passkey + email verification can't be scripted.
 *
 * Usage: bun run smoke:auth-onboarding
 */

import { prisma } from '../packages/database/src';

const BASE_URL = process.env.SMOKE_BASE_URL ?? 'http://localhost:3010';

async function main() {
  console.log('--- Phase-11c1 auth + onboarding smoke (manual-gated) ---\n');

  const requiredEnvs = [
    'CLERK_SECRET_KEY',
    'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY',
    'CLERK_WEBHOOK_SECRET',
    'DATABASE_URL',
  ];
  const missing = requiredEnvs.filter(k => !process.env[k]);
  if (missing.length > 0) {
    console.error('✗ Missing envs:', missing.join(', '));
    process.exit(1);
  }
  console.log('✓ Required envs present');

  const tenantCount = await prisma.tenant.count();
  const userCount = await prisma.user.count();
  const walletCount = await prisma.circleWallet.count();
  console.log(`  DB state: ${tenantCount} tenants, ${userCount} users, ${walletCount} circle wallets`);

  console.log('\nNow do these in a browser:');
  console.log(`1. Open ${BASE_URL}/sign-up — create a new user with an email you have access to.`);
  console.log(`2. After verification, Clerk redirects → /onboarding. Page shows OrganizationList.`);
  console.log(`3. Create an organization ("Acme Travel"). Webhook fires → Tenant row created → CircleWallet provisioned → org.publicMetadata updated.`);
  console.log(`4. /onboarding polls org.publicMetadata.onboardingComplete → flips to true → redirect to /app.`);
  console.log(`5. Open ${BASE_URL}/app/profile — should render <UserDetails/> with Clerk session + wallet row.`);

  console.log('\nAfter completion, re-run this script. Counts should be +1 tenant, +1 user, +1 wallet.');
  await prisma.$disconnect();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
