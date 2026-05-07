'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Activity,
  CircleDollarSign,
  FileText,
  HardDriveDownload,
  Heart,
  ScanLine,
  ShieldCheck,
  TrendingUp,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react';

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar';
import { cn } from '@/lib/utils';

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Roles permitted to see this item. Filtering reuses `PLATFORM_ROUTES`
   *  semantics: `superadmin` short-circuits, otherwise role intersection. */
  allowed: readonly PlatformRole[];
  /** Phase tag rendered next to the label when the route isn't built yet. */
  phaseTag?: string;
}

const NAV: readonly NavItem[] = [
  {
    href: '/dashboard/treasury',
    label: 'Treasury',
    icon: Wallet,
    allowed: ['superadmin'],
  },
  {
    href: '/dashboard/contracts',
    label: 'Contracts',
    icon: ScanLine,
    allowed: ['superadmin', 'eng'],
    phaseTag: '7.6',
  },
  {
    href: '/dashboard/payouts',
    label: 'Payouts',
    icon: HardDriveDownload,
    allowed: ['superadmin', 'finance'],
    phaseTag: '7.7',
  },
  {
    href: '/dashboard/billing',
    label: 'Billing',
    icon: CircleDollarSign,
    allowed: ['superadmin', 'finance'],
    phaseTag: '7.7',
  },
  {
    href: '/dashboard/pipeline',
    label: 'Pipeline',
    icon: TrendingUp,
    allowed: ['superadmin', 'sales'],
    phaseTag: '7.7',
  },
  {
    href: '/dashboard/tenants',
    label: 'Tenants',
    icon: Users,
    allowed: ['superadmin', 'sales', 'support'],
    phaseTag: '7.7',
  },
  {
    href: '/dashboard/agents',
    label: 'Agents',
    icon: Activity,
    allowed: ['superadmin', 'eng'],
    phaseTag: '7.7',
  },
  {
    href: '/dashboard/health',
    label: 'Health',
    icon: Heart,
    allowed: ['superadmin', 'eng', 'support'],
    phaseTag: '7.7',
  },
];

/**
 * Sidebar shell for the admin dashboard. Receives the caller's
 * platformRoles from the (server) dashboard layout — sidebar nav
 * filtering is cosmetic; per-page guards do the actual authorization.
 */
export function AppSidebar({ roles }: { roles: readonly PlatformRole[] }) {
  const pathname = usePathname();
  const isSuperadmin = roles.includes('superadmin');

  const visible = NAV.filter(item => {
    if (isSuperadmin) return true;
    return item.allowed.some(r => roles.includes(r));
  });

  return (
    <Sidebar>
      <SidebarHeader>
        <Link href="/" className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-[color:var(--color-primary)]" />
          <span className="text-sm font-semibold tracking-tight">Sendero Admin</span>
        </Link>
      </SidebarHeader>
      <SidebarContent>
        <div className="mb-3 rounded-md border bg-[color:var(--color-background)] px-3 py-2 text-xs">
          <span className="text-[color:var(--color-muted-foreground)]">role(s) · </span>
          <span className="font-medium">{roles.join(', ')}</span>
        </div>
        <SidebarMenu>
          {visible.map(item => {
            const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
            const Icon = item.icon;
            return (
              <SidebarMenuItem key={item.href}>
                <Link href={item.href}>
                  <SidebarMenuButton asChild isActive={isActive}>
                    <span className="flex w-full items-center gap-2">
                      <Icon className="h-4 w-4 shrink-0" />
                      <span className="flex-1">{item.label}</span>
                      {item.phaseTag ? (
                        <em
                          className={cn(
                            'rounded px-1.5 py-0.5 text-[10px] font-normal not-italic',
                            'bg-[color:var(--color-muted)] text-[color:var(--color-muted-foreground)]'
                          )}
                        >
                          {item.phaseTag}
                        </em>
                      ) : null}
                    </span>
                  </SidebarMenuButton>
                </Link>
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      </SidebarContent>
      <SidebarFooter>
        <p className="text-[10px] uppercase tracking-wider text-[color:var(--color-muted-foreground)]">
          Internal · do not share
        </p>
      </SidebarFooter>
    </Sidebar>
  );
}
