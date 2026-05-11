import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';

import { prisma } from '@sendero/database';

export default async function OnboardingLayout({ children }: { children: React.ReactNode }) {
  const { sessionClaims, orgId } = await auth();

  // Travelers (B2C) must never reach operator onboarding — defense in
  // depth alongside the proxy gate. Stops manual URL navigation, deep
  // links, and any leftover redirects.
  const userMeta = (sessionClaims?.public_metadata ?? {}) as { kind?: string };
  if (userMeta.kind === 'traveler') redirect('/me');

  // Anti-loop + retry guards. We redirect to /dashboard when either:
  //   a. The stamped state machine in Tenant.metadata.provisioning says
  //      `currentStage = 'done'` (the DB is truth, no waiting on JWT
  //      refresh), OR
  //   b. The legacy flag pair `onboardingComplete === true` AND the
  //      chain-appropriate wallet column is set (back-compat with
  //      pre-state-machine tenants).
  //
  // Without either, the user stays on /onboarding so they can hit Retry
  // without bouncing back from /dashboard's requireCurrentTenant().
  // `?retry=1` lets the user explicitly re-run setup regardless.
  if (orgId) {
    const tenant = await prisma.tenant.findUnique({
      where: { clerkOrgId: orgId },
      select: {
        id: true,
        primaryChain: true,
        arcAddress: true,
        metadata: true,
      },
    });
    if (tenant) {
      // DB-truth path.
      const provisioning =
        tenant.metadata && typeof tenant.metadata === 'object'
          ? ((tenant.metadata as Record<string, unknown>).provisioning as
              | { currentStage?: string }
              | undefined)
          : undefined;
      const stateMachineDone = provisioning?.currentStage === 'done';

      // Legacy session-driven path.
      const orgMeta = (sessionClaims?.org_metadata ?? {}) as {
        onboardingComplete?: boolean;
        solTreasuryAddress?: string;
      };
      const legacyWalletReady =
        orgMeta.onboardingComplete === true &&
        (tenant.primaryChain === 'sol'
          ? Boolean(orgMeta.solTreasuryAddress)
          : Boolean(tenant.arcAddress));

      if (stateMachineDone || legacyWalletReady) redirect('/dashboard');
    }
  }
  return <>{children}</>;
}
