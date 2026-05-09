'use client';

import { useAuth, useOrganizationList } from '@clerk/nextjs';
import { Building2, Check, ChevronsUpDown, Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar';

export function OrgSwitcher() {
  const router = useRouter();
  const { orgId } = useAuth();
  const { isLoaded, setActive, userMemberships } = useOrganizationList({
    userMemberships: {
      infinite: true,
      keepPreviousData: false,
    },
  });

  const memberships = userMemberships?.data ?? [];
  const active = memberships.find(membership => membership.organization.id === orgId);
  const displayOrg = active?.organization ?? memberships[0]?.organization;

  async function switchOrg(organizationId: string) {
    if (!setActive || organizationId === orgId) return;
    await setActive({ organization: organizationId });
  }

  if (!isLoaded) {
    return (
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton size="lg" disabled>
            <div className="flex size-8 items-center justify-center rounded-lg bg-[color:var(--color-sidebar-accent)]">
              <Building2 className="size-4" />
            </div>
            <div className="grid flex-1 text-left text-sm leading-tight">
              <span className="truncate font-medium">Loading...</span>
              <span className="truncate text-xs text-[color:var(--color-muted-foreground)]">
                Organizations
              </span>
            </div>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    );
  }

  if (!displayOrg) {
    return (
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton size="lg" onClick={() => router.push('/dashboard/orgs/new')}>
            <div className="flex size-8 items-center justify-center rounded-lg bg-[color:var(--color-primary)] text-[color:var(--color-primary-foreground)]">
              <Plus className="size-4" />
            </div>
            <div className="grid flex-1 text-left text-sm leading-tight">
              <span className="truncate font-medium">Create organization</span>
              <span className="truncate text-xs text-[color:var(--color-muted-foreground)]">
                New vertical
              </span>
            </div>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    );
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton size="lg">
              <div className="flex size-8 items-center justify-center overflow-hidden rounded-lg bg-[color:var(--color-primary)] text-[color:var(--color-primary-foreground)]">
                <Building2 className="size-4" />
              </div>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">{displayOrg.name}</span>
                <span className="truncate text-xs text-[color:var(--color-muted-foreground)]">
                  {active?.role ?? 'Superadmin org'}
                </span>
              </div>
              <ChevronsUpDown className="ml-auto size-4 text-[color:var(--color-muted-foreground)]" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="min-w-56 rounded-lg"
            align="start"
            side="right"
            sideOffset={6}
          >
            <DropdownMenuLabel className="text-xs text-[color:var(--color-muted-foreground)]">
              Superadmin organizations
            </DropdownMenuLabel>
            {memberships.map((membership, index) => {
              const selected = membership.organization.id === orgId;
              return (
                <DropdownMenuItem
                  key={membership.id}
                  className="gap-2 p-2"
                  onClick={() => switchOrg(membership.organization.id)}
                >
                  <div className="flex size-6 items-center justify-center rounded-md border">
                    <Building2 className="size-3.5" />
                  </div>
                  <span className="truncate">{membership.organization.name}</span>
                  {selected ? (
                    <Check className="ml-auto size-4" />
                  ) : (
                    <DropdownMenuShortcut>⌘{index + 1}</DropdownMenuShortcut>
                  )}
                </DropdownMenuItem>
              );
            })}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="gap-2 p-2"
              onClick={() => router.push('/dashboard/orgs/new')}
            >
              <div className="flex size-6 items-center justify-center rounded-md border bg-transparent">
                <Plus className="size-4" />
              </div>
              <span className="font-medium text-[color:var(--color-muted-foreground)]">
                Create organization
              </span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
