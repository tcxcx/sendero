'use client';

import { BarChart3, Briefcase, FileText, Home, Settings, ShieldAlert } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@sendero/ui/cn';

const links = [
  { href: '/app', label: 'Home', icon: Home, exact: true },
  { href: '/app/trips', label: 'Trips', icon: Briefcase },
  { href: '/app/billing/invoices', label: 'Invoices', icon: FileText },
  { href: '/app/spend', label: 'Spend', icon: BarChart3 },
  { href: '/app/caps', label: 'Caps', icon: ShieldAlert },
  { href: '/app/settings/billing', label: 'Settings', icon: Settings },
] as const;

export function Sidebar() {
  const pathname = usePathname();

  return (
    <nav className="hidden min-h-screen w-60 shrink-0 flex-col gap-1 border-r border-border bg-muted/30 p-4 md:flex">
      {links.map(link => {
        const Icon = link.icon;
        const active =
          'exact' in link && link.exact
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
