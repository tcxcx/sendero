'use client';

/**
 * Thin wrapper around `WalletMultiButton` — handles "click to connect"
 * → modal → wallet selection → signed-in pubkey display.
 *
 * Wallet-adapter-react-ui's button has its own theming; we override
 * via `className` to match the shadcn-flavored chrome rather than
 * shipping their default styles wholesale.
 */

import dynamic from 'next/dynamic';

import { cn } from '@/lib/utils';

/** SSR-disabled — `WalletMultiButton` reaches into `window` on mount. */
const WalletMultiButton = dynamic(
  async () => {
    const m = await import('@solana/wallet-adapter-react-ui');
    return m.WalletMultiButton;
  },
  { ssr: false }
);

export function WalletConnectButton({ className }: { className?: string }) {
  return (
    <WalletMultiButton
      className={cn(
        // Override the wallet-adapter default button styling to fit
        // alongside our header chrome (no purple gradient).
        '!h-9 !rounded-md !bg-[color:var(--color-primary)] !text-[color:var(--color-primary-foreground)] !text-sm !font-medium',
        className
      )}
    />
  );
}
