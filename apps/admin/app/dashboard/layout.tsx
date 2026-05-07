import Link from 'next/link';
import { redirect } from 'next/navigation';
import { UserButton } from '@clerk/nextjs';

import {
  PLATFORM_ROUTES,
  getPlatformRoles,
  hasAnyRoleSync,
} from '@/lib/access';

/**
 * Dashboard shell — gates `/dashboard/*` to authenticated callers
 * with at least one platform role. Per-page guards (via
 * `requirePlatformRole`) restrict further.
 *
 * Sidebar nav items are filtered by the caller's roles using
 * `PLATFORM_ROUTES`. That filtering is COSMETIC — the page-level
 * guards inside each route are the actual authorization. (See
 * lib/access.ts for the CVE-2025-29927 defense-in-depth note.)
 */

interface NavItem {
  href: string;
  label: string;
  /** Phase tag rendered when the route isn't built yet. */
  phaseTag?: string;
}

const NAV: readonly NavItem[] = [
  { href: '/dashboard/treasury', label: 'Treasury' },
  { href: '/dashboard/contracts', label: 'Contracts', phaseTag: '7.6' },
  { href: '/dashboard/payouts', label: 'Payouts', phaseTag: '7.7' },
  { href: '/dashboard/billing', label: 'Billing', phaseTag: '7.7' },
  { href: '/dashboard/pipeline', label: 'Pipeline', phaseTag: '7.7' },
  { href: '/dashboard/tenants', label: 'Tenants', phaseTag: '7.7' },
  { href: '/dashboard/agents', label: 'Agents', phaseTag: '7.7' },
  { href: '/dashboard/health', label: 'Health', phaseTag: '7.7' },
];

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const roles = await getPlatformRoles();
  if (roles.length === 0) redirect('/unauthorized');

  const visibleNav = NAV.filter(item => {
    const allowed = PLATFORM_ROUTES[item.href];
    if (!allowed) return true;
    return hasAnyRoleSync(roles, allowed);
  });

  return (
    <div className="grid min-h-screen grid-cols-[240px_1fr]">
      <aside className="border-r bg-[color:var(--color-muted)] px-4 py-6">
        <div className="mb-6 text-sm font-semibold uppercase tracking-wide text-[color:var(--color-muted-fg)]">
          Sendero Admin
        </div>
        <div className="mb-4 rounded-md bg-[color:var(--color-bg)] px-3 py-2 text-xs">
          <span className="text-[color:var(--color-muted-fg)]">roles · </span>
          <span className="font-medium">{roles.join(', ')}</span>
        </div>
        <nav className="flex flex-col gap-1 text-sm">
          {visibleNav.map(item => (
            <Link
              key={item.href}
              href={item.href}
              className="flex items-center justify-between rounded-md px-3 py-2 hover:bg-[color:var(--color-bg)]"
            >
              <span>{item.label}</span>
              {item.phaseTag ? (
                <em className="text-xs text-[color:var(--color-muted-fg)]">
                  {item.phaseTag}
                </em>
              ) : null}
            </Link>
          ))}
        </nav>
      </aside>
      <div className="flex min-h-screen flex-col">
        <header className="flex h-14 items-center justify-end border-b px-6">
          <UserButton />
        </header>
        <main className="flex-1 px-6 py-6">{children}</main>
      </div>
    </div>
  );
}
