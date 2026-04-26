'use client';

/**
 * Polymorphic editor for a single TransferPolicy row.
 *
 * Scope picker + guard-kind picker drive which fields render below.
 * The form posts to a server action passed in as `action`; the parent
 * route picks `createTransferPolicy` or `updateTransferPolicy`.
 *
 * Validation is server-side (in actions.ts) — bad config redirects
 * back here with `?error=…`. The runtime parser at
 * apps/app/lib/transfer-policy/parse.ts is the second line of defense
 * if a row sneaks through.
 */

import { useState } from 'react';

type GuardKind = 'budget' | 'single_tx' | 'recipient' | 'rate_limit' | 'confirm';
type Scope = 'tenant' | 'traveler' | 'tool';

interface TravelerOption {
  id: string;
  label: string;
}

export interface PolicyEditorInitial {
  id?: string;
  scope: Scope;
  travelerId?: string | null;
  toolName?: string | null;
  guardKind: GuardKind;
  config: Record<string, unknown>;
  hardCap: boolean;
  alertWebhookUrl: string | null;
  enabled: boolean;
  priority: number;
}

interface PolicyEditorProps {
  /** Server action — receives FormData. */
  action: (formData: FormData) => void;
  /** Whether this is an edit; controls submit button copy. */
  isEdit: boolean;
  /** Lock the scope (used by the per-traveler view). */
  lockedScope?: Scope;
  /** Lock subject id (e.g. travelerId for the per-traveler editor). */
  lockedTravelerId?: string;
  /** Travelers in this tenant for the dropdown. */
  travelers: TravelerOption[];
  /** Pre-fill values when editing. */
  initial?: PolicyEditorInitial;
  /** Server-side error pushed via `?error=…`. */
  error?: string | null;
}

const KIND_LABEL: Record<GuardKind, string> = {
  budget: 'Budget',
  single_tx: 'Single transaction',
  recipient: 'Recipient list',
  rate_limit: 'Rate limit',
  confirm: 'Manual approval',
};

export function PolicyEditor({
  action,
  isEdit,
  lockedScope,
  lockedTravelerId,
  travelers,
  initial,
  error,
}: PolicyEditorProps) {
  const [scope, setScope] = useState<Scope>(lockedScope ?? initial?.scope ?? 'tenant');
  const [guardKind, setGuardKind] = useState<GuardKind>(initial?.guardKind ?? 'budget');

  return (
    <form
      action={action}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 18,
        padding: '24px 28px',
      }}
      className="sd-card-raised"
    >
      {initial?.id ? <input type="hidden" name="id" value={initial.id} /> : null}

      <div className="t-meta">Rule</div>

      <RuleRow label="Scope">
        {lockedScope ? (
          <>
            <input type="hidden" name="scope" value={lockedScope} />
            <ReadOnlyField
              value={`${lockedScope.charAt(0).toUpperCase() + lockedScope.slice(1)} (locked)`}
            />
          </>
        ) : (
          <select
            name="scope"
            value={scope}
            onChange={e => setScope(e.target.value as Scope)}
            style={fieldStyle}
            className="t-body"
          >
            <option value="tenant">Tenant — every payment for this org</option>
            <option value="traveler">Traveler — per-user policy</option>
            <option value="tool">Tool — per-x402 tool call</option>
          </select>
        )}
      </RuleRow>

      {scope === 'traveler' ? (
        <RuleRow label="Traveler">
          {lockedTravelerId ? (
            <>
              <input type="hidden" name="travelerId" value={lockedTravelerId} />
              <ReadOnlyField
                value={
                  travelers.find(t => t.id === lockedTravelerId)?.label ??
                  `${lockedTravelerId.slice(0, 12)}…`
                }
              />
            </>
          ) : (
            <select
              name="travelerId"
              defaultValue={initial?.travelerId ?? ''}
              style={fieldStyle}
              className="t-body"
              required
            >
              <option value="">Select traveler…</option>
              {travelers.map(t => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          )}
        </RuleRow>
      ) : null}

      {scope === 'tool' ? (
        <RuleRow label="Tool name">
          <input
            name="toolName"
            defaultValue={initial?.toolName ?? ''}
            placeholder="duffel.search"
            style={fieldStyle}
            className="t-mono"
            required
          />
        </RuleRow>
      ) : null}

      <RuleRow label="Guard">
        <select
          name="guardKind"
          value={guardKind}
          onChange={e => setGuardKind(e.target.value as GuardKind)}
          style={fieldStyle}
          className="t-body"
        >
          {(Object.keys(KIND_LABEL) as GuardKind[]).map(k => (
            <option key={k} value={k}>
              {KIND_LABEL[k]}
            </option>
          ))}
        </select>
      </RuleRow>

      <hr aria-hidden style={hairlineSoft} />

      {guardKind === 'budget' ? (
        <BudgetFields initial={initial} />
      ) : guardKind === 'single_tx' ? (
        <SingleTxFields initial={initial} />
      ) : guardKind === 'recipient' ? (
        <RecipientFields initial={initial} />
      ) : guardKind === 'rate_limit' ? (
        <RateLimitFields initial={initial} />
      ) : (
        <ConfirmFields initial={initial} />
      )}

      <hr aria-hidden style={hairlineSoft} />

      <RuleRow label="Priority">
        <input
          name="priority"
          type="number"
          min={0}
          max={1000}
          defaultValue={initial?.priority ?? 100}
          style={fieldStyle}
          className="t-mono"
        />
        <span className="t-mono ink-60" style={{ fontSize: 10, marginLeft: 12 }}>
          Lower runs first in the chain.
        </span>
      </RuleRow>

      <RuleRow label="Enabled">
        <label
          style={{
            ...fieldStyle,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            cursor: 'pointer',
          }}
        >
          <input
            type="checkbox"
            name="enabled"
            defaultChecked={initial?.enabled ?? true}
            style={{ accentColor: 'var(--vermillion)' }}
          />
          <span className="t-body" style={{ fontSize: 13 }}>
            Active — uncheck to keep the row but stop applying the guard.
          </span>
        </label>
      </RuleRow>

      {error ? (
        <div
          style={{
            padding: '8px 12px',
            background: 'var(--tint-vermillion-soft)',
            color: 'var(--vermillion)',
            fontFamily: 'var(--font-mono-x)',
            fontSize: 11,
            borderRadius: 6,
          }}
        >
          {error}
        </div>
      ) : null}

      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <a
          href="/dashboard/caps/policies"
          className="sd-pill sd-pill-outline"
          style={ghostBtnStyle}
        >
          Cancel
        </a>
        <span style={{ flex: 1 }} />
        <button type="submit" style={primaryBtnStyle}>
          {isEdit ? 'Save changes' : 'Create policy'}
        </button>
      </div>
    </form>
  );
}

