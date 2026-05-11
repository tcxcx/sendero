'use client';

/**
 * ClerkWalletBridge — keep the Zustand `userAuth` in sync with Clerk
 * across every authenticated `/dashboard/*` route.
 *
 * The address surfaced here is the **Gateway depositor wallet** — the
 * unified-balance entry that manages the tenant treasury across every
 * Gateway-enabled chain. It is NOT the per-chain settlement treasury
 * (Arc Circle MSCA / Sol Squads V4 vault). The deposit dialog, send,
 * swap, and bridge all hang off this single Gateway wallet; settlement
 * routes per-chain happens downstream in the booking flow.
 *
 * Resolution order:
 *   1. Fetch `/api/gateway/deposit-info` on mount — returns the per-chain
 *      Gateway depositor address (EVM signer for Arc tenants, Solana
 *      pubkey for Sol tenants). Pick the row matching tenant.primaryChain.
 *   2. Fall back to `publicMetadata.{arcWalletAddress, solTreasuryAddress}`
 *      while the Gateway entry is still provisioning so the chip never
 *      shows a stale empty state. Once `/api/gateway/deposit-info` lands,
 *      the bridge re-seeds with the canonical Gateway depositor address.
 *
 * The bridge mounts once per app session inside AppChrome.
 */

import { useEffect, useState } from 'react';

import { useOrganization, useUser } from '@clerk/nextjs';

import { useSendero } from '@/components/store';

const ARC_ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const;
const SOL_ZERO_ADDRESS = '11111111111111111111111111111111' as const;

interface GatewayDepositRow {
  chain: string;
  kind: 'evm' | 'solana';
  address: string | null;
}

interface GatewayDepositInfoResponse {
  usdc?: GatewayDepositRow[];
  eurc?: GatewayDepositRow[];
  error?: string;
}

export function ClerkWalletBridge() {
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

  // Gateway depositor address from /api/gateway/deposit-info. Null while
  // the fetch is in flight or when the gateway hasn't been provisioned
  // yet (503 gateway_not_configured); we fall back to the per-chain
  // settlement address from publicMetadata in that window.
  const [gatewayAddress, setGatewayAddress] = useState<string | null>(null);

  useEffect(() => {
    if (!orgLoaded || !isSignedIn || !organization) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/gateway/deposit-info', { cache: 'no-store' });
        if (!res.ok) return;
        const json = (await res.json()) as GatewayDepositInfoResponse;
        const rowKey = chain === 'sol' ? 'Sol_Devnet' : 'Arc_Testnet';
        const row = json.usdc?.find(r => r.chain === rowKey);
        if (!cancelled && row?.address) setGatewayAddress(row.address);
      } catch {
        /* gateway not provisioned yet; fall back to settlement address */
      }
    })();
    return () => {
      cancelled = true;
    };
    // Re-run when org or chain changes — switching org / re-provisioning
    // mid-session needs to refresh the depositor address.
  }, [organization, orgLoaded, isSignedIn, chain]);

  const address = gatewayAddress ?? resolveFallbackAddress(chain, meta);

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

/**
 * Settlement-treasury fallback used only while the Gateway depositor
 * address is still in flight. Returns a chain-shaped zero placeholder
 * when the metadata is also empty so the chip can render its
 * "Provisioning…" state cleanly.
 */
function resolveFallbackAddress(
  chain: 'arc' | 'sol',
  meta: { arcWalletAddress?: string; solTreasuryAddress?: string } | undefined
): string {
  if (chain === 'sol') {
    const sol = meta?.solTreasuryAddress;
    return typeof sol === 'string' && sol.length > 0 ? sol : SOL_ZERO_ADDRESS;
  }
  const arc = meta?.arcWalletAddress;
  return typeof arc === 'string' && arc.startsWith('0x') ? arc : ARC_ZERO_ADDRESS;
}
