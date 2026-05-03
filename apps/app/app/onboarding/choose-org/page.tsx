import { auth, clerkClient } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';

import { ChooseOrgClient } from './choose-org-client';

export const dynamic = 'force-dynamic';

export default async function ChooseOrgPage() {
  const { userId, orgId, sessionClaims } = await auth();
  if (!userId) redirect('/sign-in');

  // Travelers never reach here — defense in depth alongside proxy +
  // /onboarding/layout.
  const userMeta = (sessionClaims?.public_metadata ?? {}) as { kind?: string };
  if (userMeta.kind === 'traveler') redirect('/me');

  // Already in an org → operator flow continues.
  if (orgId) redirect('/onboarding');

  // Returning operator with exactly one org membership: skip the chooser
  // and land them on /dashboard. With Clerk's "force organization
  // selection" toggle off, the session no longer auto-picks the only
  // org, so we short-circuit here. The OrganizationList component is
  // still rendered for the multi-org / no-org case.
  const client = await clerkClient();
  const memberships = await client.users.getOrganizationMembershipList({
    userId,
    limit: 5,
  });
  if (memberships.totalCount === 1 && memberships.data[0]?.organization?.id) {
    // Render a tiny client component that calls setActive() then
    // navigates — the only way to switch the active org from a server
    // component is via a client-side Clerk hook.
    return (
      <ChooseOrgClient autoSelectOrganizationId={memberships.data[0].organization.id} />
    );
  }

  return <ChooseOrgClient />;
}
