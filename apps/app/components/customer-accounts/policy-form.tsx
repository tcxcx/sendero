'use client';

import { useEffect, useState } from 'react';

type CabinClass = 'economy' | 'premium_economy' | 'business' | 'first';
type FiscalCountry = 'MX' | 'BR' | 'AR' | 'US' | 'GB';

interface PolicyRules {
  maxFlightUsd: number;
  maxNightUsd: number;
  intlCabinMinHours: number;
  intlCabinRequired: 'business' | 'first' | 'premium_economy';
  domesticCabin: 'economy' | 'premium_economy';
  preferredCarriers: string[];
  blacklistSuppliers: string[];
  requireApproverOverUsd: number;
  fiscalCountry: FiscalCountry;
}

interface InitialPolicy {
  id: string;
  slug: string;
  displayName: string;
  rules: Record<string, unknown>;
  version: number;
  updatedAt: Date | string;
}

interface PolicyFormProps {
  accountId: string;
  accountDisplayName: string;
  initialPolicy: InitialPolicy | null;
}

const DEFAULT_RULES: PolicyRules = {
  maxFlightUsd: 3000,
  maxNightUsd: 250,
  intlCabinMinHours: 6,
  intlCabinRequired: 'premium_economy',
  domesticCabin: 'economy',
  preferredCarriers: [],
  blacklistSuppliers: [],
  requireApproverOverUsd: 2000,
  fiscalCountry: 'US',
};

function hydrateRules(raw: Record<string, unknown> | null | undefined): PolicyRules {
  if (!raw) return DEFAULT_RULES;
  return {
    maxFlightUsd: typeof raw.maxFlightUsd === 'number' ? raw.maxFlightUsd : DEFAULT_RULES.maxFlightUsd,
    maxNightUsd: typeof raw.maxNightUsd === 'number' ? raw.maxNightUsd : DEFAULT_RULES.maxNightUsd,
    intlCabinMinHours:
      typeof raw.intlCabinMinHours === 'number' ? raw.intlCabinMinHours : DEFAULT_RULES.intlCabinMinHours,
    intlCabinRequired:
      raw.intlCabinRequired === 'business' ||
      raw.intlCabinRequired === 'first' ||
      raw.intlCabinRequired === 'premium_economy'
        ? raw.intlCabinRequired
        : DEFAULT_RULES.intlCabinRequired,
    domesticCabin:
      raw.domesticCabin === 'economy' || raw.domesticCabin === 'premium_economy'
        ? raw.domesticCabin
        : DEFAULT_RULES.domesticCabin,
    preferredCarriers: Array.isArray(raw.preferredCarriers)
      ? (raw.preferredCarriers.filter(s => typeof s === 'string') as string[])
      : DEFAULT_RULES.preferredCarriers,
    blacklistSuppliers: Array.isArray(raw.blacklistSuppliers)
      ? (raw.blacklistSuppliers.filter(s => typeof s === 'string') as string[])
      : DEFAULT_RULES.blacklistSuppliers,
    requireApproverOverUsd:
      typeof raw.requireApproverOverUsd === 'number'
        ? raw.requireApproverOverUsd
        : DEFAULT_RULES.requireApproverOverUsd,
    fiscalCountry: (['MX', 'BR', 'AR', 'US', 'GB'] as FiscalCountry[]).includes(
      raw.fiscalCountry as FiscalCountry
    )
      ? (raw.fiscalCountry as FiscalCountry)
      : DEFAULT_RULES.fiscalCountry,
  };
}

