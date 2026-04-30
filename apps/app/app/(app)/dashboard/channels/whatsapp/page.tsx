/**
 * /dashboard/channels/whatsapp — WhatsappA layout when connected,
 * ChannelStatusPanel + setup CTA otherwise.
 *
 * Connected state lifts h1 + lede + actions into the WhatsappConnected
 * panel itself. Disconnected state owns its own h1 above the
 * ChannelStatusPanel so every channel page renders a single semantic
 * h1.
 *
 * Kapso plumbing is unchanged: `WhatsAppInstall` row drives display
 * fields; the `probe` server action calls `KapsoClient.getPhoneNumber`
 * and updates `status` / `lastHealthyAt` / `lastErrorMessage`.
 */

import { revalidatePath } from 'next/cache';
import Link from 'next/link';

import { prisma } from '@sendero/database';
import { env } from '@sendero/env';
import { KapsoClient } from '@sendero/kapso';

import {
  type ChannelStatusKind,
  ChannelStatusPanel,
} from '@/components/channels/channel-status-panel';
import { WhatsappConnectedPanel } from '@/components/channels/whatsapp-connected-panel';
import { currentOrgPlanTier } from '@/lib/billing-plan';
import { requireCurrentTenant } from '@/lib/tenant-context';

export const dynamic = 'force-dynamic';

export default async function WhatsAppChannelPage() {
  const { tenant } = await requireCurrentTenant();
  const plan = await currentOrgPlanTier();

  const install = await prisma.whatsAppInstall.findUnique({
    where: { tenantId: tenant.id },
    select: {
      status: true,
      displayPhoneNumber: true,
      businessDisplayName: true,
      lastHealthyAt: true,
      lastErrorMessage: true,
      phoneNumberId: true,
      metadata: true,
    },
  });

  const status: ChannelStatusKind = install
    ? (install.status as ChannelStatusKind)
    : 'not_installed';
  const identifier = install?.displayPhoneNumber
    ? install.businessDisplayName
      ? `${install.businessDisplayName} · ${install.displayPhoneNumber}`
      : install.displayPhoneNumber
    : null;

  async function probe() {
    'use server';
    const { tenant: t } = await requireCurrentTenant();
    const row = await prisma.whatsAppInstall.findUnique({
      where: { tenantId: t.id },
      select: { id: true, phoneNumberId: true },
    });
    if (!row?.phoneNumberId) return { ok: false, message: 'No phone_number_id on install' };
    const apiKey = env.kapsoApiKey();
    if (!apiKey) return { ok: false, message: 'KAPSO_API_KEY missing in this environment' };
    try {
      const kapso = new KapsoClient({ apiKey, baseUrl: env.kapsoApiBaseUrl() });
      await kapso.getPhoneNumber(row.phoneNumberId);
      await prisma.whatsAppInstall.update({
        where: { id: row.id },
        data: { status: 'active', lastErrorMessage: null, lastHealthyAt: new Date() },
      });
      revalidatePath('/dashboard/channels/whatsapp');
      return { ok: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await prisma.whatsAppInstall.update({
        where: { id: row.id },
        data: { status: 'error', lastErrorMessage: message },
      });
      revalidatePath('/dashboard/channels/whatsapp');
      return { ok: false, message };
    }
  }

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
      {status === 'active' && install ? (
        <ConnectedView install={install} />
      ) : (
        <DisconnectedView
          plan={plan}
          status={status}
          identifier={identifier}
          lastHealthyAt={install?.lastHealthyAt?.toISOString() ?? null}
          lastErrorMessage={install?.lastErrorMessage ?? null}
          onProbe={status === 'not_installed' ? undefined : probe}
        />
      )}
    </div>
  );
}

function ConnectedView({
  install,
}: {
  install: {
    displayPhoneNumber: string | null;
    businessDisplayName: string | null;
    metadata: unknown;
  };
}) {
  const metadata = (install.metadata as Record<string, unknown> | null) ?? {};
  const templates = Array.isArray(metadata.templates)
    ? (metadata.templates as Array<{ name: string; status: string }>)
    : [];
  return (
    <WhatsappConnectedPanel
      displayName={install.businessDisplayName}
      displayPhoneNumber={install.displayPhoneNumber}
      status="Connected"
      templates={templates}
      recentThreads={[]}
      weeklyStats={{ trips: 0, messages: 0, deliveryRate: 100 }}
    />
  );
}

function DisconnectedView({
  plan,
  status,
  identifier,
  lastHealthyAt,
  lastErrorMessage,
  onProbe,
}: {
  plan: string;
  status: ChannelStatusKind;
  identifier: string | null;
  lastHealthyAt: string | null;
  lastErrorMessage: string | null;
  onProbe?: () => Promise<{ ok: boolean; message?: string } | undefined>;
}) {
  return (
    <>
      <ChannelStatusPanel
        brand="whatsapp"
        status={status}
        identifier={identifier}
        lastHealthyAt={lastHealthyAt}
        lastErrorMessage={lastErrorMessage}
        connectHref="/dashboard/channels/whatsapp/connect"
        onProbe={onProbe}
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
          The 5-step wizard takes about 5 minutes. Claim a number, verify ownership, brand the
          experience, send a test message, and go live.
        </p>
        <Link
          href="/dashboard/channels/whatsapp/connect"
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

      {plan === 'free' ? <WhatsAppReadinessCard /> : null}
    </>
  );
}

function WhatsAppReadinessCard() {
  return (
    <section
      className="sd-card-flat"
      style={{ boxShadow: 'inset 0 0 0 1px var(--hairline-color)', padding: '14px 16px' }}
    >
      <div className="t-meta">Readiness</div>
      <p
        className="t-body ink-70"
        style={{ marginTop: 8, fontSize: 13, lineHeight: 1.55, maxWidth: '68ch' }}
      >
        WhatsApp tenant operations require a dedicated WhatsApp Business number. Free workspaces can
        review the setup flow and channel requirements here, but live WhatsApp testing starts after
        upgrading and connecting a number through Kapso.
      </p>
      <a
        href="/dashboard/billing/plans?upgrade=basic&feature=channel_whatsapp"
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
        }}
      >
        Upgrade to connect
      </a>
    </section>
  );
}
