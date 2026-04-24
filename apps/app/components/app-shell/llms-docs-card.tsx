'use client';

import Link from 'next/link';

import { useAuth } from '@clerk/nextjs';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@sendero/ui/hover-card';
import { Waypoints } from 'lucide-react';

import { SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar';

const DOCS_URL = 'https://docs.sendero.travel/docs/mcp-integration';
const LLMS_TXT_URL = '/llms.txt';

export function LlmsDocsCard() {
  const { has, isLoaded } = useAuth();

  // `mcp_server_public` is the Clerk Billing feature attached to Pro + Enterprise
  // per packages/billing/src/plans.ts.
  const hasMcp = isLoaded && !!has?.({ feature: 'mcp_server_public' });

  return (
    <HoverCard openDelay={120} closeDelay={80}>
      <HoverCardTrigger asChild>
        <SidebarMenuItem>
          <SidebarMenuButton
            asChild
            size="sm"
            tooltip="Docs · MCP"
            className="flex w-full justify-center gap-2 rounded-none px-3.5 py-6 font-mono text-[11px] uppercase tracking-[0.12em] text-foreground transition-[background-color,color] duration-120 hover:bg-[color:color-mix(in_oklab,var(--ink)_6%,transparent)] hover:text-[color:var(--ink)] group-data-[collapsible=icon]:!justify-center group-data-[collapsible=icon]:!px-0 group-data-[collapsible=icon]:!py-2"
          >
            <Link href={DOCS_URL} target="_blank" rel="noreferrer">
              <Waypoints className="size-4 text-[color:var(--ink)]" />
              <span className="group-data-[collapsible=icon]:hidden">Docs · MCP</span>
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
          <Waypoints className="size-5 shrink-0 text-[color:var(--ink)]" />
          <div className="min-w-0 flex-1">
            <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-[color:var(--text-dim)]">
              For AI agents
            </div>
            <div className="truncate text-sm font-medium text-[color:var(--text)]">
              MCP + llms.txt
            </div>
          </div>
          <span
            className={
              hasMcp
                ? 'shrink-0 rounded-full border border-[color:color-mix(in_oklab,var(--accent-green)_40%,transparent)] bg-[color:color-mix(in_oklab,var(--accent-green)_14%,transparent)] px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.14em] text-[color:var(--accent-green)]'
                : 'shrink-0 rounded-full border border-[color:color-mix(in_oklab,var(--ink)_22%,transparent)] bg-[color:var(--tint-vermillion-soft)] px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.14em] text-[color:var(--ink)]'
            }
          >
            {hasMcp ? 'Live' : 'Pro'}
          </span>
        </div>

        <div className="border-t border-[color:color-mix(in_oklab,var(--ink)_12%,transparent)] px-4 py-3">
          <p className="text-xs leading-relaxed text-[color:var(--text-dim)]">
            Plug your AI assistant into Sendero. Claude, Cursor, Zed, or any MCP-aware app can
            search flights, hold seats, and settle bookings on Arc — directly from your chat.
          </p>
          <ul className="mt-3 space-y-1.5 text-xs leading-relaxed text-[color:var(--text-dim)]">
            <li>
              <strong className="text-[color:var(--text)]">Travel ops:</strong> let your agent
              re-quote inbound traveler messages 24/7.
            </li>
            <li>
              <strong className="text-[color:var(--text)]">Corporate:</strong> "book my Tuesday
              flight to NYC" inside Slack — agent handles the rest.
            </li>
            <li>
              <strong className="text-[color:var(--text)]">Builders:</strong> wire Sendero into your
              own product as a paid travel layer.
            </li>
          </ul>
          {!hasMcp && (
            <p className="mt-3 text-xs leading-relaxed text-[color:var(--text-dim)]">
              Available on <strong className="text-[color:var(--text)]">Pro</strong>. Your public
              MCP endpoint goes live the moment you upgrade.
            </p>
          )}
        </div>

        <div className="flex gap-2 border-t border-[color:color-mix(in_oklab,var(--ink)_12%,transparent)] p-3">
          <Link
            href={DOCS_URL}
            target="_blank"
            rel="noreferrer"
            className="flex flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-md border border-[color:color-mix(in_oklab,var(--ink)_22%,transparent)] bg-transparent px-3 py-2 font-mono text-[10px] uppercase tracking-[0.12em] text-[color:var(--text)] transition-colors hover:border-[color:var(--ink)] hover:text-[color:var(--ink)]"
          >
            Read docs ↗
          </Link>
          {hasMcp ? (
            <Link
              href={LLMS_TXT_URL}
              target="_blank"
              rel="noreferrer"
              className="flex flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-md bg-[color:var(--ink)] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.12em] text-[color:var(--bg-elev)] transition-opacity hover:opacity-90"
            >
              View llms.txt ↗
            </Link>
          ) : (
            <Link
              href="/dashboard/billing/plans?upgrade=pro"
              className="flex flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-md bg-[color:var(--ink)] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.12em] text-[color:var(--bg-elev)] transition-opacity hover:opacity-90"
            >
              Go Pro →
            </Link>
          )}
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}
