'use client';

/**
 * MoonPay top-up overlay for the traveler wallet.
 *
 * Auto-opens when `/me/wallet?topup=usdc&amount=<n>` is in the URL —
 * the WhatsApp insufficient-funds card deep-links here. Default rail is
 * USDC on Base because:
 *   - MoonPay does not support Arc directly (neither testnet nor mainnet
 *     are in MoonPay's chain list as of 2026-05);
 *   - Circle Gateway treats Base, Solana, Arc, etc. as a single unified
 *     USDC balance, so where the funds *land* is irrelevant — they're
 *     instantly mintable on the tenant's settlement chain (Arc for
 *     arc-primary, Solana for sol-primary) when `book_flight` settles.
 * Hiding the rail picker is intentional: travelers shouldn't have to
 * learn what a chain is.
 *
 * Caveat: this widget routes USDC to an EVM-shaped DCW address. Sol-only
 * DCWs (base58) need a Solana on-ramp peer — not wired today.
 *
 * Testnet vs mainnet: MoonPay's `pk_test_…` publishable key auto-routes
 * to sandbox (`buy-sandbox.moonpay.com`) which lands USDC on
 * `base-sepolia`. Flipping to `pk_live_…` swaps to `base` mainnet with
 * no widget code change.
 */

import { MoonPayBuyWidget } from '@moonpay/moonpay-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

interface Props {
  /**
   * Deterministic EVM address from the traveler's Circle DCW. Same address
   * is valid on every EVM chain (Base, Arc, etc.) — Gateway picks where to
   * mint when settlement runs.
   */
  evmAddress: string;
  /** Optional — pre-fills the MoonPay checkout email field. */
  email?: string;
  /** Internal `User.id` — sent to MoonPay as `externalCustomerId` for KYC continuity. */
  userId: string;
}

const DEFAULT_AMOUNT = 100;

async function signMoonPayUrl(url: string): Promise<string> {
  const res = await fetch('/api/moonpay/sign', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url }),
  });
  if (!res.ok) {
    throw new Error(`MoonPay URL signer responded ${res.status}`);
  }
  const data = (await res.json()) as { signature: string };
  return data.signature;
}

export function MoonPayTopUp({ evmAddress, email, userId }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [visible, setVisible] = useState(false);

  const topupParam = searchParams.get('topup');
  const amountParam = searchParams.get('amount');
  const amount = Number(amountParam) > 0 ? Number(amountParam) : DEFAULT_AMOUNT;

  useEffect(() => {
    if (topupParam === 'usdc') {
      setVisible(true);
    }
  }, [topupParam]);

  const handleClose = useCallback(async () => {
    setVisible(false);
    // Clear the deep-link params so a refresh doesn't re-open the widget.
    if (topupParam || amountParam) {
      router.replace('/me/wallet');
    }
  }, [router, topupParam, amountParam]);

  return (
    <MoonPayBuyWidget
      variant="overlay"
      baseCurrencyCode="usd"
      baseCurrencyAmount={String(amount)}
      defaultCurrencyCode="usdc_base"
      walletAddress={evmAddress}
      showWalletAddressForm="false"
      email={email}
      externalCustomerId={userId}
      visible={visible}
      onCloseOverlay={handleClose}
      onUrlSignatureRequested={signMoonPayUrl}
    />
  );
}
