'use client';

/**
 * TripConsoleShell — wraps a single trip's workspace in the same
 * ConsoleBar chrome that `/app/console` uses, so managing a trip feels
 * like one console scoped to that trip.
 *
 * Minimalism: the booking StepRail and the WorkflowLog tool-runner only
 * mount once there's real state to display. On a fresh trip they'd
 * otherwise render the global agent's placeholder phase (Intake dot)
 * and an "idle" runtime readout that doesn't reflect this trip — filler
 * that reads as chrome. We drop it until the agent actually starts.
 *
 * Handles the same zustand lifecycle as SenderoApp (hydrate from
 * storage, persist on change, poll treasury on a 20s cadence) and
 * synthesizes a `userAuth` from the Clerk operator so the ConsoleBar's
 * WalletDropdown + AgentChip render — identical to how
 * ClerkSenderoApp bridges Clerk → zustand on `/app/console`.
 */

import { type ReactNode, useEffect } from 'react';

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

  // Is there live booking state worth showing in the step rail or the
  // tool-runner column? We look at anything the agent mutates — workflow
  // events, a search request, a payment intent, a hold, or a step past
  // Intake. No state → no rail, no panel. No filler.
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

  // Synthesize userAuth from Clerk so FooterRail can render balances/meter
  // without requiring the passkey ceremony. Matches ClerkSenderoApp's bridge.
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
      <ConsoleBar crumb="Trip inbox" crumbHref="/app/inbox" subCrumb={tripTitle} />
      {hasWorkflowState ? <StepRail /> : null}
      <div className="flex min-h-0 flex-1 overflow-hidden bg-background">
        <div className="flex min-w-0 flex-1 overflow-hidden">{children}</div>
        {hasWorkflowState ? (
          <aside className="hidden xl:flex w-[340px] shrink-0 flex-col border-l border-[color:var(--border)] bg-[color:var(--bg-sunk)]">
            <WorkflowLog />
          </aside>
        ) : null}
      </div>
    </div>
  );
}
