'use client';

/**
 * FundCard — shows when the signed-in org's Gateway wallet is short USDC
 * for settlement. Polls the org balance every 10s so it auto-dismisses
 * once funded.
 */

import { useCallback, useEffect, useState } from 'react';
import { useSendero } from './store';

interface OrgGatewayBalance {
  grandTotal: string;
  spendableTotal?: string;
  depositor?: string | null;
}

interface DepositInfo {
  usdc: Array<{ chain: string; label: string; address: string | null }>;
}

export function FundCard() {
  const userAuth = useSendero(s => s.userAuth);
  const holdOrder = useSendero(s => s.holdOrder);

  const [balance, setBalance] = useState<OrgGatewayBalance | null>(null);
  const [depositInfo, setDepositInfo] = useState<DepositInfo | null>(null);

  const refresh = useCallback(async () => {
    if (!userAuth) return;
    try {
      const [balanceRes, depositRes] = await Promise.all([
        fetch('/api/gateway/balance'),
        fetch('/api/gateway/deposit-info'),
      ]);
      if (balanceRes.ok) setBalance(await balanceRes.json());
      if (depositRes.ok) setDepositInfo(await depositRes.json());
    } catch (err) {
      // swallow — transient Gateway/API errors are fine, we'll retry
    }
  }, [userAuth]);

  useEffect(() => {
    refresh();
    const iv = setInterval(refresh, 10_000);
    return () => clearInterval(iv);
  }, [refresh]);

  if (!userAuth) return null;

  const balanceAmount = balance ? Number(balance.spendableTotal ?? balance.grandTotal) : null;
  const needed = holdOrder ? Number(holdOrder.totalAmount) : 0;
  const hasEnough = balanceAmount !== null && balanceAmount >= Math.max(needed, 1);

  // Don't render if we haven't read a balance yet, or the wallet has enough.
  if (balanceAmount === null || hasEnough) return null;

  const arcDeposit =
    depositInfo?.usdc.find(row => row.chain === 'Arc_Testnet' && row.address)?.address ??
    depositInfo?.usdc.find(row => row.address)?.address ??
    balance?.depositor ??
    userAuth.address;
  const faucetHref = `https://faucet.circle.com/?address=${arcDeposit}`;

  return (
    <div className="card" style={{ borderColor: 'var(--ink)' }}>
      <div className="card-head">
        <span className="title">Fund org Gateway</span>
        <span className="tag ink">
          {balanceAmount.toFixed(2)} USDC{needed ? ` / ${needed.toFixed(2)} needed` : ''}
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
        This org's Gateway wallet is{' '}
        <strong style={{ color: 'var(--text)' }}>
          {(balance?.depositor ?? arcDeposit).slice(0, 6)}…{(balance?.depositor ?? arcDeposit).slice(-4)}
        </strong>
        . It needs enough unified USDC before settlement can run. Send USDC to the Arc deposit
        wallet below, or ask the traveler to pay from their channel.
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 10,
          padding: '0 16px 16px',
        }}
      >
        <div className="btn" style={{ padding: '10px 12px', justifyContent: 'flex-start' }}>
          Arc deposit {arcDeposit.slice(0, 6)}…{arcDeposit.slice(-4)}
        </div>
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
          Circle faucet {'->'} org wallet
        </a>
      </div>
    </div>
  );
}
