'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Activity,
  CircleDollarSign,
  HardDriveDownload,
  Heart,
  LayoutDashboard,
  MapIcon,
  Plus,
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
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { OrgSwitcher } from './org-switcher';

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
    href: '/dashboard',
    label: 'Dashboard',
    icon: LayoutDashboard,
    allowed: ['superadmin', 'sales', 'eng', 'support', 'finance'],
  },
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
  },
  {
    href: '/dashboard/maps',
    label: 'Maps',
    icon: MapIcon,
    allowed: ['superadmin', 'sales', 'eng', 'support', 'finance'],
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
      <SidebarHeader className="h-auto px-3 py-3">
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <OrgSwitcher />
          </div>
          <Button
            asChild
            variant="outline"
            className="h-10 shrink-0 gap-1.5 rounded-lg px-2 text-xs"
          >
            <Link href="/dashboard/orgs/new" aria-label="New vertical org">
              <Plus className="h-3.5 w-3.5" />
              New Org
            </Link>
          </Button>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarSectionLabel>Overview</SidebarSectionLabel>
        <SidebarMenu>
          {visible.map(item => {
            const isActive =
              item.href === '/dashboard'
                ? pathname === item.href
                : pathname === item.href || pathname.startsWith(`${item.href}/`);
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
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-[color:var(--color-primary)]" />
          <div className="min-w-0">
            <p className="truncate text-xs font-medium">Sendero Admin</p>
            <p className="truncate text-[10px] text-[color:var(--color-muted-foreground)]">
              {roles.join(', ')}
            </p>
          </div>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}

function SidebarSectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-2 px-3 text-xs font-medium text-[color:var(--color-muted-foreground)]">
      {children}
    </p>
  );
}
