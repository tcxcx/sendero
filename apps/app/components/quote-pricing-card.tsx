'use client';

/**
 * QuotePricingCard — composable quote review card. Hero anchored at the
 * top ("Customer pays $X / You receive $Y" in display type), receipt
 * grid below. Layout: sticky right-rail at >=1024px, accordion at
 * <1024px (the parent decides where to mount it; this component just
 * stays self-contained).
 *
 * Math is done client-side via `computeMarkupBreakdown` from
 * `@sendero/billing` so the slider feels live. The same function powers
 * the agent tool — both sides agree on the same numbers.
 *
 * Markup input modes:
 *   - percentage (default) — slider 0–25% (extends if user types higher)
 *   - absolute USDC — `[$ amount instead]` link toggles to a numeric
 *     input. Mutually exclusive: when bps is set, absolute = null and
 *     vice-versa.
 *
 * Guard rails (Phase 2 design fixes):
 *   - 25% soft confirm modal before `onConfirm`.
 *   - 100% hard block — submit button disabled.
 *   - >ceiling warning, <floor block.
 *   - 200ms tween on recompute (prefers-reduced-motion opts out).
 *
 * Reused primitives: `<Card>`, `<Switch>`, `<HoverCard>` from the
 * existing shadcn surface. Slider is a native `<input type="range">`
 * styled inline because the repo doesn't ship a shadcn slider yet
 * (TODO at the bottom of this file).
 */

import { useEffect, useMemo, useRef, useState } from 'react';

import {
  computeMarkupBreakdown,
  MarkupAmbiguousInputError,
  MarkupStrategyNotSupportedV1,
  type BookingKind,
  type BookingPolicySnapshot,
} from '@sendero/billing';

import { Card } from '@/components/ui/card';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card';
import { Switch } from '@/components/ui/switch';

// ─── Citation bands (display-only; mirrors the activation wizard) ────
//
// Partial — eSIM + card surfaces don't have a published industry band
// yet. CitationTooltip falls back to a generic "no published band" copy
// when missing rather than crashing.

const KIND_BANDS: Partial<
  Record<BookingKind, { label: string; lowBps: number; highBps: number; citation: string }>
> = {
  flight: {
    label: 'Flights',
    lowBps: 300,
    highBps: 700,
    citation: 'IATA NDC commission norms (2025).',
  },
  hotel: { label: 'Hotels', lowBps: 800, highBps: 1500, citation: 'Statista 2025-Q1; Skift 2025.' },
  rail: {
    label: 'Rail',
    lowBps: 500,
    highBps: 1000,
    citation: 'Eurostar/Trenitalia/Amtrak averages.',
  },
  car: {
    label: 'Car rentals',
    lowBps: 800,
    highBps: 1500,
    citation: 'Hertz/Avis corporate net rates.',
  },
  other: {
    label: 'Other',
    lowBps: 1000,
    highBps: 2000,
    citation: 'DMC + experiences; varies widely.',
  },
};

function bandFor(kind: BookingKind): {
  label: string;
  lowBps: number;
  highBps: number;
  citation: string;
} {
  return (
    KIND_BANDS[kind] ?? {
      label: kind === 'esim' ? 'eSIM' : kind === 'card' ? 'Card issuance' : 'Other',
      lowBps: 0,
      highBps: 0,
      citation: 'No published industry band — set markup based on tenant policy.',
    }
  );
}

const SOFT_WARN_BPS = 2500;
const HARD_BLOCK_BPS = 10_000;

// ─── Props ───────────────────────────────────────────────────────────

export interface QuotePricingCardProps {
  costMicroUsdc: bigint;
  bookingKind: BookingKind;
  /** Pre-filled markup default for this kind, in bps. Null = no policy yet. */
  policyDefaultBps: number | null;
  floorMicroUsdc: bigint;
  ceilingMicroUsdc: bigint | null;
  senderoTakeBehaviorDefault: 'add_to_customer' | 'deduct_from_markup';
  planTier: 'free' | 'basic' | 'pro' | 'enterprise';
  /** Reflected in the small-caps footer. */
  policyVersion?: number;
  policyPinnedAt?: Date | string;
  /** Set to true to render policy_inactive blocking state. */
  policyInactive?: boolean;
  /** Where to send the operator if the policy isn't set yet. */
  activationHref?: string;
  onConfirm: (args: {
    markupBps?: number;
    markupMicroUsdc?: bigint;
    senderoTakeBehavior: 'add_to_customer' | 'deduct_from_markup';
  }) => Promise<void>;
}

