import Link from 'next/link';
import { UserButton } from '@clerk/nextjs';

import { assertSuperadminOrRedirect } from '@/lib/superadmin';

/**
 * Dashboard shell — gates the entire `/dashboard/*` subtree on
 * superadmin role. Phase 7.0 keeps the chrome minimal; Phase 7.1
 * ports the polished sidebar/header from
 * `next-shadcn-dashboard-starter`.
 */
export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { email } = await assertSuperadminOrRedirect();
  return (
    <div className="grid min-h-screen grid-cols-[240px_1fr]">
      <aside className="border-r bg-[color:var(--color-muted)] px-4 py-6">
        <div className="mb-8 text-sm font-semibold tracking-wide uppercase text-[color:var(--color-muted-fg)]">
          Sendero Admin
        </div>
        <nav className="flex flex-col gap-1 text-sm">
          <Link
            href="/dashboard/treasury"
            className="rounded-md px-3 py-2 hover:bg-[color:var(--color-bg)]"
          >
            Treasury
          </Link>
          <span className="rounded-md px-3 py-2 text-[color:var(--color-muted-fg)]">
            Contracts <em className="ml-2 text-xs">(7.4)</em>
          </span>
          <span className="rounded-md px-3 py-2 text-[color:var(--color-muted-fg)]">
            Payouts <em className="ml-2 text-xs">(7.5)</em>
          </span>
          <span className="rounded-md px-3 py-2 text-[color:var(--color-muted-fg)]">
            Tenants <em className="ml-2 text-xs">(7.5)</em>
          </span>
          <span className="rounded-md px-3 py-2 text-[color:var(--color-muted-fg)]">
            Agents <em className="ml-2 text-xs">(7.5)</em>
          </span>
          <span className="rounded-md px-3 py-2 text-[color:var(--color-muted-fg)]">
            Health <em className="ml-2 text-xs">(7.5)</em>
          </span>
        </nav>
      </aside>
      <div className="flex min-h-screen flex-col">
        <header className="flex h-14 items-center justify-between border-b px-6">
          <span className="text-sm text-[color:var(--color-muted-fg)]">
            Signed in · <code>{email}</code>
          </span>
          <UserButton />
        </header>
        <main className="flex-1 px-6 py-6">{children}</main>
      </div>
    </div>
  );
}
