'use client';

import Link from 'next/link';

import { HoverCard, HoverCardContent, HoverCardTrigger } from '@sendero/ui/hover-card';
import { LifeBuoy } from 'lucide-react';

import { SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar';

const HELP_URL = 'https://docs.sendero.travel/docs/help';
const WHATSAPP_URL = process.env.NEXT_PUBLIC_SENDERO_WA_URL ?? 'https://wa.me/';
const EMAIL_URL = 'mailto:support@sendero.travel';

export function HelpDocsCard() {
  return (
    <HoverCard openDelay={120} closeDelay={80}>
      <HoverCardTrigger asChild>
        <SidebarMenuItem>
          <SidebarMenuButton
            asChild
            size="sm"
            tooltip="Help · Support"
            className="flex w-full items-center justify-center gap-2 rounded-none px-3.5 py-6 font-mono text-[11px] uppercase tracking-[0.12em] text-foreground transition-[background-color,color] duration-120 hover:bg-[color:color-mix(in_oklab,var(--ink)_6%,transparent)] hover:text-[color:var(--ink)] group-data-[collapsible=icon]:!size-8 group-data-[collapsible=icon]:!p-0 group-data-[collapsible=icon]:!mx-auto"
          >
            <Link href={HELP_URL} target="_blank" rel="noreferrer">
              <LifeBuoy className="size-4 text-[color:var(--ink)]" />
              <span className="group-data-[collapsible=icon]:hidden">Help · Support</span>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </HoverCardTrigger>
      <HoverCardContent
        side="right"
        align="end"
        sideOffset={14}
        collisionPadding={16}
        className="z-[60] w-80 p-0 border-[color:color-mix(in_oklab,var(--ink)_22%,transparent)] bg-[color:var(--bg-elev)] shadow-[var(--shadow-md)]"
      >
        <div className="flex items-center gap-3 px-4 pt-4 pb-3">
          <LifeBuoy className="size-5 shrink-0 text-[color:var(--ink)]" />
          <div className="min-w-0 flex-1">
            <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-[color:var(--text-dim)]">
              Need a hand?
            </div>
            <div className="truncate text-sm font-medium text-[color:var(--text)]">
              Help & support
            </div>
          </div>
          <span className="shrink-0 rounded-full border border-[color:color-mix(in_oklab,var(--accent-green)_40%,transparent)] bg-[color:color-mix(in_oklab,var(--accent-green)_14%,transparent)] px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.14em] text-[color:var(--accent-green)]">
            24/7
          </span>
        </div>

        <div className="border-t border-[color:color-mix(in_oklab,var(--ink)_12%,transparent)] px-4 py-3">
          <p className="text-xs leading-relaxed text-[color:var(--text-dim)]">
            <strong className="text-[color:var(--text)]">Docs</strong> cover trips, policy, billing,
            and Arc settlement. <strong className="text-[color:var(--text)]">Live support</strong>{' '}
            on WhatsApp or email for anything else.
          </p>
          <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.08em] text-[color:var(--text-faint)]">
            Reply target · &lt; 4h business · &lt; 24h weekends
          </p>
        </div>

        <div className="flex gap-2 border-t border-[color:color-mix(in_oklab,var(--ink)_12%,transparent)] p-3">
          <Link
            href={HELP_URL}
            target="_blank"
            rel="noreferrer"
            className="flex flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-md border border-[color:color-mix(in_oklab,var(--ink)_22%,transparent)] bg-transparent px-3 py-2 font-mono text-[10px] uppercase tracking-[0.12em] text-[color:var(--text)] transition-colors hover:border-[color:var(--ink)] hover:text-[color:var(--ink)]"
          >
            Read docs ↗
          </Link>
          <Link
            href={WHATSAPP_URL}
            target="_blank"
            rel="noreferrer"
            className="flex flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-md bg-[color:var(--ink)] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.12em] text-[color:var(--bg-elev)] transition-opacity hover:opacity-90"
          >
            Message us →
          </Link>
        </div>

        <div className="border-t border-[color:color-mix(in_oklab,var(--ink)_12%,transparent)] px-4 py-2.5">
          <Link
            href={EMAIL_URL}
            className="block text-center font-mono text-[10px] uppercase tracking-[0.12em] text-[color:var(--text-faint)] transition-colors hover:text-[color:var(--ink)]"
          >
            support@sendero.travel
          </Link>
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}
