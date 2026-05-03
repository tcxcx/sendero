'use client';

import { OrganizationList, useOrganizationList } from '@clerk/nextjs';
import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';

interface ChooseOrgClientProps {
  /**
   * When set, attempts to call setActive({ organization: id }) once the
   * Clerk SDK is loaded and routes to /dashboard. Server-side resolved
   * for returning operators with exactly one org membership.
   */
  autoSelectOrganizationId?: string;
}

export function ChooseOrgClient({ autoSelectOrganizationId }: ChooseOrgClientProps) {
  const { isLoaded, setActive } = useOrganizationList();
  const router = useRouter();
  const ranOnce = useRef(false);

  useEffect(() => {
    if (!autoSelectOrganizationId || !isLoaded || !setActive || ranOnce.current) return;
    ranOnce.current = true;
    void setActive({ organization: autoSelectOrganizationId }).then(() => {
      router.replace('/onboarding');
    });
  }, [autoSelectOrganizationId, isLoaded, setActive, router]);

  if (autoSelectOrganizationId) {
    return (
      <main className="mx-auto max-w-xl p-8">
        <p className="text-sm text-muted-foreground">Activating your organization…</p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-xl p-8">
      <h1 className="text-2xl font-semibold mb-4">Choose an organization</h1>
      <OrganizationList
        hidePersonal
        afterCreateOrganizationUrl="/onboarding"
        afterSelectOrganizationUrl="/onboarding"
      />
    </main>
  );
}
