'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { cn } from '@sendero/ui/cn';
import {
  BarChart3,
  Briefcase,
  FileText,
  Handshake,
  Home,
  type LucideIcon,
  Settings,
  ShieldAlert,
} from 'lucide-react';

export type SidebarLinkCopy = {
  href: string;
  label: string;
  exact?: boolean;
};

const defaultLinks: SidebarLinkCopy[] = [
  { href: '/dashboard', label: 'Home', exact: true },
  { href: '/dashboard/trips', label: 'Trips' },
  { href: '/dashboard/handoff', label: 'Handoff' },
  { href: '/dashboard/billing/invoices', label: 'Invoices' },
  { href: '/dashboard/spend', label: 'Spend' },
  { href: '/dashboard/caps', label: 'Caps' },
  { href: '/dashboard/settings/billing', label: 'Settings' },
];

const iconsByHref: Record<string, LucideIcon> = {
  '/dashboard': Home,
  '/dashboard/trips': Briefcase,
  '/dashboard/handoff': Handshake,
  '/dashboard/billing/invoices': FileText,
  '/dashboard/spend': BarChart3,
  '/dashboard/caps': ShieldAlert,
  '/dashboard/settings/billing': Settings,
};

export function Sidebar({ links = defaultLinks }: { links?: SidebarLinkCopy[] }) {
  const pathname = usePathname();

  return (
    <nav className="hidden min-h-screen w-60 shrink-0 flex-col gap-1 border-r border-border bg-muted/30 p-4 md:flex">
      {links.map(link => {
        const Icon = iconsByHref[link.href] ?? Home;
        const active = link.exact
          ? pathname === link.href
          : pathname === link.href || pathname.startsWith(`${link.href}/`);
        return (
          <Link
            key={link.href}
            href={link.href}
            className={cn(
              'flex items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground',
              active && 'bg-accent font-medium text-accent-foreground'
            )}
          >
            <Icon data-icon="inline-start" />
            <span>{link.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
