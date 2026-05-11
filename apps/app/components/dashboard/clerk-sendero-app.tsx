'use client';

/**
 * ClerkSenderoApp — mount the post-auth product workspace
 * (ConsoleBar + ChatCol + Stage + WorkflowLog + FooterRail) inside a
 * Clerk-authenticated `/dashboard/*` route.
 *
 * The original `SenderoApp` gates on the zustand `userAuth` set by the
 * passkey ceremony in `<LandingHero />`. Clerk-authed operators never
 * walk that ceremony, so a direct mount renders the marketing landing
 * (prior QA pass P0 #3). This wrapper synthesizes a `UserAuth` from
 * Clerk's `user` + the active `organization.publicMetadata` so the
 * workspace branch renders with the real MSCA treasury address.
 *
 * Design notes:
 * - `address` is chain-aware: Arc tenants get `arcWalletAddress`
 *   (Circle MSCA `0x…`), Sol tenants get `solTreasuryAddress` (Squads V4
 *   vault base58). Stamped by the Clerk webhook after the corresponding
 *   provision tool resolves. While provisioning is in-flight (or the svix
 *   retry hasn't caught up) the address is absent — we seed a chain-shaped
 *   placeholder and re-seed via effect deps when the metadata arrives.
 * - `email`/`phone` are populated from Clerk primary identifiers. When
 *   phone is missing, `<ProfileGate>` inside `SenderoApp` prompts the
 *   user — that's the right UX for operators who haven't added a phone
 *   yet since Duffel hold orders require one.
 */

import { useEffect, useState } from 'react';

import { useOrganization, useUser } from '@clerk/nextjs';

import { SenderoApp } from '@/components/sendero-app';
import { useSendero } from '@/components/store';

const ARC_ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const;
const SOL_ZERO_ADDRESS = '11111111111111111111111111111111' as const;

interface GatewayDepositRow {
  chain: string;
  kind: 'evm' | 'solana';
  address: string | null;
}

export function ClerkSenderoApp() {
  const { user, isLoaded: userLoaded, isSignedIn } = useUser();
  const { organization, isLoaded: orgLoaded } = useOrganization();
  const setUserAuth = useSendero(s => s.setUserAuth);
  const currentAuth = useSendero(s => s.userAuth);

  const meta = organization?.publicMetadata as
    | {
        primaryChain?: 'arc' | 'sol';
        arcWalletAddress?: string;
        solTreasuryAddress?: string;
      }
    | undefined;
  const chain: 'arc' | 'sol' = meta?.primaryChain === 'sol' ? 'sol' : 'arc';

  // Mirror the canonical bridge: surface the Gateway depositor wallet
  // (the unified-balance entry that manages the treasury) instead of the
  // per-chain settlement address. See `clerk-wallet-bridge.tsx` for the
  // full rationale.
  const [gatewayAddress, setGatewayAddress] = useState<string | null>(null);
  useEffect(() => {
    if (!orgLoaded || !isSignedIn || !organization) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/gateway/deposit-info', { cache: 'no-store' });
        if (!res.ok) return;
        const json = (await res.json()) as { usdc?: GatewayDepositRow[] };
        const rowKey = chain === 'sol' ? 'Sol_Devnet' : 'Arc_Testnet';
        const row = json.usdc?.find(r => r.chain === rowKey);
        if (!cancelled && row?.address) setGatewayAddress(row.address);
      } catch {
        /* gateway not provisioned yet */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [organization, orgLoaded, isSignedIn, chain]);

  const fallbackAddress =
    chain === 'sol'
      ? typeof meta?.solTreasuryAddress === 'string' && meta.solTreasuryAddress.length > 0
        ? meta.solTreasuryAddress
        : SOL_ZERO_ADDRESS
      : typeof meta?.arcWalletAddress === 'string' && meta.arcWalletAddress.startsWith('0x')
        ? meta.arcWalletAddress
        : ARC_ZERO_ADDRESS;
  const address = gatewayAddress ?? fallbackAddress;

  useEffect(() => {
    if (!userLoaded || !orgLoaded || !isSignedIn || !user) return;
    // Re-seed when address transitions zero → real (webhook caught up)
    // or chain flips (rare — onboarding only, but cheap to handle).
    if (currentAuth?.email && currentAuth.address === address && currentAuth.chain === chain)
      return;
    setUserAuth({
      address,
      chain,
      displayName: user.fullName || user.firstName || 'Operator',
      email: user.primaryEmailAddress?.emailAddress ?? '',
      phone: user.primaryPhoneNumber?.phoneNumber ?? '',
    });
  }, [userLoaded, orgLoaded, isSignedIn, user, setUserAuth, currentAuth, address, chain]);

  if (!userLoaded) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center p-6 text-xs text-muted-foreground">
        Loading workspace…
      </div>
    );
  }

  return <SenderoApp gate="bypass" />;
}
