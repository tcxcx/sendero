'use client';

/**
 * PricingPolicyWizard — 3-step activation flow.
 *
 *   Step 1 — kind chips ("What do you sell?")          [skipped if user already has kinds]
 *   Step 2 — per-kind sliders + floor/ceiling/behavior
 *   Step 3 — sample $1,000 hotel quote preview, then "Save & activate"
 *
 * State is plain useState — the form is short-lived and shape-fluid
 * (kind set evolves as the user toggles chips), so URL state via nuqs
 * doesn't earn its keep here. NO Redux.
 *
 * POST → `/api/tenant/pricing-policy` with `activate: true`. The route
 * runs the treasury preflight; on 412 (TREASURY_NOT_PROVISIONED) we
 * surface a link to the wallet provisioning flow.
 *
 * Mobile-first: stacks single-column under 768px via flex wrap +
 * `minmax(0, 1fr)` columns. Citations collapse to inline info chips
 * (the QuotePricingCard's HoverCard handles desktop tooltips).
 */

import { useMemo, useState } from 'react';

import type { BookingKind } from '@sendero/billing/markup';

import { QuotePricingCard } from '@/components/quote-pricing-card';

const KINDS: {
  value: BookingKind;
  label: string;
  lowBps: number;
  highBps: number;
  citation: string;
}[] = [
  {
    value: 'flight',
    label: 'Flights',
    lowBps: 300,
    highBps: 700,
    citation: 'IATA NDC commission norms (2025).',
  },
  {
    value: 'hotel',
    label: 'Hotels',
    lowBps: 800,
    highBps: 1500,
    citation: 'Statista 2025-Q1; Skift 2025.',
  },
  {
    value: 'rail',
    label: 'Rail',
    lowBps: 500,
    highBps: 1000,
    citation: 'Eurostar/Trenitalia/Amtrak averages.',
  },
  {
    value: 'car',
    label: 'Car rentals',
    lowBps: 800,
    highBps: 1500,
    citation: 'Hertz/Avis corporate net rates.',
  },
  {
    value: 'other',
    label: 'Other',
    lowBps: 1000,
    highBps: 2000,
    citation: 'DMC + experiences; varies widely.',
  },
];

const KIND_BAND = Object.fromEntries(KINDS.map(k => [k.value, k])) as Record<
  BookingKind,
  (typeof KINDS)[number]
>;

export type ExistingPolicy = {
  status: 'not_initialized' | 'inactive' | 'partial' | 'active' | 'sandbox_seed';
  markupConfig: Partial<Record<BookingKind, { strategy: 'static'; bps: number }>>;
  floorMicroUsdc: bigint;
  ceilingMicroUsdc: bigint | null;
  senderoTakeBehavior: 'add_to_customer' | 'deduct_from_markup';
  policyVersion: number | null;
  recommendations: Partial<Record<BookingKind, { medianBps: number }>>;
};

interface Props {
  existing: ExistingPolicy;
  planTier: 'free' | 'basic' | 'pro' | 'enterprise';
}

