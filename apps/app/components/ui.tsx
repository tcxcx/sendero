'use client';

/**
 * Sendero × Arc — shared UI primitives.
 *
 * One consolidated ConsoleBar replaces the old Topbar + Subbar + AgentCard
 * row. StepRail, ErrorBanner, FooterRail unchanged.
 */

import type { ReactNode } from 'react';

import Link from 'next/link';
import { useState } from 'react';
import { useSendero, deriveStep } from './store';
import { AgentChip } from './agent-chip';
import { WorkflowVisibilityToggle } from './console/workflow-visibility-toggle';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip';
import { WalletDropdown } from './wallet-dropdown';

/* ─── ConsoleBar ────────────────────────────────────────────────────────── */

export interface ConsoleBarProps {
  /** Breadcrumb label. Defaults to "Agent console". */
  crumb?: string;
  /** Breadcrumb link target. Defaults to "/". */
  crumbHref?: string;
  /** Optional secondary crumb (e.g. trip title) rendered after the primary. */
  subCrumb?: string;
  /** Optional slot rendered in the middle area (e.g. a panel toggle). */
  trailingSlot?: ReactNode;
}

export function ConsoleBar({
  crumb = 'Agent console',
  crumbHref = '/',
  subCrumb,
  trailingSlot,
}: ConsoleBarProps = {}) {
  const traveler = useSendero(s => s.traveler);
  const status = useSendero(s => s.status);
  const search = useSendero(s => s.search);
  const payment = useSendero(s => s.payment);
  const settlementPhase = useSendero(s => s.settlement.phase);
  const onChainSettlement = useSendero(s => s.onChainSettlement);

  const label = statusLabel(status, {
    payment: !!payment,
    settling:
      settlementPhase !== 'idle' && settlementPhase !== 'done' && settlementPhase !== 'error',
    onChain: !!onChainSettlement,
  });

  return (
    <div className="cbar">
      {/* LEFT: brand + breadcrumb nav */}
      <div className="cbar-left">
        <Link href="/" className="cbar-brand" aria-label="Sendero home">
          <img
            alt=""
            aria-hidden="true"
            className="cbar-mark"
            decoding="async"
            src="/brand/logo-masters/clean/sendero_icon_vermilion_clean_2048.png"
          />
          <span className="cbar-word">SENDERO</span>
        </Link>
        <span className="cbar-sep">/</span>
        <Link href={crumbHref} className="cbar-crumb">
          {crumb}
        </Link>
        {subCrumb ? (
          <>
            <span className="cbar-sep">/</span>
            <span className="cbar-crumb cbar-crumb-sub" title={subCrumb}>
              {subCrumb}
            </span>
          </>
        ) : null}
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="cbar-pulse-wrap" tabIndex={0}>
              <span className="cbar-pulse" aria-hidden="true" />
              <span className="cbar-active">agent · active</span>
            </span>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="font-mono text-[10px] tracking-wider">
            agent is online and ready to take a turn
          </TooltipContent>
        </Tooltip>
      </div>

      {/* MIDDLE: contextual status chip + optional trailing slot */}
      <div className="cbar-mid">
        <div className="cbar-chip">
          <span>{label}</span>
          {search && (
            <>
              <span className="cbar-arrow">›</span>
              <span>
                {search.origin} → {search.destination}
              </span>
              {search.departureDate && (
                <>
                  <span className="cbar-arrow">·</span>
                  <span className="cbar-date">
                    {short(search.departureDate)}
                    {search.returnDate ? ` → ${short(search.returnDate)}` : ''}
                  </span>
                </>
              )}
              <span className="cbar-arrow">·</span>
              <span className="cbar-date">{search.passengers} pax</span>
            </>
          )}
        </div>
        {trailingSlot}
      </div>

      {/* RIGHT: agent chip + user dropdown */}
      <div className="cbar-right">
        <AgentChip />
        <WalletDropdown />
      </div>

      <style jsx>{`
        .cbar {
          display: grid;
          grid-template-columns: auto 1fr auto;
          align-items: center;
          gap: 18px;
          padding: 10px 16px;
          /* Borderless on parchment (DESIGN.md §19). */
          background: var(--surface-base);
          min-height: 54px;
        }
        .cbar-left {
          display: flex;
          align-items: center;
          gap: 10px;
          flex-wrap: nowrap;
          min-width: 0;
          font-family: var(--font-mono);
          font-size: 11px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--text-dim);
          white-space: nowrap;
        }
        .cbar-brand {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          text-decoration: none;
          color: var(--ink);
          padding: 2px 2px 2px 0;
          letter-spacing: 0.14em;
          font-weight: 500;
          font-size: 12px;
        }
        .cbar-brand:hover .cbar-word {
          opacity: 0.7;
        }
        .cbar-mark {
          width: 22px;
          height: 22px;
          object-fit: contain;
          display: inline-block;
          flex-shrink: 0;
        }
        .cbar-word {
          transition: opacity 120ms;
        }
        .cbar-sep {
          opacity: 0.35;
        }
        .cbar-crumb {
          color: var(--text);
          text-decoration: none;
          padding: 2px 4px;
          border-radius: 0;
          transition: color 120ms;
        }
        .cbar-crumb:hover {
          color: var(--ink);
        }
        /* Secondary crumb — used to carry scoped context (e.g. a trip
           title) without stealing visual weight from the primary. */
        .cbar-crumb-sub {
          color: var(--ink);
          max-width: 24ch;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          display: inline-block;
          vertical-align: middle;
        }
        .cbar-pulse-wrap {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          margin-left: 8px;
          cursor: default;
          outline: none;
        }
        .cbar-pulse-wrap:focus-visible {
          outline: 1px solid var(--ink);
          outline-offset: 2px;
        }
        .cbar-pulse {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: var(--accent-green, #0cc67a);
          animation: cbar-pulse 1.6s ease-in-out infinite;
          flex-shrink: 0;
        }
        .cbar-active {
          color: var(--accent-green, #0cc67a);
          font-size: 10px;
          letter-spacing: 0.12em;
        }
        @keyframes cbar-pulse {
          0%, 100% { opacity: 0.45; transform: scale(0.85); }
          50%      { opacity: 1;    transform: scale(1); }
        }
        .cbar-mid {
          display: flex;
          justify-content: center;
        }
        .cbar-chip {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 5px 10px;
          /* Tinted vermillion pill, no outline — DESIGN.md §19. */
          background: var(--tint-vermillion-soft);
          color: var(--ink);
          border-radius: 999px;
          box-shadow: var(--shadow-xs);
          font-family: var(--font-mono);
          font-size: 10px;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          white-space: nowrap;
        }
        .cbar-arrow {
          opacity: 0.4;
        }
        .cbar-date {
          color: var(--text-dim);
        }
        .cbar-right {
          display: flex;
          align-items: center;
          gap: 10px;
        }

        @media (max-width: 960px) {
          .cbar {
            grid-template-columns: auto 1fr auto;
          }
          .cbar-mid {
            display: none;
          }
        }
      `}</style>
    </div>
  );
}

