import { redirect } from 'next/navigation';
import { HardDriveDownload } from 'lucide-react';

import { ComingSoonScreen } from '@/components/layout/coming-soon-screen';
import { requirePlatformRole } from '@/lib/access';

export default async function PayoutsPage() {
  const access = await requirePlatformRole(['superadmin', 'finance']);
  if (!access.ok) redirect('/unauthorized');

  return (
    <ComingSoonScreen
      icon={HardDriveDownload}
      eyebrow="Payouts"
      title="Payout operations are queued"
      description="This surface will reconcile tenant receivables, platform take, supplier legs, and treasury withdrawals."
      items={[
        {
          label: 'Scope',
          detail: 'Settlements, invoice payments, transfer attempts, and treasury destinations.',
        },
        { label: 'Owner', detail: 'Finance and superadmin roles.' },
        {
          label: 'Next useful view',
          detail: 'Payout queue grouped by vertical, tenant, chain, status, and amount.',
        },
      ]}
    />
  );
}