export function PricingPolicyWizard({ existing, planTier }: Props) {
  // Initial selected kinds = whatever the existing policy already covers.
  // For not_initialized this is empty → shows step 1.
  const initialKinds = (Object.keys(existing.markupConfig) as BookingKind[]).filter(
    k => existing.markupConfig[k] !== undefined
  );
  const skipStep1 = initialKinds.length > 0;

  const [step, setStep] = useState<1 | 2 | 3>(skipStep1 ? 2 : 1);
  const [selectedKinds, setSelectedKinds] = useState<Set<BookingKind>>(new Set(initialKinds));
  const [bpsByKind, setBpsByKind] = useState<Partial<Record<BookingKind, number>>>(() => {
    const out: Partial<Record<BookingKind, number>> = {};
    for (const k of KINDS) {
      const cur = existing.markupConfig[k.value]?.bps;
      out[k.value] = cur ?? Math.round((k.lowBps + k.highBps) / 2);
    }
    return out;
  });
  const [floorUsd, setFloorUsd] = useState<string>(microToUsd(existing.floorMicroUsdc));
  const [ceilingUsd, setCeilingUsd] = useState<string>(
    existing.ceilingMicroUsdc ? microToUsd(existing.ceilingMicroUsdc) : ''
  );
  const [behavior, setBehavior] = useState<'add_to_customer' | 'deduct_from_markup'>(
    existing.senderoTakeBehavior
  );
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  function toggleKind(k: BookingKind) {
    const next = new Set(selectedKinds);
    if (next.has(k)) next.delete(k);
    else next.add(k);
    setSelectedKinds(next);
  }

  async function submit() {
    setSubmitting(true);
    setErrorMsg(null);
    try {
      const markupConfig: Record<string, { strategy: 'static'; bps: number }> = {};
      for (const k of selectedKinds) {
        const bps = bpsByKind[k] ?? 0;
        markupConfig[k] = { strategy: 'static', bps };
      }
      const body = {
        markupConfig,
        floorMicroUsdc: usdToMicro(floorUsd).toString(),
        ...(ceilingUsd ? { ceilingMicroUsdc: usdToMicro(ceilingUsd).toString() } : {}),
        senderoTakeBehavior: behavior,
        activate: true,
      };
      const res = await fetch('/api/tenant/pricing-policy', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => null)) as {
          code?: string;
          message?: string;
        } | null;
        if (err?.code === 'TREASURY_NOT_PROVISIONED') {
          setErrorMsg(
            'Your treasury wallet is not provisioned yet. Finish wallet setup before activating a markup policy.'
          );
        } else {
          setErrorMsg(err?.message ?? `Save failed (${res.status}).`);
        }
        return;
      }
      setDone(true);
    } finally {
      setSubmitting(false);
    }
  }

  // Sample preview for step 3 (and the activated success card).
  const previewKind: BookingKind = selectedKinds.has('hotel')
    ? 'hotel'
    : (Array.from(selectedKinds)[0] ?? 'hotel');
  const previewBps = bpsByKind[previewKind] ?? 1100;

  if (done) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div
          className="sd-card-flat"
          style={{
            padding: '18px 22px',
            boxShadow: 'inset 0 0 0 1px var(--sea, #1e6b6e)',
            background: 'var(--tint-sea-soft)',
            borderRadius: 10,
          }}
        >
          <div className="t-meta" style={{ color: 'var(--sea)', marginBottom: 4 }}>
            ACTIVATED
          </div>
          <div className="t-h3" style={{ marginBottom: 4 }}>
            Markup policy is live
          </div>
          <p className="t-body ink-70" style={{ fontSize: 13, marginBottom: 0 }}>
            Production confirms now use these numbers. You can come back any time to update —
            existing in-flight quotes keep the old version pinned.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <Stepper step={step} skipStep1={skipStep1} />

      {step === 1 ? (
        <Step1 selected={selectedKinds} onToggle={toggleKind} onNext={() => setStep(2)} />
      ) : null}

      {step === 2 ? (
        <Step2
          selectedKinds={selectedKinds}
          bpsByKind={bpsByKind}
          setBpsByKind={setBpsByKind}
          floorUsd={floorUsd}
          setFloorUsd={setFloorUsd}
          ceilingUsd={ceilingUsd}
          setCeilingUsd={setCeilingUsd}
          behavior={behavior}
          setBehavior={setBehavior}
          recommendations={existing.recommendations}
          onBack={skipStep1 ? null : () => setStep(1)}
          onNext={() => setStep(3)}
        />
      ) : null}

      {step === 3 ? (
        <Step3
          previewKind={previewKind}
          previewBps={previewBps}
          floorUsd={floorUsd}
          ceilingUsd={ceilingUsd}
          behavior={behavior}
          planTier={planTier}
          onBack={() => setStep(2)}
          onSubmit={submit}
          submitting={submitting}
          errorMsg={errorMsg}
        />
      ) : null}
    </div>
  );
}

// ─── Step components ─────────────────────────────────────────────────

