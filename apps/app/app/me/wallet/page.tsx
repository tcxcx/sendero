/**
 * `/me/wallet` — traveler Gateway unified balance.
 *
 * Reads the user's `UserGatewaySigner` row to find the depositor address,
 * then queries Circle Gateway's `/balances` for unified USDC across every
 * supported testnet. Same shape as the operator treasury balance, but
 * scoped to the traveler — never the platform.
 */

import { auth } from '@clerk/nextjs/server';
import Link from 'next/link';

import { queryUnifiedBalance } from '@sendero/circle/gateway';
import { getUserGatewaySigner } from '@sendero/circle/gateway-signer';
import { prisma } from '@sendero/database';
import type { Address } from 'viem';

import { MoonPayTopUpShell } from '@/components/traveler/moonpay-topup-shell';
import {
  EmptyStateCard,
  Stat,
  StatGrid,
  TravelerSurface,
  TravelerSurfaceHeader,
} from '@/components/traveler/traveler-surface';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SOL_DEVNET_CHAIN_ID = 5;

export default async function TravelerWalletPage() {
  const { userId } = await auth();
  if (!userId) return null;

  const user = await prisma.user.findUnique({
    where: { clerkUserId: userId },
    select: { id: true, email: true },
  });
  if (!user) return null;

  const moonpayApiKey = process.env.NEXT_PUBLIC_MOONPAY_API_KEY ?? '';

  const [signer, solanaWallet] = await Promise.all([
    getUserGatewaySigner(user.id, {
      caller: { surface: 'route', userId, context: '/me/wallet' },
    }),
    prisma.wallet.findFirst({
      where: { userId: user.id, provisioner: 'dcw', chainId: SOL_DEVNET_CHAIN_ID },
      select: { address: true },
    }),
  ]);

  if (!signer && !solanaWallet) {
    return (
      <TravelerSurface>
        <TravelerSurfaceHeader
          title="Your wallet"
          subhead="Unified USDC balance across every Sendero-supported chain."
        />
        <EmptyStateCard
          title="Wallet provisioning pending."
          body="Your Gateway depositor will appear after your first WhatsApp inbound or first booking. Idempotent — sign in again if it doesn't show within a few seconds."
        />
      </TravelerSurface>
    );
  }

  const balance = await queryUnifiedBalance({
    evm: signer?.address as Address | undefined,
    solana: solanaWallet?.address ?? undefined,
  }).catch(err => {
    console.warn('[me/wallet] queryUnifiedBalance failed', {
      userId: user.id,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  });

  const totalUsdc = balance ? Number(balance.total).toFixed(2) : '—';
  const chainsTracked = balance?.balances.length ?? 0;
  const chainsWithBalance = balance?.balances.filter(b => Number(b.balance) > 0).length ?? 0;

  return (
    <TravelerSurface>
      <TravelerSurfaceHeader
        title="Your wallet"
        subhead="Unified USDC balance across every Sendero-supported chain — Circle Gateway settles to whichever destination your trip needs."
      />

      <StatGrid>
        <Stat label="Total · USDC" value={totalUsdc} />
        <Stat label="Chains tracked" value={String(chainsTracked)} />
        <Stat label="With balance" value={String(chainsWithBalance)} />
        <Stat label="Network" value="Testnet" />
      </StatGrid>

      {signer && moonpayApiKey ? (
        <section className="flex items-center justify-between rounded-lg border border-border bg-card px-4 py-3">
          <div className="flex flex-col gap-0.5">
            <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Top up</p>
            <p className="text-sm">Buy USDC with a card — funds land in your unified balance.</p>
          </div>
          <Link
            href="/me/wallet?topup=usdc&amount=100"
            className="inline-flex rounded-md border border-border bg-foreground px-3 py-2 text-xs uppercase tracking-[0.14em] text-background hover:opacity-90"
          >
            Top up · USDC
          </Link>
        </section>
      ) : null}

      <section className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between">
          <h2 className="font-display text-xl">Per-chain breakdown</h2>
          {signer ? (
            <code className="font-mono text-xs text-muted-foreground" title={signer.address}>
              {signer.address.slice(0, 10)}…{signer.address.slice(-8)}
            </code>
          ) : null}
        </div>

        {!balance ? (
          <EmptyStateCard
            title="Couldn't reach Circle Gateway."
            body="Refresh in a few seconds — the API may be cold-starting."
          />
        ) : (
          <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
            {balance.balances.map(b => (
              <li
                key={`${b.chain}-${b.domain}`}
                className="flex items-center justify-between px-4 py-3"
              >
                <p className="text-sm">{b.label}</p>
                <p className="font-mono text-xs text-muted-foreground">{b.balance} USDC</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {signer ? (
        <MoonPayTopUpShell
          apiKey={moonpayApiKey}
          evmAddress={signer.address}
          email={user.email ?? undefined}
          userId={user.id}
        />
      ) : null}
    </TravelerSurface>
  );
}
