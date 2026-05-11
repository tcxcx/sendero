'use client';

import { useState } from 'react';

import { BlockchainIcon } from '@sendero/icons';
import { Button } from '@sendero/ui/button';

import { UnifiedBalanceOrbit } from './unified-balance-orbit';

export type ChainSelectScreenProps = {
  organizationName: string;
  /** Default selection. Solana is the canonical default per onboarding spec. */
  defaultChain?: 'sol' | 'arc';
  onDeploy: (chain: 'sol' | 'arc') => Promise<void> | void;
  /** Disables the deploy button + signals in-flight state. */
  deploying: boolean;
  /** Surface deploy errors so the user can retry without losing chain choice. */
  deployError: string | null;
};

const OPTIONS: Array<{
  value: 'sol' | 'arc';
  /** Chain key the BlockchainIcon expects — same shape used by the
   *  wallet UI (wallet-dropdown, unified-balance, bridge / swap / deposit
   *  dialogs) so the brand mark stays consistent across the product. */
  iconChain: 'Sol' | 'Arc_Testnet';
  title: string;
  short: string;
}> = [
  {
    value: 'sol',
    iconChain: 'Sol',
    title: 'Solana',
    short: 'Squads V4 · USDC SPL',
  },
  {
    value: 'arc',
    iconChain: 'Arc_Testnet',
    title: 'Arc',
    short: 'Circle MSCA · USDC',
  },
];

