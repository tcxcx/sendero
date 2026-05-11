'use client';

/**
 * OnboardingAlert — header strip that surfaces when the signed-in
 * user's org doesn't have a chain-appropriate treasury wallet yet.
 *
 * Chain-aware:
 *   - tenant.primaryChain === 'arc' → check `arcWalletAddress`
 *   - tenant.primaryChain === 'sol' → check `solTreasuryAddress`
 *
 * Without a real wallet, on-chain settlement, USDC payments, and
 * boarding-pass NFT mints all silently fail. This alert is the canonical
 * way to surface that gap — explains what's missing + routes to the
 * onboarding flow with `?retry=1` so the layout doesn't bounce back to
 * /dashboard.
 *
 * Hydrates from Clerk org metadata (same source as ClerkWalletBridge)
 * so it reflects the org you've actually selected, not the user's first org.
 */

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { useOrganization, useUser } from '@clerk/nextjs';
import { Button } from '@sendero/ui/button';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const PLACEHOLDER_ADDRESS = '0x1111111111111111111111111111111111111111';
const DISMISS_COOKIE = 'sendero.onboarding.alert.dismissed';

function isMissingEvmWallet(addr: string | null | undefined): boolean {
  if (!addr) return true;
  const lower = addr.toLowerCase();
  return lower === ZERO_ADDRESS || lower === PLACEHOLDER_ADDRESS;
}

function isMissingSolWallet(addr: string | null | undefined): boolean {
  return !addr || addr.length < 32;
}

type ChainHint = 'arc' | 'sol';
function readChain(meta: Record<string, unknown> | undefined): ChainHint {
  const c = meta?.primaryChain;
  return c === 'sol' ? 'sol' : 'arc';
}

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const m = document.cookie.match(new RegExp(`(^|;\\s*)${name}=([^;]*)`));
  return m ? decodeURIComponent(m[2]) : null;
}

function writeCookie(name: string, value: string, hours = 6) {
  if (typeof document === 'undefined') return;
  const exp = new Date(Date.now() + hours * 3600_000).toUTCString();
  document.cookie = `${name}=${encodeURIComponent(value)}; expires=${exp}; path=/; SameSite=Lax`;
}

export function OnboardingAlert() {
  const { isSignedIn, isLoaded: userLoaded } = useUser();
  const { organization, isLoaded: orgLoaded } = useOrganization();
  const [dismissed, setDismissed] = useState(true);

  // Hydrate dismissal flag once on mount so SSR doesn't flash the alert
  // for users who already closed it this session.
  useEffect(() => {
    setDismissed(readCookie(DISMISS_COOKIE) === '1');
  }, []);

  if (!userLoaded || !orgLoaded || !isSignedIn || !organization) return null;

  const meta = organization.publicMetadata as Record<string, unknown> | undefined;
  const chain = readChain(meta);
  const missing =
    chain === 'sol'
      ? isMissingSolWallet(typeof meta?.solTreasuryAddress === 'string' ? meta.solTreasuryAddress : null)
      : isMissingEvmWallet(typeof meta?.arcWalletAddress === 'string' ? meta.arcWalletAddress : null);
  if (!missing) return null;
  if (dismissed) return null;

  const chainLabel = chain === 'sol' ? 'Solana treasury' : 'Arc wallet';

  const onDismiss = () => {
    writeCookie(DISMISS_COOKIE, '1');
    setDismissed(true);
  };

  return (
    <div className="px-4 sm:px-6 pt-1">
      <Alert className="flex items-start gap-3 border-amber-500/40 bg-amber-50/60 text-foreground dark:bg-amber-950/30">
        <span aria-hidden className="mt-[2px] text-base leading-none">⚠</span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <AlertTitle className="text-[13px] font-semibold tracking-tight">
            Finish setting up your treasury
          </AlertTitle>
          <AlertDescription className="text-[12px] leading-relaxed text-muted-foreground">
            Your org doesn&apos;t have a {chainLabel} bound yet. Until it does, you can&apos;t
            pay for bookings in USDC, settle escrow on-chain, or mint boarding-pass NFTs. The
            agent will skip those steps silently, which is why your demo runs stop short.
            One-time setup, takes about 30 seconds.
          </AlertDescription>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button asChild size="sm" className="h-7 px-3 text-[11px]">
            <Link href="/onboarding?retry=1">Finish setup →</Link>
          </Button>
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss"
            title="Hide for 6 hours"
            className="grid h-7 w-7 place-items-center rounded-md text-[12px] text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
          >
            ✕
          </button>
        </div>
      </Alert>
    </div>
  );
}
