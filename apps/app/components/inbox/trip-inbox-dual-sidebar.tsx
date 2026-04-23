'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Inbox, MessageCircle } from 'lucide-react';
import { useUser } from '@clerk/nextjs';

import { NavInboxUser } from '@/components/inbox/nav-inbox-user';
import { Label } from '@/components/ui/label';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInput,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar';
import { Switch } from '@/components/ui/switch';

export type InboxTripRow = {
  id: string;
  status: string;
  title: string;
  teaser: string;
  updatedLabel: string;
};

const navItems = [
  { title: 'Inbox', icon: Inbox, href: '/app/inbox' as const },
  { title: 'Channels', icon: MessageCircle, href: '/app/channels/whatsapp' as const },
];

export function TripInboxDualSidebar({ trips }: { trips: InboxTripRow[] }) {
  const pathname = usePathname() ?? '';
  const { user } = useUser();
  const { setOpen } = useSidebar();
  const selectedTripId = pathname.startsWith('/app/inbox/') ? pathname.split('/').pop() : null;

  const userForNav = {
    name: user?.fullName ?? user?.firstName ?? 'Admin',
    email: user?.primaryEmailAddress?.emailAddress ?? '',
    imageUrl: user?.imageUrl ?? '',
  };

  return (
    <Sidebar
      collapsible="icon"
      className="h-full min-h-0 max-w-full overflow-hidden border-r bg-sidebar [&>[data-sidebar=sidebar]]:flex-row"
    >
      <Sidebar collapsible="none" className="!w-[calc(var(--sidebar-width-icon)+1px)] border-r">
        <SidebarHeader>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton size="lg" asChild className="md:h-8 md:p-0">
                <Link href="/app">
                  <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                    <Image
                      src="/brand/logo-masters/clean/sendero_icon_vermilion_clean_2048.png"
                      alt=""
                      width={20}
                      height={20}
                      className="object-contain"
                    />
                  </div>
                  <div className="grid flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-semibold">Inbox</span>
                    <span className="truncate text-xs">Trips</span>
                  </div>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent className="px-1.5 md:px-0">
              <SidebarMenu>
                {navItems.map(item => {
                  const active =
                    item.href === '/app/inbox'
                      ? pathname === '/app/inbox' || pathname.startsWith('/app/inbox/')
                      : pathname.startsWith(item.href);
                  return (
                    <SidebarMenuItem key={item.title}>
                      <SidebarMenuButton
                        tooltip={{ children: item.title, hidden: false }}
                        onClick={() => setOpen(true)}
                        isActive={active}
                        className="px-2.5 md:px-2"
                        asChild
                      >
                        <Link href={item.href}>
                          <item.icon className="size-4" />
                          <span>{item.title}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter>
          <NavInboxUser user={userForNav} />
        </SidebarFooter>
      </Sidebar>

      <Sidebar collapsible="none" className="hidden min-w-0 flex-1 border-r md:flex">
        <SidebarHeader className="gap-3.5 border-b p-4">
          <div className="flex w-full min-w-0 items-center justify-between gap-2">
            <div className="min-w-0 text-base font-medium text-foreground">Trip threads</div>
            <Label className="flex shrink-0 items-center gap-2 text-sm">
              <span className="hidden lg:inline">Unreads</span>
              <Switch className="shadow-none" />
            </Label>
          </div>
          <SidebarInput placeholder="Filter trips…" className="bg-background" />
        </SidebarHeader>
        <SidebarContent className="min-h-0">
          <SidebarGroup className="px-0">
            <SidebarGroupContent>
              {trips.length === 0 ? (
                <p className="px-4 py-6 text-sm text-muted-foreground">
                  No trips yet. Create a prepaid trip from Trips, then return here to support
                  travelers in-channel.
                </p>
              ) : null}
              {trips.map(trip => {
                const active = selectedTripId === trip.id;
                return (
                  <Link
                    href={`/app/inbox/${trip.id}`}
                    key={trip.id}
                    className={
                      active
                        ? 'flex flex-col items-start gap-1 whitespace-nowrap border-b bg-sidebar-accent p-4 text-sm leading-tight last:border-b-0'
                        : 'flex flex-col items-start gap-1 whitespace-nowrap border-b p-4 text-sm leading-tight last:border-b-0 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
                    }
                  >
                    <div className="flex w-full min-w-0 items-center gap-2">
                      <span className="min-w-0 truncate font-medium">{trip.title}</span>
                      <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                        {trip.updatedLabel}
                      </span>
                    </div>
                    <span className="text-xs text-muted-foreground">{trip.status}</span>
                    <span className="line-clamp-2 w-full whitespace-break-spaces text-xs text-muted-foreground">
                      {trip.teaser}
                    </span>
                  </Link>
                );
              })}
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
      </Sidebar>
    </Sidebar>
  );
}