function Stepper({ step, skipStep1 }: { step: 1 | 2 | 3; skipStep1: boolean }) {
  const items: { n: 1 | 2 | 3; label: string }[] = [
    { n: 1, label: 'What you sell' },
    { n: 2, label: 'Markup levels' },
    { n: 3, label: 'Preview & activate' },
  ];
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      {items.map((item, i) => {
        const muted = skipStep1 && item.n === 1;
        const active = item.n === step;
        return (
          <span key={item.n} style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <span
              className="t-meta"
              style={{
                padding: '4px 10px',
                borderRadius: 999,
                background: active ? 'var(--vermillion)' : 'transparent',
                color: active ? '#fdfbf7' : muted ? 'rgba(31,42,68,0.4)' : 'var(--midnight)',
                boxShadow: active ? 'none' : 'inset 0 0 0 1px var(--hairline-color)',
              }}
            >
              {item.n}. {item.label}
            </span>
            {i < items.length - 1 ? (
              <span
                aria-hidden
                style={{ width: 16, height: 1, background: 'var(--hairline-color)' }}
              />
            ) : null}
          </span>
        );
      })}
    </div>
  );
}

function Step1({
  selected,
  onToggle,
  onNext,
}: {
  selected: Set<BookingKind>;
  onToggle: (k: BookingKind) => void;
  onNext: () => void;
}) {
  return (
    <div className="sd-card-flat" style={cardStyle}>
      <div className="t-h3" style={{ marginBottom: 4 }}>
        What do you sell?
      </div>
      <p className="t-body ink-70" style={{ fontSize: 13, marginBottom: 14 }}>
        Pick every category you want to quote. You can refine the markup numbers in the next step
        and add more categories later.
      </p>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 18 }}>
        {KINDS.map(k => {
          const isOn = selected.has(k.value);
          return (
            <button
              key={k.value}
              type="button"
              onClick={() => onToggle(k.value)}
              aria-pressed={isOn}
              className="t-mono"
              style={{
                padding: '8px 14px',
                borderRadius: 999,
                background: isOn ? 'var(--vermillion)' : 'var(--surface-floating)',
                color: isOn ? '#fdfbf7' : 'var(--midnight)',
                boxShadow: isOn ? 'none' : 'inset 0 0 0 1px var(--hairline-color)',
                fontSize: 11,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                cursor: 'pointer',
                border: 0,
              }}
            >
              {k.label} · {bpsToPct(k.lowBps)}–{bpsToPct(k.highBps)}%
            </button>
          );
        })}
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button
          type="button"
          onClick={onNext}
          disabled={selected.size === 0}
          style={{
            ...primaryBtnStyle,
            opacity: selected.size === 0 ? 0.5 : 1,
            cursor: selected.size === 0 ? 'not-allowed' : 'pointer',
          }}
        >
          Save & continue
        </button>
      </div>
    </div>
  );
}

