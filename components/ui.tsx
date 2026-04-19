'use client';

/**
 * Pasillo × Arc — UI primitives (Topbar, Subbar, StepRail, PolicyStrip,
 * FooterRail). Live-data versions of the original prototype components.
 */

import { usePasillo, deriveStep } from './store';

export function Topbar() {
  const partner = usePasillo((s) => s.partner);
  return (
    <div className="topbar">
      <div className="topbar-left">
        <div className="logo">
          <div className="logo-mark" />
          <span>PASILLO</span>
        </div>
        <div className="breadcrumb">
          <span>Partners</span>
          <span className="sep">/</span>
          <span>{partner.name}</span>
          <span className="sep">/</span>
          <span className="cur">Agent Console</span>
        </div>
      </div>
      <div className="topbar-right">
        <span className="tag faint">{partner.code}</span>
        <span className="tag ink">{partner.tier}</span>
        <span>circle · arc L2</span>
        <span style={{ opacity: 0.4 }}>·</span>
        <span>v0.9.4-alpha</span>
      </div>
    </div>
  );
}

export function Subbar() {
  const traveler = usePasillo((s) => s.traveler);
  const status = usePasillo((s) => s.status);
  const search = usePasillo((s) => s.search);
  const payment = usePasillo((s) => s.payment);
  const settlementPhase = usePasillo((s) => s.settlement.phase);
  const onChainSettlement = usePasillo((s) => s.onChainSettlement);

  const label = statusLabel(status, {
    payment: !!payment,
    settling:
      settlementPhase !== 'idle' &&
      settlementPhase !== 'done' &&
      settlementPhase !== 'error',
    onChain: !!onChainSettlement,
  });

  return (
    <div className="subbar">
      <div className="subbar-left">
        <div className="traveler">
          <div className="avatar">{traveler.initials}</div>
          <div className="traveler-info">
            <span className="name">{traveler.name}</span>
            <span className="meta">{traveler.role}</span>
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <div className="scenario-chip">
          <span>{label}</span>
          {search && (
            <>
              <span className="arrow">›</span>
              <span>
                {search.origin} → {search.destination}
              </span>
            </>
          )}
        </div>
      </div>
      <div className="subbar-right">
        <div className="status-pill">
          <span className="pulse" />
          <span>Agent · active</span>
        </div>
        {search && (
          <div className="status-pill">
            <span>
              {search.departureDate}
              {search.returnDate ? ` → ${search.returnDate}` : ''}
            </span>
          </div>
        )}
        {search && (
          <div className="status-pill">
            <span>{search.passengers} pax</span>
          </div>
        )}
      </div>
    </div>
  );
}

function statusLabel(status: string, extras: { payment: boolean; settling: boolean; onChain: boolean }) {
  if (extras.onChain) return 'CONFIRMED · ON-CHAIN';
  if (extras.settling) return 'SETTLING · ARC';
  if (extras.payment) return 'PAID · AWAITING SETTLEMENT';
  switch (status) {
    case 'idle':
      return 'READY';
    case 'searching':
      return 'SEARCHING';
    case 'selected':
      return 'OFFERS';
    case 'holding':
      return 'HOLDING';
    case 'held':
      return 'HELD';
    case 'paying':
      return 'PAYING · DUFFEL';
    case 'confirmed':
      return 'CONFIRMED · ON-CHAIN';
    case 'error':
      return 'ERROR';
    default:
      return status.toUpperCase();
  }
}

export function StepRail() {
  const state = usePasillo();
  const currentStep = deriveStep(state);

  const steps = ['Intake', 'Search', 'Review', 'Hold', 'Pay', 'Settle'];
  return (
    <div className="step-rail">
      {steps.map((name, i) => {
        const st =
          i < currentStep ? 'done' : i === currentStep ? 'active' : 'pending';
        return (
          <div className={`step-cell ${st}`} key={name}>
            <span className="step-dot" />
            <span className="step-name">{name}</span>
          </div>
        );
      })}
    </div>
  );
}

export function ErrorBanner() {
  const error = usePasillo((s) => s.error);
  if (!error) return null;
  return (
    <div
      className="policy-strip"
      style={{
        borderColor: 'color-mix(in oklab, var(--accent-rose) 35%, var(--border))',
        background: 'color-mix(in oklab, var(--accent-rose) 5%, var(--bg-elev))',
      }}
    >
      <span
        className="ico"
        style={{
          color: 'var(--accent-rose)',
          background: 'color-mix(in oklab, var(--accent-rose) 15%, transparent)',
        }}
      >
        !
      </span>
      <span>{error}</span>
    </div>
  );
}

export function FooterRail() {
  const treasury = usePasillo((s) => s.treasury);
  const token = usePasillo((s) => s.token);
  const holdOrder = usePasillo((s) => s.holdOrder);

  const treasuryAddr = treasury?.treasuryAddress ?? null;
  const usdc = treasury?.balances.find((b) => b.symbol === 'USDC');
  const eurc = treasury?.balances.find((b) => b.symbol === 'EURC');
  const block = treasury?.arc?.blockNumber ?? '—';

  return (
    <div className="footer-rail">
      <div className="group">
        <span>
          <strong>CIRCLE</strong> · Arc L2
        </span>
        <span>·</span>
        <span>
          block <strong style={{ color: 'var(--ink)' }}>#{block}</strong>
        </span>
        <span>·</span>
        <span>
          gas <strong>{treasury?.arc?.gasPrice ? formatGwei(treasury.arc.gasPrice) : '—'}</strong>
        </span>
      </div>
      <div className="group">
        <span>
          treasury{' '}
          <strong style={{ color: 'var(--text)' }}>
            {treasuryAddr
              ? `${treasuryAddr.slice(0, 6)}…${treasuryAddr.slice(-4)}`
              : '—'}
          </strong>
        </span>
        <span>·</span>
        <span>
          balance{' '}
          <strong style={{ color: 'var(--usdc)' }}>
            {usdc ? `${formatAmount(usdc.amount)} USDC` : '— USDC'}
          </strong>
        </span>
        <span>·</span>
        <span>
          <strong style={{ color: 'var(--eurc)' }}>
            {eurc ? `${formatAmount(eurc.amount)} EURC` : '— EURC'}
          </strong>
        </span>
      </div>
      <div className="group">
        <span>
          settling in{' '}
          <strong style={{ color: 'var(--ink)' }}>
            {token === 'AUTO' ? 'split' : token}
          </strong>
        </span>
        {holdOrder && (
          <>
            <span>·</span>
            <span>
              memo <strong>{holdOrder.bookingReference}</strong>
            </span>
          </>
        )}
      </div>
    </div>
  );
}

function formatAmount(raw: string): string {
  const n = Number(raw);
  if (!Number.isFinite(n)) return raw;
  return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

function formatGwei(raw: string): string {
  const n = Number(raw);
  if (!Number.isFinite(n)) return raw;
  // Assume wei
  const gwei = n / 1e9;
  return `${gwei.toFixed(4)} gwei`;
}