// ── per-kind field groups ──────────────────────────────────────

function BudgetFields({ initial }: { initial?: PolicyEditorInitial }) {
  const cfg = initial?.guardKind === 'budget' ? (initial.config ?? {}) : {};
  const period = (cfg as Record<string, unknown>).period;
  const cap = (cfg as Record<string, unknown>).capMicroUsdc;
  return (
    <>
      <RuleRow label="Period">
        <select
          name="period"
          defaultValue={typeof period === 'string' ? period : 'daily'}
          style={fieldStyle}
          className="t-body"
        >
          <option value="daily">Daily — rolls every 24h UTC</option>
          <option value="weekly">Weekly — trailing 7 days</option>
          <option value="monthly">Monthly — rolls on the 1st</option>
        </select>
      </RuleRow>

      <RuleRow label="Cap">
        <UsdcInput name="capUsdc" defaultValue={microStringToDecimal(cap)} placeholder="50.00" />
      </RuleRow>

      <RuleRow label="Type">
        <label
          style={{
            ...fieldStyle,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            cursor: 'pointer',
          }}
        >
          <input
            type="checkbox"
            name="hardCap"
            defaultChecked={initial?.hardCap ?? true}
            style={{ accentColor: 'var(--vermillion)' }}
          />
          <span className="t-body" style={{ fontSize: 13 }}>
            Hard cap — reject when threshold is crossed (uncheck for soft / alert-only)
          </span>
        </label>
      </RuleRow>

      <RuleRow label="Alert webhook">
        <input
          name="alertWebhookUrl"
          type="url"
          defaultValue={initial?.alertWebhookUrl ?? ''}
          placeholder="https://hooks.example.com/cap-breach (optional)"
          style={fieldStyle}
          className="t-mono"
        />
      </RuleRow>
    </>
  );
}

function SingleTxFields({ initial }: { initial?: PolicyEditorInitial }) {
  const cfg = initial?.guardKind === 'single_tx' ? (initial.config ?? {}) : {};
  return (
    <RuleRow label="Max per tx">
      <UsdcInput
        name="maxUsdc"
        defaultValue={microStringToDecimal((cfg as Record<string, unknown>).maxMicroUsdc)}
        placeholder="5.00"
      />
    </RuleRow>
  );
}

function RecipientFields({ initial }: { initial?: PolicyEditorInitial }) {
  const cfg = initial?.guardKind === 'recipient' ? (initial.config ?? {}) : {};
  const mode = (cfg as Record<string, unknown>).mode;
  const addresses = (cfg as Record<string, unknown>).addresses;
  const addressLines = Array.isArray(addresses) ? (addresses as string[]).join('\n') : '';
  return (
    <>
      <RuleRow label="Mode">
        <select
          name="mode"
          defaultValue={typeof mode === 'string' ? mode : 'allow'}
          style={fieldStyle}
          className="t-body"
        >
          <option value="allow">Allow — only these addresses are accepted</option>
          <option value="deny">Deny — these addresses are blocked, rest pass</option>
        </select>
      </RuleRow>
      <RuleRow label="Addresses">
        <textarea
          name="addresses"
          defaultValue={addressLines}
          placeholder={'0xabc...\n0xdef...'}
          rows={5}
          style={{
            ...fieldStyle,
            fontFamily: 'var(--font-mono-x)',
            fontSize: 12,
            resize: 'vertical',
          }}
          required
        />
      </RuleRow>
    </>
  );
}

