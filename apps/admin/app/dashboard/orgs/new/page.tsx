import { CreateOrganization } from '@clerk/nextjs';
import { redirect } from 'next/navigation';

import { requirePlatformRole } from '@/lib/access';

export default async function NewSuperadminOrgPage() {
  const access = await requirePlatformRole(['superadmin']);
  if (!access.ok) redirect('/unauthorized');

  return (
    <div className="space-y-6">
      <section>
        <p className="text-sm text-[color:var(--color-muted-foreground)]">Superadmin orgs</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Create organization</h1>
        <p className="mt-2 max-w-2xl text-sm text-[color:var(--color-muted-foreground)]">
          Create a workspace for a vertical AI agent business. Sendero is one vertical; legal, real
          estate, and other agents reuse the same backbone with different tools, brand, and
          adapters.
        </p>
      </section>

      <div className="max-w-xl">
        <CreateOrganization
          routing="path"
          path="/dashboard/orgs/new"
          afterCreateOrganizationUrl="/dashboard/tenants"
          appearance={{
            elements: {
              cardBox: 'shadow-none',
              card: 'border bg-[color:var(--color-card)] shadow-sm',
            },
          }}
        />
      </div>
    </div>
  );
}
