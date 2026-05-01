import { cookies } from 'next/headers';
import { after } from 'next/server';

import { RedirectToTasks } from '@clerk/nextjs';
import { roomIdForWorkspace } from '@sendero/collaboration/rooms';
import { ensureWorkspaceRoom } from '@sendero/collaboration/server';

import { LiveblocksProjectProvider } from '@/components/collaboration/liveblocks-project-provider';
import { WorkspaceLiveblocks } from '@/components/collaboration/workspace-liveblocks';
import { AppChrome } from '@/components/dashboard/app-chrome';
import { getAppCopy } from '@/lib/app-copy';
import { buildInitialPresence } from '@/lib/collaboration-presence';
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
  const initialPresence = await buildInitialPresence({
    userId,
    focusedSection: 'workspace',
    focusLabel: 'workspace',
  });
  const workspaceRoomId = roomIdForWorkspace(tenant.id);
  const liveblocksEnabled = Boolean(process.env.LIVEBLOCKS_SECRET_KEY);
  if (liveblocksEnabled) {
    after(() => ensureWorkspaceRoom({ tenantId: tenant.id }));
  }
  const chrome = (
    <AppChrome
      headerCopy={copy.header}
      locale={locale}
      defaultSidebarOpen={defaultSidebarOpen}
      liveblocksEnabled={liveblocksEnabled}
    >
      {children}
    </AppChrome>
  );

  const roomChrome = liveblocksEnabled ? (
    <WorkspaceLiveblocks roomId={workspaceRoomId} initialPresence={initialPresence}>
      {chrome}
    </WorkspaceLiveblocks>
  ) : (
    chrome
  );

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <RedirectToTasks />
      {liveblocksEnabled ? (
        <LiveblocksProjectProvider>{roomChrome}</LiveblocksProjectProvider>
      ) : (
        roomChrome
      )}
    </div>
  );
}
