/**
 * /dashboard/caps/policies/[id] — edit an existing TransferPolicy.
 *
 * 404s if the row doesn't belong to the current tenant.
 */

import { notFound } from 'next/navigation';

import { PolicyEditor } from '@/components/transfer-policy/policy-editor';
import { requireRole } from '@/lib/require-role';
import { requireCurrentTenant } from '@/lib/tenant-context';
import { prisma } from '@sendero/database';

import { updateTransferPolicy } from '../actions';

export const dynamic = 'force-dynamic';

type SearchParams = { error?: string };

export default async function EditPolicyPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
}) {
  await requireRole('org:admin');
  const { tenant } = await requireCurrentTenant();
  const { id } = await params;
  const sp = await searchParams;

  const row = await prisma.transferPolicy.findFirst({
    where: { id, tenantId: tenant.id },
  });
  if (!row) notFound();

  const memberships = await prisma.membership.findMany({
    where: { tenantId: tenant.id },
    orderBy: { createdAt: 'desc' },
    take: 200,
    include: { user: { select: { id: true, displayName: true, email: true } } },
  });
  const travelers = memberships.map(m => ({
    id: m.user.id,
    label: m.user.displayName ?? m.user.email ?? m.user.id.slice(0, 12),
  }));

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
      <div>
        <h1 className="t-h1">Edit policy</h1>
        <p className="t-body-lg ink-70" style={{ marginTop: 6, maxWidth: '60ch' }}>
          Changes apply to the next dispatch. Pause the row from the policies list to keep it on
          file without enforcing.
        </p>
      </div>

      <PolicyEditor
        action={updateTransferPolicy}
        isEdit
        travelers={travelers}
        initial={{
          id: row.id,
          scope: row.scope as 'tenant' | 'traveler' | 'tool',
          travelerId: row.travelerId,
          toolName: row.toolName,
          guardKind: row.guardKind as
            | 'budget'
            | 'single_tx'
            | 'recipient'
            | 'rate_limit'
            | 'confirm',
          config: (row.config ?? {}) as Record<string, unknown>,
          hardCap: row.hardCap,
          alertWebhookUrl: row.alertWebhookUrl,
          enabled: row.enabled,
          priority: row.priority,
        }}
        error={sp.error ?? null}
      />
    </div>
  );
}