function RateLimitFields({ initial }: { initial?: PolicyEditorInitial }) {
  const cfg = initial?.guardKind === 'rate_limit' ? (initial.config ?? {}) : {};
  const maxCount = (cfg as Record<string, unknown>).maxCount;
  const windowMs = (cfg as Record<string, unknown>).windowMs;
  return (
    <>
      <RuleRow label="Max count">
        <input
          name="maxCount"
          type="number"
          min={1}
          defaultValue={typeof maxCount === 'number' ? maxCount : 10}
          style={fieldStyle}
          className="t-mono"
          required
        />
      </RuleRow>
      <RuleRow label="Window">
        <select
          name="windowMs"
          defaultValue={typeof windowMs === 'number' ? String(windowMs) : '60000'}
          style={fieldStyle}
          className="t-body"
        >
          <option value="60000">1 minute</option>
          <option value="300000">5 minutes</option>
          <option value="3600000">1 hour</option>
          <option value="86400000">24 hours</option>
        </select>
      </RuleRow>
    </>
  );
}

function ConfirmFields({ initial }: { initial?: PolicyEditorInitial }) {
  const cfg = initial?.guardKind === 'confirm' ? (initial.config ?? {}) : {};
  return (
    <>
      <RuleRow label="Trigger ≥">
        <UsdcInput
          name="triggerUsdc"
          defaultValue={microStringToDecimal((cfg as Record<string, unknown>).triggerAtMicroUsdc)}
          placeholder="0 — every payment requires approval"
        />
      </RuleRow>
      <RuleRow label="Reason">
        <input
          name="reason"
          defaultValue={String((cfg as Record<string, unknown>).reason ?? '')}
          placeholder="finance review (optional)"
          style={fieldStyle}
          className="t-body"
        />
      </RuleRow>
    </>
  );
}

// ── atoms ──────────────────────────────────────────────────────

function RuleRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
      <div className="t-meta" style={{ width: 140, flexShrink: 0 }}>
        {label}
      </div>
      <div
        style={{
          flex: 1,
          minWidth: 240,
          display: 'flex',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 8,
        }}
      >
        {children}
      </div>
    </div>
  );
}

function ReadOnlyField({ value }: { value: string }) {
  return (
    <div style={fieldStyle}>
      <span className="t-body" style={{ fontSize: 13 }}>
        {value}
      </span>
    </div>
  );
}

function UsdcInput({
  name,
  defaultValue,
  placeholder,
}: {
  name: string;
  defaultValue: string;
  placeholder: string;
}) {
  return (
    <div style={{ ...fieldStyle, display: 'flex', alignItems: 'center', gap: 8 }}>
      <span className="t-mono ink-60" style={{ fontSize: 13 }}>
        $
      </span>
      <input
        name={name}
        defaultValue={defaultValue}
        pattern="\d+(\.\d{1,6})?"
        placeholder={placeholder}
        style={{
          flex: 1,
          border: 0,
          outline: 'none',
          background: 'transparent',
          fontFamily: 'var(--font-mono-x)',
          fontSize: 14,
          color: 'var(--midnight)',
        }}
      />
      <span className="t-mono ink-60" style={{ fontSize: 11 }}>
        USDC
      </span>
    </div>
  );
}

function microStringToDecimal(value: unknown): string {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return '';
  const n = BigInt(value);
  const whole = n / 1_000_000n;
  const frac = n % 1_000_000n;
  if (frac === 0n) return whole.toString();
  const fracStr = frac.toString().padStart(6, '0').replace(/0+$/, '');
  return `${whole}.${fracStr}`;
}

const fieldStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 240,
  padding: '10px 14px',
  background: 'var(--surface-floating)',
  borderRadius: 8,
  boxShadow: 'inset 0 0 0 1px var(--hairline-color-soft)',
  border: 0,
  fontFamily: 'var(--font-sans)',
  fontSize: 13,
  color: 'var(--midnight)',
};

const primaryBtnStyle: React.CSSProperties = {
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

const ghostBtnStyle: React.CSSProperties = {
  padding: '6px 14px',
  background: 'transparent',
  color: 'var(--midnight)',
  border: 0,
  boxShadow: 'inset 0 0 0 1px var(--hairline-color)',
  borderRadius: 8,
  fontSize: 11,
  fontWeight: 600,
  fontFamily: 'var(--font-mono-x)',
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  cursor: 'pointer',
  textDecoration: 'none',
  display: 'inline-flex',
  alignItems: 'center',
};

const hairlineSoft: React.CSSProperties = {
  border: 0,
  height: 1,
  background: 'var(--hairline-color-soft)',
  margin: 0,
};
