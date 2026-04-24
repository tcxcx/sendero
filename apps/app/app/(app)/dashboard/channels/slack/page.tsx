import Link from 'next/link';
import { revalidatePath } from 'next/cache';

import { prisma } from '@sendero/database';
import { WebClient } from '@slack/web-api';

import {
  ChannelStatusPanel,
  type ChannelStatusKind,
} from '@/components/channels/channel-status-panel';
import { requireCurrentTenant } from '@/lib/tenant-context';

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
      installedAt: true,
      updatedAt: true,
    },
  });

  async function probe(installId: string) {
    'use server';
    const { tenant: t } = await requireCurrentTenant();
    const row = await prisma.slackInstall.findFirst({
      where: { id: installId, tenantId: t.id },
      select: { id: true, botToken: true },
    });
    if (!row) return { ok: false, message: 'Install not found' };
    try {
      const client = new WebClient(row.botToken);
      const res = await client.auth.test();
      if (!res.ok) throw new Error(res.error ?? 'slack_auth_failed');
      revalidatePath('/dashboard/channels/slack');
      return { ok: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      revalidatePath('/dashboard/channels/slack');
      return { ok: false, message };
    }
  }

  if (installs.length === 0) {
    return (
      <div className="flex max-w-3xl flex-col gap-6">
        <ChannelStatusPanel
          brand="slack"
          status={'not_installed' as ChannelStatusKind}
          identifier={null}
          lastHealthyAt={null}
          lastErrorMessage={null}
          connectHref="/onboarding/corporate"
        />
        <section className="rounded-[var(--radius-lg)] bg-[color:var(--surface-raised)] p-6 shadow-[var(--shadow-sm)]">
          <p className="text-sm text-muted-foreground">
            Connect Slack from{' '}
            <Link className="underline underline-offset-2" href="/onboarding/corporate">
              Corporate onboarding
            </Link>{' '}
            to route employee trips into the same trip engine.
          </p>
        </section>
      </div>
    );
  }

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      {installs.map(install => {
        const installId = install.id;
        const identifier =
          install.isEnterpriseInstall && install.enterpriseName
            ? `${install.enterpriseName} (Grid) · ${install.teamName}`
            : install.teamName;
        return (
          <ChannelStatusPanel
            key={install.id}
            brand="slack"
            status={'active' as ChannelStatusKind}
            identifier={identifier}
            lastHealthyAt={install.updatedAt.toISOString()}
            lastErrorMessage={null}
            connectHref="/onboarding/corporate"
            onProbe={async () => probe(installId)}
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
