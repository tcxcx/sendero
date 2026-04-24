'use client';

/**
 * TripConsoleShell — wraps a single trip's workspace in the same
 * ConsoleBar chrome that `/dashboard/console` uses, so managing a trip feels
 * like one console scoped to that trip.
 *
 * Minimalism + DESIGN.md §19:
 *   - Booking StepRail appears only when there's real booking activity
 *     (search, payment, hold, settlement, or step past Intake).
 *   - WorkflowLog / tool-runner panel is manually togglable. It floats
 *     as a Midnight Veil terminal card (rounded-lg + --shadow-terminal)
 *     on the right — not a bordered column.
 *
 * Handles the same zustand lifecycle as SenderoApp (hydrate, persist,
 * poll treasury) and synthesises `userAuth` from Clerk so ConsoleBar's
 * WalletDropdown + AgentChip render — same bridge ClerkSenderoApp uses.
 */

import { type ReactNode, useEffect, useState } from 'react';

import { useUser } from '@clerk/nextjs';

import { refreshTreasury } from '@/components/actions';
import { deriveStep, hydrateFromStorage, subscribePersist, useSendero } from '@/components/store';
import { ConsoleBar, StepRail } from '@/components/ui';
import { WorkflowLog } from '@/components/workflow-log';

export function TripConsoleShell({
  children,
  tripTitle,
}: {
  children: ReactNode;
  /** Rendered as a secondary breadcrumb in the ConsoleBar. */
  tripTitle?: string;
}) {
  const userAuth = useSendero(s => s.userAuth);
  const setUserAuth = useSendero(s => s.setUserAuth);
  const { user, isLoaded, isSignedIn } = useUser();
  const [showWorkflow, setShowWorkflow] = useState(false);

  // Live booking state: StepRail is conditional because on a fresh
  // thread with no agent activity the rail would broadcast Intake as
  // a static default — filler that doesn't belong to this trip.
  const hasWorkflowState = useSendero(
    s =>
      s.workflow.length > 0 ||
      !!s.search ||
      !!s.payment ||
      !!s.holdOrder ||
      !!s.onChainSettlement ||
      deriveStep(s) > 0
  );

  useEffect(() => {
    hydrateFromStorage();
    const unsub = subscribePersist();
    return () => {
      unsub();
    };
  }, []);

  useEffect(() => {
    if (!isLoaded || !isSignedIn || !user) return;
    if (userAuth && userAuth.email) return;
    setUserAuth({
      address: '0x0000000000000000000000000000000000000000',
      displayName: user.fullName || user.firstName || 'Operator',
      email: user.primaryEmailAddress?.emailAddress ?? '',
      phone: user.primaryPhoneNumber?.phoneNumber ?? '',
    });
  }, [isLoaded, isSignedIn, user, setUserAuth, userAuth]);

  useEffect(() => {
    if (!userAuth) return;
    refreshTreasury();
    const iv = setInterval(refreshTreasury, 20_000);
    return () => clearInterval(iv);
  }, [userAuth]);

  return (
    <div
      className={`app ${hasWorkflowState ? 'app--with-steprail' : ''}`}
      data-screen-label="Trip Inbox"
    >
      <ConsoleBar
        crumb="Trip inbox"
        crumbHref="/dashboard/inbox"
        subCrumb={tripTitle}
        trailingSlot={
          <WorkflowToggle open={showWorkflow} onToggle={() => setShowWorkflow(v => !v)} />
        }
      />
      {hasWorkflowState ? <StepRail /> : null}
      <div className="flex min-h-0 flex-1 overflow-hidden bg-[color:var(--surface-base)]">
        <div className="flex min-w-0 flex-1 overflow-hidden">{children}</div>
        {showWorkflow ? (
          // Midnight Veil terminal card — rounded + shadow, no border
          // (DESIGN.md §19, Workflow / Terminal Panel).
          <aside className="hidden w-[360px] shrink-0 py-4 pr-4 xl:flex">
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[var(--radius-lg)] bg-[color:var(--surface-terminal)] shadow-[var(--shadow-terminal)]">
              <WorkflowLog />
            </div>
          </aside>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Small pill in the ConsoleBar that toggles the WorkflowLog panel.
 * Matches the rest of the chrome: shadow-only, no border, vermillion
 * tint when active (DESIGN.md §19, Segmented Controls).
 */
function WorkflowToggle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={open}
      className={
        'hidden xl:inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.12em] transition-[box-shadow,background-color] duration-[160ms] ease-[cubic-bezier(0.23,1,0.32,1)] ' +
        (open
          ? 'bg-[color:var(--tint-vermillion-soft)] text-[color:var(--ink)] shadow-[var(--shadow-xs)]'
          : 'bg-[color:var(--surface-raised)] text-muted-foreground shadow-[var(--shadow-xs)] hover:shadow-[var(--shadow-sm)]')
      }
    >
      <span
        aria-hidden="true"
        className="inline-block h-1.5 w-1.5 rounded-full"
        style={{
          background: open ? 'var(--ink)' : 'currentColor',
          opacity: open ? 1 : 0.45,
        }}
      />
      Tool runner
    </button>
  );
}
