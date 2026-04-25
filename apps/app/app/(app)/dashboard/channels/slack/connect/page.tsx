/**
 * /dashboard/channels/slack/connect
 *
 * Two-pane setup wizard bound to `sendero.slack_install`.
 */

import { ChannelSetupWizard } from '@/components/channels/setup-wizard/wizard-shell';
import { slackPanes } from '@/components/channels/setup-wizard/slack-panes';
import { requireCurrentTenant } from '@/lib/tenant-context';
import { loadOrStartRun } from '@/lib/workflow-run';

export const dynamic = 'force-dynamic';

export default async function SlackConnectPage() {
  const { tenant, userId } = await requireCurrentTenant();
  const run = await loadOrStartRun({
    tenantId: tenant.id,
    workflowId: 'sendero.slack_install',
    surfaceKey: 'channels:slack',
    startedByUserId: userId,
    input: { tenantId: tenant.id, tenantName: tenant.displayName },
    ctx: { traveler: { userId, tenantId: tenant.id } },
  });

  return (
    <div className="flex w-full flex-col items-center gap-6 px-6 py-8">
      <ChannelSetupWizard
        channel="slack"
        headline="5 steps · about 3 minutes"
        sublineHtml="Sendero installs into your workspace, escalations, and settlements route to the channels you pick."
        helpHref="/docs/channels/slack"
        helpLabel="Read the Slack setup guide →"
        initialRun={run}
        panes={slackPanes}
        doneHref="/dashboard/channels/slack"
      />
    </div>
  );
}
