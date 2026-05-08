/**
 * Phase A — parallel routes for streaming Suspense.
 * Phase B-α/B — added @kpis + @threads slots.
 * Phase B-γ (this revision) — added @conversation + @stage slots and
 * mounted the layout-level <ConsoleChatHost />:
 *
 *     ┌─────────────────────────────────────────────────────────────┐
 *     │                          @kpis                              │
 *     ├─────────┬───────────────┬──────────────────┬────────────────┤
 *     │@threads │ @conversation │      @stage      │   @context     │
 *     │ (rail)  │ (chat + comp.)│ (Stage + WL when │ (trip drawer + │
 *     │         │               │  showWorkflow)   │ customer panel)│
 *     └─────────┴───────────────┴──────────────────┴────────────────┘
 *                                ▲
 *                                │ all chat consumers read from
 *                                │ useSendero zustand
 *                                │
 *                    ┌───────────┴────────────┐
 *                    │  ConsoleChatHost       │  (mounted here, renders
 *                    │  ─────────────────────  │   null; owns useChat,
 *                    │  • useChat({transport})│   syncs to store, owns
 *                    │  • useChatStoreSync    │   bridge registration,
 *                    │  • bridge register     │   EventSource, resume)
 *                    │  • EventSource         │
 *                    │  • resume effect (?cs=)│
 *                    └────────────────────────┘
 *
 * The console route's `children` slot (page.tsx) returns null — every
 * column is a sibling slot. This is intentional: deleting page.tsx
 * would 404 (Codex outside-voice #3). The host survives ?tripId / ?cs
 * flips because the layout client tree is preserved across slot
 * navigations within /dashboard/console.
 */

import type { ReactNode } from 'react';

import { ConsoleChatHost } from '@/components/console/console-chat-host';

interface Props {
  children: ReactNode;
  context: ReactNode;
  kpis: ReactNode;
  threads: ReactNode;
  conversation: ReactNode;
  stage: ReactNode;
}

export default function ConsoleLayout({
  children,
  context,
  kpis,
  threads,
  conversation,
  stage,
}: Props) {
  return (
    <div className="flex h-full min-h-0 w-full flex-1 flex-col gap-0">
      {/* Layout-level chat host. Headless (renders null). Owns useChat
          and mirrors messages/status/error into the Zustand store so
          @conversation and @stage can render without owning the hook. */}
      <ConsoleChatHost />

      {kpis}

      <div className="flex min-h-0 w-full flex-1 flex-row gap-0">
        {/* @threads — server-fetched rail. Hidden below md. */}
        <div className="hidden min-h-0 shrink-0 md:flex">{threads}</div>

        {/* @conversation — middle column. ~380px on the inbox grid;
            here it's a flex child sized by content + flex behavior. */}
        <div
          className="hidden min-h-0 shrink-0 md:flex md:flex-col"
          style={{ width: 'min(440px, 38vw)' }}
        >
          {conversation}
        </div>

        {/* @stage — flex 1, fills remaining space. */}
        <div className="hidden min-h-0 min-w-0 flex-1 lg:flex lg:flex-col">{stage}</div>

        {/* @context — right aside, ≥lg only. */}
        <aside
          className="hidden w-[18rem] shrink-0 border-l border-[color:var(--surface-border,rgba(0,0,0,0.08))] bg-[color:var(--surface-raised,#fff)]/40 lg:flex lg:flex-col"
          aria-label="Trip context"
        >
          {context}
        </aside>

        {/* Narrow-viewport fallback: render conversation full-width
            when md hides @threads/@stage/@context. The conversation
            slot's own responsive rules collapse it to single column. */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col md:hidden">{conversation}</div>
      </div>

      {/* `children` (page.tsx) returns null. Kept mounted so Next.js
          recognizes the route segment. Hidden visually. */}
      <div className="hidden">{children}</div>
    </div>
  );
}
