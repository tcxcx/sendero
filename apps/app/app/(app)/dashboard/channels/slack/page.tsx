import Link from 'next/link';

import { prisma } from '@sendero/database';

import {
  ChannelStatusPanel,
  type ChannelStatusKind,
} from '@/components/channels/channel-status-panel';
import { SlackConnectedPanel } from '@/components/channels/slack-connected-panel';
import { requireCurrentTenant } from '@/lib/tenant-context';

const ROUTE_FALLBACKS: Record<string, string> = {
  trip_events: 'All trip events',
  settlements: 'Settlements + invoices',
  cap_warnings: 'Spend-cap warnings',
  escalations: 'Cap breaches + over-policy holds',
  silent: 'Health pings (suppressed)',
};

export default async function SlackChannelPage() {
  const { tenant } = await requireCurrentTenant();

  const installs = await prisma.slackInstall.findMany({
    where: { tenantId: tenant.id },
    orderBy: { installedAt: 'desc' },
    select: {
      id: true,
      teamId: true,
      teamName: true,
      enterpriseName: true,
      isEnterpriseInstall: true,
      botUserId: true,
      scope: true,
      installedAt: true,
      updatedAt: true,
      routing: true,
    },
  });

  if (installs.length === 0) {
    return (
      <div className="flex max-w-3xl flex-col gap-6">
        <ChannelStatusPanel
          brand="slack"
          status={'not_installed' as ChannelStatusKind}
          identifier={null}
          lastHealthyAt={null}
          lastErrorMessage={null}
          connectHref="/dashboard/channels/slack/connect"
        />
        <section className="flex flex-col gap-2 rounded-[var(--radius-lg)] bg-[color:var(--surface-raised)] p-6 shadow-[var(--shadow-sm)]">
          <h3 className="text-[15px] font-semibold tracking-normal text-foreground">
            Set up the channel
          </h3>
          <p className="text-sm text-muted-foreground">
            The 5-step wizard takes about 3 minutes. You install Sendero into your workspace, pick
            which channels receive each event class, and we invite the bot for you.
          </p>
          <Link
            href="/dashboard/channels/slack/connect"
            className="mt-2 inline-flex w-fit rounded-md bg-[color:var(--accent-rose)] px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-white transition-opacity hover:opacity-90"
          >
            Start setup
          </Link>
        </section>
      </div>
    );
  }

  return (
    <div className="flex max-w-5xl flex-col gap-6">
      {installs.map(install => {
        const enterpriseLabel =
          install.isEnterpriseInstall && install.enterpriseName
            ? `${install.enterpriseName} (Grid)`
            : null;
        const routing =
          (install.routing as {
            defaultChannel?: string;
            routes?: Array<{ eventClass: string; channelId: string; mode: string }>;
          } | null) ?? null;
        const routes = (routing?.routes ?? []).map(r => ({
          channelLabel: `#${r.channelId}`,
          description: ROUTE_FALLBACKS[r.eventClass] ?? r.eventClass,
          mode: r.mode as 'route' | 'filter' | 'silent',
        }));
        const scopeCount = install.scope ? install.scope.split(',').filter(Boolean).length : 0;
        return (
          <SlackConnectedPanel
            key={install.id}
            teamName={install.teamName}
            enterpriseLabel={enterpriseLabel}
            botUserId={install.botUserId}
            scopeCount={scopeCount}
            routes={routes}
            weeklyEscalations={0}
          />
        );
      })}

      <section className="flex flex-col gap-2 rounded-[var(--radius-lg)] bg-[color:var(--surface-raised)] p-6 shadow-[var(--shadow-sm)]">
        <h3 className="text-[15px] font-semibold tracking-normal text-foreground">
          What this does
        </h3>
        <ul className="flex flex-col gap-1.5 text-sm text-muted-foreground">
          <li>
            <strong className="text-foreground">Inbound</strong>: Employees DM the Sendero bot;
            threads land in{' '}
            <Link className="underline underline-offset-2" href="/dashboard/inbox">
              Trip inboxes
            </Link>
            .
          </li>
          <li>
            <strong className="text-foreground">Outbound</strong>: Operator replies route through
            Slack Web API to the original conversation.
          </li>
          <li>
            <strong className="text-foreground">Enterprise Grid</strong>: Multiple workspaces under
            one enterprise are listed separately above.
          </li>
        </ul>
      </section>
    </div>
  );
}
