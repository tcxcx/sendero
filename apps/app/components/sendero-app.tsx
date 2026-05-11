'use client';

/**
 * Sendero × Arc — Root App
 *
 * Pre-auth: LandingHero (cobe globe + integrated passkey sign-up/sign-in).
 * Post-auth: ConsoleBar (brand + status + AgentChip + WalletDropdown) +
 * 3-column workspace (Chat · Stage · WorkflowLog) + FooterRail.
 * Settings persist via store.
 */

import { useEffect, useState } from 'react';
import { LandingHero } from './hero';
import { ProfileGate } from './profile-gate';
import { ChatCol } from './chat-col';
import { Stage } from './stage';
import { TooltipProvider } from './ui/tooltip';
import { WorkflowLog } from './workflow-log';
import { hydrateFromStorage, subscribePersist, useSendero } from './store';
import { refreshTreasury } from './actions';

export interface SenderoAppProps {
  /**
   * 'passkey' (default) — public root flow: LandingHero pre-auth,
   * ProfileGate post-auth.
   * 'bypass' — authenticated product shell (e.g. /dashboard/console) where a
   * Clerk-authed operator is the user. Skip LandingHero + ProfileGate
   * because the operator isn't the traveler for Duffel bookings; those
   * use the trip's traveler data.
   */
  gate?: 'passkey' | 'bypass';
}

export function SenderoApp({ gate = 'passkey' }: SenderoAppProps = {}) {
  const showWorkflow = useSendero(s => s.showWorkflow);
  const userAuth = useSendero(s => s.userAuth);

  // Hydrate settings on mount. Treasury poll only runs once the user is
  // authed — before that we render the onboarding splash.
  useEffect(() => {
    hydrateFromStorage();
    const unsub = subscribePersist();
    // Dev-only QA hatch: expose the zustand store so /browse-style harnesses
    // can mount the post-auth shell without going through a real passkey
    // ceremony. Gated on NODE_ENV so it never leaks to prod bundles.
    if (process.env.NODE_ENV !== 'production' && typeof window !== 'undefined') {
      (window as any).__sendero = useSendero;
    }
    return () => {
      unsub();
    };
  }, []);

  useEffect(() => {
    if (!userAuth) return;
    refreshTreasury();
    const iv = setInterval(refreshTreasury, 20_000);
    return () => clearInterval(iv);
  }, [userAuth]);

  if (gate === 'passkey' && !userAuth) {
    return (
      <>
        <LandingHero />
        <SettleCelebration />
      </>
    );
  }

  // TooltipProvider wraps the whole workspace so any descendant can drop
  // in a <Tooltip> without re-establishing a provider. delayDuration: 200
  // = tight enough to feel responsive on hover, slow enough that drive-by
  // pointer passes don't flash tooltips.
  const workspace = (
    <TooltipProvider delayDuration={200} skipDelayDuration={300}>
      <div className="app" data-screen-label="Agent Console">
        <div
          className="workspace"
          style={showWorkflow ? undefined : { gridTemplateColumns: '360px 1fr' }}
        >
          <ChatCol />
          <Stage />
          {showWorkflow && <WorkflowLog />}
        </div>
      </div>

      <SettleCelebration />
    </TooltipProvider>
  );

  if (gate === 'bypass') return workspace;

  return <ProfileGate>{workspace}</ProfileGate>;
}

function SettleCelebration() {
  const onChain = useSendero(s => s.onChainSettlement);
  const holdOrder = useSendero(s => s.holdOrder);
  const userAuth = useSendero(s => s.userAuth);
  const [visible, setVisible] = useState(false);
  const [dismissed, setDismissed] = useState<string | null>(null);

  useEffect(() => {
    if (!onChain) return;
    if (dismissed === onChain.jobId) return;
    setVisible(true);
    const t = setTimeout(() => setVisible(false), 8000);
    return () => clearTimeout(t);
  }, [onChain, dismissed]);

  if (!onChain || !visible) return null;

  const amount = holdOrder?.totalAmount
    ? `${holdOrder.totalAmount} ${holdOrder.totalCurrency}`
    : 'USDC';
  const pnr = holdOrder?.bookingReference ?? onChain.pnr;

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed',
        top: 20,
        right: 20,
        zIndex: 100,
        maxWidth: 360,
        background: 'var(--bg-elev)',
        border: '1.5px solid var(--ink)',
        boxShadow: '0 0 0 6px color-mix(in oklab, var(--accent-green) 18%, transparent)',
        padding: '14px 16px',
        fontFamily: 'var(--font-sans)',
        animation: 'celebrate-slide 260ms ease-out',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          marginBottom: 6,
        }}
      >
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: 'var(--accent-green)',
          }}
        />
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            color: 'var(--ink)',
          }}
        >
          Booked on {userAuth?.chain === 'sol' ? 'Solana' : 'Arc'}
        </span>
        <button
          aria-label="dismiss"
          onClick={() => {
            setVisible(false);
            setDismissed(onChain.jobId);
          }}
          style={{
            marginLeft: 'auto',
            border: 'none',
            background: 'none',
            color: 'var(--text-dim)',
            cursor: 'pointer',
            fontSize: 14,
            padding: 0,
          }}
        >
          ×
        </button>
      </div>
      <div
        style={{
          fontSize: 15,
          fontWeight: 500,
          color: 'var(--text)',
          marginBottom: 6,
          letterSpacing: '-0.01em',
        }}
      >
        PNR {pnr} · {amount}
      </div>
      <div
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 10,
          color: 'var(--text-dim)',
          letterSpacing: '0.04em',
          marginBottom: 10,
        }}
      >
        7 txs · job #{onChain.jobId} · reputation +1
      </div>
      <a
        href={`${onChain.explorerBase}/tx/${onChain.txHashes[onChain.txHashes.length - 1]}`}
        target="_blank"
        rel="noreferrer"
        style={{
          display: 'inline-block',
          fontFamily: 'var(--font-mono)',
          fontSize: 10,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          color: 'var(--ink)',
          textDecoration: 'none',
          borderBottom: '1px solid var(--ink)',
          paddingBottom: 1,
        }}
      >
        View on {userAuth?.chain === 'sol' ? 'Solana Explorer' : 'Arcscan'} ↗
      </a>
      <style jsx>{`
        @keyframes celebrate-slide {
          from { transform: translateY(-8px); opacity: 0; }
          to   { transform: translateY(0); opacity: 1; }
        }
      `}</style>
    </div>
  );
}
