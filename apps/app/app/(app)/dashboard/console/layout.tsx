/**
 * Phase A — parallel routes for streaming Suspense.
 *
 * Phase B (this file) extends the slot grid:
 *
 *     ┌───────────────────────────────────────────────────────────┐
 *     │                       @kpis                              │
 *     ├───────────┬─────────────────────────────────┬─────────────┤
 *     │ @threads  │            children             │  @context   │
 *     │  (rail)   │  (MetaInbox: conversation +     │  (drawer)   │
 *     │           │   stage + composer)             │             │
 *     └───────────┴─────────────────────────────────┴─────────────┘
 *
 * Each slot has its own page.tsx + loading.tsx + default.tsx so the
 * inbox rail, the focused conversation, the workspace KPIs, and the
 * trip-context drawer all stream in from independent server fetches.
 *
 * Why this split:
 *   - `@threads` only needs the 12-most-recent trip query. It can
 *     paint as soon as that lands without waiting for the focused
 *     trip's events JSON.
 *   - `children` (MetaInboxLive) renders the conversation column
 *     and composer. It still owns the cross-cutting client state
 *     (useChat / presence / EventSource / optimistic posts), but no
 *     longer mounts the rail itself — the rail comes from `@threads`.
 *   - `@context` and `@kpis` were the Phase A and Phase B-α slots.
 *
 * Cross-cutting state (composerMode, ?tripId, ?cs) lives in the URL
 * via nuqs, so a rail click in `@threads` re-renders only the slots
 * that actually depend on the focused trip.
 */

import type { ReactNode } from 'react';

interface Props {
  children: ReactNode;
  context: ReactNode;
  kpis: ReactNode;
  threads: ReactNode;
}

export default function ConsoleLayout({ children, context, kpis, threads }: Props) {
  return (
    <div className="flex h-full min-h-0 w-full flex-1 flex-col gap-0">
      {kpis}
      <div className="flex min-h-0 w-full flex-1 flex-row gap-0">
        {/* @threads — server-fetched rail. Hidden below 900px so the
            existing MetaInbox responsive rules (which collapse the
            grid to a single column) keep working. The InboxRail's
            own collapsed state still works inside this column. */}
        <div className="hidden min-h-0 shrink-0 md:flex">{threads}</div>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>
        <aside
          className="hidden w-[18rem] shrink-0 border-l border-[color:var(--surface-border,rgba(0,0,0,0.08))] bg-[color:var(--surface-raised,#fff)]/40 lg:flex lg:flex-col"
          aria-label="Trip context"
        >
          {context}
        </aside>
      </div>
    </div>
  );
}
