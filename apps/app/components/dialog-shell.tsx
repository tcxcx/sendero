'use client';

/**
 * DialogShell — common modal chrome for send / swap / bridge / deposit.
 * Closes on backdrop click, Escape key, or programmatic `onClose`.
 *
 * Design spec:
 *   - Backdrop: 16% ink tint + 6px blur, fades 160ms.
 *   - Card: 460px, Arc cream surface, dual-layer shadow, lifts 8px on open.
 *   - Header: mono micro-caps title + kbd-style subtitle chip.
 *   - Close: 28px hit-target w/ SVG × icon + hover ring (WCAG AA).
 */

import { useEffect, type ReactNode } from 'react';

export function DialogShell({
  open,
  title,
  subtitle,
  children,
  onClose,
}: {
  open: boolean;
  title: string;
  subtitle?: string;
  children: ReactNode;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="ds-backdrop" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className="ds-card" role="dialog" aria-modal="true">
        <div className="ds-head">
          <div className="ds-head-text">
            <span className="ds-title">{title}</span>
            {subtitle && <span className="ds-subtitle">{subtitle}</span>}
          </div>
          <button className="ds-close" onClick={onClose} aria-label="Close dialog" type="button">
            <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
              <path
                d="M6 6l12 12M18 6L6 18"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
        <div className="ds-body">{children}</div>
      </div>

      <style jsx>{`
        .ds-backdrop {
          position: fixed;
          inset: 0;
          z-index: 120;
          background: color-mix(in oklab, var(--sendero-midnight, #1f2a44) 52%, transparent);
          backdrop-filter: blur(10px) saturate(1.1);
          -webkit-backdrop-filter: blur(10px) saturate(1.1);
          display: grid;
          place-items: center;
          padding: 24px;
          animation: ds-fade 160ms ease-out;
        }
        @keyframes ds-fade {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @media (prefers-reduced-motion: reduce) {
          .ds-backdrop, .ds-card { animation: none; }
        }
        .ds-card {
          width: 100%;
          max-width: 460px;
          background: var(--bg-elev);
          border: 1.5px solid var(--ink);
          /* dual-layer shadow: a sharp near-field + a softer far-field
             so the card reads as lifted on the cream surface without
             looking plasticky */
          box-shadow:
            0 1px 0 rgba(0,0,0,0.04),
            0 18px 40px -14px color-mix(in oklab, var(--ink) 24%, transparent),
            0 40px 80px -40px rgba(0,0,0,0.28);
          animation: ds-up 200ms cubic-bezier(0.2, 0.9, 0.3, 1);
          max-height: calc(100vh - 48px);
          overflow: auto;
        }
        @keyframes ds-up {
          from { transform: translateY(10px) scale(0.985); opacity: 0; }
          to   { transform: translateY(0)    scale(1);     opacity: 1; }
        }
        .ds-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          padding: 14px 16px;
          border-bottom: 1px solid var(--border);
          background: color-mix(in oklab, var(--ink) 2%, var(--bg-elev));
        }
        .ds-head-text {
          display: flex;
          flex-direction: column;
          gap: 3px;
          min-width: 0;
        }
        .ds-title {
          font-family: var(--font-mono);
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.16em;
          text-transform: uppercase;
          color: var(--ink);
          line-height: 1.2;
        }
        .ds-subtitle {
          font-family: var(--font-mono);
          font-size: 9.5px;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: var(--text-faint);
          line-height: 1.2;
        }
        .ds-close {
          width: 28px;
          height: 28px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          background: transparent;
          border: 1px solid transparent;
          color: var(--text-dim);
          cursor: pointer;
          padding: 0;
          line-height: 1;
          transition: color 120ms, border-color 120ms, background 120ms;
          flex-shrink: 0;
        }
        .ds-close:hover {
          color: var(--ink);
          border-color: var(--ink);
          background: color-mix(in oklab, var(--ink) 6%, transparent);
        }
        .ds-close:focus-visible {
          outline: none;
          border-color: var(--ink);
          box-shadow: 0 0 0 3px color-mix(in oklab, var(--ink) 22%, transparent);
        }
        .ds-body {
          padding: 18px 16px 16px;
          display: flex;
          flex-direction: column;
          gap: 14px;
        }
      `}</style>
    </div>
  );
}

/**
 * Kept as an empty export for backwards-compat with callers that still
 * import `dialogStyles`. The actual CSS lives in `app/globals.css` under
 * the "Dialog controls" section — Turbopack's SWC styled-jsx plugin
 * dropped the rules when they were authored here as a template literal.
 */
export const dialogStyles = '';
