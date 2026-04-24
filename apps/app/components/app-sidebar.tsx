'use client';

import type { ComponentProps } from 'react';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import type { LucideIcon } from 'lucide-react';
import {
  BarChart3,
  Bot,
  Briefcase,
  FileText,
  Home,
  Inbox,
  Landmark,
  MessageCircle,
  Minus,
  Plane,
  Plus,
  Settings,
  ShieldAlert,
  Sparkles,
  Waypoints,
} from 'lucide-react';

import { SearchForm } from '@/components/search-form';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarRail,
} from '@/components/ui/sidebar';

type NavSub = { title: string; url: string; icon: LucideIcon };

type NavSection = { title: string; items: NavSub[] };

const sections: NavSection[] = [
  {
    title: 'Workspace',
    items: [
      { title: 'Home', url: '/app', icon: Home },
      { title: 'Agent console', url: '/app/console', icon: Bot },
      { title: 'Trip inboxes', url: '/app/inbox', icon: Inbox },
      { title: 'Ops workspace', url: '/app/ops', icon: Briefcase },
      { title: 'Trips', url: '/app/trips', icon: Plane },
    ],
  },
  {
    title: 'Money & policy',
    items: [
      { title: 'Invoices', url: '/app/billing/invoices', icon: FileText },
      { title: 'Spend', url: '/app/spend', icon: BarChart3 },
      { title: 'Caps', url: '/app/caps', icon: ShieldAlert },
    ],
  },
  {
    title: 'Channels',
    items: [
      { title: 'WhatsApp', url: '/app/channels/whatsapp', icon: MessageCircle },
      { title: 'Slack', url: '/app/channels/slack', icon: Landmark },
      { title: 'MCP / LLM tools', url: '/app/integrations/mcp', icon: Sparkles },
    ],
  },
  {
    title: 'Settings',
    items: [{ title: 'Org settings', url: '/app/settings/billing', icon: Settings }],
  },
];

function isActivePath(pathname: string, href: string, exact?: boolean) {
  if (exact) {
    return pathname === href;
  }
  if (href === '/app') {
    return pathname === '/app' || pathname === '/app/';
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppSidebar({ ...props }: ComponentProps<typeof Sidebar>) {
  const pathname = usePathname() ?? '';

  return (
    <Sidebar collapsible="icon" {...props}>
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
                  <span className="truncate text-xs text-muted-foreground">Workspace</span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <SearchForm className="px-0" placeholder="Search trips, invoices…" />
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarMenu>
            {sections.map((section, index) => (
              <Collapsible
                key={section.title}
                defaultOpen={
                  section.items.some(item =>
                    isActivePath(pathname, item.url, item.url === '/app')
                  ) || index === 0
                }
                className="group/collapsible"
              >
                <SidebarMenuItem>
                  <CollapsibleTrigger asChild>
                    <SidebarMenuButton>
                      <span className="truncate">{section.title}</span>
                      <Plus className="ml-auto size-4 shrink-0 group-data-[state=open]/collapsible:hidden" />
                      <Minus className="ml-auto size-4 shrink-0 group-data-[state=closed]/collapsible:hidden" />
                    </SidebarMenuButton>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <SidebarMenuSub>
                      {section.items.map(item => {
                        const active = isActivePath(pathname, item.url, item.url === '/app');
                        return (
                          <SidebarMenuSubItem key={item.url}>
                            <SidebarMenuSubButton asChild isActive={active}>
                              <Link href={item.url}>
                                <item.icon className="size-4" />
                                <span>{item.title}</span>
                              </Link>
                            </SidebarMenuSubButton>
                          </SidebarMenuSubItem>
                        );
                      })}
                    </SidebarMenuSub>
                  </CollapsibleContent>
                </SidebarMenuItem>
              </Collapsible>
            ))}
          </SidebarMenu>
        </SidebarGroup>
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
