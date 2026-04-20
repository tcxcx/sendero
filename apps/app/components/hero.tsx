'use client';

/**
 * Sendero × Arc — Landing Hero.
 *
 * Editorial split: left column is the pitch + passkey onboarding, right
 * column is a live cobe globe. Once the user registers or signs in, the
 * parent unmounts the hero and the Agent Console takes over.
 */

import createGlobe from 'cobe';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  isPasskeyConfigured,
  loginPasskey,
  passkeyConfigIssue,
  registerPasskey,
  restoreFromStorage,
} from '@sendero/circle/modular-wallets';
import { useSendero, type UserAuth } from './store';
import { useMeterSummary } from './use-meter';

type Mode = 'register' | 'login';

const MARKERS: Array<{ location: [number, number]; size: number }> = [
  { location: [37.78, -122.41], size: 0.07 }, // SFO
  { location: [40.71, -74.01], size: 0.07 }, // JFK
  { location: [51.51, -0.13], size: 0.08 }, // LHR
  { location: [52.52, 13.4], size: 0.06 }, // BER
  { location: [48.85, 2.35], size: 0.07 }, // CDG
  { location: [38.72, -9.14], size: 0.05 }, // LIS
  { location: [41.9, 12.49], size: 0.06 }, // FCO
  { location: [25.2, 55.27], size: 0.06 }, // DXB
  { location: [1.35, 103.81], size: 0.07 }, // SIN
  { location: [-34.61, -58.37], size: 0.07 }, // EZE
  { location: [42.36, -71.05], size: 0.05 }, // BOS
  { location: [-23.55, -46.63], size: 0.05 }, // GRU
];

