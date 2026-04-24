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
 * Clerk's `user` + the active `organization.publicMetadata` so the
 * workspace branch renders with the real MSCA treasury address.
 *
 * Design notes:
 * - `address` comes from `organization.publicMetadata.arcWalletAddress`,
 *   stamped by the Clerk webhook after `provisionTenantWallet` resolves.
 *   While provisioning is in-flight (or the svix retry hasn't caught up)
 *   `arcWalletAddress` is absent — we seed `0x0000…` and re-seed via
 *   effect deps when the metadata arrives.
 * - `email`/`phone` are populated from Clerk primary identifiers. When
 *   phone is missing, `<ProfileGate>` inside `SenderoApp` prompts the
 *   user — that's the right UX for operators who haven't added a phone
 *   yet since Duffel hold orders require one.
 */

import { useEffect } from 'react';

import { useOrganization, useUser } from '@clerk/nextjs';

import { SenderoApp } from '@/components/sendero-app';
import { useSendero } from '@/components/store';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const;

export function ClerkSenderoApp() {
  const { user, isLoaded: userLoaded, isSignedIn } = useUser();
  const { organization, isLoaded: orgLoaded } = useOrganization();
  const setUserAuth = useSendero(s => s.setUserAuth);
  const currentAuth = useSendero(s => s.userAuth);

  const arcAddressRaw = organization?.publicMetadata?.arcWalletAddress;
  const arcAddress =
    typeof arcAddressRaw === 'string' && arcAddressRaw.startsWith('0x')
      ? (arcAddressRaw as `0x${string}`)
      : ZERO_ADDRESS;

  useEffect(() => {
    if (!userLoaded || !orgLoaded || !isSignedIn || !user) return;
    // Re-seed when address transitions zero → real (webhook caught up).
    if (currentAuth?.email && currentAuth.address === arcAddress) return;
    setUserAuth({
      address: arcAddress,
      displayName: user.fullName || user.firstName || 'Operator',
      email: user.primaryEmailAddress?.emailAddress ?? '',
      phone: user.primaryPhoneNumber?.phoneNumber ?? '',
    });
  }, [userLoaded, orgLoaded, isSignedIn, user, setUserAuth, currentAuth, arcAddress]);

  if (!userLoaded) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center p-6 text-xs text-muted-foreground">
        Loading workspace…
      </div>
    );
  }

  return <SenderoApp gate="bypass" />;
}
