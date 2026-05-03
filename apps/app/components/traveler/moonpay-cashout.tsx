'use client';

/**
 * MoonPay sell (cash-out) overlay for the traveler wallet. Sister of
 * `<MoonPayTopUp>` — auto-opens when `/me/wallet?cashout=usdc&amount=<n>`
 * is in the URL.
 *
 * Refund destination defaults to the traveler's EVM Gateway signer so a
 * cancelled sell lands back where the funds came from. The widget signs
 * its outbound URL via `/api/moonpay/sign` (same Clerk-authed surface
 * the buy widget uses).
 */

import { MoonPaySellWidget } from '@moonpay/moonpay-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

interface Props {
  evmAddress: string;
  email?: string;
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

export function MoonPayCashout({ evmAddress, email, userId }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [visible, setVisible] = useState(false);

  const cashoutParam = searchParams.get('cashout');
  const amountParam = searchParams.get('amount');
  const amount = Number(amountParam) > 0 ? Number(amountParam) : DEFAULT_AMOUNT;

  useEffect(() => {
    if (cashoutParam === 'usdc') {
      setVisible(true);
    }
  }, [cashoutParam]);

  const handleClose = useCallback(async () => {
    setVisible(false);
    if (cashoutParam || amountParam) {
      router.replace('/me/wallet');
    }
  }, [router, cashoutParam, amountParam]);

  return (
    <MoonPaySellWidget
      variant="overlay"
      defaultBaseCurrencyCode="usdc_base"
      baseCurrencyAmount={String(amount)}
      quoteCurrencyCode="usd"
      refundWalletAddress={evmAddress}
      email={email}
      externalCustomerId={userId}
      visible={visible}
      onCloseOverlay={handleClose}
      onUrlSignatureRequested={signMoonPayUrl}
    />
  );
}
