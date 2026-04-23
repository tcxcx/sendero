'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  BarChart3,
  Bot,
  Briefcase,
  FileText,
  Home,
  Inbox,
  Landmark,
  MessageCircle,
  Plane,
  Settings,
  ShieldAlert,
  Sparkles,
  Waypoints,
} from 'lucide-react';

import { SearchForm } from '@/components/search-form';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from '@/components/ui/sidebar';

type Item = { href: string; label: string; icon: React.ComponentType<{ className?: string }> };

const workspace: Item[] = [
  { href: '/app', label: 'Home', icon: Home },
  { href: '/app/console', label: 'Agent console', icon: Bot },
  { href: '/app/inbox', label: 'Trip inboxes', icon: Inbox },
  { href: '/app/ops', label: 'Ops workspace', icon: Briefcase },
  { href: '/app/trips', label: 'Trips', icon: Plane },
];

const money: Item[] = [
  { href: '/app/billing/invoices', label: 'Invoices', icon: FileText },
  { href: '/app/spend', label: 'Spend', icon: BarChart3 },
  { href: '/app/caps', label: 'Caps', icon: ShieldAlert },
];

const connect: Item[] = [
  { href: '/app/channels/whatsapp', label: 'WhatsApp', icon: MessageCircle },
  { href: '/app/channels/slack', label: 'Slack', icon: Landmark },
  { href: '/app/integrations/mcp', label: 'MCP / LLM tools', icon: Sparkles },
];

const settings: Item[] = [{ href: '/app/settings/billing', label: 'Org settings', icon: Settings }];

function isActivePath(pathname: string, href: string, exact?: boolean) {
  if (exact) {
    return pathname === href;
  }
  if (href === '/app') {
    return pathname === '/app' || pathname === '/app/';
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function MainAppSidebar() {
  const pathname = usePathname() ?? '';

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link href="/app">
                <div className="flex aspect-square size-8 items-center justify-center">
                  <Image
                    src="/brand/logo-masters/clean/sendero_icon_vermilion_clean_2048.png"
                    alt=""
                    width={28}
                    height={28}
                    className="object-contain"
                  />
                </div>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-semibold">Sendero</span>
                  <span className="truncate text-xs text-muted-foreground">Admin</span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <SearchForm className="px-0" />
      </SidebarHeader>

      <SidebarContent>
        <NavGroup title="Workspace" items={workspace} pathname={pathname} />
        <NavGroup title="Money & policy" items={money} pathname={pathname} />
        <NavGroup title="Channels" items={connect} pathname={pathname} />
        <NavGroup title="Settings" items={settings} pathname={pathname} />
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild size="sm">
              <Link href="/llms.txt" target="_blank" rel="noreferrer">
                <Waypoints className="size-4" />
                <span>llms.txt</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}

function NavGroup({ title, items, pathname }: { title: string; items: Item[]; pathname: string }) {
  return (
    <SidebarGroup>
      <SidebarGroupLabel>{title}</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map(item => {
            const active = isActivePath(pathname, item.href, item.href === '/app');
            return (
              <SidebarMenuItem key={item.href}>
                <SidebarMenuButton asChild isActive={active} tooltip={item.label}>
                  <Link href={item.href}>
                    <item.icon className="size-4" />
                    <span>{item.label}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
