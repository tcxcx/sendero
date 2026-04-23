'use client';

/**
 * ClerkSenderoApp — mount the post-auth product workspace
 * (ConsoleBar + ChatCol + Stage + WorkflowLog + FooterRail) inside a
 * Clerk-authenticated `/app/*` route.
 *
 * The original `SenderoApp` gates on the zustand `userAuth` set by the
 * passkey ceremony in `<LandingHero />`. Clerk-authed operators never
 * walk that ceremony, so a direct mount renders the marketing landing
 * (prior QA pass P0 #3). This wrapper synthesizes a `UserAuth` from
 * Clerk's `user` so the workspace branch renders.
 *
 * Design notes:
 * - `address` is a placeholder; the real MSCA address lives in Clerk
 *   publicMetadata once the user claims one. Treasury UI reads its own
 *   address from `/api/treasury/balance`, not from `userAuth`.
 * - `email`/`phone` are populated from Clerk primary identifiers. When
 *   phone is missing, `<ProfileGate>` inside `SenderoApp` prompts the
 *   user — that's the right UX for operators who haven't added a phone
 *   yet since Duffel hold orders require one.
 */

import { useEffect } from 'react';

import { useUser } from '@clerk/nextjs';

import { SenderoApp } from '@/components/sendero-app';
import { useSendero } from '@/components/store';

export function ClerkSenderoApp() {
  const { user, isLoaded, isSignedIn } = useUser();
  const setUserAuth = useSendero(s => s.setUserAuth);
  const currentAuth = useSendero(s => s.userAuth);

  useEffect(() => {
    if (!isLoaded || !isSignedIn || !user) return;
    if (currentAuth && currentAuth.email) return;
    setUserAuth({
      address: '0x0000000000000000000000000000000000000000',
      displayName: user.fullName || user.firstName || 'Operator',
      email: user.primaryEmailAddress?.emailAddress ?? '',
      phone: user.primaryPhoneNumber?.phoneNumber ?? '',
    });
  }, [isLoaded, isSignedIn, user, setUserAuth, currentAuth]);

  if (!isLoaded) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center p-6 text-xs text-muted-foreground">
        Loading workspace…
      </div>
    );
  }

  return <SenderoApp gate="bypass" />;
}