function Step2({
  selectedKinds,
  bpsByKind,
  setBpsByKind,
  floorUsd,
  setFloorUsd,
  ceilingUsd,
  setCeilingUsd,
  behavior,
  setBehavior,
  recommendations,
  onBack,
  onNext,
}: {
  selectedKinds: Set<BookingKind>;
  bpsByKind: Partial<Record<BookingKind, number>>;
  setBpsByKind: (next: Partial<Record<BookingKind, number>>) => void;
  floorUsd: string;
  setFloorUsd: (v: string) => void;
  ceilingUsd: string;
  setCeilingUsd: (v: string) => void;
  behavior: 'add_to_customer' | 'deduct_from_markup';
  setBehavior: (v: 'add_to_customer' | 'deduct_from_markup') => void;
  recommendations: Partial<Record<BookingKind, { medianBps: number }>>;
  onBack: (() => void) | null;
  onNext: () => void;
}) {
  return (
    <div className="sd-card-flat" style={cardStyle}>
      <div className="t-h3" style={{ marginBottom: 4 }}>
        Set your markup levels
      </div>
      <p className="t-body ink-70" style={{ fontSize: 13, marginBottom: 14 }}>
        Sliders are anchored to industry-typical bands. Your historical median is shown when we have
        enough data — until then it reads &ldquo;—&rdquo;.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 18 }}>
        {Array.from(selectedKinds).map(k => {
          const band = KIND_BAND[k];
          const bps = bpsByKind[k] ?? Math.round((band.lowBps + band.highBps) / 2);
          const median = recommendations[k]?.medianBps;
          return (
            <div key={k} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'baseline',
                  justifyContent: 'space-between',
                  gap: 12,
                  flexWrap: 'wrap',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                  <span className="t-body" style={{ fontSize: 13, fontWeight: 500 }}>
                    {band.label}
                  </span>
                  <span
                    className="t-mono ink-60"
                    title={band.citation}
                    style={{
                      fontSize: 10,
                      padding: '2px 6px',
                      borderRadius: 999,
                      background: 'var(--tint-midnight-soft)',
                    }}
                  >
                    {bpsToPct(band.lowBps)}–{bpsToPct(band.highBps)}% suggested
                  </span>
                  <span className="t-mono ink-60" style={{ fontSize: 10 }}>
                    your median: {median !== undefined ? `${bpsToPct(median)}%` : '—'}
                  </span>
                </div>
                <span
                  className="t-mono"
                  style={{ fontSize: 12, fontVariantNumeric: 'tabular-nums' }}
                >
                  {bpsToPct(bps)}%
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <input
                  type="range"
                  min={0}
                  max={2500}
                  step={25}
                  value={bps}
                  onChange={e => setBpsByKind({ ...bpsByKind, [k]: Number(e.target.value) })}
                  aria-label={`Markup percentage for ${band.label}`}
                  style={{ flex: 1, accentColor: 'var(--vermillion)' }}
                />
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={0.25}
                  value={(bps / 100).toFixed(2)}
                  onChange={e =>
                    setBpsByKind({ ...bpsByKind, [k]: Math.round(Number(e.target.value) * 100) })
                  }
                  aria-label={`Markup percent for ${band.label}`}
                  style={numericInputStyle}
                />
                <span className="t-mono ink-60" style={{ fontSize: 11 }}>
                  %
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Floor / ceiling */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: 14,
          marginBottom: 16,
        }}
      >
        <FloorCeilingField
          label="Floor"
          help="Minimum tenant markup per booking. Below this you're not running a business."
          value={floorUsd}
          onChange={setFloorUsd}
          required
        />
        <FloorCeilingField
          label="Ceiling (optional)"
          help="Self-imposed cap. Leave blank for no ceiling — Sendero hard-blocks at 100%."
          value={ceilingUsd}
          onChange={setCeilingUsd}
        />
      </div>

      {/* Sendero take behavior */}
      <fieldset style={{ border: 0, padding: 0, margin: 0, marginBottom: 18 }}>
        <legend className="t-meta" style={{ marginBottom: 8 }}>
          SENDERO SERVICE FEE
        </legend>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <BehaviorRadio
            id="b-add"
            checked={behavior === 'add_to_customer'}
            onChange={() => setBehavior('add_to_customer')}
            label="Add to customer (default)"
            help="Customer pays cost + your markup + Sendero fee. You receive your full markup."
          />
          <BehaviorRadio
            id="b-deduct"
            checked={behavior === 'deduct_from_markup'}
            onChange={() => setBehavior('deduct_from_markup')}
            label="Absorb from your markup"
            help="Customer pays cost + your markup. Sendero fee comes out of your margin."
          />
        </div>
      </fieldset>

      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
        {onBack ? (
          <button type="button" onClick={onBack} style={secondaryBtnStyle}>
            Back
          </button>
        ) : (
          <span />
        )}
        <button type="button" onClick={onNext} style={primaryBtnStyle}>
          Preview
        </button>
      </div>
    </div>
  );
}

