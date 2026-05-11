import { redirect } from 'next/navigation';
import { Activity } from 'lucide-react';

import { ComingSoonScreen } from '@/components/layout/coming-soon-screen';
import { requirePlatformRole } from '@/lib/access';

export default async function AgentsPage() {
  const access = await requirePlatformRole(['superadmin', 'eng']);
  if (!access.ok) redirect('/unauthorized');

  return (
    <ComingSoonScreen
      icon={Activity}
      eyebrow="Vertical agents"
      title="Agent registry is queued"
      description="Sendero is one vertical agent. This registry will let the platform run legal, real-estate, travel, and other vertical agents from the same backbone."
      items={[
        {
          label: 'Hierarchy',
          detail: 'Business unit > vertical agent > business > tenant > tool.',
        },
        {
          label: 'Reusable core',
          detail: 'Template app, collaboration, notifications, channels, billing, and treasury.',
        },
        {
          label: 'Swappable layer',
          detail: 'Brand, tools, MCP policy, domain copy, and business adapters.',
        },
      ]}
    />
  );
}
