import { CreateOrganization } from '@clerk/nextjs';

export const dynamic = 'force-dynamic';

export default function CreateOrganizationPage() {
  return (
    <main className="mx-auto max-w-xl p-8">
      <h1 className="text-2xl font-semibold mb-1">Create a new workspace</h1>
      <p className="text-neutral-600 mb-6 text-sm">
        Spin up a fresh tenant. Sendero will provision its Arc treasury wallet and tools next.
      </p>
      <CreateOrganization afterCreateOrganizationUrl="/onboarding" skipInvitationScreen />
    </main>
  );
}
