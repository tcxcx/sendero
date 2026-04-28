'use client';

/**
 * WalletDropdown — identity trigger + balance card dropdown.
 *
 * Panel design: centered token icon, big balance, four circular actions
 * (Deposit · Send · Swap · Bridge). Token selector toggles between USDC
 * and EURC. Each action button opens a nuqs-driven dialog (state lives
 * in the URL, so deep-links and hotkeys work).
 */

import { useEffect, useRef, useState } from 'react';
import { formatUnits } from 'viem';
import { useQueryState } from 'nuqs';
import { useClerk, useUser } from '@clerk/nextjs';
import { useSendero } from './store';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';
import { useIsMac } from './hooks/use-is-mac';
import { logout } from '@sendero/circle/modular-wallets';

const ARCSCAN = 'https://testnet.arcscan.app';

type Token = 'USDC' | 'EURC';

export function WalletDropdown() {
  const isMac = useIsMac();
  const userAuth = useSendero(s => s.userAuth);
  const setUserAuth = useSendero(s => s.setUserAuth);
  const { user: clerkUser } = useUser();
  const { openUserProfile } = useClerk();

  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [selected, setSelected] = useState<Token>('USDC');
  const [usdc, setUsdc] = useState<bigint | null>(null);
  const [eurc, setEurc] = useState<bigint | null>(null);

  const wrapRef = useRef<HTMLDivElement | null>(null);

  // Dialog query state (nuqs). These open on button click; the dialog
  // components themselves read the same keys to render/hide.
  const [, setSend] = useQueryState('send');
  const [, setSwap] = useQueryState('swap');
  const [, setBridge] = useQueryState('bridge');
  const [, setDeposit] = useQueryState('deposit');

  // Zero-address means `organization.publicMetadata.arcWalletAddress`
  // hasn't been stamped yet (Clerk webhook pending or Circle provision
  // failed). The trigger renders a "provisioning" state below; we skip
  // balance fetching entirely to avoid 404s.
  const isZeroAddress = !!userAuth && /^0x0+$/i.test(userAuth.address);

  // Balance authority is the Circle webhook → CircleWallet cached
  // columns. One-shot GET primes the panel, then SSE keeps it live.
  // No viem polling — the browser never reads RPC directly.
  useEffect(() => {
    if (!userAuth || isZeroAddress) return;
    const address = userAuth.address.toLowerCase();
    const encoded = encodeURIComponent(address);

    let cancelled = false;
    fetch(`/api/wallet/balance?address=${encoded}`, { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null))
      .then(json => {
        if (cancelled || !json) return;
        setUsdc(BigInt(json.usdc ?? '0'));
        setEurc(BigInt(json.eurc ?? '0'));
      })
      .catch(() => {
        /* stream will deliver first value anyway */
      });

    const es = new EventSource(`/api/wallet/balance/stream?address=${encoded}`);
    const onBalance = (ev: MessageEvent) => {
      try {
        const { usdc, eurc } = JSON.parse(ev.data) as { usdc: string; eurc: string };
        setUsdc(BigInt(usdc));
        setEurc(BigInt(eurc));
      } catch {
        /* malformed event */
      }
    };
    const onBye = () => es.close();
    es.addEventListener('balance', onBalance);
    es.addEventListener('bye', onBye);

    return () => {
      cancelled = true;
      es.removeEventListener('balance', onBalance);
      es.removeEventListener('bye', onBye);
      es.close();
    };
  }, [userAuth]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const short = userAuth ? `${userAuth.address.slice(0, 6)}…${userAuth.address.slice(-4)}` : '';
  const initials = userAuth
    ? userAuth.displayName
        .split(/\s+/)
        .map(w => w[0])
        .filter(Boolean)
        .slice(0, 2)
        .join('')
        .toUpperCase() || userAuth.address.slice(2, 4).toUpperCase()
    : '';

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(userAuth.address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1100);
    } catch {
      /* older browsers */
    }
  };

  const signOut = () => {
    logout();
    setUserAuth(null);
    setOpen(false);
  };

  const fmt = (v: bigint | null) =>
    v === null
      ? '—'
      : Number(formatUnits(v, 6)).toLocaleString('en-US', {
          minimumFractionDigits: selected === 'USDC' ? 0 : 2,
          maximumFractionDigits: 2,
        });

  const selectedBalance = selected === 'USDC' ? usdc : eurc;

  const openAction = (which: 'deposit' | 'send' | 'swap' | 'bridge') => {
    setOpen(false);
    if (which === 'deposit') setDeposit('open');
    if (which === 'send') setSend('open');
    if (which === 'swap') setSwap('open');
    if (which === 'bridge') setBridge('open');
  };

  return (
    <div className="wd-wrap" ref={wrapRef}>
      {!userAuth ? (
        <div className="wd-trigger wd-skeleton" aria-busy="true">
          <span className="wd-avatar wd-skel-avatar" />
          <span className="wd-trigger-body">
            <span className="wd-skel-line" style={{ width: 92 }} />
            <span className="wd-skel-line" style={{ width: 64 }} />
          </span>
        </div>
      ) : (
        <button
          type="button"
          className={`sd-corner-hover wd-trigger ${open ? 'open' : ''}`}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen(v => !v)}
        >
          {clerkUser?.imageUrl ? (
            <img className="wd-avatar wd-avatar-img" src={clerkUser.imageUrl} alt="" />
          ) : (
            <span className="wd-avatar">{initials}</span>
          )}
          <span className="wd-trigger-body">
            <span className="wd-name">{userAuth.displayName}</span>
            <span className="wd-addr">{isZeroAddress ? 'provisioning wallet…' : short}</span>
          </span>
          <span className={`wd-chev ${open ? 'open' : ''}`} aria-hidden="true">
            ▾
          </span>
        </button>
      )}

      {userAuth && open && (
        <div className="wd-panel" role="menu">
          {/* Identity strip */}
          <div className="wd-id">
            {clerkUser?.imageUrl ? (
              <img className="wd-avatar lg wd-avatar-img" src={clerkUser.imageUrl} alt="" />
            ) : (
              <span className="wd-avatar lg">{initials}</span>
            )}
            <div className="wd-id-body">
              <span className="wd-id-name">{userAuth.displayName}</span>
              <span className="wd-id-role">
                {isZeroAddress
                  ? 'Provisioning Arc wallet…'
                  : `Passkey · ${userAuth.email || 'no email'}`}
              </span>
            </div>
          </div>

          {isZeroAddress && (
            <div
              style={{
                padding: '12px 14px',
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
                color: 'var(--text-dim)',
                lineHeight: 1.6,
                borderTop: '1px solid var(--border)',
              }}
            >
              Your Arc wallet is still being provisioned. This normally completes within a few
              seconds of org creation. Balances will load automatically once the Circle webhook
              lands.
            </div>
          )}

          {/* Token switcher */}
          <div className="wd-tabs">
            {(['USDC', 'EURC'] as Token[]).map(t => (
              <button
                key={t}
                type="button"
                className={`wd-tab ${selected === t ? 'sel' : ''}`}
                onClick={() => setSelected(t)}
              >
                <span className={`wd-tab-dot wd-${t.toLowerCase()}`} />
                {t}
              </button>
            ))}
          </div>

          {/* Balance card — the screenshot shape */}
          <div className="wd-balance-card">
            <div className={`wd-coin wd-coin-${selected.toLowerCase()}`}>
              <svg viewBox="0 0 64 64" aria-hidden="true">
                <circle cx="32" cy="32" r="28" fill="currentColor" />
                <circle cx="32" cy="32" r="22" fill="none" stroke="#fff" strokeWidth="3" />
                <text
                  x="32"
                  y="40"
                  textAnchor="middle"
                  fontSize="22"
                  fontWeight="700"
                  fill="#fff"
                  fontFamily="var(--font-sans)"
                >
                  {selected === 'USDC' ? '$' : '€'}
                </text>
              </svg>
            </div>
            <div className="wd-amount">
              {fmt(selectedBalance)} <span className="wd-amount-unit">{selected}</span>
            </div>

            <div className="wd-actions">
              <ActionCircle
                icon={<Icon name="deposit" />}
                label="Deposit"
                hint={isMac ? '⌘⇧D' : 'Ctrl+Shift+D'}
                onClick={() => openAction('deposit')}
              />
              <ActionCircle
                icon={<Icon name="send" />}
                label="Send"
                hint={isMac ? '⌘⇧S' : 'Ctrl+Shift+S'}
                onClick={() => openAction('send')}
              />
              <ActionCircle
                icon={<Icon name="swap" />}
                label="Swap"
                hint={isMac ? '⌘⇧W' : 'Ctrl+Shift+W'}
                onClick={() => openAction('swap')}
              />
              <ActionCircle
                icon={<Icon name="bridge" />}
                label="Bridge"
                hint={isMac ? '⌘⇧R' : 'Ctrl+Shift+R'}
                onClick={() => openAction('bridge')}
              />
            </div>
          </div>

          {/* Meta footer */}
          <div className="wd-meta">
            <Tooltip>
              <TooltipTrigger asChild>
                <a
                  className="wd-meta-link"
                  href={`${ARCSCAN}/address/${userAuth.address}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  View on Arcscan ↗
                </a>
              </TooltipTrigger>
              <TooltipContent side="top" className="font-mono text-[10px] tracking-wider">
                opens Arc block explorer in a new tab
              </TooltipContent>
            </Tooltip>
            <span className="wd-meta-sep">·</span>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="wd-meta-refresh"
                  onClick={async () => {
                    if (!userAuth) return;
                    const r = await fetch(
                      `/api/wallet/balance?address=${encodeURIComponent(
                        userAuth.address.toLowerCase()
                      )}`,
                      { cache: 'no-store' }
                    );
                    if (!r.ok) return;
                    const json = (await r.json()) as { usdc?: string; eurc?: string };
                    if (json.usdc) setUsdc(BigInt(json.usdc));
                    if (json.eurc) setEurc(BigInt(json.eurc));
                  }}
                  aria-label="refresh balance"
                >
                  ↻ refresh
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" className="font-mono text-[10px] tracking-wider">
                re-read cached balance (Circle webhook pushes updates live)
              </TooltipContent>
            </Tooltip>
            <span className="wd-meta-sep">·</span>
            <span className="wd-meta-ver">v0.9.4-alpha</span>
          </div>

          <button
            type="button"
            className="wd-action"
            onClick={copy}
            aria-label={`copy address ${userAuth.address}`}
          >
            {copied ? 'Copied' : short}
          </button>
          <button
            type="button"
            className="wd-action"
            onClick={() => {
              setOpen(false);
              openUserProfile();
            }}
          >
            Manage account
          </button>
          <button type="button" className="wd-action wd-action-danger" onClick={signOut}>
            Sign out
          </button>
        </div>
      )}

      <style jsx>{`
        .wd-wrap {
          position: relative;
          display: inline-block;
        }
        .wd-trigger {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          /* Header baseline — all right-side chips lock to 28px. */
          height: 28px;
          padding: 0 8px 0 4px;
          border: 1px solid var(--border);
          background: var(--bg-elev);
          color: var(--text);
          cursor: pointer;
          font-family: var(--font-sans);
          transition: border-color 120ms;
          max-width: 220px;
        }
        .wd-trigger:hover,
        .wd-trigger.open {
          border-color: var(--ink);
        }
        .wd-trigger-body {
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          gap: 0;
          line-height: 1;
          min-width: 0;
        }
        .wd-name {
          font-size: 10px;
          font-weight: 500;
          letter-spacing: -0.005em;
          color: var(--text);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          max-width: 120px;
          line-height: 1.1;
        }
        .wd-addr {
          font-family: var(--font-mono);
          font-size: 8px;
          color: var(--ink);
          letter-spacing: 0.02em;
          line-height: 1.1;
        }
        .wd-avatar {
          width: 18px;
          height: 18px;
          background: var(--ink);
          color: var(--bg-elev);
          font-family: var(--font-mono);
          font-size: 9px;
          display: grid;
          place-items: center;
          flex-shrink: 0;
        }
        .wd-avatar.lg {
          width: 36px;
          height: 36px;
          font-size: 13px;
        }
        .wd-avatar-img {
          object-fit: cover;
          border-radius: 50%;
        }
        .wd-skeleton {
          cursor: default;
          border-color: var(--border);
        }
        .wd-skel-avatar {
          background: color-mix(in oklab, var(--ink) 22%, var(--border));
          animation: wd-pulse 1.4s ease-in-out infinite;
        }
        .wd-skel-line {
          display: inline-block;
          height: 8px;
          background: var(--border);
          border-radius: 2px;
          animation: wd-pulse 1.4s ease-in-out infinite;
        }
        @keyframes wd-pulse {
          0%, 100% { opacity: 0.5; }
          50%      { opacity: 0.85; }
        }
        .wd-chev {
          font-family: var(--font-mono);
          font-size: 10px;
          color: var(--ink);
          transition: transform 160ms ease;
          margin-left: 2px;
        }
        .wd-chev.open {
          transform: rotate(-180deg);
        }

        .wd-panel {
          position: absolute;
          top: calc(100% + 10px);
          right: 0;
          z-index: 60;
          width: 340px;
          background: var(--bg-elev);
          border: 1.5px solid var(--ink);
          box-shadow: 0 14px 32px -14px rgba(0, 0, 0, 0.24);
          display: flex;
          flex-direction: column;
          animation: wd-in 160ms ease-out;
        }
        @keyframes wd-in {
          from { transform: translateY(-6px); opacity: 0; }
          to   { transform: translateY(0);    opacity: 1; }
        }

        .wd-id {
          display: flex;
          gap: 10px;
          padding: 12px 14px;
          border-bottom: 1px solid var(--border);
          align-items: center;
        }
        .wd-id-body {
          display: flex;
          flex-direction: column;
          gap: 2px;
          min-width: 0;
          flex: 1;
        }
        .wd-id-name {
          font-family: var(--font-sans);
          font-size: 14px;
          font-weight: 500;
          letter-spacing: -0.005em;
          color: var(--text);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .wd-id-role {
          font-family: var(--font-mono);
          font-size: 10px;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          color: var(--text-dim);
        }
        .wd-chip {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          font-family: var(--font-mono);
          font-size: 10px;
          letter-spacing: 0.04em;
          color: var(--ink);
          background: var(--bg);
          border: 1px solid var(--border);
          padding: 4px 8px;
          cursor: pointer;
          transition:
            border-color 120ms,
            color 120ms,
            background 120ms;
        }
        .wd-chip:hover {
          border-color: var(--ink);
          color: var(--text);
        }
        .wd-chip-icon {
          display: inline-flex;
          align-items: center;
          color: var(--text-dim);
          transition: color 120ms;
        }
        .wd-chip:hover .wd-chip-icon {
          color: var(--ink);
        }
        .wd-chip-label {
          display: inline-block;
        }

        .wd-tabs {
          display: grid;
          grid-template-columns: 1fr 1fr;
          border-bottom: 1px solid var(--border);
        }
        .wd-tab {
          background: none;
          border: none;
          border-bottom: 2px solid transparent;
          padding: 10px;
          font-family: var(--font-mono);
          font-size: 11px;
          letter-spacing: 0.1em;
          color: var(--text-dim);
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          transition: all 120ms;
        }
        .wd-tab + .wd-tab {
          border-left: 1px solid var(--border);
        }
        .wd-tab.sel {
          color: var(--ink);
          border-bottom-color: var(--ink);
        }
        .wd-tab-dot {
          width: 7px;
          height: 7px;
          border-radius: 50%;
          background: var(--text-faint);
        }
        .wd-tab.sel .wd-usdc {
          background: #2775ca;
        }
        .wd-tab.sel .wd-eurc {
          background: #0ea5e9;
        }

        .wd-balance-card {
          padding: 24px 16px 18px;
          border: 1px solid var(--border);
          margin: 14px;
          border-radius: 14px;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 14px;
          background: linear-gradient(
            180deg,
            color-mix(in oklab, var(--bg-elev) 100%, transparent) 0%,
            color-mix(in oklab, var(--bg-panel, #f6f7f9) 100%, transparent) 100%
          );
        }
        .wd-coin {
          width: 64px;
          height: 64px;
          color: #2775ca;
        }
        .wd-coin-eurc {
          color: #0ea5e9;
        }
        .wd-coin svg {
          width: 100%;
          height: 100%;
        }
        .wd-amount {
          font-family: var(--font-sans);
          font-size: 28px;
          font-weight: 600;
          letter-spacing: -0.02em;
          color: var(--text);
          text-align: center;
          line-height: 1;
        }
        .wd-amount-unit {
          font-family: var(--font-mono);
          font-size: 18px;
          font-weight: 500;
          letter-spacing: 0.02em;
          color: var(--text-dim);
          margin-left: 2px;
        }
        .wd-actions {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 10px;
          width: 100%;
          padding-top: 4px;
        }

        .wd-meta {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          padding: 8px 14px 12px;
          font-family: var(--font-mono);
          font-size: 10px;
          letter-spacing: 0.06em;
          color: var(--text-dim);
          flex-wrap: wrap;
        }
        .wd-meta-link {
          color: var(--ink);
          text-decoration: none;
        }
        .wd-meta-link:hover {
          text-decoration: underline;
        }
        .wd-meta-sep {
          opacity: 0.4;
        }
        .wd-meta-refresh {
          background: none;
          border: none;
          color: var(--text-dim);
          cursor: pointer;
          font-family: var(--font-mono);
          font-size: 10px;
          padding: 0;
          letter-spacing: 0.06em;
        }
        .wd-meta-refresh:hover {
          color: var(--ink);
        }
        .wd-meta-ver {
          color: var(--text-faint);
        }

        .wd-action {
          display: block;
          width: 100%;
          padding: 12px 14px;
          margin: 0;
          background: none;
          border: none;
          border-top: 1px solid var(--border);
          color: var(--text);
          font-family: var(--font-mono);
          font-size: 11px;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          text-align: center;
          cursor: pointer;
          text-decoration: none;
          transition: background 120ms, color 120ms;
        }
        .wd-action:hover {
          background: color-mix(in oklab, var(--ink) 6%, transparent);
          color: var(--ink);
        }
        .wd-action.wd-action-danger {
          color: var(--accent-rose, #e34);
        }
        .wd-action.wd-action-danger:hover {
          background: color-mix(in oklab, var(--accent-rose, #e34) 6%, transparent);
          color: var(--accent-rose, #e34);
        }
      `}</style>
    </div>
  );
}

function ActionCircle({
  icon,
  label,
  hint,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  hint?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="ac-btn"
      onClick={onClick}
      title={hint ? `${label} · ${hint}` : label}
      aria-label={hint ? `${label} (${hint})` : label}
    >
      <span className="ac-circle">{icon}</span>
      <span className="ac-label">{label}</span>
      <style jsx>{`
        .ac-btn {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 6px;
          background: none;
          border: none;
          cursor: pointer;
          padding: 4px 0;
          color: var(--text-dim);
        }
        .ac-btn:hover {
          color: var(--ink);
        }
        .ac-circle {
          width: 40px;
          height: 40px;
          border-radius: 50%;
          background: color-mix(in oklab, var(--text-dim) 20%, var(--bg));
          color: #fff;
          display: grid;
          place-items: center;
          transition: background 120ms, transform 120ms;
        }
        .ac-btn:hover .ac-circle {
          background: var(--ink);
          transform: translateY(-1px);
        }
        .ac-label {
          font-family: var(--font-mono);
          font-size: 9px;
          letter-spacing: 0.12em;
          text-transform: uppercase;
        }
      `}</style>
    </button>
  );
}

function Icon({ name }: { name: 'deposit' | 'send' | 'swap' | 'bridge' }) {
  const style: React.CSSProperties = {
    width: 18,
    height: 18,
    stroke: 'currentColor',
    fill: 'none',
    strokeWidth: 2,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
  };
  switch (name) {
    case 'deposit':
      return (
        <svg viewBox="0 0 24 24" style={style}>
          <path d="M12 4v12" />
          <path d="M6 10l6 6 6-6" />
          <path d="M4 20h16" />
        </svg>
      );
    case 'send':
      return (
        <svg viewBox="0 0 24 24" style={style}>
          <path d="M22 2L11 13" />
          <path d="M22 2l-7 20-4-9-9-4 20-7z" />
        </svg>
      );
    case 'swap':
      return (
        <svg viewBox="0 0 24 24" style={style}>
          <path d="M7 4v16" />
          <path d="M4 7l3-3 3 3" />
          <path d="M17 20V4" />
          <path d="M20 17l-3 3-3-3" />
        </svg>
      );
    case 'bridge':
      return (
        <svg viewBox="0 0 24 24" style={style}>
          <path d="M3 12c0-3 2-5 4-5s4 2 4 5" />
          <path d="M13 12c0-3 2-5 4-5s4 2 4 5" />
          <path d="M3 12h18" />
          <path d="M6 16v4" />
          <path d="M18 16v4" />
        </svg>
      );
  }
}
