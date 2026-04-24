'use client';

import { cn } from '@sendero/ui/cn';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const links = [
  { href: '/app/settings/billing', label: 'Billing' },
  { href: '/app/settings/branding', label: 'Branding' },
  { href: '/app/settings/org', label: 'Organization' },
  { href: '/app/settings/profile', label: 'Profile' },
] as const;

export function SettingsNav() {
  const pathname = usePathname();

  return (
    <nav className="flex gap-2 border-b border-[color:var(--hairline-color-soft)] pb-4 md:w-48 md:flex-col md:border-b-0 md:pb-0">
      {links.map(link => (
        <Link
          key={link.href}
          href={link.href}
          className={cn(
            'rounded-[var(--radius-sm)] px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-[color:var(--tint-midnight-soft)] hover:text-foreground',
            pathname === link.href &&
              'bg-[color:var(--tint-vermillion-soft)] font-medium text-foreground'
          )}
        >
          {link.label}
        </Link>
      ))}
    </nav>
  );
}
