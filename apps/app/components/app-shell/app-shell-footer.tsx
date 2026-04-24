'use client';

/**
 * AppShellFooter — the global FooterRail rendered at the bottom of the
 * app shell. Sits outside SidebarProvider so it spans the full viewport
 * width (sidebar rail + main inset together), not just the main column.
 *
 * Renders the same FooterRail content (Arc chain / treasury / nanopay
 * state) used by /app/console and the inbox trip views, and handles the
 * store lifecycle so the rail has live data even on routes that don't
 * mount SenderoApp.
 */

import { useEffect } from 'react';

import { useUser } from '@clerk/nextjs';

import { refreshTreasury } from '@/components/actions';
import { hydrateFromStorage, subscribePersist, useSendero } from '@/components/store';
import { FooterRail } from '@/components/ui';

export function AppShellFooter() {
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
    <div className="app-shell-footer shrink-0 border-t border-[color:var(--border)] bg-[color:var(--bg-elev)]">
      <FooterRail />
    </div>
  );
}
