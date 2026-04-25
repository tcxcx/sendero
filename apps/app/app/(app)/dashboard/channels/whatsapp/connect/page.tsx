/**
 * /dashboard/channels/whatsapp/connect
 *
 * Two-pane setup wizard bound to the `sendero.whatsapp_provision`
 * workflow. The server loads or starts the WorkflowRun for this
 * tenant + surface, then the client wizard polls /resume on each
 * Continue.
 */

import { ChannelSetupWizard } from '@/components/channels/setup-wizard/wizard-shell';
import { whatsappPanes } from '@/components/channels/setup-wizard/whatsapp-panes';
import { requireCurrentTenant } from '@/lib/tenant-context';
import { loadOrStartRun } from '@/lib/workflow-run';

export const dynamic = 'force-dynamic';

export default async function WhatsAppConnectPage() {
  const { tenant, userId } = await requireCurrentTenant();
  const run = await loadOrStartRun({
    tenantId: tenant.id,
    workflowId: 'sendero.whatsapp_provision',
    surfaceKey: 'channels:whatsapp',
    startedByUserId: userId,
    input: { tenantId: tenant.id, tenantName: tenant.displayName },
    ctx: { traveler: { userId, tenantId: tenant.id } },
  });

  return (
    <div className="flex w-full flex-col items-center gap-6 px-6 py-8">
      <ChannelSetupWizard
        channel="whatsapp"
        headline="5 steps · about 5 minutes"
        sublineHtml="Sendero owns the WhatsApp Business Account and shares a number from the pool. No Meta embedded signup required."
        helpHref="/docs/channels/whatsapp"
        helpLabel="Read the WhatsApp setup guide →"
        initialRun={run}
        panes={whatsappPanes}
        doneHref="/dashboard/channels/whatsapp"
      />
    </div>
  );
}
