'use client';

import { type ComponentProps, useEffect, useState } from 'react';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { OrganizationSwitcher } from '@clerk/nextjs';
import type { LucideIcon } from 'lucide-react';
import {
  BarChart3,
  Bot,
  FileText,
  Home,
  Inbox,
  Landmark,
  MapIcon,
  MessageCircle,
  Minus,
  Plane,
  Plus,
  ScanLine,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';

import { BrandUpgradeCard } from '@/components/app-shell/brand-upgrade-card';
import { HelpDocsCard } from '@/components/app-shell/help-docs-card';
import { LlmsDocsCard } from '@/components/app-shell/llms-docs-card';
import { OperatorOnboardingCard } from '@/components/app-shell/operator-onboarding-card';
import { SocialsRow } from '@/components/app-shell/socials-row';
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

/**
 * NavSub rendering: when `iconSrc` is set, the brand SVG (full-color
 * trademark mark from `/public/brand/app-store/*`) renders instead of
 * the Lucide glyph. Keeps WhatsApp / Slack / MCP visually consistent
 * with the dashboard ChannelPill row and the connect-flow chrome.
 */
type NavSub = { title: string; url: string; icon: LucideIcon; iconSrc?: string };

type NavSection = { title: string; items: NavSub[] };

const sections: NavSection[] = [
  {
    title: 'Workspace',
    items: [
      { title: 'Home', url: '/dashboard', icon: Home },
      { title: 'Agent console', url: '/dashboard/console', icon: Bot },
      { title: 'Scan document', url: '/dashboard/scan', icon: ScanLine },
      { title: 'Passport', url: '/dashboard/passport', icon: ShieldCheck },
      { title: 'Trip inboxes', url: '/dashboard/inbox', icon: Inbox },
      { title: 'Trips', url: '/dashboard/trips', icon: Plane },
      { title: 'Active trips map', url: '/dashboard/trips/map', icon: MapIcon },
    ],
  },
  {
    title: 'Money & policy',
    items: [
      { title: 'Invoices', url: '/dashboard/billing/invoices', icon: FileText },
      { title: 'Spend', url: '/dashboard/spend', icon: BarChart3 },
      { title: 'Caps', url: '/dashboard/caps', icon: ShieldAlert },
    ],
  },
  {
    title: 'Channels',
    items: [
      {
        title: 'WhatsApp',
        url: '/dashboard/channels/whatsapp',
        icon: MessageCircle,
        iconSrc: '/brand/app-store/whatsapp.svg',
      },
      {
        title: 'Slack',
        url: '/dashboard/channels/slack',
        icon: Landmark,
        iconSrc: '/brand/app-store/slack.svg',
      },
      {
        title: 'API keys / MCP',
        url: '/dashboard/integrations/mcp',
        icon: Sparkles,
        iconSrc: '/brand/app-store/mcp.svg',
      },
    ],
  },
];

function isActivePath(pathname: string, href: string, exact?: boolean) {
  if (exact) {
    return pathname === href;
  }
  if (href === '/dashboard') {
    return pathname === '/dashboard' || pathname === '/dashboard/';
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppSidebar({ ...props }: ComponentProps<typeof Sidebar>) {
  const pathname = usePathname() ?? '';
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader className="group-data-[collapsible=icon]:hidden">
        <div className="px-2 pt-1 pb-2 pr-10 md:pr-2">
          {mounted ? (
            <OrganizationSwitcher
              hidePersonal={false}
              afterSelectOrganizationUrl="/dashboard"
              afterCreateOrganizationUrl="/onboarding"
              appearance={{
                elements: {
                  rootBox: 'w-full',
                  organizationSwitcherTrigger:
                    'w-full min-w-0 justify-between rounded-md px-2 py-1.5 hover:bg-[color:var(--tint-vermillion-soft)]',
                },
              }}
            />
          ) : (
            <div
              className="h-9 w-full rounded-md bg-[color:var(--tint-vermillion-soft)]/40"
              aria-hidden="true"
            />
          )}
        </div>
        <SearchForm className="px-0" placeholder="Search trips, invoices…" />
      </SidebarHeader>

      <SidebarContent>
        {/* Expanded state: collapsible sections with category headers */}
        <SidebarGroup className="group-data-[collapsible=icon]:hidden">
          <SidebarMenu>
            {sections.map((section, index) => (
              <Collapsible
                key={section.title}
                defaultOpen={
                  section.items.some(item =>
                    isActivePath(pathname, item.url, item.url === '/dashboard')
                  ) || index === 0
                }
                className="group/collapsible"
              >
                <SidebarMenuItem>
                  <CollapsibleTrigger asChild>
                    <SidebarMenuButton className="group/trigger">
                      <span className="truncate">{section.title}</span>
                      <Plus className="ml-auto size-4 shrink-0 text-[color:var(--ink)] transition-transform duration-200 ease-out group-hover/trigger:rotate-45 group-data-[state=open]/collapsible:hidden" />
                      <Minus className="ml-auto size-4 shrink-0 text-[color:var(--ink)] transition-transform duration-200 ease-out group-hover/trigger:rotate-90 group-data-[state=closed]/collapsible:hidden" />
                    </SidebarMenuButton>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <SidebarMenuSub>
                      {section.items.map(item => {
                        const active = isActivePath(pathname, item.url, item.url === '/dashboard');
                        return (
                          <SidebarMenuSubItem key={item.url}>
                            <SidebarMenuSubButton asChild isActive={active}>
                              <Link href={item.url}>
                                {item.iconSrc ? (
                                  /* eslint-disable-next-line @next/next/no-img-element -- trademark-locked brand SVG */
                                  <img
                                    src={item.iconSrc}
                                    alt=""
                                    width={20}
                                    height={20}
                                    className="size-5 shrink-0"
                                    aria-hidden="true"
                                  />
                                ) : (
                                  <item.icon className="size-4" />
                                )}
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

        {/* Collapsed state: flat icon list, no category headers. Tooltip
            surfaces the full label on hover. */}
        <SidebarGroup className="hidden group-data-[collapsible=icon]:block">
          <SidebarMenu>
            {sections
              .flatMap(s => s.items)
              .map(item => {
                const active = isActivePath(pathname, item.url, item.url === '/dashboard');
                return (
                  <SidebarMenuItem key={item.url}>
                    <SidebarMenuButton asChild isActive={active} tooltip={item.title}>
                      <Link href={item.url}>
                        {item.iconSrc ? (
                          /* eslint-disable-next-line @next/next/no-img-element -- trademark-locked brand SVG */
                          <img
                            src={item.iconSrc}
                            alt=""
                            width={20}
                            height={20}
                            className="size-5 shrink-0"
                            aria-hidden="true"
                          />
                        ) : (
                          <item.icon className="size-4" />
                        )}
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="p-0 gap-0">
        <div
          aria-hidden
          className="h-px w-full bg-[color:color-mix(in_oklab,var(--ink)_24%,transparent)] group-data-[collapsible=icon]:hidden"
        />
        <SidebarMenu>
          <OperatorOnboardingCard />
        </SidebarMenu>
        <div
          aria-hidden
          className="h-px w-full bg-[color:color-mix(in_oklab,var(--ink)_24%,transparent)] group-data-[collapsible=icon]:hidden"
        />
        <SidebarMenu>
          <LlmsDocsCard />
        </SidebarMenu>
        <div
          aria-hidden
          className="h-px w-full bg-[color:color-mix(in_oklab,var(--ink)_24%,transparent)] group-data-[collapsible=icon]:hidden"
        />
        <SidebarMenu>
          <HelpDocsCard />
        </SidebarMenu>
        <div
          aria-hidden
          className="h-px w-full bg-[color:color-mix(in_oklab,var(--ink)_24%,transparent)] group-data-[collapsible=icon]:hidden"
        />
        <BrandUpgradeCard />
        <div
          aria-hidden
          className="h-px w-full bg-[color:color-mix(in_oklab,var(--ink)_24%,transparent)] group-data-[collapsible=icon]:hidden"
        />
        <SocialsRow />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