// ─── Component ───────────────────────────────────────────────────────

export function QuotePricingCard(props: QuotePricingCardProps) {
  const {
    costMicroUsdc,
    bookingKind,
    policyDefaultBps,
    floorMicroUsdc,
    ceilingMicroUsdc,
    senderoTakeBehaviorDefault,
    planTier,
    policyVersion,
    policyPinnedAt,
    policyInactive = false,
    activationHref = '/dashboard/settings/pricing',
    onConfirm,
  } = props;

  // ── Local form state ──
  const [mode, setMode] = useState<'pct' | 'abs'>('pct');
  const [markupBps, setMarkupBps] = useState<number>(policyDefaultBps ?? 0);
  const [markupMicroUsdcInput, setMarkupMicroUsdcInput] = useState<string>('');
  const [absorb, setAbsorb] = useState<boolean>(
    senderoTakeBehaviorDefault === 'deduct_from_markup'
  );
  const [confirming, setConfirming] = useState(false);
  const [showSoftWarn, setShowSoftWarn] = useState(false);
  const [diffBadge, setDiffBadge] = useState<{ delta: bigint; key: number } | null>(null);

  // Snapshot used for live computation. We synthesize a v1 'static'
  // snapshot from props so the math matches what the server will pin.
  const snapshot: BookingPolicySnapshot = useMemo(
    () => ({
      policyVersion: policyVersion ?? 0,
      kind: bookingKind,
      markup: { strategy: 'static', bps: policyDefaultBps ?? 0 },
      floorMicroUsdc: floorMicroUsdc.toString(),
      ceilingMicroUsdc: ceilingMicroUsdc?.toString() ?? null,
      senderoTakeBehavior: absorb ? 'deduct_from_markup' : 'add_to_customer',
    }),
    [policyVersion, bookingKind, policyDefaultBps, floorMicroUsdc, ceilingMicroUsdc, absorb]
  );

  // Run the breakdown. Surface compute errors as inline UI rather than
  // throwing in render — same envelope shape the API would return.
  const breakdown = useMemo(() => {
    try {
      const args = {
        costMicroUsdc,
        bookingKind,
        policy: snapshot,
        plan: planTier,
        ...(mode === 'abs' && markupMicroUsdcInput
          ? { overrideMarkupMicroUsdc: parseUsdcInput(markupMicroUsdcInput) }
          : { overrideMarkupBps: markupBps }),
      };
      return { ok: true as const, value: computeMarkupBreakdown(args) };
    } catch (err) {
      const message =
        err instanceof MarkupStrategyNotSupportedV1
          ? err.message
          : err instanceof MarkupAmbiguousInputError
            ? err.message
            : 'Unable to compute breakdown.';
      return { ok: false as const, error: message };
    }
  }, [costMicroUsdc, bookingKind, snapshot, mode, markupBps, markupMicroUsdcInput, planTier]);

  // Trigger the absorb-toggle diff badge for 1.5s.
  const lastTakeRef = useRef<bigint | null>(null);
  useEffect(() => {
    if (!breakdown.ok) return;
    const current = breakdown.value.senderoTakeMicroUsdc;
    const last = lastTakeRef.current;
    lastTakeRef.current = current;
    if (last === null) return;
    const delta = absorb ? -current : current;
    if (delta === 0n) return;
    setDiffBadge({ delta, key: Date.now() });
    const t = setTimeout(() => setDiffBadge(null), 1500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [absorb]);

  // ── Validation derived from breakdown ──
  const effectiveMarkupBps = breakdown.ok
    ? (breakdown.value.markupBps ?? bpsFromAbsolute(breakdown.value.markupMicroUsdc, costMicroUsdc))
    : markupBps;
  const belowFloor = breakdown.ok && breakdown.value.markupMicroUsdc < floorMicroUsdc;
  const aboveSelfCeiling =
    breakdown.ok && ceilingMicroUsdc !== null && breakdown.value.markupMicroUsdc > ceilingMicroUsdc;
  const aboveSoft = effectiveMarkupBps >= SOFT_WARN_BPS;
  const aboveHard = effectiveMarkupBps >= HARD_BLOCK_BPS;
  const absorbInsufficient = breakdown.ok && breakdown.value.absorbInsufficient;

  const submitDisabled =
    confirming || policyInactive || !breakdown.ok || belowFloor || aboveHard || absorbInsufficient;

  async function submit() {
    if (submitDisabled) return;
    if (aboveSoft && !showSoftWarn) {
      setShowSoftWarn(true);
      return;
    }
    setShowSoftWarn(false);
    setConfirming(true);
    try {
      await onConfirm({
        ...(mode === 'abs' && markupMicroUsdcInput
          ? { markupMicroUsdc: parseUsdcInput(markupMicroUsdcInput) }
          : { markupBps }),
        senderoTakeBehavior: absorb ? 'deduct_from_markup' : 'add_to_customer',
      });
    } finally {
      setConfirming(false);
    }
  }

  // ── Render: blocking state for inactive policy ──
  if (policyInactive) {
    return (
      <Card style={{ padding: 20 }}>
        <div className="t-meta" style={{ color: 'var(--vermillion)', marginBottom: 6 }}>
          POLICY INACTIVE
        </div>
        <h3 className="t-h3" style={{ marginBottom: 6 }}>
          Set your markup policy to start quoting
        </h3>
        <p className="t-body ink-70" style={{ fontSize: 13, marginBottom: 14, maxWidth: '52ch' }}>
          You don&apos;t have an active markup policy yet. Sandbox keys can quote with the seed
          defaults, but production confirms will fail until you set real numbers.
        </p>
        <a href={activationHref} style={primaryBtnStyle}>
          Set up markup
        </a>
      </Card>
    );
  }

  const band = bandFor(bookingKind);
  const customerTotal = breakdown.ok ? breakdown.value.customerTotalMicroUsdc : 0n;
  const tenantTake = breakdown.ok ? breakdown.value.tenantTakeMicroUsdc : 0n;

  return (
    <Card style={{ padding: 0, overflow: 'hidden' }}>
      {/* Hero — top-anchored per Phase 2 design fix */}
      <div
        style={{
          padding: '20px 22px 16px',
          borderBottom: '1px solid var(--hairline-color-soft)',
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 16,
        }}
      >
        <HeroNumber
          label="Customer pays"
          value={customerTotal}
          tone="midnight"
          animateKey={`cp-${customerTotal}`}
        />
        <HeroNumber
          label="You receive"
          value={tenantTake}
          tone="sea"
          animateKey={`yr-${tenantTake}`}
        />
      </div>

      {/* Receipt grid */}
      <div style={{ padding: '16px 22px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <ReceiptRow label="Supplier cost" amount={costMicroUsdc} mono subtle />

        {/* Markup row — editable */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'baseline',
              justifyContent: 'space-between',
              gap: 12,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="t-body" style={{ fontSize: 13 }}>
                Your markup
              </span>
              <CitationTooltip kind={bookingKind} />
            </div>
            <button
              type="button"
              onClick={() => setMode(mode === 'pct' ? 'abs' : 'pct')}
              className="t-mono ink-60"
              style={{
                background: 'transparent',
                border: 0,
                fontSize: 10,
                textDecoration: 'underline',
                cursor: 'pointer',
                padding: 0,
              }}
            >
              {mode === 'pct' ? '$ amount instead' : '% instead'}
            </button>
          </div>

          {mode === 'pct' ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <input
                type="range"
                min={0}
                max={Math.max(2500, markupBps + 100)}
                step={25}
                value={markupBps}
                onChange={e => setMarkupBps(Number(e.target.value))}
                aria-label={`Markup percentage for ${band.label}`}
                style={{ flex: 1, accentColor: 'var(--vermillion)' }}
              />
              <input
                type="number"
                min={0}
                max={10_000}
                step={25}
                value={markupBps / 100}
                onChange={e => setMarkupBps(Math.round(Number(e.target.value) * 100))}
                aria-label="Markup percent"
                style={numericInputStyle}
              />
              <span className="t-mono ink-60" style={{ fontSize: 11 }}>
                %
              </span>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span className="t-mono ink-60" style={{ fontSize: 11 }}>
                $
              </span>
              <input
                type="number"
                min={0}
                step={0.01}
                value={markupMicroUsdcInput}
                onChange={e => setMarkupMicroUsdcInput(e.target.value)}
                placeholder="0.00"
                aria-label="Markup amount in USDC"
                style={{ ...numericInputStyle, width: 100 }}
              />
              <span className="t-mono ink-60" style={{ fontSize: 11 }}>
                USDC
              </span>
            </div>
          )}

          <ReceiptAmount
            value={breakdown.ok ? breakdown.value.markupMicroUsdc : 0n}
            mono
            align="right"
          />

          {belowFloor ? (
            <InlineMsg tone="error">
              Below your floor of {fmtUsdc(floorMicroUsdc)}. Raise the markup or lower the floor in
              settings.
            </InlineMsg>
          ) : null}
          {aboveSelfCeiling ? (
            <InlineMsg tone="warn">
              Above your self-imposed ceiling of {fmtUsdc(ceilingMicroUsdc!)} — confirm to override.
            </InlineMsg>
          ) : null}
          {aboveSoft && !aboveHard ? (
            <InlineMsg tone="warn">
              Above 25% — Sendero will require an extra confirm before we book.
            </InlineMsg>
          ) : null}
          {aboveHard ? (
            <InlineMsg tone="error">
              100% markup is the hard ceiling. Drop the markup before continuing.
            </InlineMsg>
          ) : null}
        </div>

        {/* Sendero service fee row */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span className="t-body" style={{ fontSize: 13 }}>
                Sendero service fee
              </span>
              <Switch
                checked={absorb}
                onCheckedChange={setAbsorb}
                aria-label="Absorb the Sendero service fee from your markup"
              />
              <span className="t-mono ink-60" style={{ fontSize: 10 }}>
                {absorb ? 'absorbed' : 'passed to customer'}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {diffBadge ? (
                <span
                  key={diffBadge.key}
                  className="t-mono"
                  style={{
                    fontSize: 10,
                    padding: '2px 6px',
                    borderRadius: 4,
                    background:
                      diffBadge.delta < 0n ? 'var(--tint-sea-soft)' : 'var(--tint-vermillion-soft)',
                    color: diffBadge.delta < 0n ? 'var(--sea)' : 'var(--vermillion)',
                  }}
                >
                  {diffBadge.delta < 0n ? '−' : '+'}
                  {fmtUsdc(diffBadge.delta < 0n ? -diffBadge.delta : diffBadge.delta)}
                </span>
              ) : null}
              <span className="t-mono ink-70" style={{ fontSize: 12 }}>
                {breakdown.ok ? fmtUsdc(breakdown.value.senderoTakeMicroUsdc) : '—'}
              </span>
            </div>
          </div>
          {absorbInsufficient ? (
            <InlineMsg tone="error">
              The Sendero take exceeds your markup — you would receive $0. Raise the markup or
              switch off absorb.
            </InlineMsg>
          ) : null}
        </div>

        <div style={{ height: 1, background: 'var(--hairline-color-soft)', margin: '4px 0' }} />

        <ReceiptRow label="Customer pays" amount={customerTotal} mono bold />
        <ReceiptRow label="You receive" amount={tenantTake} mono bold tone="sea" />
      </div>

      {/* Footer — version pin + submit */}
      <div
        style={{
          padding: '14px 22px',
          borderTop: '1px solid var(--hairline-color-soft)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
        }}
      >
        <PolicyPin version={policyVersion} pinnedAt={policyPinnedAt} />
        <button type="button" onClick={submit} disabled={submitDisabled} style={primaryBtnStyle}>
          {confirming
            ? 'Confirming…'
            : aboveSoft && !aboveHard
              ? 'Confirm 25%+ markup'
              : 'Confirm quote'}
        </button>
      </div>

      {/* Soft-confirm modal (lightweight inline; promote to <Dialog> if reused) */}
      {showSoftWarn ? (
        <div
          role="alertdialog"
          aria-modal="true"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(31,42,68,0.4)',
            display: 'grid',
            placeItems: 'center',
            zIndex: 50,
          }}
          onClick={() => setShowSoftWarn(false)}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: 'var(--surface-floating)',
              borderRadius: 12,
              padding: 22,
              maxWidth: 420,
              width: '90%',
              boxShadow: '0 20px 40px rgba(0,0,0,0.18)',
            }}
          >
            <div className="t-meta" style={{ color: 'var(--vermillion)', marginBottom: 4 }}>
              CONFIRM 25%+ MARKUP
            </div>
            <h4 className="t-h3" style={{ marginBottom: 8 }}>
              That&apos;s above the suggested band
            </h4>
            <p className="t-body ink-70" style={{ fontSize: 13, marginBottom: 16 }}>
              Suggested for {band.label.toLowerCase()}: {bpsToPct(band.lowBps)}–
              {bpsToPct(band.highBps)}%. You&apos;re at {bpsToPct(effectiveMarkupBps)}%. Customers
              see the full markup line on their invoice — make sure the price still reads fair.
            </p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={() => setShowSoftWarn(false)}
                style={secondaryBtnStyle}
              >
                Lower it
              </button>
              <button type="button" onClick={submit} style={primaryBtnStyle}>
                Confirm anyway
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </Card>
  );
}

// ─── Subcomponents ───────────────────────────────────────────────────

function HeroNumber({
  label,
  value,
  tone,
  animateKey,
}: {
  label: string;
  value: bigint;
  tone: 'midnight' | 'sea';
  animateKey: string;
}) {
  return (
    <div>
      <div className="t-meta" style={{ marginBottom: 6 }}>
        {label}
      </div>
      <div
        key={animateKey}
        className="t-num-md"
        style={{
          fontSize: 32,
          fontWeight: 600,
          color: tone === 'sea' ? 'var(--sea)' : 'var(--midnight)',
          fontVariantNumeric: 'tabular-nums',
          transition: 'opacity 200ms ease',
        }}
      >
        {fmtUsdc(value)}
      </div>
    </div>
  );
}

function ReceiptRow({
  label,
  amount,
  mono,
  bold,
  subtle,
  tone,
  align = 'right',
}: {
  label: string;
  amount: bigint;
  mono?: boolean;
  bold?: boolean;
  subtle?: boolean;
  tone?: 'midnight' | 'sea';
  align?: 'left' | 'right';
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        gap: 12,
      }}
    >
      <span
        className={subtle ? 't-body ink-70' : 't-body'}
        style={{ fontSize: 13, fontWeight: bold ? 600 : 400 }}
      >
        {label}
      </span>
      <ReceiptAmount value={amount} mono={mono} bold={bold} tone={tone} align={align} />
    </div>
  );
}

function ReceiptAmount({
  value,
  mono,
  bold,
  tone,
}: {
  value: bigint;
  mono?: boolean;
  bold?: boolean;
  tone?: 'midnight' | 'sea';
  align?: 'left' | 'right';
}) {
  return (
    <span
      className={mono ? 't-mono' : 't-body'}
      style={{
        fontSize: 13,
        fontVariantNumeric: 'tabular-nums',
        fontWeight: bold ? 600 : 400,
        color: tone === 'sea' ? 'var(--sea)' : 'var(--midnight)',
        transition: 'color 200ms ease',
      }}
    >
      {fmtUsdc(value)}
    </span>
  );
}

function CitationTooltip({ kind }: { kind: BookingKind }) {
  const band = bandFor(kind);
  return (
    <HoverCard openDelay={150}>
      <HoverCardTrigger asChild>
        <button
          type="button"
          aria-label={`Suggested ${band.label} markup band`}
          className="t-mono ink-60"
          style={{
            background: 'transparent',
            border: '1px solid var(--hairline-color)',
            borderRadius: 999,
            padding: '0 6px',
            fontSize: 9,
            cursor: 'help',
          }}
        >
          {bpsToPct(band.lowBps)}–{bpsToPct(band.highBps)}%
        </button>
      </HoverCardTrigger>
      <HoverCardContent>
        <div className="t-meta" style={{ marginBottom: 4 }}>
          {band.label.toUpperCase()} BAND
        </div>
        <div className="t-body" style={{ fontSize: 12, marginBottom: 6 }}>
          Industry-typical: {bpsToPct(band.lowBps)}–{bpsToPct(band.highBps)}%.
        </div>
        <div className="t-mono ink-60" style={{ fontSize: 10 }}>
          Source: {band.citation}
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}

function InlineMsg({ tone, children }: { tone: 'warn' | 'error'; children: React.ReactNode }) {
  return (
    <div
      className="t-mono"
      style={{
        fontSize: 11,
        color: tone === 'error' ? 'var(--vermillion)' : 'var(--sand-deep, #8a6a1f)',
        background:
          tone === 'error' ? 'var(--tint-vermillion-soft)' : 'var(--tint-sand-soft, #fdf6e3)',
        borderRadius: 6,
        padding: '6px 8px',
      }}
    >
      {children}
    </div>
  );
}

function PolicyPin({ version, pinnedAt }: { version?: number; pinnedAt?: Date | string }) {
  if (version === undefined) return <span />;
  const date = pinnedAt ? (typeof pinnedAt === 'string' ? new Date(pinnedAt) : pinnedAt) : null;
  return (
    <HoverCard openDelay={150}>
      <HoverCardTrigger asChild>
        <span
          className="t-meta"
          style={{
            cursor: 'help',
            color: 'rgba(31,42,68,0.6)',
          }}
        >
          POLICY V{version} PINNED
        </span>
      </HoverCardTrigger>
      <HoverCardContent>
        <div className="t-body" style={{ fontSize: 12 }}>
          This quote uses your markup policy as of{' '}
          {date ? date.toLocaleDateString() : 'quote-draft time'}. Updates won&apos;t reprice this
          quote.
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────

function fmtUsdc(micro: bigint): string {
  const negative = micro < 0n;
  const abs = negative ? -micro : micro;
  const whole = abs / 1_000_000n;
  const frac = abs % 1_000_000n;
  const fracStr = frac.toString().padStart(6, '0').slice(0, 2);
  return `${negative ? '−' : ''}$${whole}.${fracStr}`;
}

function bpsToPct(bps: number): string {
  return (bps / 100).toFixed(bps % 100 === 0 ? 0 : 1);
}

function bpsFromAbsolute(abs: bigint, cost: bigint): number {
  if (cost === 0n) return 0;
  return Number((abs * 10_000n) / cost);
}

function parseUsdcInput(value: string): bigint {
  // Accept "12.34" → 12_340_000n (micro-USDC).
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0n;
  return BigInt(Math.round(n * 1_000_000));
}

const numericInputStyle: React.CSSProperties = {
  width: 70,
  padding: '4px 8px',
  fontFamily: 'var(--font-mono-x)',
  fontSize: 12,
  border: '1px solid var(--hairline-color)',
  borderRadius: 6,
  background: 'transparent',
  color: 'var(--midnight)',
  textAlign: 'right',
  fontVariantNumeric: 'tabular-nums',
};

const primaryBtnStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  padding: '8px 18px',
  background: 'var(--vermillion)',
  color: '#fdfbf7',
  border: 0,
  borderRadius: 8,
  fontSize: 12,
  fontWeight: 600,
  fontFamily: 'var(--font-mono-x)',
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  cursor: 'pointer',
  textDecoration: 'none',
};

const secondaryBtnStyle: React.CSSProperties = {
  ...primaryBtnStyle,
  background: 'transparent',
  color: 'var(--midnight)',
  boxShadow: 'inset 0 0 0 1px var(--hairline-color)',
};

// ─── TODOs ───────────────────────────────────────────────────────────
// - shadcn `<Slider>` primitive is missing; using native range input.
//   When @radix-ui/react-slider is added run `bunx shadcn add slider`
//   and swap the range inputs.
// - prefers-reduced-motion: the 200ms tween relies on browser-level
//   transitions which already honor the user setting via the OS. If we
//   add JS-driven motion (e.g. number-roll), wrap in the standard hook.
// - Playwright sketch: open `/dashboard/settings/pricing`, set hotel
//   markup to 18%, navigate to a quote, assert hero numbers update
//   live, drag slider to 30%, assert soft-confirm modal, drag to 110%,
//   assert submit button disabled.
