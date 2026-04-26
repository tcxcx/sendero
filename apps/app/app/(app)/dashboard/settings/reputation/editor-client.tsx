'use client';

/**
 * Reputation policy editor — client component for the form mutation.
 * The server page passes the current values; this component PUTs to
 * /api/tenant/reputation-policy on submit.
 */

import { useState } from 'react';

interface Initial {
  minStars: number | null;
  minTripCount: number | null;
  maxDisputeRatio: number | null;
  requireKyc: boolean;
  requireKyb: boolean;
  enforcement: 'block' | 'warn' | 'allow';
}

export function ReputationPolicyEditor({ initial }: { initial: Initial }) {
  const [minStars, setMinStars] = useState<string>(initial.minStars?.toString() ?? '');
  const [minTripCount, setMinTripCount] = useState<string>(initial.minTripCount?.toString() ?? '');
  const [maxDisputeRatio, setMaxDisputeRatio] = useState<string>(
    initial.maxDisputeRatio?.toString() ?? ''
  );
  const [requireKyc, setRequireKyc] = useState(initial.requireKyc);
  const [requireKyb, setRequireKyb] = useState(initial.requireKyb);
  const [enforcement, setEnforcement] = useState<'block' | 'warn' | 'allow'>(initial.enforcement);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch('/api/tenant/reputation-policy', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          minStars: minStars === '' ? null : Number.parseFloat(minStars),
          minTripCount: minTripCount === '' ? null : Number.parseInt(minTripCount, 10),
          maxDisputeRatio: maxDisputeRatio === '' ? null : Number.parseFloat(maxDisputeRatio),
          requireKyc,
          requireKyb,
          enforcement,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setMessage(`Error: ${body.error ?? res.status}`);
      } else {
        setMessage('Saved. Changes apply on the next dispatch.');
      }
    } catch (err) {
      setMessage(`Error: ${err instanceof Error ? err.message : 'unknown'}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6">
      <Field label="Minimum stars (0-5)" hint="Leave empty to skip the floor.">
        <input
          type="number"
          min="0"
          max="5"
          step="0.1"
          value={minStars}
          onChange={e => setMinStars(e.target.value)}
          placeholder="3.5"
          className="w-32 rounded-md border border-border bg-background px-3 py-2 text-sm"
        />
      </Field>

      <Field
        label="Minimum trip count"
        hint="Star floor only enforced once a counterparty has crossed this. Leaves first-time travelers as 'unknown' instead of trivially blocked."
      >
        <input
          type="number"
          min="0"
          value={minTripCount}
          onChange={e => setMinTripCount(e.target.value)}
          placeholder="3"
          className="w-32 rounded-md border border-border bg-background px-3 py-2 text-sm"
        />
      </Field>

      <Field label="Max dispute ratio (0-1)" hint="Placeholder; not yet enforced.">
        <input
          type="number"
          min="0"
          max="1"
          step="0.05"
          value={maxDisputeRatio}
          onChange={e => setMaxDisputeRatio(e.target.value)}
          placeholder="0.10"
          className="w-32 rounded-md border border-border bg-background px-3 py-2 text-sm"
        />
      </Field>

      <Field
        label="Require KYC"
        hint="Counterparty must have ≥1 ValidationRegistry pass tagged 'kyc_*'."
      >
        <input
          type="checkbox"
          checked={requireKyc}
          onChange={e => setRequireKyc(e.target.checked)}
          className="h-4 w-4"
        />
      </Field>

      <Field
        label="Require KYB"
        hint="For org→org engagements only — counterparty agency must have ≥1 'kyb_*' validation."
      >
        <input
          type="checkbox"
          checked={requireKyb}
          onChange={e => setRequireKyb(e.target.checked)}
          className="h-4 w-4"
        />
      </Field>

      <Field
        label="Enforcement"
        hint="warn = log + surface in dashboard; block = refuse engagement; allow = skip the gate entirely."
      >
        <select
          value={enforcement}
          onChange={e => setEnforcement(e.target.value as 'block' | 'warn' | 'allow')}
          className="w-32 rounded-md border border-border bg-background px-3 py-2 text-sm"
        >
          <option value="warn">warn</option>
          <option value="block">block</option>
          <option value="allow">allow</option>
        </select>
      </Field>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={saving}
          className="rounded-md bg-foreground px-4 py-2 text-sm text-background disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save policy'}
        </button>
        {message ? <span className="text-sm text-muted-foreground">{message}</span> : null}
      </div>
    </form>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-sm font-medium text-foreground">{label}</label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
