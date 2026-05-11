import { redirect } from 'next/navigation';
import { Heart } from 'lucide-react';

import { ComingSoonScreen } from '@/components/layout/coming-soon-screen';
import { requirePlatformRole } from '@/lib/access';

export default async function HealthPage() {
  const access = await requirePlatformRole(['superadmin', 'eng', 'support']);
  if (!access.ok) redirect('/unauthorized');

  return (
    <ComingSoonScreen
      icon={Heart}
      eyebrow="Ops health"
      title="Platform health is queued"
      description="This surface will show service health across vertical agents, channels, queues, treasury jobs, and tool execution."
      items={[
        {
          label: 'Scope',
          detail: 'Slack, WhatsApp, MCP tools, billing jobs, treasury actions, and webhook queues.',
        },
        { label: 'Owner', detail: 'Support, engineering, and superadmin roles.' },
        {
          label: 'Next useful view',
          detail: 'Incident timeline with affected vertical, tenant, channel, and job.',
        },
      ]}
    />
  );
}
