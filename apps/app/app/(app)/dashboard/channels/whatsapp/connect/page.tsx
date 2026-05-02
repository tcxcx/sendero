/**
 * /dashboard/channels/whatsapp/connect
 *
 * Two-pane setup wizard bound to the `sendero.whatsapp_provision`
 * workflow. The server loads or starts the WorkflowRun for this
 * tenant + surface, then the client wizard polls /resume on each
 * Continue.
 */

import { prisma } from '@sendero/database';

import { whatsappPanes } from '@/components/channels/setup-wizard/whatsapp-panes';
import { ChannelSetupWizard } from '@/components/channels/setup-wizard/wizard-shell';
import { currentOrgPlanTier } from '@/lib/billing-plan';
import { docsUrl } from '@/lib/docs-url';
import { requireCurrentTenant } from '@/lib/tenant-context';
import { loadOrStartWizardSession } from '@/lib/wizard-session';

export const dynamic = 'force-dynamic';

export default async function WhatsAppConnectPage() {
  const { tenant, userId } = await requireCurrentTenant();
  const plan = await currentOrgPlanTier();
  const install = await prisma.whatsAppInstall.findUnique({
    where: { tenantId: tenant.id },
    select: { id: true },
  });
  if (!install) {
    await prisma.session.deleteMany({
      where: { tenantId: tenant.id, subjectKey: 'channels:whatsapp' },
    });
  }
  const run = await loadOrStartWizardSession({
    tenantId: tenant.id,
    workflowId: 'sendero.whatsapp_provision',
    surfaceKey: 'channels:whatsapp',
    startedByUserId: userId,
    input: { tenantId: tenant.id, tenantName: tenant.displayName },
    ctx: { traveler: { userId, tenantId: tenant.id } },
  });

  return (
    <div className="flex w-full flex-col items-center gap-2 px-2 pb-4 pt-0">
      <ChannelSetupWizard
        channel="whatsapp"
        headline={plan === 'free' ? 'Readiness · dedicated number required' : 'Connect WhatsApp'}
        subline={
          plan === 'free'
            ? 'Free workspaces can review setup requirements here. Live tenant WhatsApp operations require upgrading and connecting a dedicated WhatsApp Business number.'
            : 'Open the hosted setup, finish WhatsApp Business connection, then send a test message.'
        }
        helpHref={docsUrl('/docs/channels/whatsapp')}
        helpLabel="Read the WhatsApp setup guide →"
        initialRun={run}
        panes={whatsappPanes}
        doneHref="/dashboard/channels/whatsapp"
      />
    </div>
  );
}
