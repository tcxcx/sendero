/**
 * Public layout for /agents/* routes.
 * Adds branded nav header + footer without requiring a Clerk session.
 * Root layout already provides <html> + <body> + font vars — this layer
 * only wraps children with chrome.
 */

import type { ReactNode } from 'react';
import Image from 'next/image';
import Link from 'next/link';

import { env } from '@sendero/env';

export default function AgentsLayout({ children }: { children: ReactNode }) {
  const explorerUrl = env.arcExplorerUrl();
  return (
    <>
      <style>{`
        .agents-layout-nav {
          position: sticky;
          top: 0;
          z-index: 40;
          background: var(--bg, #eedcc7);
          border-bottom: 1px solid var(--border, #d8c1a7);
          backdrop-filter: blur(8px);
          -webkit-backdrop-filter: blur(8px);
        }
        .agents-layout-nav-inner {
          max-width: 900px;
          margin: 0 auto;
          padding: 0 24px;
          height: 52px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 24px;
        }
        .agents-layout-wordmark {
          display: flex;
          align-items: center;
          gap: 8px;
          text-decoration: none;
          flex-shrink: 0;
        }
        .agents-layout-mark {
          width: 28px;
          height: 28px;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }
        .agents-layout-brand-text {
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.16em;
          text-transform: uppercase;
          color: var(--midnight, #1f2a44);
          line-height: 1;
        }
        .agents-layout-nav-links {
          display: flex;
          align-items: center;
          gap: 20px;
        }
        .agents-layout-nav-link {
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: 11px;
          font-weight: 500;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          color: var(--midnight, #1f2a44);
          opacity: 0.55;
          text-decoration: none;
          transition: opacity 120ms ease;
        }
        .agents-layout-nav-link:hover {
          opacity: 0.9;
        }
        .agents-layout-nav-cta {
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          color: #fdfbf7;
          background: var(--ink, #fb542b);
          text-decoration: none;
          padding: 6px 14px;
          border-radius: 2px;
          transition: opacity 120ms ease;
          white-space: nowrap;
        }
        .agents-layout-nav-cta:hover {
          opacity: 0.88;
        }
        .agents-layout-footer {
          border-top: 1px solid var(--border, #d8c1a7);
          background: var(--bg, #eedcc7);
          margin-top: auto;
        }
        .agents-layout-footer-inner {
          max-width: 900px;
          margin: 0 auto;
          padding: 20px 24px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          flex-wrap: wrap;
        }
        .agents-layout-footer-label {
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: 10px;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: var(--midnight, #1f2a44);
          opacity: 0.45;
        }
        .agents-layout-footer-links {
          display: flex;
          align-items: center;
          gap: 16px;
        }
        .agents-layout-footer-link {
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: 10px;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: var(--midnight, #1f2a44);
          opacity: 0.5;
          text-decoration: none;
          transition: opacity 120ms ease;
        }
        .agents-layout-footer-link:hover {
          opacity: 0.85;
        }
        .agents-layout-body {
          min-height: 100dvh;
          display: flex;
          flex-direction: column;
          background: var(--bg, #eedcc7);
        }
        .agents-layout-content {
          flex: 1;
        }
      `}</style>

      <div className="agents-layout-body">
        {/* ── Header ─────────────────────────────────────────────────── */}
        <nav className="agents-layout-nav" aria-label="Sendero public navigation">
          <div className="agents-layout-nav-inner">
            {/* Wordmark */}
            <Link href="https://app.sendero.travel" className="agents-layout-wordmark" aria-label="Sendero home">
              <Image
                src="/brand/logo-masters/clean/sendero_icon_vermilion_clean_2048.png"
                alt=""
                width={28}
                height={28}
                className="agents-layout-mark"
                aria-hidden="true"
              />
              <span className="agents-layout-brand-text">Sendero · Arc</span>
            </Link>

            {/* Nav links */}
            <div className="agents-layout-nav-links">
              <Link
                href="https://sendero.travel/agents"
                target="_blank"
                rel="noreferrer"
                className="agents-layout-nav-link"
              >
                Agents
              </Link>
              <Link
                href="https://docs.sendero.travel"
                target="_blank"
                rel="noreferrer"
                className="agents-layout-nav-link"
              >
                Docs
              </Link>
              <Link href="https://app.sendero.travel" className="agents-layout-nav-cta">
                App →
              </Link>
            </div>
          </div>
        </nav>

        {/* ── Page content ────────────────────────────────────────────── */}
        <main className="agents-layout-content">{children}</main>

        {/* ── Footer ─────────────────────────────────────────────────── */}
        <footer className="agents-layout-footer" aria-label="Sendero footer">
          <div className="agents-layout-footer-inner">
            <span className="agents-layout-footer-label">
              Sendero · Arc — ERC-8004 · Arc Testnet
            </span>
            <nav className="agents-layout-footer-links" aria-label="Footer links">
              <Link
                href={explorerUrl}
                target="_blank"
                rel="noreferrer"
                className="agents-layout-footer-link"
              >
                Arcscan
              </Link>
              <Link
                href="https://docs.sendero.travel"
                target="_blank"
                rel="noreferrer"
                className="agents-layout-footer-link"
              >
                Docs
              </Link>
              <Link
                href="https://sendero.travel"
                target="_blank"
                rel="noreferrer"
                className="agents-layout-footer-link"
              >
                Marketing
              </Link>
            </nav>
          </div>
        </footer>
      </div>
    </>
  );
}
