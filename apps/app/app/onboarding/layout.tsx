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

  // Anti-loop guard: redirecting to /dashboard ONLY because Clerk
  // says onboardingComplete=true is unsafe — if the matching Tenant
  // row is missing in our DB (webhook failed, data reset, drift),
  // /dashboard will bounce right back to /onboarding via
  // requireCurrentTenant() and the user sees a flicker loop.
  //
  // Require BOTH conditions: Clerk flag AND a matching Tenant row.
  // If Clerk is ahead of the DB (the common drift mode), stay on
  // onboarding so the user can re-run the provisioning steps.
  const orgMeta = (sessionClaims?.org_metadata ?? {}) as { onboardingComplete?: boolean };
  if (orgMeta.onboardingComplete === true && orgId) {
    const tenant = await prisma.tenant.findUnique({
      where: { clerkOrgId: orgId },
      select: { id: true },
    });
    if (tenant) redirect('/dashboard');
  }
  return <>{children}</>;
}
