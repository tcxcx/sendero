/**
 * Phase A — parallel routes for streaming Suspense.
 *
 * The console layout receives `children` (the existing MetaInbox via
 * page.tsx) AND a named `context` slot — a right-side drawer that
 * streams independently. Each slot has its own loading.tsx, so the
 * inbox paints instantly while the context drawer's slower fetch
 * lands when ready.
 *
 * Pattern lifted from next-shadcn-dashboard-starter's
 * `dashboard/overview/@sales` setup. We add `default.tsx` per slot
 * so this layout doesn't break when other routes share its scope.
 *
 * Why purely additive (instead of refactoring inbox into slots):
 *   The existing MetaInbox is a single live client component
 *   (Liveblocks + presence + composer + thread rail). Splitting it
 *   into N slots means breaking apart its client islands — an entire
 *   refactor. This phase A delivers the streaming PATTERN with a new
 *   context drawer, leaving the existing inbox untouched. Phase B
 *   migrates the inbox itself.
 */

import type { ReactNode } from 'react';

interface Props {
  children: ReactNode;
  context: ReactNode;
}

export default function ConsoleLayout({ children, context }: Props) {
  return (
    <div className="flex h-full min-h-0 w-full flex-1 flex-row gap-0">
      <div className="flex min-w-0 flex-1 flex-col">{children}</div>
      <aside
        className="hidden w-[18rem] shrink-0 border-l border-[color:var(--surface-border,rgba(0,0,0,0.08))] bg-[color:var(--surface-raised,#fff)]/40 lg:flex lg:flex-col"
        aria-label="Trip context"
      >
        {context}
      </aside>
    </div>
  );
}
