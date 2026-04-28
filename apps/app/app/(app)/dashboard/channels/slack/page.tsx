/**
 * /dashboard/channels/slack — SlackA layout when one or more
 * `SlackInstall` rows exist, ChannelStatusPanel + setup CTA otherwise.
 *
 * Multiple installs (Enterprise Grid) render as stacked panels.
 * Routing rows come straight from `SlackInstall.routing` JSON — no
 * demo data.
 */

import Link from 'next/link';

import { prisma } from '@sendero/database';

import {
  type ChannelStatusKind,
  ChannelStatusPanel,
} from '@/components/channels/channel-status-panel';
import { PublicInstallUrlCard } from '@/components/channels/public-install-url-card';
import { SlackChannelTabs } from '@/components/channels/slack-channel-tabs';
import { SlackConnectedPanel } from '@/components/channels/slack-connected-panel';
import { requireCurrentTenant } from '@/lib/tenant-context';

const APP_ORIGIN = (process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.sendero.travel').replace(
  /\/$/,
  ''
);

export const dynamic = 'force-dynamic';

const ROUTE_FALLBACKS: Record<string, string> = {
  trip_events: 'All trip events',
  settlements: 'Settlements + invoices',
  cap_warnings: 'Spend-cap warnings',
  escalations: 'Cap breaches + over-policy holds',
  silent: 'Health pings (suppressed)',
};

export default async function SlackChannelPage() {
  const { tenant } = await requireCurrentTenant();

  const [installs, tenantRow] = await Promise.all([
    prisma.slackInstall.findMany({
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
    }),
    prisma.tenant.findUnique({
      where: { id: tenant.id },
      select: { slug: true, displayName: true },
    }),
  ]);

  return (
    <div
      style={{
        padding: '0 20px 20px',
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
        flex: 1,
        minHeight: 0,
      }}
    >
      {/* Two-tab layout: 'Workspace' (default) shows the connected
          install panel(s); 'Share install URL' shows the public install
          URL card. Both subtrees are server-rendered in this RSC and
          the client tab wrapper just toggles visibility. When the
          tenant has no slug we hide the share tab content silently —
          no slug means the install URL can't be built. */}
      <SlackChannelTabs
        workspaceContent={
          installs.length === 0 ? (
            <DisconnectedView />
          ) : (
            <>
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
                  channelId: r.channelId,
                  channelLabel: `#${r.channelId}`,
                  description: ROUTE_FALLBACKS[r.eventClass] ?? r.eventClass,
                  mode: r.mode as 'route' | 'filter' | 'silent' | 'default' | 'escalation',
                }));
                const scopeCount = install.scope
                  ? install.scope.split(',').filter(Boolean).length
                  : 0;
                return (
                  <SlackConnectedPanel
                    key={install.id}
                    installId={install.id}
                    teamName={install.teamName}
                    enterpriseLabel={enterpriseLabel}
                    botUserId={install.botUserId}
                    scopeCount={scopeCount}
                    routes={routes}
                    weeklyEscalations={0}
                  />
                );
              })}
            </>
          )
        }
        shareContent={
          tenantRow?.slug ? (
            <PublicInstallUrlCard
              appOrigin={APP_ORIGIN}
              tenantSlug={tenantRow.slug}
              tenantDisplayName={tenantRow.displayName}
            />
          ) : (
            <p className="t-body ink-70" style={{ fontSize: 13 }}>
              Your tenant doesn&rsquo;t have a slug yet. Set one in{' '}
              <code className="t-mono">/dashboard/settings/org</code> to enable the public install
              URL.
            </p>
          )
        }
      />
    </div>
  );
}

function DisconnectedView() {
  return (
    <>
      <ChannelStatusPanel
        brand="slack"
        status={'not_installed' as ChannelStatusKind}
        identifier={null}
        lastHealthyAt={null}
        lastErrorMessage={null}
        connectHref="/dashboard/channels/slack/connect"
      />

      <section
        className="sd-card-flat"
        style={{ boxShadow: 'inset 0 0 0 1px var(--hairline-color)', padding: '14px 16px' }}
      >
        <div className="t-meta">Set up the channel</div>
        <p
          className="t-body ink-70"
          style={{ marginTop: 8, fontSize: 13, lineHeight: 1.55, maxWidth: '64ch' }}
        >
          The 5-step wizard takes about 3 minutes. Install the Sendero app, route your channels,
          invite the bot, and confirm with a test message.
        </p>
        <Link
          href="/dashboard/channels/slack/connect"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            marginTop: 12,
            padding: '8px 18px',
            background: 'var(--vermillion)',
            color: '#fdfbf7',
            border: 0,
            borderRadius: 8,
            fontSize: 12,
            fontWeight: 600,
            fontFamily: 'var(--font-mono-x)',
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            textDecoration: 'none',
            cursor: 'pointer',
          }}
        >
          Start setup
        </Link>
      </section>
    </>
  );
}