export function ChainSelectScreen({
  organizationName,
  defaultChain = 'sol',
  onDeploy,
  deploying,
  deployError,
}: ChainSelectScreenProps) {
  const [picked, setPicked] = useState<'sol' | 'arc'>(defaultChain);

  return (
    <main className="chain-select-screen">
      <article className="chain-select-card" aria-busy={deploying}>
        <div className="chain-select-grid">
          <div className="chain-select-form-col">
            <header className="chain-select-card__head">
              <span className="chain-select-eyebrow">Primary chain</span>
              <h1 className="chain-select-title">
                Pick the chain
                <span className="chain-select-title__org"> {organizationName}</span>
                <span className="chain-select-title__period"> </span>
                settles on.
              </h1>
              <p className="chain-select-lede">
                Locks treasury, escrow, stamps, identity, and settlement.
              </p>
            </header>

            <fieldset className="chain-select-options">
              <legend className="chain-select-options__legend">Chain</legend>
              {OPTIONS.map(opt => (
                <label
                  key={opt.value}
                  className="chain-select-option"
                  data-active={picked === opt.value || undefined}
                >
                  <input
                    type="radio"
                    name="primaryChain"
                    value={opt.value}
                    checked={picked === opt.value}
                    onChange={() => setPicked(opt.value)}
                    disabled={deploying}
                    className="chain-select-option__radio"
                  />
                  <span className="chain-select-option__body">
                    <span className="chain-select-option__head">
                      <span className="chain-select-option__icon" aria-hidden="true">
                        <BlockchainIcon chain={opt.iconChain} size={16} variant="branded" />
                      </span>
                      <span className="chain-select-option__heading">
                        <span className="chain-select-option__title">{opt.title}</span>
                        <span className="chain-select-option__short">{opt.short}</span>
                      </span>
                      {opt.value === defaultChain ? (
                        <span className="chain-select-option__badge">Default</span>
                      ) : null}
                    </span>
                  </span>
                </label>
              ))}
            </fieldset>
          </div>

          <aside className="chain-select-orbit-col" aria-hidden="true">
            <UnifiedBalanceOrbit />
          </aside>
        </div>

        <footer className="chain-select-footer">
          <Button
            type="button"
            disabled={deploying}
            onClick={() => void onDeploy(picked)}
            className="chain-select-deploy"
          >
            {deploying ? 'Deploying…' : `Deploy on ${picked === 'sol' ? 'Solana' : 'Arc'}`}
          </Button>
          {deployError ? (
            <p className="chain-select-error" role="alert">
              {deployError}
            </p>
          ) : null}
        </footer>
      </article>

      <style jsx>{`
        .chain-select-screen {
          display: grid;
          place-items: center;
          min-height: calc(100svh - 32px);
          padding: clamp(24px, 6vw, 64px) 16px;
          color: var(--midnight, #1f2a44);
        }

        .chain-select-card {
          position: relative;
          width: 100%;
          max-width: 1040px;
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

        .chain-select-card::before {
          content: '';
          position: absolute;
          inset: 12px;
          border: 1px solid color-mix(in oklab, var(--ink, #fb542b) 14%, transparent);
          border-radius: 14px;
          pointer-events: none;
          opacity: 0.45;
        }

        .chain-select-grid {
          display: grid;
          grid-template-columns: 1fr;
          gap: clamp(20px, 3vw, 32px);
          position: relative;
          z-index: 1;
          align-items: stretch;
        }

        @media (min-width: 760px) {
          .chain-select-grid {
            grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
          }
        }

        .chain-select-form-col {
          display: grid;
          gap: 16px;
          align-content: start;
        }

        .chain-select-orbit-col {
          align-self: center;
          justify-self: center;
          display: flex;
          flex-direction: column;
          width: 100%;
        }

        @media (min-width: 760px) {
          .chain-select-orbit-col {
            border-left: 1px dashed var(--hairline-color-soft, rgba(31, 42, 68, 0.12));
            padding-left: clamp(20px, 3vw, 32px);
          }
        }

        @media (max-width: 759px) {
          .chain-select-orbit-col {
            border-top: 1px dashed var(--hairline-color-soft, rgba(31, 42, 68, 0.12));
            padding-top: clamp(20px, 4vw, 32px);
          }
        }

        .chain-select-footer :global(button.chain-select-deploy),
        .chain-select-deploy {
          width: 100%;
          justify-self: stretch;
          display: flex;
        }

        .chain-select-card__head {
          display: grid;
          gap: 12px;
          position: relative;
          z-index: 1;
        }

        .chain-select-eyebrow {
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: 11px;
          letter-spacing: 0.16em;
          text-transform: uppercase;
          color: color-mix(in oklab, var(--midnight, #1f2a44) 70%, transparent);
        }

        .chain-select-title {
          font-family: var(--font-display, ui-serif, Georgia, serif);
          font-weight: 500;
          font-size: clamp(2rem, 4.5vw, 2.75rem);
          line-height: 1.05;
          letter-spacing: -0.015em;
          margin: 0;
        }

        .chain-select-title__org {
          font-style: italic;
          color: var(--ink, #fb542b);
        }

        .chain-select-title__period {
          color: var(--ink, #fb542b);
        }

        .chain-select-lede {
          margin: 0;
          max-width: 50ch;
          color: color-mix(in oklab, var(--midnight, #1f2a44) 70%, transparent);
          font-size: 0.8125rem;
          line-height: 1.5;
        }

        .chain-select-options {
          display: grid;
          gap: 8px;
          padding: 0;
          margin: 0;
          border: none;
          position: relative;
          z-index: 1;
        }

        .chain-select-options__legend {
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: 10px;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          color: color-mix(in oklab, var(--midnight, #1f2a44) 60%, transparent);
          padding: 0;
          margin-bottom: 2px;
        }

        .chain-select-option {
          display: grid;
          grid-template-columns: 16px 1fr;
          gap: 10px;
          padding: 8px 12px;
          border: 1px solid var(--hairline-color-soft, rgba(31, 42, 68, 0.12));
          border-radius: 8px;
          background: color-mix(in oklab, var(--surface-floating, #fdfbf7) 60%, transparent);
          cursor: pointer;
          transition:
            border-color 160ms ease,
            background-color 160ms ease,
            transform 160ms ease;
        }

        .chain-select-option:hover {
          border-color: color-mix(in oklab, var(--ink, #fb542b) 36%, transparent);
        }

        .chain-select-option[data-active] {
          border-color: var(--ink, #fb542b);
          background: color-mix(in oklab, var(--ink, #fb542b) 6%, transparent);
        }

        .chain-select-option__radio {
          margin-top: 1px;
          accent-color: var(--ink, #fb542b);
          width: 14px;
          height: 14px;
        }

        .chain-select-option__body {
          display: grid;
        }

        .chain-select-option__head {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
        }

        .chain-select-option__icon {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 22px;
          height: 22px;
          border-radius: 6px;
          background: color-mix(in oklab, var(--midnight, #1f2a44) 4%, transparent);
          border: 1px solid var(--hairline-color-soft, rgba(31, 42, 68, 0.08));
          flex-shrink: 0;
          transition:
            background-color 160ms ease,
            border-color 160ms ease;
        }

        .chain-select-option[data-active] .chain-select-option__icon {
          background: color-mix(in oklab, var(--ink, #fb542b) 10%, transparent);
          border-color: color-mix(in oklab, var(--ink, #fb542b) 28%, transparent);
        }

        .chain-select-option__heading {
          display: flex;
          flex-direction: column;
          gap: 2px;
          min-width: 0;
        }

        .chain-select-option__title {
          font-family: var(--font-display, ui-serif, Georgia, serif);
          font-weight: 500;
          font-size: 0.875rem;
          letter-spacing: -0.005em;
          color: var(--midnight, #1f2a44);
          line-height: 1.15;
        }

        .chain-select-option__short {
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: 11px;
          letter-spacing: 0.04em;
          color: color-mix(in oklab, var(--midnight, #1f2a44) 60%, transparent);
        }

        .chain-select-option__badge {
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: 9px;
          letter-spacing: 0.16em;
          text-transform: uppercase;
          color: var(--ink, #fb542b);
          border: 1px solid color-mix(in oklab, var(--ink, #fb542b) 36%, transparent);
          padding: 2px 6px;
          border-radius: 999px;
          margin-left: auto;
        }

        .chain-select-footer {
          display: grid;
          gap: 8px;
          position: relative;
          z-index: 1;
        }

        .chain-select-error {
          margin: 0;
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: 11px;
          line-height: 1.5;
          color: var(--accent-rose, #b54848);
          word-break: break-word;
        }
      `}</style>
    </main>
  );
}
