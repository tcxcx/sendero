'use client';

/**
 * UnifiedBalanceSection — operator-facing unified Gateway balance.
 *
 * Phase 2 P2.8. Renders the per-tenant unified USDC view sourced from
 * /api/gateway/balance:
 *
 *   grandTotal  — single user-facing number (Gateway + optimistic + ops staging)
 *   perDomain   — one row per enabled chain
 *   pendingCredits — finalizing deposits with per-chain ETAs
 *   opsStaging  — USDC sitting in ops DCWs mid-sweep
 *
 * Lives alongside the existing per-wallet treasury balance in
 * WalletDropdown. Per-wallet view = "what's in my Arc treasury wallet
 * right now." Unified view = "what's in my Gateway balance plus
 * everything in flight." Both useful in different ops contexts.
 *
 * Polls every 30s — Gateway API freshness + the finalization ETA
 * countdowns. SSE-replacement deferred to Phase 5 (Postgres NOTIFY
 * channel for gateway balance changes).
 */

import { useEffect, useState } from 'react';

import { TopographyButton } from '@sendero/ui/button';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@sendero/ui/hover-card';

interface PerDomain {
  domain: number;
  chain: string;
  label: string;
  balance: string;
  depositor: string | null;
  scannerUrl: string | null;
}

interface PendingCredit {
  chain: string;
  domain: number;
  amount: string;
  depositTxHash: string | null;
  scannerUrl: string | null;
  confirmedAt: string | null;
  estimatedAvailableAt: string;
  remainingSeconds: number;
  status: 'finalizing' | 'should_be_available';
}

interface OpsStagingEntry {
  chain: string;
  walletAddress: string;
  usdc: string;
  updatedAt: string | null;
  scannerUrl: string | null;
}

interface UnifiedBalanceResponse {
  grandTotal: string;
  available: string;
  pendingCreditTotal: string;
  opsStagingTotal: string;
  perDomain: PerDomain[];
  pendingCredits: PendingCredit[];
  opsStaging: OpsStagingEntry[];
  depositor: string;
  enabledDomains: number[];
}

interface UnifiedBalanceErrorResponse {
  error: string;
  message?: string;
}

const POLL_INTERVAL_MS = 30_000;

export function UnifiedBalanceSection({ chrome = 'section' }: { chrome?: 'section' | 'inline' }) {
  const [data, setData] = useState<UnifiedBalanceResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch('/api/gateway/balance', { cache: 'no-store' });
        if (cancelled) return;
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as UnifiedBalanceErrorResponse | null;
          setError(body?.message ?? body?.error ?? `HTTP ${res.status}`);
          setData(null);
          return;
        }
        const json = (await res.json()) as UnifiedBalanceResponse;
        if (cancelled) return;
        setData(json);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      }
    };
    void load();
    const id = setInterval(load, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  // Hide the section when Gateway isn't configured for this tenant.
  // The provisioning cron / login backfill will catch up; we don't
  // surface "503 not configured" to the operator as a noisy error.
  if (error && /not_configured|gateway_not_configured/.test(error)) {
    return null;
  }

  const Wrapper = chrome === 'inline' ? InlineWrapper : SectionWrapper;
  const inline = chrome === 'inline';

  return (
    <Wrapper>
      <div
        className={
          inline
            ? 'flex flex-col items-center justify-center gap-2 text-center'
            : 'flex items-center justify-between'
        }
      >
        <div className={inline ? 'flex flex-col items-center' : undefined}>
          <div className="text-xs uppercase tracking-wider text-zinc-500">Unified balance</div>
          <div
            className={
              inline
                ? 'mt-1 font-mono text-3xl font-semibold text-[color:var(--ink)] tabular-nums'
                : 'mt-0.5 font-mono text-lg tabular-nums'
            }
          >
            {data ? `$${formatGrandTotal(data.grandTotal)}` : '—'}
          </div>
        </div>
        <HoverCard openDelay={120} closeDelay={80}>
          <HoverCardTrigger asChild>
            <TopographyButton
              type="button"
              size="sm"
              className="mx-auto h-8 px-3 text-xs text-[color:var(--ink)]"
            >
              Breakdown
            </TopographyButton>
          </HoverCardTrigger>
          <HoverCardContent
            side="bottom"
            align="end"
            sideOffset={10}
            collisionPadding={16}
            data-variant="ink"
            className="z-[100] w-80 max-w-[calc(100vw-24px)] p-4 text-xs"
          >
            {data ? (
              <BreakdownContent data={data} />
            ) : (
              <div className="font-mono text-[11px] uppercase tracking-[0.12em] opacity-80">
                Loading balance
              </div>
            )}
          </HoverCardContent>
        </HoverCard>
      </div>

      {error && !/not_configured/.test(error) && (
        <div className="mt-2 text-xs text-amber-700">Gateway API: {error}</div>
      )}
    </Wrapper>
  );
}

function SectionWrapper({ children }: { children: React.ReactNode }) {
  return <div className="border-t border-zinc-200/60 px-4 py-3">{children}</div>;
}

