'use client';

/**
 * TripConsoleShell — wraps a single trip's workspace in the same
 * ConsoleBar + FooterRail chrome that `/app/console` uses, so managing
 * a trip (sidebar + thread list + conversation + AI side panel) feels
 * like one console scoped to that trip.
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
import { hydrateFromStorage, subscribePersist, useSendero } from '@/components/store';
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
    <div className="app app--with-steprail" data-screen-label="Trip Inbox">
      <ConsoleBar crumb="Trip inbox" crumbHref="/app/inbox" subCrumb={tripTitle} />
      {/* Booking navigator: Intake → Search → Review → Hold → Pay → Settle.
          Shared with /app/console so operators see the same phase language
          whether they're working the global console or a specific trip. */}
      <StepRail />
      <div className="flex min-h-0 flex-1 overflow-hidden bg-background">
        <div className="flex min-w-0 flex-1 overflow-hidden">{children}</div>
        {/* Tool runner / workflow log, scoped to the active run. Hidden on
            narrow viewports so the conversation + side-panel stay usable. */}
        <aside className="hidden xl:flex w-[340px] shrink-0 flex-col border-l border-[color:var(--border)] bg-[color:var(--bg-sunk)]">
          <WorkflowLog />
        </aside>
      </div>
    </div>
  );
}
