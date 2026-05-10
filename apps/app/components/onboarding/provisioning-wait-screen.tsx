'use client';

import { useEffect, useState } from 'react';

import { Button } from '@sendero/ui/button';

const IS_DEV = process.env.NODE_ENV === 'development';

const ARC_PHASES = [
  { code: '01', label: 'Circle wallet set created' },
  { code: '02', label: 'MSCA deployed on Arc Testnet' },
  { code: '03', label: 'ERC-8004 identity anchored' },
  { code: '04', label: 'Webhook acknowledgement' },
] as const;

const SOL_PHASES = [
  { code: '01', label: 'Squads V4 vault provisioned' },
  { code: '02', label: 'Solana DCWs minted on devnet' },
  { code: '03', label: 'Metaplex Agent Registry attestation' },
  { code: '04', label: 'Workspace handoff' },
] as const;

const CHAIN_META = {
  arc: {
    eyebrow: 'Arc treasury · minting',
    chainLabel: 'arc-testnet',
    lede: 'Circle is provisioning your treasury wallet on Arc Testnet and signalling Sendero via webhook. This usually takes a few seconds.',
    phases: ARC_PHASES,
  },
  sol: {
    eyebrow: 'Solana treasury · minting',
    chainLabel: 'sol-devnet',
    lede: 'Sendero is provisioning your Squads V4 vault, JIT-funding it for gas, and minting the Metaplex Agent Registry attestation. This usually takes a few seconds.',
    phases: SOL_PHASES,
  },
} as const;

export type ProvisioningWaitScreenProps = {
  organizationName: string;
  /** Tenant's primary chain — drives copy + step list. Defaults to 'arc'
   *  for legacy callers that haven't been migrated to the chain-select
   *  flow yet. */
  chain?: 'arc' | 'sol';
  polling: boolean;
  stuck: boolean;
  completing: boolean;
  devHint: string | null;
  onRunDevComplete: () => void;
};

