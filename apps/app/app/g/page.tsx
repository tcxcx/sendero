'use client';

/**
 * Guest claim landing page — end-to-end.
 *
 * The URL looks like `/g#t=0xTRIP&k=0xCLAIMKEY`. The fragment never
 * reaches the server. This page:
 *
 *   1. Parses the fragment and shows the trip preview
 *   2. Collects display name + email + phone (required for WA binding)
 *   3. Registers a Modular Wallet passkey on the Sendero domain OR
 *      logs into an existing one
 *   4. Signs the Peanut-style claim with the embedded private key
 *   5. Submits the claimTrip userOp via the MSCA (Circle Paymaster
 *      sponsors gas — no native token required)
 *   6. On confirmation, notifies the server so any paused workflow
 *      waiting on this claim can resume, then redirects into the app
 *
 * The private key stays in the URL fragment and in-memory only.
 */

import { useEffect, useMemo, useState } from 'react';

import {
  isPasskeyConfigured,
  loginPasskey,
  passkeyConfigIssue,
  registerPasskey,
  restoreFromStorage,
  sendUserOp,
  type UserWallet,
} from '@sendero/circle/modular-wallets';
import {
  buildClaimCodePreimage,
  buildClaimTripCalls,
  parseGuestLink,
  signClaim,
} from '@sendero/guest';
import type { Address, Hex } from 'viem';

type Phase = 'preview' | 'enroll' | 'submitting' | 'done' | 'error';

const ESCROW_ADDRESS = process.env.NEXT_PUBLIC_SENDERO_GUEST_ESCROW as Address | undefined;
const CHAIN_ID = Number(process.env.NEXT_PUBLIC_ARC_CHAIN_ID ?? 5042002);

