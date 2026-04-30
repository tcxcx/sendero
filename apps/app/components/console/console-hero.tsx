'use client';

/**
 * ConsoleHero / TripHero — full-width header band.
 *
 * Two surfaces, one shell:
 *
 *   - `<ConsoleHero>` (workspace mode) — KPIs (Today / Settled 30d /
 *     Avg response) + Quick Commands. Mounted on `/dashboard/console`.
 *     Reference: `/sendero/project/console-concepts.jsx::ConsoleV2Hero`.
 *
 *   - `<TripHero>` (scoped mode) — trip identity (traveler · route ·
 *     trip id · channel pill · hold timer) + Quick Commands + an
 *     optional toolbar slot for trip-action buttons. Mounted on
 *     `/dashboard/inbox/[tripId]`.
 *
 * Both share the same band shell (bleed margin, vermillion-soft
 * gradient, ink bottom border, inner rhythm) so the spacing matches
 * across surfaces while the content differentiates the lens. Quick
 * Commands ride along on both — operator muscle memory.
 *
 * Data wiring (workspace):
 *   - `tripsInFlight` + `awaiting` derive from the existing trips prop
 *     (free, server-rendered).
 *   - `settled30d` + `avgResponseLabel` are reserved for server-side
 *     aggregates; render `—` until those queries are added to
 *     `loadConsoleData`. We do NOT invent numbers to fill the slot.
 *
 * Quick commands are decorative until `onCommand` is provided. The
 * parent (`MetaInbox`) wires it through to the composer's seed text
 * once that plumbing exists.
 */

import type { ReactNode } from 'react';

import { ChatModelTrigger } from '@/components/chat/chat-model-trigger';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

import type { ChannelDef } from './channels';
import type { TripRowData } from './trip-rail';

const QUICK_COMMANDS: ReadonlyArray<{ k: string; hint: string; desc: string }> = [
  {
    k: '/spend',
    hint: '<period>',
    desc: 'Show total spend for a time window — try /spend last 30d or /spend this month. Breaks down by traveler, channel, and trip state.',
  },
  {
    k: '/policy',
    hint: '<name|dept>',
    desc: 'Look up travel policy limits for a person or team — try /policy Sarah or /policy engineering. Shows fare caps, booking windows, and approval thresholds.',
  },
  {
    k: '/trip',
    hint: '<id>',
    desc: 'Pull full details on any trip — try /trip trp-3392. Shows the timeline, channel history, holds, and booking audit trail.',
  },
  {
    k: '/handoff',
    hint: '@user',
    desc: "Transfer this trip to another operator. They'll be notified and see the full context, conversation, and pending actions.",
  },
  {
    k: '/report',
    hint: '<scope>',
    desc: 'Generate a travel or spend report — try /report this-week, /report department, or /report compliance. Exports as a structured summary.',
  },
];

// ─── shared shell ───────────────────────────────────────────────────

function HeroBand({ children }: { children: ReactNode }) {
  return (
    <div
      className="console-hero-band"
      style={{
        // Bleed past MetaInbox's `padding: 12px 0px` so the band's
        // background touches the surface edges (full-width header).
        // Inner padding handles the visual rhythm.
        margin: '-12px -14px 0',
        padding: '18px 22px 16px',
        background: 'linear-gradient(0deg, var(--tint-vermillion-soft) 0%, transparent 100%)',
        borderBottom: '1px solid var(--ink)',
        display: 'grid',
        gridTemplateColumns: 'minmax(0,1fr) minmax(330px,auto)',
        gap: 14,
        alignItems: 'stretch',
        minWidth: 0,
      }}
    >
      {children}
    </div>
  );
}

function MetaLabel({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        fontFamily: 'var(--font-mono)',
        fontSize: 10,
        textTransform: 'uppercase',
        letterSpacing: '0.08em',
        color: 'var(--text-dim)',
      }}
    >
      {children}
    </div>
  );
}

// ─── shared right panel (model selector + quick commands) ───────────