function InlineWrapper({ children }: { children: React.ReactNode }) {
  return <div className="w-full">{children}</div>;
}

function BreakdownContent({ data }: { data: UnifiedBalanceResponse }) {
  return (
    <div className="space-y-3">
      <div>
        <div className="font-mono text-[10px] uppercase tracking-[0.12em] opacity-70">
          Unified balance
        </div>
        <div className="mt-0.5 text-sm font-medium">Gateway balance breakdown</div>
      </div>

      <div className="space-y-1.5">
        <BreakdownRow label="Available" value={`$${formatGrandTotal(data.available)}`} />
        <BreakdownRow
          label="Finalizing"
          value={`$${formatGrandTotal(data.pendingCreditTotal)}`}
          muted={data.pendingCreditTotal === '0.000000'}
        />
        <BreakdownRow
          label="Ops staging"
          value={`$${formatGrandTotal(data.opsStagingTotal)}`}
          muted={data.opsStagingTotal === '0.000000'}
        />
      </div>

      {data.perDomain.length > 0 && (
        <div className="border-t border-white/20 pt-2">
          <div className="opacity-70">Per chain</div>
          <ul className="mt-1 space-y-1">
            {data.perDomain.map(d => (
              <li
                key={d.domain}
                className="grid grid-cols-[minmax(0,1fr)_74px_72px] items-center gap-2"
              >
                <span className="min-w-0 truncate">{d.label}</span>
                <span className="flex justify-center">
                  {d.scannerUrl && (
                    <ScannerLink href={d.scannerUrl} label={`${d.label} Gateway depositor`} />
                  )}
                </span>
                <span className="text-right font-mono tabular-nums">
                  ${formatGrandTotal(d.balance)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {data.pendingCredits.length > 0 && (
        <div className="border-t border-white/20 pt-2">
          <div className="opacity-70">Pending credits</div>
          <ul className="mt-1 space-y-1">
            {data.pendingCredits.map(c => (
              <li
                key={`${c.depositTxHash ?? c.confirmedAt}-${c.domain}`}
                className="flex justify-between gap-3"
              >
                <span className="min-w-0 truncate">
                  {c.chain} ·{' '}
                  {c.status === 'finalizing'
                    ? `${formatRemaining(c.remainingSeconds)}`
                    : 'arriving'}
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  {c.scannerUrl && <ScannerLink href={c.scannerUrl} label={`${c.chain} tx`} />}
                  <span className="font-mono tabular-nums">${formatMicroUsdc(c.amount)}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {data.opsStaging.length > 0 && data.opsStaging.some(s => s.usdc !== '0') && (
        <div className="border-t border-white/20 pt-2">
          <div className="opacity-70">In sweep</div>
          <ul className="mt-1 space-y-1">
            {data.opsStaging
              .filter(s => s.usdc !== '0')
              .map(s => (
                <li key={s.walletAddress} className="flex items-center justify-between gap-3">
                  <span className="min-w-0 truncate">{s.chain}</span>
                  <span className="flex shrink-0 items-center gap-2">
                    {s.scannerUrl && (
                      <ScannerLink href={s.scannerUrl} label={`${s.chain} ops wallet`} />
                    )}
                    <span className="font-mono tabular-nums">${formatMicroUsdc(s.usdc)}</span>
                  </span>
                </li>
              ))}
          </ul>
        </div>
      )}

      <div className="border-t border-white/20 pt-2 font-mono text-[10px] opacity-75">
        Depositor: {shortAddr(data.depositor)}
      </div>
    </div>
  );
}

function ScannerLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      aria-label={`open ${label} scanner`}
      className="rounded border border-white/25 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.12em] text-white/90 no-underline transition hover:border-white/70 hover:bg-white/10 hover:text-white"
    >
      Scan ↗
    </a>
  );
}

function BreakdownRow({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className={`flex justify-between gap-3 ${muted ? 'opacity-55' : ''}`}>
      <span>{label}</span>
      <span className="shrink-0 font-mono tabular-nums">{value}</span>
    </div>
  );
}

/** Format a 6-decimal USDC string like '12.345600' as '12.35'. */
function formatGrandTotal(s: string): string {
  const n = Number(s);
  if (!Number.isFinite(n)) return s;
  return n.toFixed(2);
}

/** Format a micro-USDC bigint string ('1500000') as '1.50'. */
function formatMicroUsdc(s: string): string {
  try {
    const micro = BigInt(s);
    const whole = micro / 1_000_000n;
    const frac = (micro % 1_000_000n) / 10_000n; // two decimal places
    return `${whole}.${frac.toString().padStart(2, '0')}`;
  } catch {
    return s;
  }
}

/** Render seconds as '5m' / '1h 12m' / '<1m'. */
function formatRemaining(seconds: number): string {
  if (seconds <= 0) return 'arriving';
  if (seconds < 60) return `<1m`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function shortAddr(a: string): string {
  if (!a) return '';
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}
