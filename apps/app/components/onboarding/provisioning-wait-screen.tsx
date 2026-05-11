'use client';

import { useEffect, useState } from 'react';

import { Button } from '@sendero/ui/button';

const IS_DEV = process.env.NODE_ENV === 'development';

type StageStatus = 'idle' | 'running' | 'done' | 'failed';

type StageState = {
  status: StageStatus;
  error?: string;
  address?: string;
  identityStatus?: string;
};

export type ProvisioningProgressView = {
  jobId: string;
  chain: 'arc' | 'sol';
  startedAt: string;
  finishedAt?: string;
  currentStage: 'treasury' | 'identity' | 'finalize' | 'done' | 'failed';
  attempts: number;
  stages: {
    treasury: StageState;
    identity: StageState;
    finalize: StageState;
  };
  lastError?: { stage: 'treasury' | 'identity' | 'finalize'; message: string };
} | null;

// Three real stages. The old four-step UI included "Wiring up
// notifications" which mapped to nothing on the server — it was a UI
// fiction that made every retry look stuck on that step. Removed
// until there's an actual server-side action to surface.
const PHASES = [
  { key: 'treasury', code: '01', label: 'Creating your treasury wallet' },
  { key: 'identity', code: '02', label: 'Minting your agent identity' },
  { key: 'finalize', code: '03', label: 'Almost ready' },
] as const;

const CHAIN_META = {
  arc: {
    eyebrow: 'Setting things up',
    chainLabel: 'Arc',
    lede: 'Building your workspace. This takes about a minute.',
  },
  sol: {
    eyebrow: 'Setting things up',
    chainLabel: 'Solana',
    lede: 'Building your workspace. Solana provisioning takes 30 to 60 seconds.',
  },
} as const;

export type ProvisioningWaitScreenProps = {
  organizationName: string;
  /** Tenant's primary chain — drives copy + step list. Defaults to 'arc'
   *  for legacy callers that haven't been migrated to the chain-select
   *  flow yet. */
  chain?: 'arc' | 'sol';
  /** Real provisioning state from `/api/onboarding/check-ready`. When
   *  null, falls back to a generic "running" pulse on the first step. */
  progress: ProvisioningProgressView;
  polling: boolean;
  stuck: boolean;
  completing: boolean;
  devHint: string | null;
  onRunDevComplete: () => void;
};

function resolveStageStatus(
  progress: ProvisioningProgressView,
  key: 'treasury' | 'identity' | 'finalize'
): StageStatus {
  if (!progress) {
    // Pre-state-machine fallback: animate the first step while we wait
    // for the first /check-ready response.
    return key === 'treasury' ? 'running' : 'idle';
  }
  return progress.stages[key]?.status ?? 'idle';
}

function resolveStageDetail(
  progress: ProvisioningProgressView,
  key: 'treasury' | 'identity' | 'finalize'
): string | null {
  if (!progress) return null;
  const stage = progress.stages[key];
  if (stage.status === 'failed' && stage.error) return stage.error;
  if (key === 'treasury' && stage.status === 'done' && stage.address) {
    return `${stage.address.slice(0, 6)}…${stage.address.slice(-4)}`;
  }
  if (key === 'identity' && stage.status === 'done' && stage.identityStatus) {
    return stage.identityStatus;
  }
  return null;
}

