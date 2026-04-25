/**
 * Add the Sendero Dogfood user as an admin member of the QA Corporate
 * org so headless browse can sign in as Dogfood (Clerk test pattern,
 * accepts code 424242) and operate inside QA Corporate's tenant.
 *
 * Run:  bun scripts/add-dogfood-to-qa-corporate.ts
 */

import { createClerkClient } from '@clerk/backend';
import { prisma } from '@sendero/database';

const QA_CORPORATE_ORG_ID = 'org_3Ch6nJC0dsd4rsQ4MdqeLYyfjKz';
const DOGFOOD_USER_ID = 'user_3Ch9cj7CYNxFjG4qe4zLFeJrVpr';
const TENANT_ID = 'cmo9g3ido0008g6c9padbnu2k';

async function main() {
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) throw new Error('CLERK_SECRET_KEY required');
  const clerk = createClerkClient({ secretKey });

  // 1. Add Dogfood to the Clerk org as admin (idempotent).
  try {
    const m = await clerk.organizations.createOrganizationMembership({
      organizationId: QA_CORPORATE_ORG_ID,
      userId: DOGFOOD_USER_ID,
      role: 'org:admin',
    });
    console.log(`Clerk membership added: ${m.id} (role=${m.role})`);
  } catch (err: any) {
    if (
      err?.errors?.[0]?.code === 'duplicate_record' ||
      err?.errors?.[0]?.code === 'already_a_member_in_organization'
    ) {
      console.log('Clerk membership already exists');
    } else {
      console.error('clerk error:', JSON.stringify(err?.errors, null, 2));
      throw err;
    }
  }

  // 2. Mirror to Prisma — TenantMembership row.
  const dogfoodUser = await prisma.user.findFirst({
    where: { clerkUserId: DOGFOOD_USER_ID },
  });
  if (!dogfoodUser) {
    console.log('Dogfood User row not in Prisma yet — Clerk webhook will sync on next sign-in');
  } else {
    const existing = await prisma.membership.findFirst({
      where: { tenantId: TENANT_ID, userId: dogfoodUser.id },
    });
    if (existing) {
      console.log(`Prisma membership already exists: ${existing.id} role=${existing.role}`);
    } else {
      const created = await prisma.membership.create({
        data: {
          tenantId: TENANT_ID,
          userId: dogfoodUser.id,
          role: 'agency_admin',
        },
      });
      console.log(`Prisma membership created: ${created.id}`);
    }
  }

  await prisma.$disconnect();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
