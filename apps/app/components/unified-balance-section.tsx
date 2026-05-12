'use client';

/**
 * UnifiedBalanceSection — operator-facing business balance.
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
 * right now." Business balance = "ticket-sale profit, deposits, and
 * spendable Gateway funds, plus everything in flight."
 *
 * Polls every 30s — Gateway API freshness + the finalization ETA
 * countdowns. SSE-replacement deferred to Phase 5 (Postgres NOTIFY
 * channel for gateway balance changes).
 */

import { useEffect, useRef, useState } from 'react';

import { BlockchainIcon } from '@sendero/icons';
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
  spendableTotal?: string;
  available: string;
  spendableAvailable?: string;
  unsupportedSourceTotal?: string;
  pendingCreditTotal: string;
  spendablePendingCreditTotal?: string;
  opsStagingTotal: string;
  spendableOpsStagingTotal?: string;
  perDomain: PerDomain[];
  pendingCredits: PendingCredit[];
  opsStaging: OpsStagingEntry[];
  depositor: string;
  enabledDomains: number[];
  appKit: {
    token: string;
    totalConfirmedBalance: string;
    totalPendingBalance: string;
    breakdown: Array<{
      depositor: string;
      totalConfirmed: string;
      totalPending?: string;
      breakdown: Array<{
        chain: string;
        confirmedBalance: string;
        pendingBalance?: string;
      }>;
    }>;
  } | null;
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

    // Phase 4.5 — SSE pulse from /api/gateway/balance/stream lets the
    // dashboard react within ~50ms of a deposit/spend instead of
    // waiting for the next 30s poll tick. The stream itself carries
    // no balance payload (Gateway pool isn't cached in a column); on
    // any `refresh` event we re-fetch /api/gateway/balance — same
    // pattern operator inbox uses for trip_events.
    const es =
      typeof window !== 'undefined' && typeof EventSource !== 'undefined'
        ? new EventSource('/api/gateway/balance/stream', { withCredentials: true })
        : null;
    if (es) {
      es.addEventListener('refresh', () => {
        if (!cancelled) void load();
      });
      // hello / ping / bye are heartbeats — no handler needed.
    }

    return () => {
      cancelled = true;
      clearInterval(id);
      if (es) es.close();
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
            className="z-[100] w-[336px] max-w-[calc(100vw-24px)] p-0 text-xs shadow-[0_18px_48px_-28px_rgba(31,42,68,0.45)]"
          >
            {data ? (
              <BreakdownContent data={data} />
            ) : (
              <div className="font-mono text-[11px] uppercase tracking-[0.12em] opacity-80">
                Loading unified balance
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
  const spendableAvailable = data.spendableAvailable ?? data.available;
  const spendableTotal = data.spendableTotal ?? data.grandTotal;
  const unsupportedSourceTotal = data.unsupportedSourceTotal ?? '0.000000';
  const hasUnsupportedSource = unsupportedSourceTotal !== '0.000000';
  const fundedGatewayRoutes = data.perDomain.filter(d => !isZeroAmount(d.balance));
  const appKitRows =
    data.appKit?.breakdown.flatMap(account =>
      account.breakdown.map(row => ({
        depositor: account.depositor,
        chain: row.chain,
        confirmedBalance: row.confirmedBalance,
        pendingBalance: row.pendingBalance ?? '0.000000',
        scannerUrl: explorerUrlForAddress(row.chain, account.depositor),
      }))
    ) ?? [];
  const fundedAppKitRows = appKitRows
    .filter(row => !isZeroAmount(row.confirmedBalance) || !isZeroAmount(row.pendingBalance))
    .sort((a, b) => Number(b.confirmedBalance) - Number(a.confirmedBalance));
  const activeRouteCount = fundedGatewayRoutes.length || fundedAppKitRows.length;
  const connectedRouteCount = data.perDomain.length || appKitRows.length;
  const emptyRouteCount = Math.max(connectedRouteCount - activeRouteCount, 0);
  const inFlightTotal = Number(data.pendingCreditTotal || 0) + Number(data.opsStagingTotal || 0);

  return (
    <div className="overflow-hidden rounded-md">
      <div className="border-b border-[color:var(--hairline-color)] px-4 py-3">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-black/65">
              Unified balance
            </div>
            <div className="mt-1 flex items-end gap-2">
              <span className="text-[28px] leading-none font-semibold tracking-[-0.02em] tabular-nums text-black">
                ${formatGrandTotal(data.grandTotal)}
              </span>
              <span className="pb-0.5 text-[10px] font-semibold uppercase tracking-[0.13em] text-black/55">
                USDC
              </span>
            </div>
          </div>
          <div className="rounded-[5px] border border-black/10 bg-black/[0.035] px-2.5 py-1.5 text-right text-black">
            <div className="text-[9px] uppercase tracking-[0.13em] text-black/55">Routes</div>
            <div className="mt-0.5 font-mono text-[12px] tabular-nums">
              {activeRouteCount}/{connectedRouteCount || 0}
            </div>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <BalanceStat label="Spendable" value={`$${formatGrandTotal(spendableAvailable)}`} />
          <BalanceStat label="In flight" value={`$${formatGrandTotal(String(inFlightTotal))}`} />
        </div>
      </div>

      <div className="px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-black/65">
            Live route
          </div>
          {emptyRouteCount > 0 && (
            <div className="text-[10px] text-black/55">{emptyRouteCount} quiet</div>
          )}
        </div>

        <div className="mt-2 space-y-1.5">
          {fundedGatewayRoutes.length > 0 ? (
            fundedGatewayRoutes.map(route => (
              <ChainBalanceRow
                key={route.domain}
                chain={route.chain}
                label={route.label}
                amount={route.balance}
                scannerUrl={route.scannerUrl}
              />
            ))
          ) : fundedAppKitRows.length > 0 ? (
            fundedAppKitRows.map(row => (
              <ChainBalanceRow
                key={`${row.depositor}-${row.chain}`}
                chain={row.chain}
                label={prettyChainName(row.chain)}
                amount={row.confirmedBalance}
                pending={row.pendingBalance}
                scannerUrl={row.scannerUrl}
              />
            ))
          ) : (
            <div className="rounded-[6px] border border-black/10 bg-[color:color-mix(in_oklab,var(--bg-elev)_90%,white)] px-3 py-2 text-black/70">
              No funded Gateway routes yet.
            </div>
          )}
        </div>
      </div>

      {data.pendingCredits.length > 0 && (
        <div className="border-t border-[color:var(--hairline-color)] px-4 py-3">
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-black/65">
            Finalizing deposits
          </div>
          <ul className="mt-2 space-y-1.5">
            {data.pendingCredits.map(c => (
              <li
                key={`${c.depositTxHash ?? c.confirmedAt}-${c.domain}`}
                className="flex items-center justify-between gap-3"
              >
                <span className="min-w-0 truncate text-black/70">
                  <ChainLabel chain={c.chain} label={prettyChainName(c.chain)} /> ·{' '}
                  {c.status === 'finalizing' ? formatRemaining(c.remainingSeconds) : 'arriving'}
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
        <div className="border-t border-[color:var(--hairline-color)] px-4 py-3">
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-black/65">
            In sweep
          </div>
          <ul className="mt-2 space-y-1.5">
            {data.opsStaging
              .filter(s => s.usdc !== '0')
              .map(s => (
                <li key={s.walletAddress} className="flex items-center justify-between gap-3">
                  <span className="min-w-0 truncate text-black/70">
                    <ChainLabel chain={s.chain} label={prettyChainName(s.chain)} />
                  </span>
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

      {(hasUnsupportedSource || data.grandTotal !== spendableTotal || data.appKit) && (
        <div className="border-t border-[color:var(--hairline-color)] px-4 py-2.5">
          <div className="space-y-1">
            {hasUnsupportedSource && (
              <BreakdownRow
                label="Unsupported source"
                value={`$${formatGrandTotal(unsupportedSourceTotal)}`}
              />
            )}
            <BreakdownRow
              label="Total tracked"
              value={`$${formatGrandTotal(data.grandTotal)}`}
              muted={data.grandTotal === spendableTotal}
            />
          </div>
          <div className="mt-1 flex items-center justify-between gap-3 text-[10px] text-black/55">
            <span className="min-w-0 truncate">Gateway {shortAddr(data.depositor)}</span>
            <span className="shrink-0">AppKit · pending included</span>
          </div>
        </div>
      )}
    </div>
  );
}

function BalanceStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-[5px] border border-black/10 bg-[color:color-mix(in_oklab,var(--bg-elev)_90%,white)] px-2.5 py-1.5 text-black shadow-[0_1px_0_rgba(0,0,0,0.035)]">
      <span className="min-w-0 truncate text-[10px] uppercase tracking-[0.1em] text-black/55">
        {label}
      </span>
      <span className="shrink-0 font-mono text-[12px] tabular-nums">{value}</span>
    </div>
  );
}

function ChainBalanceRow({
  chain,
  label,
  amount,
  pending,
  scannerUrl,
}: {
  chain: string;
  label: string;
  amount: string;
  pending?: string;
  scannerUrl?: string | null;
}) {
  const hasPending = pending && !isZeroAmount(pending);
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-[6px] border border-black/10 bg-[color:color-mix(in_oklab,var(--bg-elev)_91%,white)] px-3 py-2.5 text-black shadow-[inset_0_1px_0_rgba(255,255,255,0.42),0_1px_0_rgba(0,0,0,0.035)]">
      <div className="flex min-w-0 items-center gap-2.5">
        <ChainIcon chain={chain} size="lg" />
        <div className="min-w-0">
          <div className="truncate text-[14px] leading-4 font-semibold">{label}</div>
          <div className="mt-0.5 text-[10px] uppercase tracking-[0.1em] text-black/50">
            Gateway route
          </div>
          {hasPending && (
            <div className="mt-0.5 text-[11px] text-black/60">
              +${formatGrandTotal(pending)} pending
            </div>
          )}
        </div>
      </div>
      <div className="shrink-0 text-right">
        <div className="font-mono text-[14px] tabular-nums">${formatGrandTotal(amount)}</div>
        {scannerUrl && <ScannerLink href={scannerUrl} label={`${label} Gateway depositor`} />}
      </div>
    </div>
  );
}

function ChainLabel({ chain, label }: { chain: string; label: string }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 align-middle">
      <ChainIcon chain={chain} size="sm" />
      <span className="min-w-0 truncate">{label}</span>
    </span>
  );
}

function ChainIcon({ chain, size }: { chain: string; size: 'sm' | 'lg' }) {
  const boxClass =
    size === 'lg'
      ? 'size-6 bg-[color:color-mix(in_oklab,var(--bg-elev)_72%,white)]'
      : 'size-4 bg-white/80';
  const iconSize = size === 'lg' ? 18 : 13;

  return (
    <span
      className={`grid shrink-0 place-items-center rounded-full ring-1 ring-black/10 ${boxClass}`}
    >
      <BlockchainIcon chain={chain} size={iconSize} />
    </span>
  );
}

function ScannerLink({ href, label }: { href: string; label: string }) {
  const openedFromPointerRef = useRef(false);

  const openScanner = (
    e: React.MouseEvent<HTMLAnchorElement> | React.PointerEvent<HTMLAnchorElement>
  ) => {
    e.preventDefault();
    e.stopPropagation();
    const opened = window.open(href, '_blank', 'noopener,noreferrer');
    if (!opened) {
      window.location.href = href;
    }
  };

  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      aria-label={`open ${label} block explorer`}
      onPointerDown={e => {
        openedFromPointerRef.current = true;
        openScanner(e);
      }}
      onClick={e => {
        if (openedFromPointerRef.current) {
          openedFromPointerRef.current = false;
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        openScanner(e);
      }}
      className="mt-0.5 inline-flex items-center justify-end font-mono text-[9px] uppercase tracking-[0.11em] text-black/55 underline decoration-black/20 underline-offset-2 transition-[color,text-decoration-color,transform] duration-150 ease-out hover:text-black hover:decoration-black active:scale-[0.97]"
    >
      Explorer ↗
    </a>
  );
}

function BreakdownRow({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div
      className={`flex justify-between gap-3 text-[11px] ${muted ? 'text-black/60' : 'text-black'}`}
    >
      <span className="min-w-0 truncate">{label}</span>
      <span className="shrink-0 font-mono tabular-nums">{value}</span>
    </div>
  );
}

function isZeroAmount(s: string | undefined | null): boolean {
  if (!s) return true;
  const n = Number(s);
  return Number.isFinite(n) && Math.abs(n) < 0.000001;
}

function prettyChainName(chain: string): string {
  return chain
    .replace(/_Sepolia$/u, ' Sepolia')
    .replace(/_Testnet$/u, ' Testnet')
    .replace(/_Fuji$/u, ' Fuji')
    .replace(/_Amoy_Testnet$/u, ' Amoy')
    .replace(/_/gu, ' ');
}

function explorerUrlForAddress(chain: string, address: string | null | undefined): string | null {
  if (!address) return null;
  const base = explorerBaseForChain(chain);
  if (!base) return null;
  if (chain === 'Solana_Devnet' || chain === 'Sol_Devnet' || chain === 'Solana') {
    const cluster = chain === 'Solana' ? '' : '?cluster=devnet';
    return `${base}/address/${address}${cluster}`;
  }
  return `${base}/address/${address}`;
}

function explorerBaseForChain(chain: string): string | null {
  switch (chain) {
    case 'Arc_Testnet':
      return 'https://testnet.arcscan.app';
    case 'Ethereum_Sepolia':
      return 'https://sepolia.etherscan.io';
    case 'Base_Sepolia':
      return 'https://sepolia.basescan.org';
    case 'Avalanche_Fuji':
      return 'https://testnet.snowtrace.io';
    case 'Arbitrum_Sepolia':
      return 'https://sepolia.arbiscan.io';
    case 'Optimism_Sepolia':
      return 'https://sepolia-optimism.etherscan.io';
    case 'Polygon_Amoy':
    case 'Polygon_Amoy_Testnet':
      return 'https://amoy.polygonscan.com';
    case 'Sol_Devnet':
    case 'Solana_Devnet':
    case 'Solana':
      return 'https://explorer.solana.com';
    case 'Unichain_Sepolia':
      return 'https://sepolia.uniscan.xyz';
    default:
      return null;
  }
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