export function ProvisioningWaitScreen({
  organizationName,
  chain = 'arc',
  polling,
  stuck,
  completing,
  devHint,
  onRunDevComplete,
}: ProvisioningWaitScreenProps) {
  const elapsed = useElapsedSeconds();
  const meta = CHAIN_META[chain];

  return (
    <main className="provisioning-screen">
      <article className="provisioning-card" aria-busy={polling} aria-live="polite">
        <header className="provisioning-card__head">
          <span className="provisioning-eyebrow">
            <span className="provisioning-eyebrow__pulse" data-active={polling || undefined} />
            {meta.eyebrow}
          </span>
          <h1 className="provisioning-title">
            Minting
            <span className="provisioning-title__org"> {organizationName}</span>
            <span className="provisioning-title__period">.</span>
          </h1>
          <p className="provisioning-lede">{meta.lede}</p>
        </header>

        <ol className="provisioning-manifest" data-running={!stuck || undefined}>
          {meta.phases.map((phase, idx) => (
            <li
              key={phase.code}
              className="provisioning-step"
              style={{ ['--step-index' as string]: idx }}
            >
              <span className="provisioning-step__code">{phase.code}</span>
              <span className="provisioning-step__label">{phase.label}</span>
              <span className="provisioning-step__dot" aria-hidden="true" />
            </li>
          ))}
        </ol>

        <footer className="provisioning-meta">
          <span className="provisioning-meta__row">
            <span>tenant</span>
            <span className="provisioning-meta__value">{organizationName}</span>
          </span>
          <span className="provisioning-meta__row">
            <span>chain</span>
            <span className="provisioning-meta__value">{meta.chainLabel}</span>
          </span>
          <span className="provisioning-meta__row">
            <span>listener</span>
            <span className="provisioning-meta__value">
              {polling ? 'awaiting webhook' : 'idle'} · t+{formatElapsed(elapsed)}
            </span>
          </span>
        </footer>

        {stuck ? (
          <aside className="provisioning-notice" role="status">
            <span className="provisioning-notice__tag">Diagnostic</span>
            <h2 className="provisioning-notice__title">
              Webhook hasn’t reached this dev server yet
            </h2>
            <p>
              <code>onboardingComplete</code> is set by the{' '}
              <code>organization.created</code> webhook — Clerk calls{' '}
              <code>/api/webhooks/clerk</code>, Sendero provisions Circle, and updates this org.
              Clerk cannot POST to localhost unless you expose it (e.g. ngrok) and point the
              dashboard webhook at <code>https://&lt;tunnel&gt;/api/webhooks/clerk</code>.
            </p>
            <p className="provisioning-notice__hint">
              In the terminal running <code>next dev</code> you should see{' '}
              <code>[webhooks/clerk] organization.created</code> when delivery succeeds. No log line
              means the webhook never arrived.
            </p>
          </aside>
        ) : null}

        {IS_DEV ? (
          <div className="provisioning-dev">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={completing}
              onClick={onRunDevComplete}
              className="provisioning-dev__button"
            >
              {completing ? 'Provisioning…' : 'Run provisioning without webhook'}
            </Button>
            {devHint ? <p className="provisioning-dev__hint">{devHint}</p> : null}
          </div>
        ) : null}
      </article>

      <style jsx>{`
        .provisioning-screen {
          display: grid;
          place-items: center;
          min-height: calc(100svh - 32px);
          padding: clamp(24px, 6vw, 64px) 16px;
          color: var(--midnight, #1f2a44);
        }

        .provisioning-card {
          position: relative;
          width: 100%;
          max-width: 560px;
          padding: clamp(28px, 4vw, 44px);
          background: var(--surface-floating, #fdfbf7);
          border: 1px solid var(--hairline-color, #d8c1a7);
          border-radius: 20px;
          box-shadow:
            0 1px 0 rgba(255, 255, 255, 0.6) inset,
            0 24px 60px -28px rgba(31, 42, 68, 0.22),
            0 2px 6px rgba(31, 42, 68, 0.06);
          display: grid;
          gap: clamp(20px, 3vw, 28px);
        }

        .provisioning-card::before {
          content: '';
          position: absolute;
          inset: 12px;
          border: 1px solid color-mix(in oklab, var(--ink, #fb542b) 14%, transparent);
          border-radius: 14px;
          pointer-events: none;
          opacity: 0.45;
        }

        .provisioning-card__head {
          display: grid;
          gap: 14px;
          position: relative;
          z-index: 1;
        }

        .provisioning-eyebrow {
          display: inline-flex;
          align-items: center;
          gap: 10px;
          align-self: start;
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: 11px;
          letter-spacing: 0.16em;
          text-transform: uppercase;
          color: color-mix(in oklab, var(--midnight, #1f2a44) 70%, transparent);
        }

        .provisioning-eyebrow__pulse {
          width: 7px;
          height: 7px;
          border-radius: 999px;
          background: color-mix(in oklab, var(--ink, #fb542b) 70%, transparent);
          box-shadow: 0 0 0 0 color-mix(in oklab, var(--ink, #fb542b) 50%, transparent);
        }

        .provisioning-eyebrow__pulse[data-active] {
          animation: provisioning-eyebrow-pulse 2.4s ease-out infinite;
        }

        @keyframes provisioning-eyebrow-pulse {
          0% {
            box-shadow: 0 0 0 0 color-mix(in oklab, var(--ink, #fb542b) 55%, transparent);
          }
          70% {
            box-shadow: 0 0 0 8px color-mix(in oklab, var(--ink, #fb542b) 0%, transparent);
          }
          100% {
            box-shadow: 0 0 0 0 color-mix(in oklab, var(--ink, #fb542b) 0%, transparent);
          }
        }

        .provisioning-title {
          font-family: var(--font-display, ui-serif, Georgia, serif);
          font-weight: 500;
          font-size: clamp(2rem, 4.5vw, 2.75rem);
          line-height: 1.05;
          letter-spacing: -0.015em;
          margin: 0;
        }

        .provisioning-title__org {
          font-style: italic;
          color: var(--ink, #fb542b);
        }

        .provisioning-title__period {
          color: var(--ink, #fb542b);
        }

        .provisioning-lede {
          margin: 0;
          max-width: 46ch;
          color: color-mix(in oklab, var(--midnight, #1f2a44) 78%, transparent);
          font-size: 0.9375rem;
          line-height: 1.55;
        }

        .provisioning-manifest {
          list-style: none;
          margin: 0;
          padding: 0;
          display: grid;
          gap: 0;
          border-top: 1px solid var(--hairline-color-soft, rgba(31, 42, 68, 0.08));
          border-bottom: 1px solid var(--hairline-color-soft, rgba(31, 42, 68, 0.08));
        }

        .provisioning-step {
          display: grid;
          grid-template-columns: 32px 1fr auto;
          align-items: center;
          gap: 16px;
          padding: 14px 0;
          font-size: 0.875rem;
          color: color-mix(in oklab, var(--midnight, #1f2a44) 72%, transparent);
        }

        .provisioning-step + .provisioning-step {
          border-top: 1px dashed var(--hairline-color-soft, rgba(31, 42, 68, 0.08));
        }

        .provisioning-step__code {
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: 11px;
          letter-spacing: 0.12em;
          color: color-mix(in oklab, var(--midnight, #1f2a44) 50%, transparent);
          font-variant-numeric: tabular-nums;
        }

        .provisioning-step__label {
          font-feature-settings: 'ss01' on;
        }

        .provisioning-step__dot {
          width: 8px;
          height: 8px;
          border-radius: 999px;
          background: color-mix(in oklab, var(--midnight, #1f2a44) 18%, transparent);
          transition: background-color 200ms ease;
        }

        [data-running] .provisioning-step__dot {
          animation: provisioning-step-glow 5.2s ease-in-out infinite;
          animation-delay: calc(var(--step-index) * 1.3s);
        }

        @keyframes provisioning-step-glow {
          0%,
          70%,
          100% {
            background: color-mix(in oklab, var(--midnight, #1f2a44) 18%, transparent);
            box-shadow: 0 0 0 0 transparent;
          }
          15%,
          40% {
            background: var(--ink, #fb542b);
            box-shadow: 0 0 0 3px color-mix(in oklab, var(--ink, #fb542b) 18%, transparent);
          }
        }

        .provisioning-meta {
          display: grid;
          grid-template-columns: 1fr;
          gap: 6px;
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: 11px;
          letter-spacing: 0.04em;
          color: color-mix(in oklab, var(--midnight, #1f2a44) 55%, transparent);
        }

        .provisioning-meta__row {
          display: grid;
          grid-template-columns: 80px 1fr;
          gap: 12px;
          text-transform: lowercase;
        }

        .provisioning-meta__row > span:first-child {
          color: color-mix(in oklab, var(--midnight, #1f2a44) 38%, transparent);
          letter-spacing: 0.14em;
          text-transform: uppercase;
        }

        .provisioning-meta__value {
          color: color-mix(in oklab, var(--midnight, #1f2a44) 78%, transparent);
          font-variant-numeric: tabular-nums;
        }

        .provisioning-notice {
          margin: 0;
          padding: 18px 20px;
          border: 1px solid color-mix(in oklab, var(--accent-amber, #c08a3a) 32%, transparent);
          border-radius: 12px;
          background: color-mix(in oklab, var(--accent-amber, #c08a3a) 7%, transparent);
          display: grid;
          gap: 8px;
          font-size: 0.8125rem;
          line-height: 1.55;
          color: color-mix(in oklab, var(--midnight, #1f2a44) 84%, transparent);
        }

        .provisioning-notice__tag {
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: 10px;
          letter-spacing: 0.18em;
          text-transform: uppercase;
          color: color-mix(in oklab, var(--midnight, #1f2a44) 60%, transparent);
        }

        .provisioning-notice__title {
          margin: 0;
          font-family: var(--font-display, ui-serif, Georgia, serif);
          font-weight: 500;
          font-size: 1rem;
          letter-spacing: -0.005em;
          color: var(--midnight, #1f2a44);
        }

        .provisioning-notice p {
          margin: 0;
        }

        .provisioning-notice__hint {
          color: color-mix(in oklab, var(--midnight, #1f2a44) 65%, transparent);
        }

        .provisioning-notice code {
          font-size: 0.75rem;
          padding: 1px 5px;
          border-radius: 4px;
          background: color-mix(in oklab, var(--midnight, #1f2a44) 6%, transparent);
          color: var(--midnight, #1f2a44);
        }

        .provisioning-dev {
          display: grid;
          gap: 10px;
          padding-top: 4px;
          border-top: 1px solid var(--hairline-color-soft, rgba(31, 42, 68, 0.08));
        }

        .provisioning-dev__button {
          justify-self: start;
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: 11px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }

        .provisioning-dev__hint {
          margin: 0;
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: 11px;
          line-height: 1.5;
          color: var(--accent-rose, #b54848);
          word-break: break-word;
        }

        @media (prefers-reduced-motion: reduce) {
          .provisioning-eyebrow__pulse[data-active],
          [data-running] .provisioning-step__dot {
            animation: none;
          }
        }
      `}</style>
    </main>
  );
}

function useElapsedSeconds(): number {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setSeconds(s => s + 1), 1000);
    return () => clearInterval(id);
  }, []);
  return seconds;
}

function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${String(seconds).padStart(2, '0')}s`;
  const mins = Math.floor(seconds / 60);
  const rem = seconds % 60;
  return `${String(mins).padStart(2, '0')}m${String(rem).padStart(2, '0')}s`;
}
