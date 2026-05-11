'use client';

import { OrganizationList } from '@clerk/nextjs';

/**
 * Org-naming step shell. Mirrors `ChainSelectScreen`'s parchment card
 * (eyebrow + display title + lede) and slots Clerk's `<OrganizationList />`
 * — which renders its own white card for the create / select flow —
 * inside the body slot. Visual handoff between this and the chain-select
 * step is the matching outer container, so the pair feels like one
 * onboarding ladder.
 */
export function WelcomeCardScreen() {
  return (
    <main className="welcome-screen">
      <article className="welcome-card">
        <header className="welcome-card__head">
          <span className="welcome-eyebrow">Workspace</span>
          <h1 className="welcome-title">
            Name your
            <span className="welcome-title__accent"> Sendero</span>
            <span className="welcome-title__period"> </span>
            workspace.
          </h1>
          <p className="welcome-lede">Pick a name. We'll route the chain next.</p>
        </header>

        <div className="welcome-clerk">
          <OrganizationList
            hidePersonal
            afterCreateOrganizationUrl="/onboarding"
            afterSelectOrganizationUrl="/onboarding"
          />
        </div>
      </article>

      <style jsx>{`
        .welcome-screen {
          display: grid;
          place-items: center;
          min-height: calc(100svh - 32px);
          padding: clamp(24px, 6vw, 64px) 16px;
          color: var(--midnight, #1f2a44);
        }

        .welcome-card {
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

        .welcome-card::before {
          content: '';
          position: absolute;
          inset: 12px;
          border: 1px solid color-mix(in oklab, var(--ink, #fb542b) 14%, transparent);
          border-radius: 14px;
          pointer-events: none;
          opacity: 0.45;
        }

        .welcome-card__head {
          display: grid;
          gap: 12px;
          position: relative;
          z-index: 1;
        }

        .welcome-eyebrow {
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: 11px;
          letter-spacing: 0.16em;
          text-transform: uppercase;
          color: color-mix(in oklab, var(--midnight, #1f2a44) 70%, transparent);
        }

        .welcome-title {
          font-family: var(--font-display, ui-serif, Georgia, serif);
          font-weight: 500;
          font-size: clamp(2rem, 4.5vw, 2.75rem);
          line-height: 1.05;
          letter-spacing: -0.015em;
          margin: 0;
        }

        .welcome-title__accent {
          font-style: italic;
          color: var(--ink, #fb542b);
        }

        .welcome-title__period {
          color: var(--ink, #fb542b);
        }

        .welcome-lede {
          margin: 0;
          max-width: 56ch;
          color: color-mix(in oklab, var(--midnight, #1f2a44) 78%, transparent);
          font-size: 0.9375rem;
          line-height: 1.55;
        }

        .welcome-clerk {
          position: relative;
          z-index: 1;
          display: flex;
          justify-content: center;
        }

        /* Soften Clerk's default outer shadow inside the parchment card.
         * Clerk's component already renders its own white card; we
         * neutralize the duplicate drop-shadow so the two cards don't
         * compete and the flow reads as one nested step. */
        .welcome-clerk :global(.cl-rootBox),
        .welcome-clerk :global(.cl-organizationListPreviewItems),
        .welcome-clerk :global(.cl-card) {
          box-shadow: none !important;
          background: transparent !important;
        }

        .welcome-clerk :global(.cl-card) {
          border: 1px solid var(--hairline-color-soft, rgba(31, 42, 68, 0.12)) !important;
          border-radius: 14px !important;
          background: color-mix(in oklab, #ffffff 96%, var(--surface-floating, #fdfbf7)) !important;
        }
      `}</style>
    </main>
  );
}
