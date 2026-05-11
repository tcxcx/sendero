'use client';

/**
 * Guest claim landing page — /me-style onboarding.
 *
 * Replaces the prior passkey-MSCA flow with a server-custodied DCW
 * provisioning pattern (matches WhatsApp travelers):
 *
 *   1. Parse the URL fragment. The fragment never reaches the server
 *      until we POST it explicitly below.
 *   2. Guest types the email the buyer addressed the invite to,
 *      optional display name + phone, and the 6-digit OTP if the
 *      trip was prefunded with 2FA.
 *   3. POST to /api/guest/claim with the full fragment + form fields.
 *      Server verifies email matches the invite, upserts the User,
 *      provisions a Circle DCW, signs the Peanut-style claim with
 *      the embedded key, and submits the on-chain claim from the
 *      DCW (Arc: contractExecution / Sol: Anchor claim_trip).
 *   4. On success, redirect to /me?welcome=1.
 *
 * No passkey, no in-browser private-key handling. The claim secret
 * still travels in the URL fragment client→server in the POST body —
 * that's the new trust boundary. Server discards it immediately after
 * the on-chain submit.
 */

import { useEffect, useMemo, useState } from 'react';

type Phase = 'preview' | 'submitting' | 'done' | 'error';

interface ParsedLink {
  chain: 'arc' | 'sol';
  tripIdShort: string;
  has2fa: boolean;
}

function parseLink(fragment: string): ParsedLink | null {
  const params = new URLSearchParams(
    fragment.startsWith('#') ? fragment.slice(1) : fragment
  );
  const t = params.get('t');
  const k = params.get('k');
  const n = params.get('n');
  const c = params.get('c');
  if (!t || !k) return null;
  const chain: 'arc' | 'sol' = c === 'sol' ? 'sol' : 'arc';
  const tripIdShort =
    chain === 'arc'
      ? `${t.slice(0, 10)}…${t.slice(-6)}`
      : `${t.slice(0, 6)}…${t.slice(-6)}`;
  return { chain, tripIdShort, has2fa: Boolean(n) };
}

