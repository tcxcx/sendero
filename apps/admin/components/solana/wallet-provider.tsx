'use client';

/**
 * Solana wallet-adapter provider — wraps `/dashboard/*` (mounted in the
 * dashboard layout, not the root layout, so the wallet libs don't load
 * on `/sign-in` or `/unauthorized`).
 *
 * Devnet by default. Phase 7.5.x's Arc work doesn't need this; this is
 * Solana-only. Phantom + Solflare cover ~95% of Solana wallets — we
 * skip the rest to keep the bundle lean.
 *
 * `WalletModalProvider` mounts the modal that opens when a user clicks
 * the connect button. CSS comes from
 * `@solana/wallet-adapter-react-ui/styles.css` — imported in
 * dashboard/layout.tsx so it doesn't leak into sign-in chrome.
 */

import * as React from 'react';
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import { PhantomWalletAdapter, SolflareWalletAdapter } from '@solana/wallet-adapter-wallets';
import { clusterApiUrl } from '@solana/web3.js';

const ENDPOINT = clusterApiUrl('devnet');

export function SolanaWalletProvider({ children }: { children: React.ReactNode }) {
  const wallets = React.useMemo(
    () => [new PhantomWalletAdapter(), new SolflareWalletAdapter()],
    []
  );

  return (
    <ConnectionProvider endpoint={ENDPOINT}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