export function LandingHero() {
  const setUserAuth = useSendero(s => s.setUserAuth);

  const [restoring, setRestoring] = useState(true);
  const [mode, setMode] = useState<Mode>('register');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const wallet = await restoreFromStorage();
        if (alive && wallet) {
          setUserAuth({
            address: wallet.address,
            displayName: wallet.displayName,
            email: wallet.email,
            phone: wallet.phone,
          });
        }
      } catch {
        /* fresh user */
      } finally {
        if (alive) setRestoring(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [setUserAuth]);

  const configured = isPasskeyConfigured();
  const configIssue = useMemo(() => passkeyConfigIssue(), []);

  const trimmedName = displayName.trim();
  const trimmedEmail = email.trim();
  const trimmedPhone = phone.trim();
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail);
  const phoneValid = /^\+[1-9]\d{6,14}$/.test(trimmedPhone);
  const formValid = mode === 'login' || (trimmedName.length > 0 && emailValid && phoneValid);

  const submit = async () => {
    if (!configured) return;
    setError(null);
    setWorking(true);
    try {
      const wallet =
        mode === 'register'
          ? await registerPasskey({
              displayName: trimmedName,
              email: trimmedEmail,
              phone: trimmedPhone,
            })
          : await loginPasskey();
      const next: UserAuth = {
        address: wallet.address,
        displayName: wallet.displayName,
        email: wallet.email,
        phone: wallet.phone,
      };
      setUserAuth(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setWorking(false);
    }
  };

  if (restoring) {
    return (
      <div className="hero-splash">
        <span className="hero-dot" />
        <span>checking for existing passkey…</span>
        <style jsx>{heroStyles}</style>
      </div>
    );
  }

  return (
    <div className="hero-root">
      <header className="hero-nav">
        <div className="hero-brand">
          <span className="hero-mark" />
          <span className="hero-word">SENDERO</span>
          <span className="hero-x">×</span>
          <span className="hero-word hero-word-alt">ARC</span>
        </div>
        <div className="hero-meta">
          <span className="hero-pill">circle · arc L2</span>
          <span className="hero-pill-ink">Arc Testnet · live</span>
          <span className="hero-ver">v0.9.4-alpha</span>
        </div>
      </header>

      <main className="hero-grid">
        <section className="hero-left">
          <div className="hero-eyebrow">
            <span className="dot" />
            Hackathon · Circle × Arc · Spring 2026
          </div>

          <h1 className="hero-title">
            Corporate travel,
            <br />
            one <em>agent per trip</em>.
            <br />
            Settled on <em>Arc</em>.
          </h1>

          <p className="hero-sub">
            Every booking spawns its own AI agent. Reachable over <strong>email</strong> and{' '}
            <strong>WhatsApp</strong>, it issues a real PNR via Duffel, clears policy with Clerk-bound
            org rules, and settles on Arc Testnet through an ERC-8183 escrow job. No seed phrase, no
            native gas token — USDC is the gas.
          </p>

          <MarginStrip />

          <form
            className="hero-form"
            onSubmit={e => {
              e.preventDefault();
              submit();
            }}
          >
            <div className="hero-tabs" role="tablist" aria-label="Auth mode">
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'register'}
                className={`hero-tab ${mode === 'register' ? 'sel' : ''}`}
                onClick={() => {
                  setError(null);
                  setMode('register');
                }}
              >
                Create passkey
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'login'}
                className={`hero-tab ${mode === 'login' ? 'sel' : ''}`}
                onClick={() => {
                  setError(null);
                  setMode('login');
                }}
              >
                Sign in
              </button>
            </div>

            {!configured && (
              <div className="hero-alert">
                <strong>Passkey not configured.</strong> {configIssue ?? 'Check .env.local.'}
              </div>
            )}

            {mode === 'register' && (
              <div className="hero-fields">
                <label className="hero-field">
                  <span>Display name</span>
                  <input
                    value={displayName}
                    onChange={e => setDisplayName(e.target.value)}
                    placeholder="Nadia Chen"
                    maxLength={40}
                    autoComplete="name"
                  />
                </label>
                <label className="hero-field">
                  <span>Email · for the booking PNR</span>
                  <input
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="nadia@acme.fin"
                    maxLength={120}
                    autoComplete="email"
                  />
                </label>
                <label className="hero-field">
                  <span>Phone · E.164</span>
                  <input
                    type="tel"
                    value={phone}
                    onChange={e => setPhone(e.target.value)}
                    placeholder="+447123456789"
                    maxLength={20}
                    autoComplete="tel"
                  />
                </label>
              </div>
            )}

            {mode === 'login' && (
              <p className="hero-login-hint">
                Use the passkey you registered on this device — biometric confirmation only.
              </p>
            )}

            {error && <div className="hero-alert">{error}</div>}

            <button
              type="submit"
              className="hero-primary"
              disabled={!configured || working || !formValid}
            >
              {working
                ? 'Talking to authenticator…'
                : mode === 'register'
                  ? 'Create passkey · mint MSCA'
                  : 'Sign in with passkey'}
            </button>
          </form>

          <dl className="hero-spec">
            <div>
              <dt>Settlement</dt>
              <dd>&lt; 6s</dd>
            </div>
            <div>
              <dt>Tokens</dt>
              <dd>USDC · EURC</dd>
            </div>
            <div>
              <dt>Chain</dt>
              <dd>Arc · 5042002</dd>
            </div>
            <div>
              <dt>Standards</dt>
              <dd>ERC-8183 · ERC-8004</dd>
            </div>
          </dl>
        </section>

        <section className="hero-right">
          <Globe />
          <div className="hero-right-caption">
            <span className="pulse" /> {MARKERS.length} hubs on Arc · idempotent hold ·
            paymaster-sponsored userOps
          </div>
        </section>
      </main>

      <footer className="hero-foot">
        <span>Duffel sandbox · Arc Testnet · Circle Modular Wallets</span>
        <span className="dot-sep">·</span>
        <span>Account lazily deploys on first booking. Gas in USDC.</span>
      </footer>

      <style jsx>{heroStyles}</style>
    </div>
  );
}

/* ─── Public margin/meter strip ────────────────────────────────────── */
/* Always renders. If the edge meter is reachable it shows live numbers;    */
/* otherwise it falls back to seeded demo data so cold visitors still see   */
/* the Arc-vs-Ethereum gas story before touching a passkey.                 */

