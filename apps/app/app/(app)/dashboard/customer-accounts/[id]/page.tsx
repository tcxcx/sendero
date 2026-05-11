/**
 * /dashboard/customer-accounts/[id] — detail view for one corporate
 * customer downstream of this TMC tenant. The operator hits "Mint
 * invite link" here to generate a signed URL they email to the
 * corporate admin, who clicks → Slack OAuth → Sendero installs in
 * the corporate's own workspace.
 *
 * Phase 1 surface — Phase 2 wires the Slack OAuth Flow-B callback to
 * actually consume the invite token.
 */

import { notFound } from 'next/navigation';

import { prisma } from '@sendero/database';

import { requireRole } from '@/lib/require-role';
import { requireCurrentTenant } from '@/lib/tenant-context';

import { CustomerAccountInvitePanel } from '@/components/customer-accounts/invite-panel';

export const dynamic = 'force-dynamic';

export default async function CustomerAccountDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireRole('org:admin', { fallback: '/' });
  const { tenant } = await requireCurrentTenant();

  const { id } = await params;
  const account = await prisma.customerAccount.findFirst({
    where: { id, tenantId: tenant.id },
    select: {
      id: true,
      displayName: true,
      primaryDomain: true,
      status: true,
      createdAt: true,
      slackInstalls: {
        where: { revokedAt: null },
        select: {
          id: true,
          teamId: true,
          teamName: true,
          installedAt: true,
        },
      },
      _count: { select: { users: true, policies: true, trips: true } },
    },
  });

  if (!account) notFound();

  return (
    <div
      style={{
        padding: '0 20px 20px',
        display: 'flex',
        flexDirection: 'column',
        gap: 18,
        flex: 1,
        minHeight: 0,
      }}
    >
      <header>
        <div className="t-meta ink-60" style={{ marginBottom: 4 }}>
          <a href="/dashboard/customer-accounts" style={{ color: 'inherit' }}>
            Customer accounts
          </a>{' '}
          / {account.displayName}
        </div>
        <h1 className="t-h1">{account.displayName}</h1>
        {account.primaryDomain ? (
          <p className="t-meta ink-60" style={{ marginTop: 6 }}>
            Primary domain: <code>{account.primaryDomain}</code>
          </p>
        ) : null}
      </header>

      <section
        className="sd-card-flat"
        style={{
          boxShadow: 'inset 0 0 0 1px var(--hairline-color)',
          padding: 16,
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 12,
        }}
      >
        <Stat label="Slack workspaces" value={account.slackInstalls.length} />
        <Stat label="Employees" value={account._count.users} />
        <Stat label="Trips" value={account._count.trips} />
      </section>

      <section
        className="sd-card-flat"
        style={{ boxShadow: 'inset 0 0 0 1px var(--hairline-color)', padding: 16 }}
      >
        <div className="t-meta" style={{ marginBottom: 4 }}>
          Travel policy
        </div>
        <p className="t-body ink-70" style={{ marginTop: 4, fontSize: 13, marginBottom: 12 }}>
          {account._count.policies > 0
            ? `${account._count.policies} policy version(s) on file. The agent checks every offer against the latest revision before booking.`
            : "No policy set. Trips for this customer will fall through to the tenant default. Set caps + cabin rules + approval threshold here."}
        </p>
        <a
          href={`/dashboard/customer-accounts/${account.id}/policy`}
          className="sd-btn"
          style={{
            display: 'inline-block',
            padding: '8px 14px',
            borderRadius: 8,
            border: '1px solid var(--ink, #fb542b)',
            color: 'var(--ink, #fb542b)',
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            textDecoration: 'none',
          }}
        >
          {account._count.policies > 0 ? 'Edit policy →' : 'Set policy →'}
        </a>
      </section>

      <section
        className="sd-card-flat"
        style={{ boxShadow: 'inset 0 0 0 1px var(--hairline-color)', padding: 16 }}
      >
        <div className="t-meta" style={{ marginBottom: 4 }}>
          Slack install
        </div>
        <p className="t-body ink-70" style={{ marginTop: 4, fontSize: 13, marginBottom: 12 }}>
          Mint a signed invite link and send it to the corporate admin. They click → install the
          Sendero Slack app in their own workspace → trip provisioning is enabled for their
          employees.
        </p>
        <CustomerAccountInvitePanel
          accountId={account.id}
          alreadyInstalled={account.slackInstalls.length > 0}
        />
      </section>

      {account.slackInstalls.length > 0 ? (
        <section
          className="sd-card-flat"
          style={{ boxShadow: 'inset 0 0 0 1px var(--hairline-color)', padding: 16 }}
        >
          <div className="t-meta" style={{ marginBottom: 8 }}>
            Connected workspaces · {account.slackInstalls.length}
          </div>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 6 }}>
            {account.slackInstalls.map(install => (
              <li
                key={install.id}
                style={{
                  display: 'flex',
                  gap: 12,
                  alignItems: 'baseline',
                  fontSize: 13,
                }}
              >
                <span style={{ fontWeight: 600 }}>{install.teamName}</span>
                <span className="ink-60" style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                  {install.teamId}
                </span>
                <span className="ink-60" style={{ fontSize: 11 }}>
                  installed {install.installedAt.toLocaleDateString()}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span className="t-meta ink-60">{label}</span>
      <span
        style={{
          fontFamily: 'var(--font-mono)',
          fontWeight: 600,
          fontSize: 22,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {value}
      </span>
    </div>
  );
}