export default function GuestClaimPage() {
  const [link, setLink] = useState<string | null>(null);
  const [mode, setMode] = useState<'register' | 'login'>('register');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [phase, setPhase] = useState<Phase>('preview');
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<Hex | null>(null);
  // 2FA — only used when the link fragment carries `&n=<nonce>`. When
  // present, the trip was created with a claimCodeHash and the guest
  // must enter the 6-digit OTP from their invite email to reproduce
  // the preimage on-chain.
  const [claimCode, setClaimCode] = useState('');

  useEffect(() => {
    if (typeof window !== 'undefined') setLink(window.location.href);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const existing = await restoreFromStorage();
      if (!cancelled && existing) {
        setMode('login');
        setDisplayName(existing.displayName);
        setEmail(existing.email ?? '');
        setPhone(existing.phone ?? '');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const parts = useMemo(() => (link ? parseGuestLink(link) : null), [link]);
  const configured = isPasskeyConfigured();
  const configIssue = useMemo(() => passkeyConfigIssue(), []);

  if (link === null) return null;

  if (!parts) {
    return (
      <main style={rootStyle}>
        <h1 style={h1Style}>Invalid invite link.</h1>
        <p style={pStyle}>
          Tokens must ride in the URL fragment (after the <code>#</code>).
        </p>
      </main>
    );
  }

  if (!ESCROW_ADDRESS) {
    return (
      <main style={rootStyle}>
        <h1 style={h1Style}>Guest escrow not configured.</h1>
        <p style={pStyle}>
          Set <code>NEXT_PUBLIC_SENDERO_GUEST_ESCROW</code> before handing out guest links.
        </p>
      </main>
    );
  }

  async function onClaim() {
    if (!parts || !ESCROW_ADDRESS) return;
    setError(null);

    // 2FA guard — when the link includes a nonce (`&n=`), the trip was
    // prefunded with require2fa=true and will revert with InvalidClaimCode
    // unless we submit the real preimage. Fail fast with a friendly UI
    // message instead of a gas-sunken revert.
    if (parts.claimCodeNonce && !/^\d{6}$/.test(claimCode)) {
      setError('This invite requires a 6-digit code. Check the email from Sendero and paste it above.');
      return;
    }

    setPhase('enroll');
    try {
      let wallet: UserWallet;
      if (mode === 'register') {
        if (!displayName.trim() || !isValidEmail(email) || !isValidPhone(phone)) {
          throw new Error('Please fill display name, email, and E.164 phone.');
        }
        wallet = await registerPasskey({
          displayName: displayName.trim(),
          email: email.trim(),
          phone: phone.trim(),
        });
      } else {
        wallet = await loginPasskey();
      }

      setPhase('submitting');
      const signature = await signClaim({
        claimPrivateKey: parts.claimPrivateKey,
        chainId: CHAIN_ID,
        escrow: ESCROW_ADDRESS,
        tripId: parts.tripId,
        guestWallet: wallet.address,
      });
      // Preimage resolution:
      //   • trip with 2FA  → nonce in the URL fragment + code typed by guest → `${code}|${nonce}`
      //   • trip no 2FA    → claimCodeHash is 0x00..00 on-chain → any bytes pass (we send '0x')
      const claimCodePreimage: Hex = parts.claimCodeNonce
        ? buildClaimCodePreimage(claimCode, parts.claimCodeNonce)
        : ('0x' as Hex);
      const calls = buildClaimTripCalls({
        escrow: ESCROW_ADDRESS,
        tripId: parts.tripId,
        guestWallet: wallet.address,
        signature,
        claimCodePreimage,
      });
      const { txHash: hash } = await sendUserOp(
        wallet,
        calls.map(c => ({ to: c.to, data: c.data, value: c.value }))
      );
      setTxHash(hash);
      setPhase('done');

      try {
        await fetch('/api/guest/claimed', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tripId: parts.tripId,
            guestWallet: wallet.address,
            txHash: hash,
          }),
        });
      } catch {
        /* resume is reactive — ignore if the post fails */
      }
    } catch (err) {
      setPhase('error');
      setError(err instanceof Error ? err.message : String(err));
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
        A Sendero buyer prefunded your travel budget in USDC on Arc. Claim it with a passkey — no
        seed phrase, no app install. Gas is sponsored.
      </p>

      <section style={cardStyle}>
        <div style={eyebrowStyle}>Trip</div>
        <div style={codeStyle}>{parts.tripId}</div>
        <div style={eyebrowStyle}>Claim key · stays on your device</div>
        <div style={codeFadedStyle}>
          {parts.claimPrivateKey.slice(0, 10)}…{parts.claimPrivateKey.slice(-8)}
        </div>
        {parts.claimCodeNonce && (
          <>
            <div style={eyebrowStyle}>2FA</div>
            <div style={pillStyle}>One-time code required — check your email</div>
          </>
        )}
      </section>

      {!configured && (
        <div style={alertStyle}>
          <strong>Passkey not configured.</strong> {configIssue ?? 'Check .env.local.'}
        </div>
      )}

      {phase === 'preview' && (
        <form
          onSubmit={e => {
            e.preventDefault();
            onClaim();
          }}
          style={formStyle}
        >
          <div style={tabRowStyle}>
            <button
              type="button"
              style={tabStyle(mode === 'register')}
              onClick={() => setMode('register')}
            >
              Create passkey
            </button>
            <button
              type="button"
              style={tabStyle(mode === 'login')}
              onClick={() => setMode('login')}
            >
              Sign in
            </button>
          </div>

          {mode === 'register' && (
            <>
              <label style={labelStyle}>
                <span>Display name</span>
                <input
                  value={displayName}
                  onChange={e => setDisplayName(e.target.value)}
                  required
                  maxLength={40}
                  style={inputStyle}
                />
              </label>
              <label style={labelStyle}>
                <span>Email</span>
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                  style={inputStyle}
                />
              </label>
              <label style={labelStyle}>
                <span>Phone · E.164</span>
                <input
                  type="tel"
                  value={phone}
                  onChange={e => setPhone(e.target.value)}
                  required
                  pattern="^\+[1-9]\d{6,14}$"
                  style={inputStyle}
                />
              </label>
            </>
          )}

          {mode === 'login' && (
            <p style={hintStyle}>Use the passkey on this device — biometric confirmation only.</p>
          )}

          {parts.claimCodeNonce && (
            <label style={labelStyle}>
              <span>One-time code · 6 digits</span>
              <input
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="\d{6}"
                value={claimCode}
                onChange={e => setClaimCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="123456"
                required
                maxLength={6}
                style={{
                  ...inputStyle,
                  fontSize: 22,
                  letterSpacing: '0.3em',
                  textAlign: 'center',
                  fontFamily: 'ui-monospace, Menlo, monospace',
                }}
              />
            </label>
          )}

          <button
            type="submit"
            style={ctaStyle}
            disabled={!configured || (!!parts.claimCodeNonce && !/^\d{6}$/.test(claimCode))}
          >
            Claim trip with passkey →
          </button>
        </form>
      )}

      {phase === 'enroll' && <p style={progressStyle}>Talking to authenticator…</p>}
      {phase === 'submitting' && (
        <p style={progressStyle}>Submitting claim userOp via Circle Paymaster…</p>
      )}
      {phase === 'done' && (
        <div style={doneStyle}>
          <div style={eyebrowStyle}>Claimed</div>
          <div style={codeStyle}>{txHash}</div>
          <a href="/" style={linkBtnStyle}>
            Open Sendero →
          </a>
        </div>
      )}
      {phase === 'error' && error && (
        <div style={alertStyle}>
          <strong>Claim failed.</strong> {error}
          <div>
            <button type="button" style={ghostCtaStyle} onClick={() => setPhase('preview')}>
              Try again
            </button>
          </div>
        </div>
      )}
    </main>
  );
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}
function isValidPhone(phone: string): boolean {
  return /^\+[1-9]\d{6,14}$/.test(phone.trim());
}

// ─── styles ───

const rootStyle: React.CSSProperties = {
  maxWidth: 560,
  margin: '0 auto',
  padding: '64px 24px 80px',
  fontFamily: 'ui-sans-serif, system-ui, sans-serif',
  color: '#111',
};
const headerStyle: React.CSSProperties = {
  display: 'inline-flex',
  gap: 8,
  alignItems: 'center',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: 11,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: '#555',
  marginBottom: 32,
};
const markStyle: React.CSSProperties = { width: 12, height: 12, background: '#fb542b' };
const h1Style: React.CSSProperties = {
  fontSize: 36,
  letterSpacing: '-0.03em',
  margin: '0 0 16px',
  fontWeight: 500,
  lineHeight: 1.1,
};
const pStyle: React.CSSProperties = { color: '#555', fontSize: 16, margin: '0 0 32px' };
const hintStyle: React.CSSProperties = { color: '#8a8a8a', fontSize: 13, margin: '4px 0 0' };
const cardStyle: React.CSSProperties = {
  border: '1.5px solid #e6e6e6',
  padding: '20px 24px',
  marginBottom: 24,
};
const eyebrowStyle: React.CSSProperties = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: 10,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: '#8a8a8a',
  marginTop: 8,
};
const codeStyle: React.CSSProperties = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: 12,
  wordBreak: 'break-all',
  marginTop: 4,
};
const codeFadedStyle: React.CSSProperties = { ...codeStyle, color: '#8a8a8a' };
const pillStyle: React.CSSProperties = {
  display: 'inline-block',
  marginTop: 6,
  padding: '4px 10px',
  background: '#fff1ea',
  color: '#b34b2e',
  border: '1px solid #f0c8b4',
  borderRadius: 999,
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: 11,
  letterSpacing: '0.06em',
};
const formStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 14,
  padding: 20,
  background: '#f9f9f9',
  border: '1.5px solid #111',
};
const tabRowStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  borderBottom: '1px solid #e6e6e6',
};
function tabStyle(selected: boolean): React.CSSProperties {
  return {
    background: 'transparent',
    border: 'none',
    borderBottom: selected ? '2px solid #111' : '2px solid transparent',
    padding: '10px 4px',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: 11,
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
    color: selected ? '#111' : '#8a8a8a',
    cursor: 'pointer',
  };
}
const labelStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: 10,
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  color: '#555',
};
const inputStyle: React.CSSProperties = {
  padding: '10px 12px',
  border: '1.5px solid #e6e6e6',
  fontFamily: 'ui-sans-serif, system-ui, sans-serif',
  fontSize: 14,
  background: '#fff',
};
const ctaStyle: React.CSSProperties = {
  padding: '14px 20px',
  background: '#fb542b',
  color: '#fff',
  border: 'none',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: 12,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  cursor: 'pointer',
  marginTop: 8,
};
const ghostCtaStyle: React.CSSProperties = {
  ...ctaStyle,
  background: '#fff',
  color: '#111',
  border: '1.5px solid #111',
  marginTop: 12,
};
const progressStyle: React.CSSProperties = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: 12,
  color: '#8a8a8a',
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
};
const doneStyle: React.CSSProperties = {
  border: '1.5px solid #0cc67a',
  padding: '20px 24px',
};
const linkBtnStyle: React.CSSProperties = {
  display: 'inline-block',
  marginTop: 16,
  padding: '10px 16px',
  background: '#111',
  color: '#fff',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: 11,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  textDecoration: 'none',
};
const alertStyle: React.CSSProperties = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: 11,
  lineHeight: 1.5,
  color: '#e34',
  padding: '8px 12px',
  borderLeft: '2px solid #e34',
  background: 'color-mix(in oklab, #e34 6%, transparent)',
  marginBottom: 16,
};
