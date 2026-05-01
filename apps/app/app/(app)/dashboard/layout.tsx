import { cookies } from 'next/headers';
import { after } from 'next/server';

import { RedirectToTasks } from '@clerk/nextjs';
import { auth, currentUser } from '@clerk/nextjs/server';
import { roomIdForWorkspace, type TripPresence } from '@sendero/collaboration/rooms';
import { ensureWorkspaceRoom } from '@sendero/collaboration/server';

import { WorkspaceLiveblocks } from '@/components/collaboration/workspace-liveblocks';
import { AppChrome } from '@/components/dashboard/app-chrome';
import { getAppCopy } from '@/lib/app-copy';
import { backfillTenantGatewayPostLogin } from '@/lib/gateway-backfill-hook';
import { getRequestLocale } from '@/lib/request-locale';
import { requireRole } from '@/lib/require-role';
import { requireCurrentTenant } from '@/lib/tenant-context';

export const dynamic = 'force-dynamic';

export default async function ProtectedAppLayout({ children }: { children: React.ReactNode }) {
  const { tenant, userId } = await requireCurrentTenant();
  await requireRole('org:admin', { fallback: '/' });

  // Phase 2 P2.6 — login backfill hook. Catches tenants that pre-date
  // a chain addition (Phase 3 AVAX, Phase 4 SOL) and any rows the
  // Clerk webhook couldn't provision atomically. Non-blocking via
  // after() so page render isn't delayed; idempotent + race-safe via
  // the (tenantId, kind, chain) unique constraint.
  if (tenant.clerkOrgId) {
    after(() =>
      backfillTenantGatewayPostLogin({
        tenantId: tenant.id,
        clerkOrgId: tenant.clerkOrgId as string,
      })
    );
  }
  const locale = await getRequestLocale();
  const copy = getAppCopy(locale).shell;
  const sidebarCookie = (await cookies()).get('sidebar_state')?.value;
  const defaultSidebarOpen = sidebarCookie !== 'false';
  const { has } = await auth();
  const clerkUser = await currentUser();
  const displayName =
    clerkUser?.fullName ||
    clerkUser?.firstName ||
    clerkUser?.username ||
    clerkUser?.primaryEmailAddress?.emailAddress ||
    'Operator';
  const initialPresence: TripPresence = {
    userId,
    displayName,
    avatarUrl: clerkUser?.imageUrl ?? null,
    role: has({ role: 'org:admin' })
      ? 'admin'
      : has({ role: 'org:finance' })
        ? 'finance'
        : 'member',
    cursorX: null,
    cursorY: null,
    focusedSection: 'workspace',
  };
  const workspaceRoomId = roomIdForWorkspace(tenant.id);
  const liveblocksEnabled = Boolean(process.env.LIVEBLOCKS_SECRET_KEY);
  if (liveblocksEnabled) {
    after(() => ensureWorkspaceRoom({ tenantId: tenant.id }));
  }
  const chrome = (
    <AppChrome headerCopy={copy.header} locale={locale} defaultSidebarOpen={defaultSidebarOpen}>
      {children}
    </AppChrome>
  );

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <RedirectToTasks />
      {liveblocksEnabled ? (
        <WorkspaceLiveblocks roomId={workspaceRoomId} initialPresence={initialPresence}>
          {chrome}
        </WorkspaceLiveblocks>
      ) : (
        chrome
      )}
    </div>
  );
}