export default function GuestClaimPage() {
  const [fragment, setFragment] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [claimCode, setClaimCode] = useState('');
  const [phase, setPhase] = useState<Phase>('preview');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    txHash: string;
    guestWallet: string;
    redirectTo: string;
  } | null>(null);

  useEffect(() => {
    if (typeof window !== 'undefined') setFragment(window.location.hash);
  }, []);

  const parsed = useMemo(() => (fragment ? parseLink(fragment) : null), [fragment]);

  // Once claim succeeds, redirect after a brief celebration screen so
  // the user can copy the tx hash if they want.
  useEffect(() => {
    if (phase !== 'done' || !result) return;
    const t = setTimeout(() => {
      window.location.assign(result.redirectTo);
    }, 2500);
    return () => clearTimeout(t);
  }, [phase, result]);

  if (fragment === null) return null;

  if (!parsed) {
    return (
      <main style={rootStyle}>
        <h1 style={h1Style}>Invalid invite link.</h1>
        <p style={pStyle}>
          The trip metadata must ride in the URL fragment (after the <code>#</code>). Make
          sure you opened the full link from your invite email.
        </p>
      </main>
    );
  }

  async function submit() {
    if (phase === 'submitting') return;
    setError(null);
    setPhase('submitting');
    try {
      const res = await fetch('/api/guest/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fragment,
          email: email.trim(),
          ...(displayName.trim() ? { displayName: displayName.trim() } : {}),
          ...(phone.trim() ? { phone: phone.trim() } : {}),
          ...(claimCode.trim() ? { claimCode: claimCode.trim() } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.message || data?.error || `claim_failed (${res.status})`);
      }
      setResult({
        txHash: data.txHash,
        guestWallet: data.guestWallet,
        redirectTo: data.redirectTo ?? '/me?welcome=1',
      });
      setPhase('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase('error');
    }
  }

  return (
    <main style={rootStyle}>
      <header style={headerStyle}>
        <span style={markStyle} />
        <span>Sendero · guest invite</span>
      </header>

      <h1 style={h1Style}>Your trip is funded and waiting.</h1>
      <p style={pStyle}>
        A Sendero buyer prefunded your travel budget in USDC on{' '}
        {parsed.chain === 'sol' ? 'Solana' : 'Arc'}. Claim it with your email — Sendero
        creates your account and on-chain wallet automatically. Gas is sponsored.
      </p>

      <section style={cardStyle}>
        <div style={eyebrowStyle}>Trip</div>
        <div style={codeStyle}>{parsed.tripIdShort}</div>
        <div style={eyebrowStyle}>Chain</div>
        <div style={pillStyle}>{parsed.chain === 'sol' ? 'Solana Devnet' : 'Arc Testnet'}</div>
        {parsed.has2fa && (
          <>
            <div style={eyebrowStyle}>Security</div>
            <div style={pillStyle}>One-time code required — check your email</div>
          </>
        )}
      </section>

      {phase === 'done' && result && (
        <section style={successStyle}>
          <strong>Claimed.</strong> Funds released to your new Sendero wallet:
          <div style={codeStyle}>{result.guestWallet}</div>
          <a
            href={
              parsed.chain === 'sol'
                ? `https://solscan.io/tx/${result.txHash}?cluster=devnet`
                : `https://testnet.arcscan.app/tx/${result.txHash}`
            }
            target="_blank"
            rel="noreferrer"
            style={linkStyle}
          >
            View on-chain ↗
          </a>
          <p style={hintStyle}>Redirecting you to Sendero…</p>
        </section>
      )}

      {(phase === 'preview' || phase === 'error') && (
        <form
          onSubmit={e => {
            e.preventDefault();
            submit();
          }}
          style={formStyle}
        >
          <label style={labelStyle}>
            <span>Email</span>
            <span style={hintInlineStyle}>
              the address your invite was sent to — used to verify it's really you
            </span>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              autoComplete="email"
              style={inputStyle}
            />
          </label>

          <label style={labelStyle}>
            <span>Display name</span>
            <input
              value={displayName}
              onChange={e => setDisplayName(e.target.value)}
              maxLength={80}
              autoComplete="name"
              style={inputStyle}
            />
          </label>

          <label style={labelStyle}>
            <span>Phone · E.164</span>
            <span style={hintInlineStyle}>
              optional — lets us text or WhatsApp you trip updates later
            </span>
            <input
              type="tel"
              value={phone}
              onChange={e => setPhone(e.target.value)}
              pattern="^\+[1-9]\d{6,14}$"
              autoComplete="tel"
              style={inputStyle}
            />
          </label>

          {parsed.has2fa && (
            <label style={labelStyle}>
              <span>One-time code · 6 digits</span>
              <span style={hintInlineStyle}>from your invite email</span>
              <input
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="\d{6}"
                value={claimCode}
                onChange={e => setClaimCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="123456"
                required
                maxLength={6}
                style={{ ...inputStyle, letterSpacing: '0.3em' }}
              />
            </label>
          )}

          {error && <div style={errorStyle}>{error}</div>}

          <button type="submit" style={buttonStyle}>
            Claim trip →
          </button>
        </form>
      )}

      {phase === 'submitting' && (
        <section style={cardStyle}>
          <strong>Provisioning your wallet and claiming on-chain…</strong>
          <p style={hintStyle}>This usually takes about 10 seconds.</p>
        </section>
      )}
    </main>
  );
}

// ─── inline styles (kept verbatim from the previous page) ──────────
const rootStyle: React.CSSProperties = {
  maxWidth: 560,
  margin: '0 auto',
  padding: '48px 24px 96px',
  fontFamily:
    'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif',
  color: 'var(--text, #0f172a)',
  background: 'var(--bg, #fbfbf9)',
};
const headerStyle: React.CSSProperties = {
  fontSize: 11,
  letterSpacing: '0.18em',
  textTransform: 'uppercase',
  color: 'var(--text-faint, #6b7280)',
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  marginBottom: 16,
};
const markStyle: React.CSSProperties = {
  display: 'inline-block',
  width: 8,
  height: 8,
  background: 'var(--ink, #111)',
};
const h1Style: React.CSSProperties = {
  fontSize: 28,
  fontWeight: 600,
  margin: '0 0 12px',
  lineHeight: 1.2,
};
const pStyle: React.CSSProperties = { lineHeight: 1.55, marginBottom: 24, color: 'var(--text-dim, #374151)' };
const cardStyle: React.CSSProperties = {
  border: '1px solid var(--border, #e5e7eb)',
  padding: 16,
  marginBottom: 16,
  background: '#fff',
};
const eyebrowStyle: React.CSSProperties = {
  fontSize: 10,
  letterSpacing: '0.18em',
  textTransform: 'uppercase',
  color: 'var(--text-faint, #6b7280)',
  marginBottom: 4,
};
const codeStyle: React.CSSProperties = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: 12,
  wordBreak: 'break-all',
  marginBottom: 12,
};
const pillStyle: React.CSSProperties = {
  display: 'inline-block',
  fontSize: 11,
  padding: '4px 8px',
  border: '1px solid var(--border, #e5e7eb)',
  marginBottom: 12,
};
const formStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 16,
};
const labelStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  fontSize: 13,
};
const hintInlineStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--text-faint, #6b7280)',
};
const hintStyle: React.CSSProperties = {
  fontSize: 13,
  color: 'var(--text-dim, #374151)',
  marginTop: 12,
};
const inputStyle: React.CSSProperties = {
  border: '1px solid var(--border, #e5e7eb)',
  padding: '10px 12px',
  fontSize: 14,
  fontFamily: 'inherit',
};
const buttonStyle: React.CSSProperties = {
  background: 'var(--ink, #111)',
  color: '#fff',
  border: 'none',
  padding: '14px 16px',
  fontSize: 14,
  letterSpacing: '0.04em',
  cursor: 'pointer',
};
const errorStyle: React.CSSProperties = {
  border: '1px solid #dc2626',
  background: '#fef2f2',
  color: '#7f1d1d',
  padding: 12,
  fontSize: 13,
};
const successStyle: React.CSSProperties = {
  border: '1px solid #16a34a',
  background: '#f0fdf4',
  padding: 16,
  fontSize: 13,
};
const linkStyle: React.CSSProperties = {
  fontSize: 12,
  color: 'var(--ink, #111)',
  textDecoration: 'underline',
};
