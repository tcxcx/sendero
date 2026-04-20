'use client';

/**
 * DialogShell — common modal chrome for send / swap / bridge / deposit.
 * Closes on backdrop click, Escape key, or programmatic `onClose`.
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
          <button className="ds-close" onClick={onClose} aria-label="close" type="button">
            ✕
          </button>
        </div>
        <div className="ds-body">{children}</div>
      </div>

      <style jsx>{`
        .ds-backdrop {
          position: fixed;
          inset: 0;
          z-index: 120;
          background: color-mix(in oklab, var(--ink) 12%, transparent);
          backdrop-filter: blur(2px);
          display: grid;
          place-items: center;
          padding: 24px;
          animation: ds-fade 140ms ease-out;
        }
        @keyframes ds-fade {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        .ds-card {
          width: 100%;
          max-width: 440px;
          background: var(--bg-elev);
          border: 1.5px solid var(--ink);
          box-shadow: 0 14px 36px -16px rgba(0, 0, 0, 0.3);
          animation: ds-up 180ms ease-out;
          max-height: calc(100vh - 48px);
          overflow: auto;
        }
        @keyframes ds-up {
          from { transform: translateY(6px); opacity: 0; }
          to   { transform: translateY(0);   opacity: 1; }
        }
        .ds-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 12px 14px;
          border-bottom: 1px solid var(--border);
        }
        .ds-head-text {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .ds-title {
          font-family: var(--font-mono);
          font-size: 11px;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          color: var(--ink);
        }
        .ds-subtitle {
          font-family: var(--font-mono);
          font-size: 9px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--text-faint);
        }
        .ds-close {
          background: none;
          border: none;
          color: var(--text-dim);
          cursor: pointer;
          font-size: 14px;
          padding: 4px 6px;
          line-height: 1;
        }
        .ds-close:hover {
          color: var(--ink);
        }
        .ds-body {
          padding: 16px;
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
      `}</style>
    </div>
  );
}

/* Shared control styles consumed by the dialog contents via className. */
export const dialogStyles = `
  .dlg-label {
    font-family: var(--font-mono);
    font-size: 9px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--text-faint);
  }
  .dlg-input {
    padding: 10px 12px;
    border: 1.5px solid var(--border);
    background: var(--bg);
    color: var(--text);
    font-family: var(--font-sans);
    font-size: 14px;
    outline: none;
    width: 100%;
  }
  .dlg-input:focus {
    border-color: var(--ink);
  }
  .dlg-row {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .dlg-sub {
    font-family: var(--font-sans);
    font-size: 12.5px;
    color: var(--text-dim);
    line-height: 1.5;
  }
  .dlg-err {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--accent-rose, #e34);
    padding: 8px 10px;
    border-left: 2px solid var(--accent-rose, #e34);
    background: color-mix(in oklab, var(--accent-rose, #e34) 6%, transparent);
    line-height: 1.5;
    word-break: break-word;
  }
  .dlg-ok {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--accent-green, #0cc67a);
    padding: 8px 10px;
    border-left: 2px solid var(--accent-green, #0cc67a);
    background: color-mix(in oklab, var(--accent-green, #0cc67a) 6%, transparent);
    line-height: 1.5;
  }
  .dlg-ok strong {
    color: var(--text);
    font-family: var(--font-sans);
  }
  .dlg-link {
    color: var(--ink);
    text-decoration: underline;
  }
  .dlg-primary {
    padding: 12px 14px;
    background: var(--ink);
    color: var(--bg-elev);
    border: none;
    font-family: var(--font-mono);
    font-size: 11px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    cursor: pointer;
    width: 100%;
  }
  .dlg-primary:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .dlg-select {
    padding: 10px 12px;
    border: 1.5px solid var(--border);
    background: var(--bg);
    color: var(--text);
    font-family: var(--font-sans);
    font-size: 13px;
    outline: none;
    width: 100%;
  }
  .dlg-select:focus {
    border-color: var(--ink);
  }
  .dlg-segmented {
    display: grid;
    grid-auto-flow: column;
    border: 1.5px solid var(--border);
  }
  .dlg-seg-btn {
    background: var(--bg);
    border: none;
    padding: 10px 8px;
    font-family: var(--font-mono);
    font-size: 11px;
    letter-spacing: 0.08em;
    color: var(--text-dim);
    cursor: pointer;
    transition: all 120ms;
  }
  .dlg-seg-btn + .dlg-seg-btn {
    border-left: 1px solid var(--border);
  }
  .dlg-seg-btn.sel {
    background: var(--ink);
    color: var(--bg-elev);
  }
  .dlg-seg-btn:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }
`;
