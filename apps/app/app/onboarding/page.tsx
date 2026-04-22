'use client';

import { OrganizationList, useOrganization } from '@clerk/nextjs';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

type OrganizationMetadata = {
  onboardingComplete?: boolean;
  arcWalletAddress?: string;
};

function hasCompletedOnboarding(metadata: unknown) {
  return (metadata as OrganizationMetadata | undefined)?.onboardingComplete === true;
}

export default function OnboardingPage() {
  const { organization, isLoaded } = useOrganization();
  const router = useRouter();
  const [polling, setPolling] = useState(false);

  useEffect(() => {
    if (!organization) return;

    if (hasCompletedOnboarding(organization.publicMetadata)) {
      router.push('/app');
      return;
    }

    setPolling(true);
    const interval = setInterval(() => {
      void organization
        .reload()
        .then(reloaded => {
          if (hasCompletedOnboarding(reloaded.publicMetadata)) {
            router.push('/app');
          }
        })
        .catch(() => {});
    }, 2000);
    return () => clearInterval(interval);
  }, [organization, router]);

  if (!isLoaded) {
    return <div className="p-8 text-sm text-neutral-500">Loading…</div>;
  }

  if (!organization) {
    return (
      <main className="mx-auto max-w-xl p-8">
        <h1 className="text-2xl font-semibold mb-4">Welcome to Sendero</h1>
        <p className="text-neutral-600 mb-6">Create or select an organization to continue.</p>
        <OrganizationList
          hidePersonal
          afterCreateOrganizationUrl="/onboarding"
          afterSelectOrganizationUrl="/onboarding"
        />
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-xl p-8 text-center">
      <h1 className="text-2xl font-semibold mb-4">Provisioning {organization.name}…</h1>
      <p className="text-neutral-600 mb-6">
        Setting up your Arc treasury wallet. This takes a few seconds.
      </p>
      <div className="animate-pulse text-xs font-mono text-neutral-500">
        polling {polling ? '●' : '○'}
      </div>
    </main>
  );
}