export function CustomerAccountPolicyForm({
  accountId,
  accountDisplayName,
  initialPolicy,
}: PolicyFormProps) {
  const [rules, setRules] = useState<PolicyRules>(hydrateRules(initialPolicy?.rules));
  const [carriersText, setCarriersText] = useState(rules.preferredCarriers.join(', '));
  const [blacklistText, setBlacklistText] = useState(rules.blacklistSuppliers.join(', '));
  const [version, setVersion] = useState(initialPolicy?.version ?? null);
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (status === 'saved') {
      const id = setTimeout(() => setStatus('idle'), 2500);
      return () => clearTimeout(id);
    }
  }, [status]);

  const setRule = <K extends keyof PolicyRules>(key: K, value: PolicyRules[K]) =>
    setRules(prev => ({ ...prev, [key]: value }));

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus('saving');
    setError(null);
    const finalRules: PolicyRules = {
      ...rules,
      preferredCarriers: carriersText
        .split(',')
        .map(s => s.trim().toUpperCase())
        .filter(Boolean),
      blacklistSuppliers: blacklistText
        .split(',')
        .map(s => s.trim())
        .filter(Boolean),
    };
    try {
      const res = await fetch(`/api/customer-accounts/${accountId}/policy`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ rules: finalRules }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        policy?: { version?: number };
        error?: string;
        issues?: Array<{ message?: string }>;
      };
      if (!res.ok || !body.ok) {
        setStatus('error');
        setError(
          body.issues?.map(i => i.message).filter(Boolean).join(', ') ??
            body.error ??
            `Save failed (${res.status})`
        );
        return;
      }
      setVersion(body.policy?.version ?? (version === null ? 1 : version + 1));
      setRules(finalRules);
      setCarriersText(finalRules.preferredCarriers.join(', '));
      setBlacklistText(finalRules.blacklistSuppliers.join(', '));
      setStatus('saved');
    } catch (err) {
      setStatus('error');
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <form
      onSubmit={onSubmit}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 18,
      }}
    >
      <section
        className="sd-card-flat"
        style={{
          boxShadow: 'inset 0 0 0 1px var(--hairline-color)',
          padding: 16,
          display: 'grid',
          gridTemplateColumns: 'repeat(2, 1fr)',
          gap: 14,
        }}
      >
        <NumField
          label="Max flight USD"
          value={rules.maxFlightUsd}
          onChange={v => setRule('maxFlightUsd', v)}
          hint="Per-ticket ceiling. Above this → policy violation."
        />
        <NumField
          label="Max hotel USD / night"
          value={rules.maxNightUsd}
          onChange={v => setRule('maxNightUsd', v)}
          hint="Per-night ceiling. Above this → policy violation."
        />
        <NumField
          label="Int'l cabin min hours"
          value={rules.intlCabinMinHours}
          onChange={v => setRule('intlCabinMinHours', v)}
          hint="Flights ≥ this duration must meet the int'l cabin requirement."
        />
        <NumField
          label="Requires approver above USD"
          value={rules.requireApproverOverUsd}
          onChange={v => setRule('requireApproverOverUsd', v)}
          hint="Above this → /dashboard/handoff fires for human approval (Tier 3)."
        />

        <SelectField
          label="Int'l cabin required"
          value={rules.intlCabinRequired}
          options={[
            ['premium_economy', 'Premium Economy'],
            ['business', 'Business'],
            ['first', 'First'],
          ]}
          onChange={v => setRule('intlCabinRequired', v as PolicyRules['intlCabinRequired'])}
        />
        <SelectField
          label="Domestic cabin"
          value={rules.domesticCabin}
          options={[
            ['economy', 'Economy'],
            ['premium_economy', 'Premium Economy'],
          ]}
          onChange={v => setRule('domesticCabin', v as PolicyRules['domesticCabin'])}
        />

        <SelectField
          label="Fiscal country"
          value={rules.fiscalCountry}
          options={[
            ['MX', 'Mexico'],
            ['BR', 'Brazil'],
            ['AR', 'Argentina'],
            ['US', 'United States'],
            ['GB', 'United Kingdom'],
          ]}
          onChange={v => setRule('fiscalCountry', v as FiscalCountry)}
        />
        <div />
      </section>

      <section
        className="sd-card-flat"
        style={{
          boxShadow: 'inset 0 0 0 1px var(--hairline-color)',
          padding: 16,
          display: 'grid',
          gap: 12,
        }}
      >
        <TextField
          label="Preferred carriers"
          value={carriersText}
          onChange={setCarriersText}
          hint="IATA codes, comma-separated. e.g. LA, AV, CM"
        />
        <TextField
          label="Blacklisted suppliers"
          value={blacklistText}
          onChange={setBlacklistText}
          hint="Supplier IDs, comma-separated. Booking against any of these → policy violation."
        />
      </section>

      <footer
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          paddingTop: 4,
        }}
      >
        <button
          type="submit"
          disabled={status === 'saving'}
          style={{
            padding: '9px 18px',
            borderRadius: 8,
            background: 'var(--ink, #fb542b)',
            color: '#fff',
            border: '1px solid var(--ink, #fb542b)',
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            cursor: status === 'saving' ? 'not-allowed' : 'pointer',
            opacity: status === 'saving' ? 0.6 : 1,
          }}
        >
          {status === 'saving' ? 'Saving…' : 'Save policy'}
        </button>
        {version !== null ? (
          <span className="t-meta ink-60" style={{ fontSize: 11 }}>
            v{version} · {accountDisplayName}
          </span>
        ) : (
          <span className="t-meta ink-60" style={{ fontSize: 11 }}>
            No policy yet · creating v1
          </span>
        )}
        {status === 'saved' ? (
          <span style={{ color: 'var(--ink, #fb542b)', fontSize: 12 }}>Saved.</span>
        ) : null}
        {status === 'error' && error ? (
          <span style={{ color: 'var(--accent-rose, #b54848)', fontSize: 12 }}>{error}</span>
        ) : null}
      </footer>
    </form>
  );
}

function NumField({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  hint?: string;
}) {
  return (
    <label style={{ display: 'grid', gap: 4 }}>
      <span className="t-meta ink-60" style={{ fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase' }}>
        {label}
      </span>
      <input
        type="number"
        min="0"
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        style={{
          padding: '8px 10px',
          border: '1px solid var(--border, #d8c1a7)',
          borderRadius: 6,
          background: 'var(--bg-elev, #fdfbf7)',
          fontFamily: 'var(--font-mono)',
          fontSize: 13,
        }}
      />
      {hint ? (
        <span className="ink-60" style={{ fontSize: 11, lineHeight: 1.4 }}>
          {hint}
        </span>
      ) : null}
    </label>
  );
}

function SelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<[string, string]>;
  onChange: (v: string) => void;
}) {
  return (
    <label style={{ display: 'grid', gap: 4 }}>
      <span className="t-meta ink-60" style={{ fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase' }}>
        {label}
      </span>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        style={{
          padding: '8px 10px',
          border: '1px solid var(--border, #d8c1a7)',
          borderRadius: 6,
          background: 'var(--bg-elev, #fdfbf7)',
          fontSize: 13,
        }}
      >
        {options.map(([v, label]) => (
          <option key={v} value={v}>
            {label}
          </option>
        ))}
      </select>
    </label>
  );
}

function TextField({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
}) {
  return (
    <label style={{ display: 'grid', gap: 4 }}>
      <span className="t-meta ink-60" style={{ fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase' }}>
        {label}
      </span>
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        style={{
          padding: '8px 10px',
          border: '1px solid var(--border, #d8c1a7)',
          borderRadius: 6,
          background: 'var(--bg-elev, #fdfbf7)',
          fontFamily: 'var(--font-mono)',
          fontSize: 13,
        }}
      />
      {hint ? (
        <span className="ink-60" style={{ fontSize: 11, lineHeight: 1.4 }}>
          {hint}
        </span>
      ) : null}
    </label>
  );
}