function QuickCommandsPanel({ onCommand }: { onCommand?: (prefix: string) => void }) {
  return (
    <div
      className="console-hero-quick"
      style={{
        paddingLeft: 24,
        borderLeft: '1px solid var(--hairline-color)',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        justifyContent: 'center',
        minWidth: 0,
      }}
    >
      <div className="console-hero-quick-desktop">
        <div
          className="console-hero-quick-head"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
          }}
        >
          <MetaLabel>Quick commands</MetaLabel>
          <ChatModelTrigger />
        </div>
        <TooltipProvider delayDuration={400}>
          <div
            className="console-hero-quick-list"
            style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}
          >
            {QUICK_COMMANDS.map(q => (
              <Tooltip key={q.k}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className="console-hero-quick-chip sd-corner-hover"
                    onClick={() => onCommand?.(q.k)}
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 10.5,
                      padding: '4px 9px',
                      background: 'var(--surface-floating)',
                      boxShadow: 'inset 0 0 0 1px var(--hairline-color)',
                      borderRadius: 14,
                      border: 0,
                      cursor: onCommand ? 'pointer' : 'default',
                      display: 'inline-flex',
                      alignItems: 'baseline',
                      gap: 5,
                      whiteSpace: 'nowrap',
                      flexShrink: 0,
                    }}
                  >
                    <span style={{ color: 'var(--vermillion)', fontWeight: 600 }}>{q.k}</span>
                    <span style={{ color: 'var(--text-dim)' }}>{q.hint}</span>
                  </button>
                </TooltipTrigger>
                <TooltipContent
                  side="bottom"
                  align="start"
                  className="w-64 max-w-none border border-[color:var(--ink)] bg-[color:var(--surface-floating)] p-3 text-[color:var(--midnight)] shadow-[0_4px_16px_rgba(31,42,68,0.12)]"
                >
                  <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--vermillion)] mb-1">
                    {q.k} {q.hint}
                  </p>
                  <p className="text-[11px] leading-relaxed opacity-75">{q.desc}</p>
                </TooltipContent>
              </Tooltip>
            ))}
          </div>
        </TooltipProvider>
      </div>

      <div
        className="console-hero-quick-mobile"
        style={{ display: 'none', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}
      >
        <ChatModelTrigger />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="sd-corner-hover"
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
                padding: '6px 10px',
                background: 'var(--surface-floating)',
                boxShadow: 'inset 0 0 0 1px var(--hairline-color)',
                borderRadius: 6,
                border: 0,
                color: 'var(--ink)',
              }}
            >
              Commands
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="min-w-56 border border-[color:var(--ink)] bg-[color:var(--surface-floating)] p-1 text-[color:var(--midnight)] shadow-[0_4px_16px_rgba(31,42,68,0.12)]"
          >
            {QUICK_COMMANDS.map(q => (
              <DropdownMenuItem
                key={q.k}
                onSelect={() => onCommand?.(q.k)}
                className="flex cursor-pointer items-baseline gap-2 rounded-[4px] px-2 py-2 font-mono text-[11px]"
              >
                <span className="font-semibold text-[color:var(--vermillion)]">{q.k}</span>
                <span className="text-[color:var(--text-dim)]">{q.hint}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

// ─── workspace mode ─────────────────────────────────────────────────

export interface ConsoleHeroProps {
  trips: TripRowData[];
  /** Total settled fare over the last 30d, formatted (e.g., "$74,820"). */
  settled30dFare?: string | null;
  /** Settled-trip count over the last 30d (e.g., 312). */
  settled30dCount?: number | null;
  /** Avg agent response time, formatted (e.g., "11s"). */
  avgResponseLabel?: string | null;
  /** Optional chip handler. When omitted, chips render inert (decorative). */
  onCommand?: (prefix: string) => void;
}

export function ConsoleHero({
  trips,
  settled30dFare,
  settled30dCount,
  avgResponseLabel,
  onCommand,
}: ConsoleHeroProps) {
  // Derived live counts. The `trips` slice is the same one the rail
  // reads — keeping the source consistent so the hero never disagrees
  // with what the operator sees in the rail.
  const inFlight = trips.filter(t => t.state !== 'SETTLED').length;
  const awaiting = trips.filter(t => t.state === 'AWAITING').length;

  return (
    <HeroBand>
      <div
        className="console-hero-kpis"
        style={{
          display: 'grid',
          gridTemplateColumns: 'auto auto auto',
          gap: 0,
          minWidth: 0,
        }}
      >
        <KpiCol
          label="Today"
          big={String(inFlight)}
          sub={`${inFlight === 1 ? 'trip' : 'trips'} in flight · ${awaiting} awaiting`}
          showDivider
        />
        <KpiCol
          label="Settled 30d"
          big={settled30dCount != null ? String(settled30dCount) : '—'}
          sub={settled30dFare ?? 'awaiting roll-up'}
          showDivider
        />
        <KpiCol label="Avg response" big={avgResponseLabel ?? '—'} sub="agent latency" />
      </div>
      <QuickCommandsPanel onCommand={onCommand} />
    </HeroBand>
  );
}

function KpiCol({
  label,
  big,
  sub,
  showDivider,
}: {
  label: string;
  big: string;
  sub: string;
  showDivider?: boolean;
}) {
  return (
    <div
      className="console-hero-kpi"
      style={{
        padding: '0 20px',
        borderRight: showDivider ? '1px solid var(--hairline-color)' : 'none',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
      }}
    >
      <MetaLabel>{label}</MetaLabel>
      <div
        className="console-hero-kpi-value"
        style={{
          fontFamily: 'var(--font-display)',
          fontSize: 34,
          marginTop: 4,
          lineHeight: 1,
          color: 'var(--ink)',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {big}
      </div>
      <div
        className="console-hero-kpi-sub"
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 10.5,
          marginTop: 4,
          color: 'var(--text-dim)',
        }}
      >
        {sub}
      </div>
    </div>
  );
}

// ─── trip-scoped mode ───────────────────────────────────────────────

export interface TripHeroProps {
  /** Display name of the traveler (e.g., "Sara Chen"). Falls back to "Traveler". */
  traveler: string;
  /** Route summary (e.g., "LAX → CDG"). Empty string is fine. */
  route: string;
  /** Trip id (e.g., "TRP-3392"). */
  tripId: string;
  /** Channel descriptor — drives the right-hand pill colour + label. */
  channel: ChannelDef;
  /** Hold-expires countdown string (e.g., "59:48"). Renders only when set. */
  hold?: string | null;
  /** Top-right slot for trip-action buttons (Pop to console, Settle, etc.). */
  toolbarSlot?: ReactNode;
  /** Optional chip handler. Same contract as ConsoleHero. */
  onCommand?: (prefix: string) => void;
}

export function TripHero({
  traveler,
  route,
  tripId,
  channel,
  hold,
  toolbarSlot,
  onCommand,
}: TripHeroProps) {
  return (
    <HeroBand>
      <div
        style={{
          padding: '0 4px',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          minWidth: 0,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            flexWrap: 'wrap',
          }}
        >
          <MetaLabel>Trip inbox</MetaLabel>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              padding: '2px 7px',
              borderRadius: 10,
              background: channel.tint,
              color: channel.accent,
              fontFamily: 'var(--font-mono)',
              fontSize: 9.5,
              fontWeight: 700,
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
            }}
          >
            {channel.icon(10)}
            {channel.name}
          </span>
          {hold ? (
            <span
              title="Hold expires in"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                padding: '2px 7px',
                borderRadius: 10,
                background: 'var(--tint-vermillion-soft)',
                color: 'var(--vermillion)',
                fontFamily: 'var(--font-mono)',
                fontSize: 9.5,
                fontWeight: 700,
                letterSpacing: '0.04em',
              }}
            >
              ⏱ {hold}
            </span>
          ) : null}
        </div>
        <div
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 28,
            marginTop: 4,
            lineHeight: 1.05,
            color: 'var(--ink)',
          }}
        >
          {traveler || 'Traveler'}
          {route ? (
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 13,
                color: 'var(--text-dim)',
                marginLeft: 10,
                fontWeight: 400,
              }}
            >
              {route}
            </span>
          ) : null}
        </div>
        <div
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 10.5,
            marginTop: 4,
            color: 'var(--text-dim)',
            display: 'flex',
            gap: 10,
            flexWrap: 'wrap',
          }}
        >
          <span>{tripId}</span>
          <span>·</span>
          <span>{channel.handle}</span>
          {toolbarSlot ? (
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                marginLeft: 'auto',
              }}
            >
              {toolbarSlot}
            </span>
          ) : null}
        </div>
      </div>
      <QuickCommandsPanel onCommand={onCommand} />
    </HeroBand>
  );
}
