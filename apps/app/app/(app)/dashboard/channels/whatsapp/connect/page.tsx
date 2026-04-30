/**
 * /dashboard/channels/whatsapp/connect
 *
 * Two-pane setup wizard bound to the `sendero.whatsapp_provision`
 * workflow. The server loads or starts the WorkflowRun for this
 * tenant + surface, then the client wizard polls /resume on each
 * Continue.
 */

import { whatsappPanes } from '@/components/channels/setup-wizard/whatsapp-panes';
import { ChannelSetupWizard } from '@/components/channels/setup-wizard/wizard-shell';
import { currentOrgPlanTier } from '@/lib/billing-plan';
import { requireCurrentTenant } from '@/lib/tenant-context';
import { loadOrStartWizardSession } from '@/lib/wizard-session';

export const dynamic = 'force-dynamic';

export default async function WhatsAppConnectPage() {
  const { tenant, userId } = await requireCurrentTenant();
  const plan = await currentOrgPlanTier();
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
        headline={
          plan === 'free' ? 'Readiness · dedicated number required' : '5 steps · about 5 minutes'
        }
        sublineHtml={
          plan === 'free'
            ? 'Free workspaces can review setup requirements here. Live tenant WhatsApp operations require upgrading and connecting a dedicated WhatsApp Business number.'
            : 'Connect your WhatsApp Business number through Kapso, then Sendero activates the tenant travel agent workflow.'
        }
        helpHref="/docs/channels/whatsapp"
        helpLabel="Read the WhatsApp setup guide →"
        initialRun={run}
        panes={whatsappPanes}
        doneHref="/dashboard/channels/whatsapp"
      />
    </div>
  );
}
