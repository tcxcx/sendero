/**
 * /dashboard/customer-accounts/[id]/policy — per-corporate-customer
 * travel policy editor. The TMC operator sets caps + cabin rules +
 * approval threshold here; the agent gates each booking via
 * `check_policy({ customerAccountId, ... })` against this row.
 *
 * Server fetches the current policy (or null when none seeded); the
 * client form does the PUT to /api/customer-accounts/[id]/policy.
 */

import { notFound } from 'next/navigation';

import { prisma } from '@sendero/database';

import { CustomerAccountPolicyForm } from '@/components/customer-accounts/policy-form';
import { requireRole } from '@/lib/require-role';
import { requireCurrentTenant } from '@/lib/tenant-context';

export const dynamic = 'force-dynamic';

export default async function CustomerAccountPolicyPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireRole('org:admin', { fallback: '/' });
  const { tenant } = await requireCurrentTenant();
  const { id } = await params;

  const account = await prisma.customerAccount.findFirst({
    where: { id, tenantId: tenant.id },
    select: { id: true, displayName: true, primaryDomain: true },
  });
  if (!account) notFound();

  const policy = await prisma.policy.findFirst({
    where: { tenantId: tenant.id, customerAccountId: account.id },
    orderBy: [{ version: 'desc' }, { updatedAt: 'desc' }],
    select: {
      id: true,
      slug: true,
      displayName: true,
      rules: true,
      version: true,
      updatedAt: true,
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
        <div className="t-meta ink-60" style={{ marginBottom: 4 }}>
          <a href="/dashboard/customer-accounts" style={{ color: 'inherit' }}>
            Customer accounts
          </a>{' '}
          /{' '}
          <a href={`/dashboard/customer-accounts/${account.id}`} style={{ color: 'inherit' }}>
            {account.displayName}
          </a>{' '}
          / Policy
        </div>
        <h1 className="t-h1">Travel policy</h1>
        <p className="t-body ink-70" style={{ marginTop: 6, fontSize: 13, maxWidth: 640 }}>
          The agent checks every flight + hotel offer against these rules before booking. Set caps,
          required cabin class, preferred carriers, and an approval threshold. Rules apply only to
          trips bound to this corporate customer; TMC employees + direct consumers fall through to
          the tenant default.
        </p>
      </header>

      <CustomerAccountPolicyForm
        accountId={account.id}
        accountDisplayName={account.displayName}
        initialPolicy={policy ? { ...policy, rules: policy.rules as Record<string, unknown> } : null}
      />
    </div>
  );
}
