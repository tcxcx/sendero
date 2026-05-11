/**
 * /dashboard/customer-accounts — list of corporate customers
 * downstream of this TMC tenant (the B2B2B layer).
 *
 * Each row shows status (`invited` → `active` → `suspended`), the
 * number of Slack installs / employees / trips, and links to the
 * detail page where the operator mints a Slack-install invite.
 *
 * Phase 1 — list + create. Phase 2 wires the actual Slack OAuth flow
 * to land an install as `SlackInstall { kind: 'customer_account' }`.
 */

import Link from 'next/link';

import { prisma } from '@sendero/database';

import { requireRole } from '@/lib/require-role';
import { requireCurrentTenant } from '@/lib/tenant-context';

import { CreateCustomerAccountForm } from '@/components/customer-accounts/create-form';

export const dynamic = 'force-dynamic';

export default async function CustomerAccountsPage() {
  await requireRole('org:admin', { fallback: '/' });
  const { tenant } = await requireCurrentTenant();

  const accounts = await prisma.customerAccount.findMany({
    where: { tenantId: tenant.id },
    orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    select: {
      id: true,
      displayName: true,
      primaryDomain: true,
      status: true,
      createdAt: true,
      _count: { select: { slackInstalls: true, users: true, trips: true } },
    },
  });

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
        <h1 className="t-h1">Customer accounts</h1>
        <p className="t-body-lg ink-70" style={{ marginTop: 6, maxWidth: '70ch' }}>
          Corporate customers downstream of your agency. Each one installs the Sendero Slack app
          inside their own workspace so their employees can request trips. You manage everything
          from here.
        </p>
      </header>

      <section
        className="sd-card-flat"
        style={{ boxShadow: 'inset 0 0 0 1px var(--hairline-color)', padding: 16 }}
      >
        <div className="t-meta" style={{ marginBottom: 8 }}>
          Invite a new corporate customer
        </div>
        <CreateCustomerAccountForm />
      </section>

      {accounts.length === 0 ? (
        <section
          className="sd-card-flat"
          style={{ boxShadow: 'inset 0 0 0 1px var(--hairline-color)', padding: 16 }}
        >
          <div className="t-meta">No customer accounts yet</div>
          <p className="t-body ink-70" style={{ marginTop: 8, fontSize: 13 }}>
            Add your first corporate customer above. After they install the Slack app in their
            workspace, their employees can request trips with <code>@sendero</code> and you'll see
            every trip surface here.
          </p>
        </section>
      ) : (
        <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div className="t-meta">Accounts · {accounts.length}</div>
          <div style={{ display: 'grid', gap: 10 }}>
            {accounts.map(account => (
              <Link
                key={account.id}
                href={`/dashboard/customer-accounts/${account.id}`}
                className="sd-card-flat"
                style={{
                  boxShadow: 'inset 0 0 0 1px var(--hairline-color)',
                  padding: 14,
                  display: 'grid',
                  gridTemplateColumns: '1fr auto',
                  alignItems: 'center',
                  gap: 12,
                  textDecoration: 'none',
                  color: 'inherit',
                }}
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div
                    style={{
                      display: 'flex',
                      gap: 10,
                      alignItems: 'baseline',
                      flexWrap: 'wrap',
                    }}
                  >
                    <span className="t-body" style={{ fontWeight: 600 }}>
                      {account.displayName}
                    </span>
                    <StatusPill status={account.status} />
                  </div>
                  {account.primaryDomain ? (
                    <span className="t-meta ink-60">{account.primaryDomain}</span>
                  ) : null}
                </div>
                <div style={{ display: 'flex', gap: 14, fontSize: 12 }} className="ink-60">
                  <CountChip label="Slack" value={account._count.slackInstalls} />
                  <CountChip label="Employees" value={account._count.users} />
                  <CountChip label="Trips" value={account._count.trips} />
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const tint =
    status === 'active'
      ? { bg: 'rgba(34, 138, 86, 0.10)', fg: 'rgb(34, 138, 86)' }
      : status === 'suspended'
        ? { bg: 'rgba(196, 84, 56, 0.10)', fg: 'rgb(196, 84, 56)' }
        : { bg: 'rgba(31, 42, 68, 0.06)', fg: 'rgb(31, 42, 68)' };
  return (
    <span
      style={{
        fontSize: 10,
        fontFamily: 'var(--font-mono)',
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        padding: '3px 7px',
        borderRadius: 3,
        background: tint.bg,
        color: tint.fg,
        fontWeight: 600,
      }}
    >
      {status}
    </span>
  );
}

function CountChip({ label, value }: { label: string; value: number }) {
  return (
    <span style={{ display: 'inline-flex', gap: 4, alignItems: 'baseline' }}>
      <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{value}</span>
      <span style={{ fontSize: 11 }}>{label}</span>
    </span>
  );
}