function MarginStrip() {
  const { summary } = useMeterSummary(2500);

  const live = Boolean(summary && summary.totalEvents > 0);
  const paidCalls = live ? (summary?.paidCalls ?? 0) : 142;
  const totalUsdc = live ? (summary?.totalUsdc ?? '0.00') : '0.91';
  const perCallUsdc = live
    ? (Number(summary?.totalUsdc ?? '0') / Math.max(summary?.paidCalls ?? 1, 1)).toFixed(4)
    : '0.0064';
  const ethereumTotalUsd = live
    ? Math.max(summary?.ethereum.totalUsd ?? 0, 0).toFixed(2)
    : '58.40';
  const marginFactor = live ? Math.max(summary?.ethereum.marginFactor ?? 0, 1) : 64;

  return (
    <div className="hero-margin" aria-label="Nanopayments meter">
      <div className="hero-margin-head">
        <span className="hero-margin-dot" />
        <span>nanopayments · x402 · arc</span>
        <span className="hero-margin-state">{live ? 'live' : 'demo'}</span>
      </div>
      <div className="hero-margin-body">
        <div>
          <dt>Calls settled</dt>
          <dd>{paidCalls}</dd>
        </div>
        <div>
          <dt>USDC paid on Arc</dt>
          <dd>${totalUsdc}</dd>
        </div>
        <div>
          <dt>Per-call cost</dt>
          <dd>${perCallUsdc}</dd>
        </div>
        <div className="hero-margin-delta">
          <dt>Same on Ethereum</dt>
          <dd>
            ${ethereumTotalUsd}
            <span>{marginFactor}× more</span>
          </dd>
        </div>
      </div>
    </div>
  );
}

/* ─── cobe globe ───────────────────────────────────────────────────── */

function Globe() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const phiRef = useRef(0);
  const widthRef = useRef(0);
  const pointerStartRef = useRef<number | null>(null);
  const pointerDeltaRef = useRef(0);

  useEffect(() => {
    if (!canvasRef.current) return;
    const canvas = canvasRef.current;
    const onResize = () => {
      const parent = canvas.parentElement;
      // Fallback ensures we still render during SSR flash / zero-layout.
      widthRef.current = Math.max(parent?.offsetWidth ?? 0, 600);
    };
    window.addEventListener('resize', onResize);
    onResize();

    const globe = createGlobe(canvas, {
      devicePixelRatio: 2,
      width: widthRef.current * 2,
      height: widthRef.current * 2,
      phi: 0,
      theta: 0.28,
      dark: 0,
      diffuse: 2.8,
      mapSamples: 18000,
      mapBrightness: 1.15,
      baseColor: [0.96, 0.97, 0.99],
      markerColor: [0.23, 0.37, 1],
      glowColor: [0.93, 0.95, 1],
      markers: MARKERS,
    });

    canvas.style.opacity = '0';
    let fadeRaf: number | null = requestAnimationFrame(() => {
      canvas.style.opacity = '1';
      fadeRaf = null;
    });

    let animRaf = 0;
    const tick = () => {
      const dragging = pointerStartRef.current !== null;
      if (!dragging) phiRef.current += 0.0022;
      globe.update({
        phi: phiRef.current + pointerDeltaRef.current / 200,
        width: widthRef.current * 2,
        height: widthRef.current * 2,
      });
      animRaf = requestAnimationFrame(tick);
    };
    animRaf = requestAnimationFrame(tick);

    return () => {
      if (fadeRaf != null) cancelAnimationFrame(fadeRaf);
      cancelAnimationFrame(animRaf);
      globe.destroy();
      window.removeEventListener('resize', onResize);
    };
  }, []);

  return (
    <div className="hero-globe-wrap">
      <canvas
        ref={canvasRef}
        className="hero-globe"
        style={{
          width: '100%',
          aspectRatio: '1 / 1',
          maxWidth: 720,
          contain: 'layout paint size',
          cursor: 'grab',
          transition: 'opacity 700ms ease',
          opacity: 0,
        }}
        onPointerDown={e => {
          pointerStartRef.current = e.clientX - pointerDeltaRef.current;
          (e.target as HTMLCanvasElement).style.cursor = 'grabbing';
        }}
        onPointerMove={e => {
          if (pointerStartRef.current === null) return;
          pointerDeltaRef.current = e.clientX - pointerStartRef.current;
        }}
        onPointerUp={e => {
          pointerStartRef.current = null;
          (e.target as HTMLCanvasElement).style.cursor = 'grab';
        }}
        onPointerLeave={e => {
          pointerStartRef.current = null;
          (e.target as HTMLCanvasElement).style.cursor = 'grab';
        }}
      />
    </div>
  );
}

/* ─── styles ───────────────────────────────────────────────────────── */