function Step3({
  previewKind,
  previewBps,
  floorUsd,
  ceilingUsd,
  behavior,
  planTier,
  onBack,
  onSubmit,
  submitting,
  errorMsg,
}: {
  previewKind: BookingKind;
  previewBps: number;
  floorUsd: string;
  ceilingUsd: string;
  behavior: 'add_to_customer' | 'deduct_from_markup';
  planTier: 'free' | 'basic' | 'pro' | 'enterprise';
  onBack: () => void;
  onSubmit: () => void;
  submitting: boolean;
  errorMsg: string | null;
}) {
  const ceilingMicro = ceilingUsd ? usdToMicro(ceilingUsd) : null;
  const floorMicro = usdToMicro(floorUsd);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="sd-card-flat" style={cardStyle}>
        <div className="t-h3" style={{ marginBottom: 4 }}>
          Preview a $1,000 {previewKind} quote
        </div>
        <p className="t-body ink-70" style={{ fontSize: 13, marginBottom: 14 }}>
          This is exactly what your customer would see. The hero numbers update live with your
          configuration above.
        </p>
      </div>

      <QuotePricingCard
        costMicroUsdc={1_000_000_000n}
        bookingKind={previewKind}
        policyDefaultBps={previewBps}
        floorMicroUsdc={floorMicro}
        ceilingMicroUsdc={ceilingMicro}
        senderoTakeBehaviorDefault={behavior}
        planTier={planTier}
        // The preview surface short-circuits onConfirm — Step 3's real
        // submit lives below this card.
        onConfirm={async () => {
          /* preview only */
        }}
      />

      {errorMsg ? (
        <div
          className="t-mono"
          style={{
            fontSize: 11,
            color: 'var(--vermillion)',
            background: 'var(--tint-vermillion-soft)',
            padding: '10px 12px',
            borderRadius: 8,
          }}
        >
          {errorMsg}
        </div>
      ) : null}

      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
        <button type="button" onClick={onBack} style={secondaryBtnStyle} disabled={submitting}>
          Back
        </button>
        <button type="button" onClick={onSubmit} style={primaryBtnStyle} disabled={submitting}>
          {submitting ? 'Activating…' : 'Save & activate'}
        </button>
      </div>
    </div>
  );
}

function FloorCeilingField({
  label,
  help,
  value,
  onChange,
  required,
}: {
  label: string;
  help: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
}) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span className="t-meta">{label.toUpperCase()}</span>
      <span
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '6px 10px',
          border: '1px solid var(--hairline-color)',
          borderRadius: 8,
        }}
      >
        <span className="t-mono ink-60" style={{ fontSize: 12 }}>
          $
        </span>
        <input
          type="number"
          min={0}
          step={0.01}
          required={required}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder="0.00"
          style={{
            flex: 1,
            border: 0,
            outline: 'none',
            background: 'transparent',
            fontFamily: 'var(--font-mono-x)',
            fontSize: 13,
            fontVariantNumeric: 'tabular-nums',
            textAlign: 'right',
            color: 'var(--midnight)',
          }}
        />
        <span className="t-mono ink-60" style={{ fontSize: 11 }}>
          USDC
        </span>
      </span>
      <span className="t-mono ink-60" style={{ fontSize: 10 }}>
        {help}
      </span>
    </label>
  );
}

function BehaviorRadio({
  id,
  checked,
  onChange,
  label,
  help,
}: {
  id: string;
  checked: boolean;
  onChange: () => void;
  label: string;
  help: string;
}) {
  return (
    <label
      htmlFor={id}
      style={{
        display: 'flex',
        gap: 10,
        padding: '10px 12px',
        borderRadius: 8,
        cursor: 'pointer',
        background: checked ? 'var(--tint-vermillion-soft)' : 'transparent',
        boxShadow: checked
          ? 'inset 0 0 0 1px var(--vermillion)'
          : 'inset 0 0 0 1px var(--hairline-color)',
      }}
    >
      <input
        id={id}
        type="radio"
        name="senderoTakeBehavior"
        checked={checked}
        onChange={onChange}
        style={{ accentColor: 'var(--vermillion)', marginTop: 3 }}
      />
      <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span className="t-body" style={{ fontSize: 13, fontWeight: 500 }}>
          {label}
        </span>
        <span className="t-mono ink-60" style={{ fontSize: 10 }}>
          {help}
        </span>
      </span>
    </label>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────

function bpsToPct(bps: number): string {
  return (bps / 100).toFixed(bps % 100 === 0 ? 0 : 1);
}

function usdToMicro(value: string): bigint {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0n;
  return BigInt(Math.round(n * 1_000_000));
}

function microToUsd(value: bigint): string {
  const whole = value / 1_000_000n;
  const frac = value % 1_000_000n;
  if (frac === 0n) return whole.toString();
  return `${whole}.${frac.toString().padStart(6, '0').replace(/0+$/, '')}`;
}

const cardStyle: React.CSSProperties = {
  padding: '20px 22px',
  boxShadow: 'inset 0 0 0 1px var(--hairline-color)',
  borderRadius: 12,
  background: 'var(--surface-floating)',
};

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
};

const secondaryBtnStyle: React.CSSProperties = {
  ...primaryBtnStyle,
  background: 'transparent',
  color: 'var(--midnight)',
  boxShadow: 'inset 0 0 0 1px var(--hairline-color)',
};
