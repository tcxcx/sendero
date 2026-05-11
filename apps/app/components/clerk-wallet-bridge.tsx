'use client';

/**
 * ClerkWalletBridge — keep the Zustand `userAuth` in sync with Clerk
 * across every authenticated `/dashboard/*` route, not just the agent
 * console.
 *
 * Chain-aware: reads `organization.publicMetadata.primaryChain` and
 * picks the matching address (Arc `arcWalletAddress` 0x…, Sol
 * `solTreasuryAddress` base58). Without this branch, Sol tenants
 * always saw the zero-address placeholder + "Provisioning Arc wallet…"
 * copy regardless of whether their Squads V4 treasury was live.
 *
 * Previously `ClerkSenderoApp` held this logic (console route only),
 * so on `/dashboard` home the WalletDropdown would read a persisted
 * zero address and never reconcile. Moving the effect to AppChrome
 * fixes that: the bridge mounts once per app session and re-seeds
 * whenever the Clerk org metadata updates.
 */

import { useEffect } from 'react';

import { useOrganization, useUser } from '@clerk/nextjs';

import { useSendero } from '@/components/store';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const;

type OrgMeta = {
  primaryChain?: 'arc' | 'sol';
  arcWalletAddress?: string;
  solTreasuryAddress?: string;
};

function resolveAddress(meta: OrgMeta | undefined): { address: string; chain: 'arc' | 'sol' } {
  const chain: 'arc' | 'sol' = meta?.primaryChain === 'sol' ? 'sol' : 'arc';
  if (chain === 'sol') {
    const sol = meta?.solTreasuryAddress;
    if (typeof sol === 'string' && sol.length >= 32) {
      return { address: sol, chain: 'sol' };
    }
    // Sol unprovisioned — use a Sol-shaped placeholder so the dropdown's
    // `isUnprovisioned` check still works without conflating with an Arc
    // zero hex.
    return { address: 'pending-sol', chain: 'sol' };
  }
  const arc = meta?.arcWalletAddress;
  if (typeof arc === 'string' && arc.startsWith('0x')) {
    return { address: arc, chain: 'arc' };
  }
  return { address: ZERO_ADDRESS, chain: 'arc' };
}

export function ClerkWalletBridge() {
  const { user, isLoaded: userLoaded, isSignedIn } = useUser();
  const { organization, isLoaded: orgLoaded } = useOrganization();
  const setUserAuth = useSendero(s => s.setUserAuth);
  const currentAuth = useSendero(s => s.userAuth);

  const { address, chain } = resolveAddress(organization?.publicMetadata as OrgMeta | undefined);

  useEffect(() => {
    if (!userLoaded || !orgLoaded || !isSignedIn || !user) return;
    // Same-email + same-address + same-chain means we're already hydrated.
    if (
      currentAuth?.email === (user.primaryEmailAddress?.emailAddress ?? '') &&
      currentAuth?.address === address &&
      currentAuth?.chain === chain
    ) {
      return;
    }
    setUserAuth({
      address,
      chain,
      displayName: user.fullName || user.firstName || 'Operator',
      email: user.primaryEmailAddress?.emailAddress ?? '',
      phone: user.primaryPhoneNumber?.phoneNumber ?? '',
    });
  }, [userLoaded, orgLoaded, isSignedIn, user, setUserAuth, currentAuth, address, chain]);

  return null;
}
