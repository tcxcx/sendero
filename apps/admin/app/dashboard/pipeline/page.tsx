import { redirect } from 'next/navigation';
import { TrendingUp } from 'lucide-react';

import { ComingSoonScreen } from '@/components/layout/coming-soon-screen';
import { requirePlatformRole } from '@/lib/access';

export default async function PipelinePage() {
  const access = await requirePlatformRole(['superadmin', 'sales']);
  if (!access.ok) redirect('/unauthorized');

  return (
    <ComingSoonScreen
      icon={TrendingUp}
      eyebrow="Pipeline"
      title="Sales pipeline is queued"
      description="This surface will connect vertical-agent opportunities to business units, tenants, channels, and launch readiness."
      items={[
        {
          label: 'Scope',
          detail: 'Leads, business units, vertical agents, workspaces, and onboarding state.',
        },
        { label: 'Owner', detail: 'Sales and superadmin roles.' },
        {
          label: 'Next useful view',
          detail:
            'Funnel table with vertical, buyer, ARR estimate, channel needs, and launch blockers.',
        },
      ]}
    />
  );
}