function short(iso: string): string {
  // 2026-05-04 → May 04
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString('en-US', { month: 'short', day: '2-digit' });
  } catch {
    return iso;
  }
}

function statusLabel(
  status: string,
  extras: { payment: boolean; settling: boolean; onChain: boolean }
) {
  if (extras.onChain) return 'confirmed · on-chain';
  if (extras.settling) return 'settling · arc';
  if (extras.payment) return 'paid · awaiting settlement';
  switch (status) {
    case 'idle':
      return 'ready';
    case 'searching':
      return 'searching';
    case 'selected':
      return 'offers';
    case 'holding':
      return 'holding';
    case 'held':
      return 'held';
    case 'paying':
      return 'paying · duffel';
    case 'confirmed':
      return 'confirmed · on-chain';
    case 'error':
      return 'error';
    default:
      return status;
  }
}

/* ─── StepRail ──────────────────────────────────────────────────────────── */

export function StepRail() {
  const state = useSendero();
  const currentStep = deriveStep(state);

  const steps = ['Intake', 'Search', 'Review', 'Hold', 'Pay', 'Settle'];
  return (
    <div className="step-rail">
      {steps.map((name, i) => {
        const st = i < currentStep ? 'done' : i === currentStep ? 'active' : 'pending';
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

/* ─── ErrorBanner ──────────────────────────────────────────────────────── */

export function ErrorBanner() {
  const error = useSendero(s => s.error);
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

/* ─── FooterRail ──────────────────────────────────────────────────────── */

import { useMeterSummary } from './use-meter';
import { DigitTicker, SmoothNumber } from './footer-numbers';

// Dev/demo telemetry strip — block ticker, org Gateway balance, meter
// rate. Useful when shaking out flows locally; visual noise + a
// surface for stale data in prod. NODE_ENV is inlined at build time
// so the entire branch tree-shakes out of the prod bundle.
const SHOW_FOOTER_RAIL = process.env.NODE_ENV === 'development';

export function FooterRail() {
  const treasury = useSendero(s => s.treasury);
  const holdOrder = useSendero(s => s.holdOrder);
  const settlementPhase = useSendero(s => s.settlement.phase);
  const onChainSettlement = useSendero(s => s.onChainSettlement);
  const userAuth = useSendero(s => s.userAuth);
  const isSolTenant = userAuth?.chain === 'sol';
  const { summary: meter } = useMeterSummary(1500);

  if (!SHOW_FOOTER_RAIL) return null;

  const treasuryAddr = treasury?.treasuryAddress ?? null;
  const usdc = treasury?.balances.find(b => b.symbol === 'USDC');
  const block = treasury?.arc?.blockNumber ?? '—';

  const escrowLabel = onChainSettlement
    ? `settled`
    : settlementPhase === 'idle' || settlementPhase === 'error'
      ? 'idle'
      : 'settling';

  return (
    <div className="footer-rail">
      <div className="group">
        <span>
          <strong>CIRCLE</strong> · {isSolTenant ? 'Solana' : 'Arc L2'}
        </span>
        <span>·</span>
        <span>
          {isSolTenant ? 'cluster' : 'block'}{' '}
          <strong style={{ color: 'var(--ink)' }}>
            {isSolTenant ? (
              'devnet'
            ) : block === '—' ? (
              '#—'
            ) : (
              <>
                #<DigitTicker value={block} />
              </>
            )}
          </strong>
        </span>
        <span>·</span>
        <span>
          gas{' '}
          <strong
            title={
              isSolTenant
                ? 'Solana settlement charges are paid in nano-USDC via Circle Gateway → Squads V4.'
                : "USDC is Arc's native gas token (1 nUSDC = 1e-9 USDC)"
            }
          >
            {!isSolTenant && treasury?.arc?.gasPrice ? (
              <SmoothNumber
                value={Number(treasury.arc.gasPrice) / 1e9}
                precision={4}
                suffix=" nUSDC"
                cadence="fast"
              />
            ) : (
              '—'
            )}
          </strong>
        </span>
      </div>
      <div className="group">
        <span>
          org gateway{' '}
          <strong style={{ color: 'var(--text)' }}>
            {treasuryAddr ? `${treasuryAddr.slice(0, 6)}…${treasuryAddr.slice(-4)}` : '—'}
          </strong>
        </span>
        <span>·</span>
        <span>
          balance{' '}
          <strong style={{ color: 'var(--usdc)' }}>
            {usdc ? (
              <SmoothNumber
                value={Number(usdc.amount)}
                precision={2}
                suffix=" USDC"
                cadence="calm"
              />
            ) : (
              '— USDC'
            )}
          </strong>
        </span>
      </div>
      <div className="group">
        <span>
          escrow <strong style={{ color: 'var(--ink)' }}>{escrowLabel}</strong>
        </span>
        <span>·</span>
        <span>
          nano{' '}
          <strong
            style={{
              color: (meter?.paidCalls ?? 0) >= 50 ? 'var(--accent-green)' : 'var(--ink)',
            }}
          >
            {meter ? (
              <>
                <DigitTicker value={meter.paidCalls} />/<DigitTicker value={meter.totalEvents} />{' '}
                calls
              </>
            ) : (
              '—'
            )}
          </strong>
        </span>
        <span>·</span>
        <span>
          paid{' '}
          <strong style={{ color: 'var(--usdc)' }}>
            {meter ? (
              <SmoothNumber
                value={Number(meter.totalUsdc) || 0}
                precision={6}
                prefix="$"
                cadence="fast"
              />
            ) : (
              '—'
            )}
          </strong>
        </span>
        {meter && meter.ethereum.marginFactor > 0 && (
          <>
            <span>·</span>
            <span>
              arc vs eth{' '}
              <strong style={{ color: 'var(--accent-green)' }}>
                {meter.ethereum.marginFactor}×
              </strong>
            </span>
          </>
        )}
        {holdOrder && (
          <>
            <span>·</span>
            <span>
              memo <strong>{holdOrder.bookingReference}</strong>
            </span>
          </>
        )}
        <TweaksToggle />
      </div>
    </div>
  );
}

function TweaksToggle() {
  const dark = useSendero(s => s.dark);
  const setDark = useSendero(s => s.setDark);

  const [open, setOpen] = useState(false);

  return (
    <>
      <TooltipProvider delayDuration={200} skipDelayDuration={300}>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => setOpen(!open)}
              aria-label="Tweaks"
              className="footer-tweaks-btn"
            >
              ◇ Tweaks
            </button>
          </TooltipTrigger>
          <TooltipContent side="top" className="font-mono text-[10px] tracking-wider">
            toggle theme + workflow terminal
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      {open && (
        <div className="tweaks-panel">
          <div className="tweaks-head">
            <span>TWEAKS</span>
            <button onClick={() => setOpen(false)}>✕</button>
          </div>
          <div className="tweaks-body">
            <WorkflowVisibilityToggle />

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

function formatAmount(raw: string): string {
  const n = Number(raw);
  if (!Number.isFinite(n)) return raw;
  return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

/**
 * Arc's native gas token is USDC at 18 decimals, so 1 wei = 1e-18 USDC and
 * 1 nano-USDC = 1e9 wei — numerically identical to gwei on an ETH chain.
 * Same digit, accurate unit. (1 gwei == 1 nUSDC on Arc.)
 */
function formatGas(raw: string): string {
  const n = Number(raw);
  if (!Number.isFinite(n)) return raw;
  const nUsdc = n / 1e9;
  return `${nUsdc.toFixed(4)} nUSDC`;
}
