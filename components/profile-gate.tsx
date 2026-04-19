'use client';

/**
 * ProfileGate — catches existing passkey sessions that pre-date the email
 * + phone fields and prompts the user to complete their profile before any
 * Duffel call can go out with empty/malformed passenger data.
 */

import { useEffect, useState } from 'react';
import { usePasillo } from './store';
import { logout } from '@/lib/user-wallet';

const PROFILE_KEY = 'pasillo:passkey-profile';

export function ProfileGate({ children }: { children: React.ReactNode }) {
  const userAuth = usePasillo((s) => s.userAuth);
  const setUserAuth = usePasillo((s) => s.setUserAuth);

  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!userAuth) return;
    setEmail(userAuth.email ?? '');
    setPhone(userAuth.phone ?? '');
  }, [userAuth]);

  if (!userAuth) return <>{children}</>;

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const phoneValid = /^\+[1-9]\d{6,14}$/.test(phone.trim());
  const missing = !userAuth.email || !userAuth.phone;

  if (!missing) return <>{children}</>;

  const canSave = emailValid && phoneValid && !saving;

  const save = () => {
    if (!canSave) return;
    setSaving(true);
    try {
      // Persist into the same localStorage record user-wallet.ts reads.
      const raw = window.localStorage.getItem(PROFILE_KEY);
      const base = raw ? safeJson(raw) : { displayName: userAuth.displayName };
      const next = {
        displayName: userAuth.displayName,
        email: email.trim(),
        phone: phone.trim(),
        ...base,
      };
      next.email = email.trim();
      next.phone = phone.trim();
      window.localStorage.setItem(PROFILE_KEY, JSON.stringify(next));
      setUserAuth({
        ...userAuth,
        email: email.trim(),
        phone: phone.trim(),
      });
    } finally {
      setSaving(false);
    }
  };

  const signOut = () => {
    logout();
    setUserAuth(null);
  };

  return (
    <div className="pg-root">
      <div className="pg-card">
        <div className="pg-brand">
          <span className="pg-mark" />
          <span className="pg-word">PASILLO</span>
          <span className="pg-sub">× complete your profile</span>
        </div>

        <h1 className="pg-title">One more step</h1>
        <p className="pg-copy">
          Your passkey was registered before we started collecting contact
          info. Duffel needs a valid email and E.164 phone for every booking.
          Add them once — we'll keep them on this device next to your passkey.
        </p>

        <label className="pg-field">
          <span>Email · for the booking PNR</span>
          <input
            autoFocus
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="nadia@acme.fin"
            maxLength={120}
            autoComplete="email"
          />
        </label>

        <label className="pg-field">
          <span>Phone · E.164 (e.g. +447123456789)</span>
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+447123456789"
            maxLength={20}
            autoComplete="tel"
          />
        </label>

        <button
          className="pg-primary"
          onClick={save}
          disabled={!canSave}
        >
          {saving ? 'Saving…' : 'Save and continue →'}
        </button>

        <button className="pg-link" onClick={signOut}>
          Sign out and start over
        </button>

        <div className="pg-foot">
          <span>
            Signed in as <strong>{userAuth.displayName}</strong>
          </span>
          <span className="pg-dot">·</span>
          <span className="mono">
            {userAuth.address.slice(0, 6)}…{userAuth.address.slice(-4)}
          </span>
        </div>
      </div>

      <style jsx>{`
        .pg-root {
          min-height: 100vh;
          display: grid;
          place-items: center;
          background:
            radial-gradient(
              1000px 600px at 20% 10%,
              color-mix(in oklab, var(--accent-blue, #3a5fff) 10%, transparent),
              transparent 60%
            ),
            var(--bg);
          padding: 24px;
        }
        .pg-card {
          width: 100%;
          max-width: 460px;
          background: var(--bg-elev);
          border: 1.5px solid var(--ink);
          padding: 28px;
          display: flex;
          flex-direction: column;
          gap: 14px;
        }
        .pg-brand {
          display: flex;
          align-items: center;
          gap: 10px;
          font-family: var(--font-mono);
          font-size: 10px;
          letter-spacing: 0.14em;
          text-transform: uppercase;
        }
        .pg-mark {
          width: 12px;
          height: 12px;
          background: var(--ink);
        }
        .pg-word {
          color: var(--ink);
        }
        .pg-sub {
          color: var(--text-dim);
          text-transform: none;
          letter-spacing: 0.04em;
        }
        .pg-title {
          font-family: var(--font-sans);
          font-size: 28px;
          font-weight: 500;
          letter-spacing: -0.02em;
          margin: 2px 0 0;
          color: var(--text);
        }
        .pg-copy {
          font-family: var(--font-sans);
          font-size: 13px;
          line-height: 1.55;
          color: var(--text-dim);
          margin: 0;
        }
        .pg-field {
          display: flex;
          flex-direction: column;
          gap: 4px;
          font-family: var(--font-mono);
          font-size: 10px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--text-dim);
        }
        .pg-field input {
          padding: 10px 12px;
          border: 1.5px solid var(--border);
          background: var(--bg);
          color: var(--text);
          font-family: var(--font-sans);
          font-size: 14px;
          outline: none;
        }
        .pg-field input:focus {
          border-color: var(--ink);
        }
        .pg-primary {
          padding: 12px 14px;
          background: var(--ink);
          color: var(--bg-elev);
          border: none;
          font-family: var(--font-mono);
          font-size: 11px;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          cursor: pointer;
        }
        .pg-primary:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }
        .pg-link {
          background: none;
          border: none;
          color: var(--text-dim);
          font-family: var(--font-mono);
          font-size: 10px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          cursor: pointer;
          padding: 4px 0;
          text-align: center;
        }
        .pg-link:hover {
          color: var(--ink);
        }
        .pg-foot {
          margin-top: 8px;
          padding-top: 10px;
          border-top: 1px solid var(--border);
          font-family: var(--font-mono);
          font-size: 10px;
          color: var(--text-faint);
          letter-spacing: 0.06em;
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
        }
        .pg-foot strong {
          color: var(--text);
          font-weight: 500;
        }
        .pg-foot .mono {
          color: var(--ink);
        }
        .pg-foot .pg-dot {
          opacity: 0.4;
        }
      `}</style>
    </div>
  );
}

function safeJson(raw: string): any {
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}
