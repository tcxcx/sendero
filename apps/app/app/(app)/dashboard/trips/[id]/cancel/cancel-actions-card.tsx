'use client';

/**
 * Two-button action card for the buyer cancel-sweep page.
 *
 * Inline-style + token-based theming to match the existing trip-detail
 * surface (`SettleHoldButton`, `TripDetailCard`). Mobile-first: the
 * buttons stack on narrow widths via flex-wrap so a phone-bound buyer
 * can act with one thumb.
 *
 * State transitions:
 *   - idle → resending (POST /api/trip/.../resend)
 *   - idle → cancelling (server action `cancelTripAndSweep`)
 *   - both → success / blocked / pending banners
 *
 * Both buttons disable themselves when:
 *   - `disabledReason` is non-null (trip already cancelled / settled)
 *   - the other action is in flight (avoids double-submit races)
 */

import { useState, useTransition } from 'react';

import { type CancelSweepResult, cancelTripAndSweep } from './cancel-action';

type ResendState =
  | { kind: 'idle' }
  | { kind: 'pending' }
  | { kind: 'success'; channel: string; sentAt: string }
  | { kind: 'failed'; message: string };

interface Props {
  /** Off-chain trip id (cuid). */
  tripId: string;
  /** On-chain bytes32 hex. */
  onchainTripId: string;
  /**
   * When set, both buttons render as disabled with this copy as the
   * helper text (e.g. "Trip already cancelled — funds were swept on
   * 2026-04-25.").
   */
  disabledReason: string | null;
}

export function CancelActionsCard({ tripId, onchainTripId, disabledReason }: Props) {
  const [resend, setResend] = useState<ResendState>({ kind: 'idle' });
  const [cancelResult, setCancelResult] = useState<CancelSweepResult | null>(null);
  const [pendingCancel, startCancel] = useTransition();

  const disabled = Boolean(disabledReason) || resend.kind === 'pending' || pendingCancel;

  async function onResend() {
    setResend({ kind: 'pending' });
    try {
      const res = await fetch(`/api/trip/${onchainTripId}/claim-code/resend`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // The resend endpoint requires a contactProof; the buyer
        // cancel page doesn't have it, so this call will fail with
        // `contact_proof_mismatch` until the route adds a buyer-side
        // bypass. Surface the failure so the user sees what's needed.
        body: JSON.stringify({ contactProof: '' }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
          message?: string;
        };
        setResend({
          kind: 'failed',
          message: body.error ?? body.message ?? `HTTP ${res.status}`,
        });
        return;
      }
      const body = (await res.json()) as { channel: string; sentAt: string };
      setResend({ kind: 'success', channel: body.channel, sentAt: body.sentAt });
    } catch (err) {
      setResend({
        kind: 'failed',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  function onCancel() {
    setCancelResult(null);
    startCancel(async () => {
      const r = await cancelTripAndSweep(tripId);
      setCancelResult(r);
    });
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
        marginTop: 18,
      }}
    >
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 12,
        }}
      >
        <button
          type="button"
          onClick={onResend}
          disabled={disabled}
          style={{
            padding: '10px 16px',
            background: '#fdfbf7',
            color: 'var(--ink-100)',
            border: '1px solid var(--ink-30)',
            borderRadius: 8,
            fontSize: 13,
            fontWeight: 600,
            fontFamily: 'var(--font-sans)',
            cursor: disabled ? 'not-allowed' : 'pointer',
            opacity: disabled ? 0.55 : 1,
            flex: '1 1 auto',
            minWidth: 220,
          }}
          data-testid="resend-code-button"
        >
          {resend.kind === 'pending' ? 'Sending fresh code…' : 'Send a fresh code to the guest'}
        </button>

        <button
          type="button"
          onClick={onCancel}
          disabled={disabled}
          style={{
            padding: '10px 16px',
            background: 'var(--vermillion)',
            color: '#fdfbf7',
            border: 0,
            borderRadius: 8,
            fontSize: 13,
            fontWeight: 600,
            fontFamily: 'var(--font-sans)',
            cursor: disabled ? 'not-allowed' : 'pointer',
            opacity: disabled ? 0.55 : 1,
            flex: '1 1 auto',
            minWidth: 220,
          }}
          data-testid="cancel-sweep-button"
        >
          {pendingCancel ? 'Cancelling + sweeping…' : 'Cancel this trip + reclaim funds'}
        </button>
      </div>

      {disabledReason ? (
        <div className="t-mono ink-60" style={{ fontSize: 11 }} data-testid="disabled-reason">
          {disabledReason}
        </div>
      ) : null}

      {resend.kind === 'success' ? (
        <div
          style={{
            fontSize: 12,
            padding: '8px 12px',
            borderRadius: 6,
            background: 'rgba(80, 130, 95, 0.10)',
            color: 'var(--accent-green)',
          }}
          className="t-mono"
        >
          ✓ Fresh code dispatched via {resend.channel} at {new Date(resend.sentAt).toLocaleString()}
        </div>
      ) : null}
      {resend.kind === 'failed' ? (
        <div
          style={{
            fontSize: 12,
            padding: '8px 12px',
            borderRadius: 6,
            background: 'rgba(217,79,52,0.08)',
            color: 'var(--vermillion)',
          }}
          className="t-mono"
        >
          ✗ Resend failed: {resend.message}
        </div>
      ) : null}

      {cancelResult ? <CancelResultBanner result={cancelResult} /> : null}
    </div>
  );
}

