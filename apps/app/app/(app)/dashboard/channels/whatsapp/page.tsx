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
import { readWhatsappHealth, type WhatsAppHealthSummary } from '@/lib/whatsapp-health';
import { isMetaMockPhoneNumber, META_MOCK_PHONE_NUMBER_MESSAGE } from '@/lib/whatsapp-mock-number';

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

  const hasMockPhoneNumber = isMetaMockPhoneNumber(install?.displayPhoneNumber);
  const status: ChannelStatusKind = install
    ? hasMockPhoneNumber
      ? 'error'
      : (install.status as ChannelStatusKind)
    : 'not_installed';
  const identifier = install?.displayPhoneNumber
    ? install.businessDisplayName
      ? `${install.businessDisplayName} · ${install.displayPhoneNumber}`
      : install.displayPhoneNumber
    : null;
  const health = install?.phoneNumberId ? await readWhatsappHealth(install.phoneNumberId) : null;

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
        <ConnectedView install={install} health={health} />
      ) : (
        <DisconnectedView
          plan={plan}
          status={status}
          identifier={identifier}
          lastHealthyAt={install?.lastHealthyAt?.toISOString() ?? null}
          lastErrorMessage={
            hasMockPhoneNumber
              ? META_MOCK_PHONE_NUMBER_MESSAGE
              : (install?.lastErrorMessage ?? null)
          }
          health={health}
          onProbe={status === 'not_installed' ? undefined : probe}
        />
      )}
    </div>
  );
}

function ConnectedView({
  install,
  health,
}: {
  install: {
    displayPhoneNumber: string | null;
    businessDisplayName: string | null;
  };
  health: WhatsAppHealthSummary | null;
}) {
  return (
    <WhatsappConnectedPanel
      displayName={install.businessDisplayName}
      displayPhoneNumber={install.displayPhoneNumber}
      health={health}
    />
  );
}

function DisconnectedView({
  plan,
  status,
  identifier,
  lastHealthyAt,
  lastErrorMessage,
  health,
  onProbe,
}: {
  plan: string;
  status: ChannelStatusKind;
  identifier: string | null;
  lastHealthyAt: string | null;
  lastErrorMessage: string | null;
  health: WhatsAppHealthSummary | null;
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

      {health ? <WhatsAppMetaReadinessCard health={health} /> : null}

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

function WhatsAppMetaReadinessCard({ health }: { health: WhatsAppHealthSummary }) {
  return (
    <section
      className="sd-card-flat"
      style={{ boxShadow: 'inset 0 0 0 1px var(--hairline-color)', padding: '14px 16px' }}
    >
      <div className="t-meta">Meta readiness</div>
      <div
        style={{
          marginTop: 10,
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
          gap: 10,
        }}
      >
        <ReadinessItem label="Overall" value={health.status ?? 'unknown'} />
        <ReadinessItem label="Messaging" value={health.messagingStatus ?? 'unknown'} />
        <ReadinessItem label="Phone" value={health.phoneStatus ?? 'unknown'} />
        <ReadinessItem
          label="Webhook"
          value={
            health.webhookVerified
              ? 'verified'
              : health.webhookSubscribed
                ? 'subscribed, waiting for first message'
                : 'not subscribed'
          }
        />
        <ReadinessItem label="Quality" value={health.qualityRating ?? 'unknown'} />
      </div>
      {health.errors.length ? (
        <ul className="t-body ink-70" style={{ margin: '12px 0 0', paddingLeft: 18, fontSize: 13 }}>
          {health.errors.slice(0, 3).map(error => (
            <li key={error}>{error}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function ReadinessItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="t-meta">{label}</div>
      <div className="t-body" style={{ marginTop: 4, fontSize: 13 }}>
        {value}
      </div>
    </div>
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