const heroStyles = `
  .hero-root {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    background:
      radial-gradient(
        1200px 700px at 78% 15%,
        color-mix(in oklab, var(--accent-blue, #3a5fff) 10%, transparent),
        transparent 60%
      ),
      radial-gradient(
        900px 600px at 10% 90%,
        color-mix(in oklab, var(--accent-green, #0cc67a) 8%, transparent),
        transparent 60%
      ),
      var(--bg);
    color: var(--text);
    overflow-x: hidden;
  }

  .hero-splash {
    min-height: 100vh;
    display: grid;
    place-items: center;
    grid-auto-flow: column;
    gap: 10px;
    font-family: var(--font-mono);
    font-size: 11px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--text-dim);
    background: var(--bg);
  }
  .hero-splash .hero-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--ink);
    animation: hero-pulse 1.1s ease-in-out infinite;
  }

  .hero-nav {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 22px clamp(24px, 4vw, 56px);
    font-family: var(--font-mono);
    font-size: 11px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-dim);
  }
  .hero-brand {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .hero-mark {
    width: 12px;
    height: 12px;
    background: var(--ink);
  }
  .hero-word {
    color: var(--ink);
    letter-spacing: 0.14em;
    font-weight: 500;
  }
  .hero-x {
    opacity: 0.35;
    margin: 0 -2px;
  }
  .hero-word-alt {
    color: var(--text);
    opacity: 0.72;
  }
  .hero-meta {
    display: flex;
    align-items: center;
    gap: 14px;
  }
  .hero-pill {
    padding: 3px 8px;
    border: 1px solid var(--border);
    color: var(--text-dim);
  }
  .hero-pill-ink {
    padding: 3px 8px;
    border: 1px solid var(--ink);
    color: var(--ink);
  }
  .hero-ver {
    opacity: 0.45;
  }

  .hero-grid {
    flex: 1;
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: clamp(24px, 4vw, 64px);
    padding: clamp(24px, 4vw, 56px);
    padding-top: 0;
    align-items: center;
    max-width: 1400px;
    width: 100%;
    margin: 0 auto;
  }

  @media (max-width: 1024px) {
    .hero-grid {
      grid-template-columns: 1fr;
    }
    .hero-right {
      order: -1;
    }
  }

  .hero-left {
    display: flex;
    flex-direction: column;
    gap: 20px;
    max-width: 560px;
  }

  .hero-eyebrow {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    padding: 6px 10px;
    border: 1px solid var(--border);
    width: fit-content;
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--text-dim);
  }
  .hero-eyebrow .dot {
    width: 6px;
    height: 6px;
    background: var(--accent-green, #0cc67a);
    border-radius: 50%;
  }

  .hero-title {
    font-family: var(--font-sans);
    font-size: clamp(36px, 5.2vw, 64px);
    line-height: 1.02;
    letter-spacing: -0.035em;
    margin: 0;
    font-weight: 500;
    color: var(--text);
  }
  .hero-title em {
    font-style: italic;
    color: var(--ink);
    font-weight: 500;
  }

  .hero-sub {
    font-family: var(--font-sans);
    font-size: 15px;
    line-height: 1.55;
    color: var(--text-dim);
    margin: 0;
    max-width: 520px;
  }

  .hero-form {
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding: 20px;
    background: var(--bg-elev);
    border: 1.5px solid var(--ink);
    margin-top: 10px;
  }

  .hero-tabs {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0;
    border-bottom: 1px solid var(--border);
  }
  .hero-tab {
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    padding: 10px 4px;
    font-family: var(--font-mono);
    font-size: 11px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--text-dim);
    cursor: pointer;
    transition: color 120ms, border-color 120ms;
  }
  .hero-tab.sel {
    color: var(--ink);
    border-bottom-color: var(--ink);
  }
  .hero-tab:hover:not(.sel) {
    color: var(--text);
  }

  .hero-fields {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .hero-field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-dim);
  }
  .hero-field input {
    padding: 10px 12px;
    border: 1.5px solid var(--border);
    background: var(--bg);
    color: var(--text);
    font-family: var(--font-sans);
    font-size: 14px;
    outline: none;
    transition: border-color 120ms;
  }
  .hero-field input:focus {
    border-color: var(--ink);
  }

  .hero-login-hint {
    font-family: var(--font-sans);
    font-size: 13px;
    color: var(--text-dim);
    margin: 0;
    line-height: 1.5;
  }

  .hero-alert {
    font-family: var(--font-mono);
    font-size: 11px;
    line-height: 1.5;
    color: var(--accent-rose, #e34);
    padding: 8px 10px;
    border-left: 2px solid var(--accent-rose, #e34);
    background: color-mix(in oklab, var(--accent-rose, #e34) 6%, transparent);
  }
  .hero-alert strong {
    font-family: var(--font-sans);
    font-weight: 600;
  }

  .hero-primary {
    padding: 12px 14px;
    background: var(--ink);
    color: var(--bg-elev);
    border: none;
    font-family: var(--font-mono);
    font-size: 11px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    cursor: pointer;
    transition: opacity 120ms, transform 120ms;
  }
  .hero-primary:hover:not(:disabled) {
    transform: translateY(-1px);
  }
  .hero-primary:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .hero-spec {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 0;
    margin-top: 12px;
    border-top: 1px solid var(--border);
    padding-top: 14px;
  }
  .hero-spec > div {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .hero-spec dt {
    font-family: var(--font-mono);
    font-size: 9px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--text-faint);
    margin: 0;
  }
  .hero-spec dd {
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--ink);
    margin: 0;
    letter-spacing: 0.02em;
  }

  .hero-right {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 16px;
    position: relative;
  }
  .hero-globe-wrap {
    width: 100%;
    display: flex;
    justify-content: center;
    position: relative;
  }
  .hero-globe-wrap::before {
    content: '';
    position: absolute;
    inset: -40px;
    background: radial-gradient(
      closest-side,
      color-mix(in oklab, var(--accent-blue, #3a5fff) 10%, transparent),
      transparent
    );
    pointer-events: none;
    z-index: 0;
  }
  .hero-globe {
    position: relative;
    z-index: 1;
  }
  .hero-right-caption {
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--text-dim);
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }
  .hero-right-caption .pulse {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--accent-green, #0cc67a);
    box-shadow: 0 0 0 0 color-mix(in oklab, var(--accent-green, #0cc67a) 40%, transparent);
    animation: hero-pulse 1.8s ease-in-out infinite;
  }

  .hero-foot {
    display: flex;
    justify-content: center;
    gap: 10px;
    padding: 20px;
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-faint);
    border-top: 1px solid var(--border);
  }
  .hero-foot .dot-sep {
    opacity: 0.4;
  }

  @keyframes hero-pulse {
    0%, 100% {
      opacity: 0.4;
      transform: scale(0.9);
    }
    50% {
      opacity: 1;
      transform: scale(1);
    }
  }

  .hero-margin {
    margin-top: 4px;
    border: 1px solid var(--border);
    border-left: 2px solid var(--ink);
    background: var(--bg-elev);
    font-family: var(--font-mono);
  }
  .hero-margin-head {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    font-size: 10px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--text-dim);
    border-bottom: 1px solid var(--border);
    width: 100%;
  }
  .hero-margin-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--accent-green, #0cc67a);
    animation: hero-pulse 1.8s ease-in-out infinite;
  }
  .hero-margin-state {
    margin-left: auto;
    font-size: 9px;
    color: var(--ink);
    border: 1px solid var(--ink);
    padding: 1px 6px;
  }
  .hero-margin-body {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 0;
  }
  .hero-margin-body > div {
    padding: 10px 12px;
    border-right: 1px solid var(--border);
  }
  .hero-margin-body > div:last-child {
    border-right: none;
  }
  .hero-margin-body dt {
    font-size: 9px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--text-faint);
    margin: 0 0 4px 0;
  }
  .hero-margin-body dd {
    font-size: 14px;
    color: var(--ink);
    margin: 0;
    letter-spacing: 0.01em;
  }
  .hero-margin-delta dd {
    display: flex;
    align-items: baseline;
    gap: 8px;
    color: var(--text-dim);
  }
  .hero-margin-delta dd span {
    font-size: 10px;
    color: var(--accent-rose, #e34);
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  @media (max-width: 640px) {
    .hero-margin-body {
      grid-template-columns: repeat(2, 1fr);
    }
    .hero-margin-body > div:nth-child(2) {
      border-right: none;
    }
  }
`;
