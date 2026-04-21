import { auth } from '@clerk/nextjs/server';
import { prisma, type Tenant } from '@sendero/database';
import { redirect } from 'next/navigation';

export async function requireCurrentTenant(): Promise<{
  tenant: Tenant;
  orgId: string;
  userId: string;
}> {
  const { userId, orgId } = await auth();
  if (!userId) redirect('/sign-in');
  if (!orgId) redirect('/onboarding/choose-org');

  const tenant = await prisma.tenant.findUnique({ where: { clerkOrgId: orgId } });
  if (!tenant) redirect('/onboarding');

  return { tenant, orgId, userId };
}
