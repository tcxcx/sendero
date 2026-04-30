import { cookies } from 'next/headers';
import { after } from 'next/server';

import { RedirectToTasks } from '@clerk/nextjs';

import { AppChrome } from '@/components/dashboard/app-chrome';
import { backfillTenantGatewayPostLogin } from '@/lib/gateway-backfill-hook';
import { getAppCopy } from '@/lib/app-copy';
import { getRequestLocale } from '@/lib/request-locale';
import { requireRole } from '@/lib/require-role';
import { requireCurrentTenant } from '@/lib/tenant-context';

export const dynamic = 'force-dynamic';

export default async function ProtectedAppLayout({ children }: { children: React.ReactNode }) {
  const { tenant } = await requireCurrentTenant();
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

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <RedirectToTasks />
      <AppChrome headerCopy={copy.header} locale={locale} defaultSidebarOpen={defaultSidebarOpen}>
        {children}
      </AppChrome>
    </div>
  );
}
