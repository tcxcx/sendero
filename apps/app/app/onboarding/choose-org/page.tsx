'use client';

import { OrganizationList } from '@clerk/nextjs';

export default function ChooseOrgPage() {
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
