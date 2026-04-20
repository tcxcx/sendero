'use client';

/**
 * FundCard — shows when the signed-in MSCA has 0 USDC and the user is about
 * to need it (for settlement). Two paths:
 *   1. Drip 5 USDC from the Sendero treasury (Circle DCW, ~10s)
 *   2. Open the Circle faucet with the MSCA address pre-selected
 *
 * Polls the MSCA balance every 10s so it auto-dismisses once funded.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPublicClient, http, formatUnits } from 'viem';
import { arcTestnet } from 'viem/chains';
import { useSendero } from './store';
import { ARC_USDC_ADDRESS } from '@sendero/erc8183/client';

const USDC_ABI = [
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
] as const;

export function FundCard() {
  const userAuth = useSendero(s => s.userAuth);
  const holdOrder = useSendero(s => s.holdOrder);

  const [balanceRaw, setBalanceRaw] = useState<bigint | null>(null);
  const [dripping, setDripping] = useState(false);
  const [dripResult, setDripResult] = useState<string | null>(null);
  const [dripError, setDripError] = useState<string | null>(null);

  const client = useMemo(() => createPublicClient({ chain: arcTestnet, transport: http() }), []);

  const refresh = useCallback(async () => {
    if (!userAuth) return;
    try {
      const v = (await client.readContract({
        address: ARC_USDC_ADDRESS,
        abi: USDC_ABI,
        functionName: 'balanceOf',
        args: [userAuth.address],
      } as any)) as bigint;
      setBalanceRaw(v);
    } catch (err) {
      // swallow — transient RPC errors are fine, we'll retry
    }
  }, [userAuth, client]);

  useEffect(() => {
    refresh();
    const iv = setInterval(refresh, 10_000);
    return () => clearInterval(iv);
  }, [refresh]);

  if (!userAuth) return null;

  const balance = balanceRaw === null ? null : Number(formatUnits(balanceRaw, 6));
  const needed = holdOrder ? Number(holdOrder.totalAmount) : 0;
  const underFunded = balance !== null && balance < Math.max(needed, 1);
  const hasEnough = balance !== null && balance >= Math.max(needed, 1);

  // Don't render if we haven't read a balance yet, or the wallet has enough.
  if (balance === null || hasEnough) return null;

  const drip = async () => {
    setDripping(true);
    setDripError(null);
    setDripResult(null);
    try {
      const res = await fetch('/api/fund-msca', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: userAuth.address, amount: '5' }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.message || data?.error || `fund_failed (${res.status})`);
      }
      setDripResult(
        `Drip submitted · ${data.amount} USDC → ${userAuth.address.slice(0, 6)}…${userAuth.address.slice(-4)}. Balance polls every 10s.`
      );
      // Start an eager poll every 3s for 30s
      let i = 0;
      const iv = setInterval(() => {
        refresh();
        if (++i >= 10) clearInterval(iv);
      }, 3_000);
    } catch (err) {
      setDripError(err instanceof Error ? err.message : String(err));
    } finally {
      setDripping(false);
    }
  };

  const faucetHref = `https://faucet.circle.com/?address=${userAuth.address}`;

  return (
    <div className="card" style={{ borderColor: 'var(--ink)' }}>
      <div className="card-head">
        <span className="title">Fund your wallet</span>
        <span className="tag ink">
          {balance.toFixed(2)} USDC{needed ? ` / ${needed.toFixed(2)} needed` : ''}
        </span>
      </div>

      <div
        style={{
          padding: '12px 16px',
          fontFamily: 'var(--font-sans)',
          fontSize: 13,
          lineHeight: 1.55,
          color: 'var(--text-dim)',
        }}
      >
        Your passkey wallet is{' '}
        <strong style={{ color: 'var(--text)' }}>
          {userAuth.address.slice(0, 6)}…{userAuth.address.slice(-4)}
        </strong>
        . It needs USDC on Arc Testnet before settlement can run. Drip from the Sendero treasury for
        an instant 5 USDC, or top up bigger amounts via the Circle faucet.
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 10,
          padding: '0 16px 16px',
        }}
      >
        <button
          className="btn primary"
          disabled={dripping}
          onClick={drip}
          style={{ padding: '10px 12px' }}
        >
          {dripping ? 'Sending…' : '🚰 Drip 5 USDC (treasury)'}
        </button>
        <a
          className="btn"
          href={faucetHref}
          target="_blank"
          rel="noreferrer"
          style={{
            padding: '10px 12px',
            textAlign: 'center',
            textDecoration: 'none',
          }}
        >
          Circle faucet ↗ · 20 USDC
        </a>
      </div>

      {(dripResult || dripError) && (
        <div
          style={{
            padding: '10px 16px',
            borderTop: '1px solid var(--border)',
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            color: dripError ? 'var(--accent-rose)' : 'var(--text-dim)',
            lineHeight: 1.5,
          }}
        >
          {dripError ?? dripResult}
        </div>
      )}
    </div>
  );
}
