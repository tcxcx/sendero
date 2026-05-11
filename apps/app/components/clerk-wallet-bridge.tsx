'use client';

/**
 * ClerkWalletBridge — keep the Zustand `userAuth` in sync with Clerk
 * across every authenticated `/dashboard/*` route, not just the agent
 * console.
 *
 * Previously `ClerkSenderoApp` held this logic (console route only),
 * so on `/dashboard` home the WalletDropdown would read a persisted zero
 * address and never reconcile. Moving the effect to AppChrome fixes
 * that: the bridge mounts once per app session and re-seeds whenever
 * the Clerk org metadata updates.
 */

import { useEffect } from 'react';

import { useOrganization, useUser } from '@clerk/nextjs';

import { useSendero } from '@/components/store';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const;

export function ClerkWalletBridge() {
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
    // Same-email + same-address means we're already hydrated.
    if (
      currentAuth?.email === (user.primaryEmailAddress?.emailAddress ?? '') &&
      currentAuth?.address === arcAddress
    ) {
      return;
    }
    setUserAuth({
      address: arcAddress,
      displayName: user.fullName || user.firstName || 'Operator',
      email: user.primaryEmailAddress?.emailAddress ?? '',
      phone: user.primaryPhoneNumber?.phoneNumber ?? '',
    });
  }, [userLoaded, orgLoaded, isSignedIn, user, setUserAuth, currentAuth, arcAddress]);

  return null;
}
