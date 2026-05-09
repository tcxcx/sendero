import { redirect } from 'next/navigation';
import { ScanLine } from 'lucide-react';

import { ComingSoonScreen } from '@/components/layout/coming-soon-screen';
import { requirePlatformRole } from '@/lib/access';

export default async function ContractsPage() {
  const access = await requirePlatformRole(['superadmin', 'eng']);
  if (!access.ok) redirect('/unauthorized');

  return (
    <ComingSoonScreen
      icon={ScanLine}
      eyebrow="Contracts"
      title="Contract operations are queued"
      description="This surface will track deployed contracts, policy upgrades, and on-chain admin actions across every vertical agent."
      items={[
        {
          label: 'Scope',
          detail: 'Arc MSCA, Solana programs, tool policies, and upgrade history.',
        },
        { label: 'Owner', detail: 'Engineering and superadmin roles.' },
        {
          label: 'Next useful view',
          detail: 'Deployments table with chain, version, owner, tx hash, and risk status.',
        },
      ]}
    />
  );
}
