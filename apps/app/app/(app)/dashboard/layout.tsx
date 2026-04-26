import { cookies } from 'next/headers';

import { RedirectToTasks } from '@clerk/nextjs';

import { AppChrome } from '@/components/dashboard/app-chrome';
import { getAppCopy } from '@/lib/app-copy';
import { getRequestLocale } from '@/lib/request-locale';
import { requireRole } from '@/lib/require-role';
import { requireCurrentTenant } from '@/lib/tenant-context';

export const dynamic = 'force-dynamic';

export default async function ProtectedAppLayout({ children }: { children: React.ReactNode }) {
  await requireCurrentTenant();
  await requireRole('org:admin', { fallback: '/' });
  const locale = await getRequestLocale();
  const copy = getAppCopy(locale).shell;
  const sidebarCookie = (await cookies()).get('sidebar_state')?.value;
  const defaultSidebarOpen = sidebarCookie !== 'false';

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <RedirectToTasks />
      <AppChrome
        headerCopy={copy.header}
        locale={locale}
        defaultSidebarOpen={defaultSidebarOpen}
      >
        {children}
      </AppChrome>
    </div>
  );
}