export function ProvisioningWaitScreen({
  organizationName,
  chain = 'arc',
  progress,
  polling,
  stuck,
  completing,
  devHint,
  onRunDevComplete,
}: ProvisioningWaitScreenProps) {
  const elapsed = useElapsedSeconds();
  const meta = CHAIN_META[chain];
  const isFailed = progress?.currentStage === 'failed';
  const lastError = progress?.lastError;

  return (
    <main className="provisioning-screen">
      <article className="provisioning-card" aria-busy={polling} aria-live="polite">
        <header className="provisioning-card__head">
          <span className="provisioning-eyebrow">
            <span
              className="provisioning-eyebrow__pulse"
              data-active={polling && !isFailed ? true : undefined}
              data-failed={isFailed || undefined}
            />
            {meta.eyebrow}
          </span>
          <h1 className="provisioning-title">
            Spinning up
            <span className="provisioning-title__org"> {organizationName}</span>
            <span className="provisioning-title__period">.</span>
          </h1>
          <p className="provisioning-lede">{meta.lede}</p>
        </header>

        <ol className="provisioning-manifest">
          {PHASES.map(phase => {
            const status = resolveStageStatus(progress, phase.key);
            const detail = resolveStageDetail(progress, phase.key);
            return (
              <li key={phase.code} className="provisioning-step" data-status={status}>
                <span className="provisioning-step__code">{phase.code}</span>
                <span className="provisioning-step__body">
                  <span className="provisioning-step__label">{phase.label}</span>
                  {detail ? <span className="provisioning-step__detail">{detail}</span> : null}
                </span>
                <span className="provisioning-step__dot" aria-hidden="true">
                  {status === 'done' ? '✓' : status === 'failed' ? '!' : null}
                </span>
              </li>
            );
          })}
        </ol>

        <footer className="provisioning-meta">
          <span className="provisioning-meta__row">
            <span>workspace</span>
            <span className="provisioning-meta__value">{organizationName}</span>
          </span>
          <span className="provisioning-meta__row">
            <span>chain</span>
            <span className="provisioning-meta__value">{meta.chainLabel}</span>
          </span>
          <span className="provisioning-meta__row">
            <span>elapsed</span>
            <span className="provisioning-meta__value">{formatElapsed(elapsed)}</span>
          </span>
          {progress?.attempts && progress.attempts > 1 ? (
            <span className="provisioning-meta__row">
              <span>attempts</span>
              <span className="provisioning-meta__value">{progress.attempts}</span>
            </span>
          ) : null}
        </footer>

        {isFailed && lastError ? (
          <aside className="provisioning-notice provisioning-notice--error" role="alert">
            <span className="provisioning-notice__tag">Provisioning failed</span>
            <h2 className="provisioning-notice__title">
              Stage {lastError.stage} blew up. We can retry without losing the workspace.
            </h2>
            <p className="provisioning-notice__error">{lastError.message}</p>
            <p className="provisioning-notice__hint">
              Provisioning is idempotent — already-completed steps short-circuit. Hit Retry below.
            </p>
          </aside>
        ) : stuck ? (
          <aside className="provisioning-notice" role="status">
            <span className="provisioning-notice__tag">Taking longer than usual</span>
            <h2 className="provisioning-notice__title">This is taking a moment.</h2>
            <p>We're still working on it. Try the button below to retry, or refresh the page.</p>
          </aside>
        ) : null}

        {IS_DEV || isFailed || stuck ? (
          <div className="provisioning-dev">
            <Button
              type="button"
              variant={isFailed ? 'default' : 'outline'}
              size="sm"
              disabled={completing}
              onClick={onRunDevComplete}
              className="provisioning-dev__button"
            >
              {completing ? 'Retrying…' : isFailed ? 'Retry provisioning' : 'Retry setup'}
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
          max-width: 640px;
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
        }

        .provisioning-eyebrow__pulse[data-active] {
          animation: provisioning-eyebrow-pulse 2.4s ease-out infinite;
        }

        .provisioning-eyebrow__pulse[data-failed] {
          background: var(--accent-rose, #b54848);
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
          max-width: 50ch;
          color: color-mix(in oklab, var(--midnight, #1f2a44) 70%, transparent);
          font-size: 0.8125rem;
          line-height: 1.5;
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
          grid-template-columns: 32px 1fr 22px;
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

        .provisioning-step__body {
          display: grid;
          gap: 2px;
          min-width: 0;
        }

        .provisioning-step__label {
          font-feature-settings: 'ss01' on;
        }

        .provisioning-step__detail {
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: 10.5px;
          letter-spacing: 0.04em;
          color: color-mix(in oklab, var(--midnight, #1f2a44) 50%, transparent);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .provisioning-step[data-status='failed'] .provisioning-step__detail {
          color: var(--accent-rose, #b54848);
        }

        .provisioning-step__dot {
          width: 18px;
          height: 18px;
          border-radius: 999px;
          background: color-mix(in oklab, var(--midnight, #1f2a44) 12%, transparent);
          display: grid;
          place-items: center;
          font-size: 10px;
          line-height: 1;
          color: transparent;
          transition:
            background-color 200ms ease,
            color 200ms ease,
            box-shadow 200ms ease;
        }

        .provisioning-step[data-status='running'] .provisioning-step__dot {
          background: color-mix(in oklab, var(--ink, #fb542b) 75%, transparent);
          animation: provisioning-step-glow 1.4s ease-in-out infinite;
        }

        .provisioning-step[data-status='done'] .provisioning-step__dot {
          background: var(--ink, #fb542b);
          color: #fff;
        }

        .provisioning-step[data-status='failed'] .provisioning-step__dot {
          background: var(--accent-rose, #b54848);
          color: #fff;
        }

        @keyframes provisioning-step-glow {
          0%,
          100% {
            box-shadow: 0 0 0 0 color-mix(in oklab, var(--ink, #fb542b) 0%, transparent);
          }
          50% {
            box-shadow: 0 0 0 5px color-mix(in oklab, var(--ink, #fb542b) 22%, transparent);
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

        .provisioning-notice--error {
          border-color: color-mix(in oklab, var(--accent-rose, #b54848) 38%, transparent);
          background: color-mix(in oklab, var(--accent-rose, #b54848) 8%, transparent);
        }

        .provisioning-notice__tag {
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: 10px;
          letter-spacing: 0.18em;
          text-transform: uppercase;
          color: color-mix(in oklab, var(--midnight, #1f2a44) 60%, transparent);
        }

        .provisioning-notice--error .provisioning-notice__tag {
          color: var(--accent-rose, #b54848);
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

        .provisioning-notice__error {
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: 11.5px;
          line-height: 1.5;
          color: var(--accent-rose, #b54848);
          word-break: break-word;
          padding: 8px 10px;
          background: rgba(255, 255, 255, 0.55);
          border-radius: 6px;
        }

        .provisioning-notice__hint {
          color: color-mix(in oklab, var(--midnight, #1f2a44) 65%, transparent);
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
          .provisioning-step[data-status='running'] .provisioning-step__dot {
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
