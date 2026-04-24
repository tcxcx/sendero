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
import { ConsoleBar, FooterRail } from './ui';
import { ChatCol } from './chat-col';
import { Stage } from './stage';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip';
import { WorkflowLog } from './workflow-log';
import { SwapDialog } from './swap-dialog';
import { SendDialog } from './send-dialog';
import { BridgeDialog } from './bridge-dialog';
import { DepositDialog } from './deposit-dialog';
import { hydrateFromStorage, subscribePersist, useSendero } from './store';
import { refreshTreasury } from './actions';

export interface SenderoAppProps {
  /**
   * 'passkey' (default) — public root flow: LandingHero pre-auth,
   * ProfileGate post-auth.
   * 'bypass' — authenticated product shell (e.g. /app/console) where a
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
        <ConsoleBar />

        <div
          className="workspace"
          style={showWorkflow ? undefined : { gridTemplateColumns: '360px 1fr' }}
        >
          <ChatCol />
          <Stage />
          {showWorkflow && <WorkflowLog />}
        </div>

        <FooterRail />
      </div>

      <TweaksToggle />
      <SettleCelebration />
      <SwapDialog />
      <SendDialog />
      <BridgeDialog />
      <DepositDialog />
    </TooltipProvider>
  );

  if (gate === 'bypass') return workspace;

  return <ProfileGate>{workspace}</ProfileGate>;
}

function SettleCelebration() {
  const onChain = useSendero(s => s.onChainSettlement);
  const holdOrder = useSendero(s => s.holdOrder);
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
          Booked on Arc
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
        View on Arcscan ↗
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

function TweaksToggle() {
  const showWorkflow = useSendero(s => s.showWorkflow);
  const dark = useSendero(s => s.dark);
  const setShowWorkflow = useSendero(s => s.setShowWorkflow);
  const setDark = useSendero(s => s.setDark);

  const [open, setOpen] = useState(false);

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={() => setOpen(!open)}
            aria-label="Tweaks"
            style={{
              position: 'fixed',
              right: 16,
              bottom: 44,
              zIndex: 99,
              padding: '8px 12px',
              border: '1.5px solid var(--ink)',
              background: 'var(--bg-elev)',
              color: 'var(--ink)',
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              textTransform: 'uppercase',
              letterSpacing: '0.1em',
              cursor: 'pointer',
            }}
          >
            ◇ Tweaks
          </button>
        </TooltipTrigger>
        <TooltipContent side="left" className="font-mono text-[10px] tracking-wider">
          toggle theme + workflow terminal
        </TooltipContent>
      </Tooltip>

      {open && (
        <div className="tweaks-panel">
          <div className="tweaks-head">
            <span>TWEAKS</span>
            <button onClick={() => setOpen(false)}>✕</button>
          </div>
          <div className="tweaks-body">
            <div className="tweak-group">
              <span className="tk-label">Workflow terminal</span>
              <div className="tweak-toggle">
                <div
                  className={`tw-switch ${showWorkflow ? 'on' : ''}`}
                  onClick={() => setShowWorkflow(!showWorkflow)}
                >
                  <div className="knob" />
                </div>
                <span>{showWorkflow ? 'Visible' : 'Hidden'}</span>
              </div>
            </div>

            <div className="tweak-group">
              <span className="tk-label">Theme</span>
              <div className="tweak-toggle">
                <div className={`tw-switch ${dark ? 'on' : ''}`} onClick={() => setDark(!dark)}>
                  <div className="knob" />
                </div>
                <span>{dark ? 'Dark' : 'Light'}</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
