/**
 * /dashboard/caps/policies/new — create a TransferPolicy row.
 *
 * Loads the tenant's travelers for the scope=traveler dropdown.
 * `?travelerId=…` prefills the editor for the per-traveler view.
 * `?scope=…` locks the scope (used by /dashboard/passport/[id]/policy
 * which always wants traveler-scoped guards).
 */

import { PolicyEditor } from '@/components/transfer-policy/policy-editor';
import { requireRole } from '@/lib/require-role';
import { requireCurrentTenant } from '@/lib/tenant-context';
import { prisma } from '@sendero/database';

import { createTransferPolicy } from '../actions';

export const dynamic = 'force-dynamic';

type SearchParams = { scope?: string; travelerId?: string; toolName?: string; error?: string };

export default async function NewPolicyPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireRole('org:admin');
  const { tenant } = await requireCurrentTenant();
  const params = await searchParams;
  const lockedScope = parseLockedScope(params.scope);

  const travelers = await loadTravelers(tenant.id);

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
        <h1 className="t-h1">New transfer policy</h1>
        <p className="t-body-lg ink-70" style={{ marginTop: 6, maxWidth: '60ch' }}>
          Compose one guard. Multiple rows for the same scope tuple compose into a chain ordered by
          priority — the runtime short-circuits on the first hard rejection.
        </p>
      </div>

      <PolicyEditor
        action={createTransferPolicy}
        isEdit={false}
        lockedScope={lockedScope ?? undefined}
        lockedTravelerId={params.travelerId}
        travelers={travelers}
        initial={
          params.travelerId
            ? {
                scope: 'traveler',
                travelerId: params.travelerId,
                toolName: null,
                guardKind: 'budget',
                config: {},
                hardCap: true,
                alertWebhookUrl: null,
                enabled: true,
                priority: 100,
              }
            : params.toolName
              ? {
                  scope: 'tool',
                  travelerId: null,
                  toolName: params.toolName,
                  guardKind: 'budget',
                  config: {},
                  hardCap: true,
                  alertWebhookUrl: null,
                  enabled: true,
                  priority: 100,
                }
              : undefined
        }
        error={params.error ?? null}
      />
    </div>
  );
}

function parseLockedScope(value: string | undefined): 'tenant' | 'traveler' | 'tool' | null {
  if (value === 'tenant' || value === 'traveler' || value === 'tool') return value;
  return null;
}

async function loadTravelers(tenantId: string) {
  const memberships = await prisma.membership.findMany({
    where: { tenantId },
    orderBy: { createdAt: 'desc' },
    take: 200,
    include: { user: { select: { id: true, displayName: true, email: true } } },
  });
  return memberships.map(m => ({
    id: m.user.id,
    label: m.user.displayName ?? m.user.email ?? m.user.id.slice(0, 12),
  }));
}
