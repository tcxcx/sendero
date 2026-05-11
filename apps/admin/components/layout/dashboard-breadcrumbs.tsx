'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LABELS: Record<string, string> = {
  dashboard: 'Dashboard',
  treasury: 'Treasury',
  contracts: 'Contracts',
  payouts: 'Payouts',
  billing: 'Billing',
  pipeline: 'Pipeline',
  tenants: 'Tenants',
  orgs: 'Organizations',
  new: 'New',
  agents: 'Agents',
  health: 'Health',
};

export function DashboardBreadcrumbs() {
  const pathname = usePathname();
  const parts = pathname.split('/').filter(Boolean);
  const crumbs = parts.map((part, index) => {
    const href = `/${parts.slice(0, index + 1).join('/')}`;
    return { href, label: LABELS[part] ?? part };
  });

  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-sm">
      {crumbs.map((crumb, index) => {
        const current = index === crumbs.length - 1;
        return (
          <span key={crumb.href} className="flex items-center gap-2">
            {index > 0 ? (
              <span className="text-[color:var(--color-muted-foreground)]">/</span>
            ) : null}
            {current ? (
              <span className="font-medium text-[color:var(--color-foreground)]">
                {crumb.label}
              </span>
            ) : (
              <Link
                href={crumb.href}
                className="text-[color:var(--color-muted-foreground)] hover:text-[color:var(--color-foreground)]"
              >
                {crumb.label}
              </Link>
            )}
          </span>
        );
      })}
    </nav>
  );
}
