'use client';

/**
 * SolDeferredPanel — shared placeholder rendered inside Send / Swap /
 * Bridge / Deposit dialogs for Sol-primary tenants. The unified-balance
 * abstraction the dialogs ride on is Arc-native today; the Solana
 * Squads V4 vault path needs separate wiring (Phase 2). Until that
 * lands, surface a clear, non-broken state instead of letting the
 * dialog post an Arc-shaped request with a base58 address.
 */

interface SolDeferredPanelProps {
  feature: string;
  detail: string;
}

export function SolDeferredPanel({ feature, detail }: SolDeferredPanelProps) {
  return (
    <div className="sd-shell">
      <div className="sd-eyebrow">Solana settlement</div>
      <h3 className="sd-title">{feature} on Solana — shipping shortly</h3>
      <p className="sd-detail">{detail}</p>
      <div className="sd-meta">
        <span className="sd-meta-k">Status</span>
        <span className="sd-meta-v">Deferred · Phase 2</span>
      </div>
      <style jsx>{`
        .sd-shell {
          display: flex;
          flex-direction: column;
          gap: 14px;
          padding: 18px 8px;
        }
        .sd-eyebrow {
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: 10px;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          color: var(--ink, #fb542b);
        }
        .sd-title {
          margin: 0;
          font-family: var(--font-sans);
          font-size: 16px;
          font-weight: 500;
          letter-spacing: -0.01em;
          color: var(--text);
        }
        .sd-detail {
          margin: 0;
          font-size: 13px;
          line-height: 1.55;
          color: var(--text-dim, color-mix(in oklab, var(--text) 70%, transparent));
        }
        .sd-meta {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 10px 12px;
          border: 1px solid var(--border);
          font-family: var(--font-mono);
        }
        .sd-meta-k {
          font-size: 9px;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          color: var(--text-faint, color-mix(in oklab, var(--text) 50%, transparent));
        }
        .sd-meta-v {
          font-size: 11px;
          color: var(--ink, #fb542b);
        }
      `}</style>
    </div>
  );
}
