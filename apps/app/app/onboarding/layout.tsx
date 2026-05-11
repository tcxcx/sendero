import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';

import { prisma } from '@sendero/database';

export default async function OnboardingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { sessionClaims, orgId } = await auth();

  // Travelers (B2C) must never reach operator onboarding — defense in
  // depth alongside the proxy gate. Stops manual URL navigation, deep
  // links, and any leftover redirects.
  const userMeta = (sessionClaims?.public_metadata ?? {}) as { kind?: string };
  if (userMeta.kind === 'traveler') redirect('/me');

  // Anti-loop + retry guards:
  //
  //   1. Require BOTH Clerk's onboardingComplete flag AND a matching
  //      Tenant row in DB before redirecting to /dashboard. Without
  //      this, a stale flag (cached JWT, DB reset) creates a flicker
  //      loop via /dashboard's requireCurrentTenant().
  //   2. ALSO require the chain-appropriate wallet to be set on the
  //      Tenant. A partial provisioning leaves the Tenant row created
  //      but `arcAddress` / `solTreasuryAddress` null — those users
  //      bounce back to /onboarding from /dashboard's OnboardingAlert
  //      with `?retry=1` and need to re-run deployWithChain.
  //   3. Honor `?retry=1` to let the user explicitly re-run setup
  //      without arguing about it. Used by the OnboardingAlert's
  //      "Finish setup →" button.
  const orgMeta = (sessionClaims?.org_metadata ?? {}) as { onboardingComplete?: boolean };
  if (orgMeta.onboardingComplete === true && orgId) {
    const tenant = await prisma.tenant.findUnique({
      where: { clerkOrgId: orgId },
      select: {
        id: true,
        primaryChain: true,
        arcAddress: true,
      },
    });
    if (tenant) {
      const walletReady =
        tenant.primaryChain === 'sol'
          ? Boolean(
              (sessionClaims?.org_metadata as Record<string, unknown> | undefined)
                ?.solTreasuryAddress
            )
          : Boolean(tenant.arcAddress);
      if (walletReady) redirect('/dashboard');
    }
  }
  return <>{children}</>;
}