function CancelResultBanner({ result }: { result: CancelSweepResult }) {
  if (result.kind === 'executed') {
    return (
      <div
        className="t-mono"
        style={{
          fontSize: 12,
          padding: '8px 12px',
          borderRadius: 6,
          background: 'rgba(80, 130, 95, 0.10)',
          color: 'var(--accent-green)',
        }}
      >
        ✓ Cancelled + swept · cancel tx {result.cancelledTxHash.slice(0, 12)}… · sweep tx{' '}
        {result.sweptTxHash.slice(0, 12)}…
        {result.recoveredMicroUsdc
          ? ` · recovered ${(Number(result.recoveredMicroUsdc) / 1_000_000).toFixed(2)} USDC`
          : ''}
      </div>
    );
  }
  if (result.kind === 'operator_unavailable') {
    return (
      <div
        style={{
          fontSize: 12,
          padding: '10px 12px',
          borderRadius: 6,
          background: 'rgba(217,165,32,0.10)',
          color: 'var(--ink-100)',
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
        }}
        className="t-mono"
        data-testid="operator-unavailable-banner"
      >
        <span style={{ fontWeight: 600 }}>Operator infra not configured</span>
        <span style={{ opacity: 0.85 }}>{result.message}</span>
        <span style={{ opacity: 0.85 }}>{result.manualInstructions}</span>
      </div>
    );
  }
  if (result.kind === 'invalid_state') {
    const copy =
      result.reason === 'already_cancelled'
        ? 'Trip already cancelled — nothing to sweep.'
        : result.reason === 'already_settled'
          ? 'Trip already settled — funds were released to the vendor.'
          : 'Trip not found.';
    return (
      <div className="t-mono ink-60" style={{ fontSize: 11 }}>
        {copy}
      </div>
    );
  }
  if (result.kind === 'unauthorized') {
    return (
      <div className="t-mono" style={{ fontSize: 11, color: 'var(--vermillion)' }}>
        Not authorized: {result.reason}
      </div>
    );
  }
  // result.kind === 'failed' — distinguishes which step failed so the
  // user can retry the right one (sweep can run on its own after cancel).
  return (
    <div className="t-mono" style={{ fontSize: 11, color: 'var(--vermillion)' }}>
      ✗ {result.step === 'cancel' ? 'Cancel failed' : 'Sweep failed (cancel succeeded)'}: {result.reason}
    </div>
  );
}
