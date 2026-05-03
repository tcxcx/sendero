'use client';

/**
 * Client shell that wires `<MoonPayProvider>` + the buy widget. Lives at
 * the page level instead of the root layout so the publishable key only
 * loads on `/me/wallet` (the one surface that uses MoonPay).
 *
 * Falls back to a no-op render when `NEXT_PUBLIC_MOONPAY_API_KEY` is
 * unset — local dev without MoonPay credentials shouldn't break the
 * wallet page.
 */

import { MoonPayProvider } from '@moonpay/moonpay-react';

import { MoonPayTopUp } from './moonpay-topup';

interface Props {
  apiKey: string;
  evmAddress: string;
  email?: string;
  userId: string;
}

export function MoonPayTopUpShell({ apiKey, evmAddress, email, userId }: Props) {
  if (!apiKey) return null;

  return (
    <MoonPayProvider apiKey={apiKey} debug={false}>
      <MoonPayTopUp evmAddress={evmAddress} email={email} userId={userId} />
    </MoonPayProvider>
  );
}
