'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

/**
 * Operator form on /dashboard/customer-accounts that POSTs a new
 * CustomerAccount and routes to its detail page.
 */
export function CreateCustomerAccountForm() {
  const router = useRouter();
  const [displayName, setDisplayName] = useState('');
  const [primaryDomain, setPrimaryDomain] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await fetch('/api/customer-accounts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          displayName: displayName.trim(),
          primaryDomain: primaryDomain.trim() || undefined,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body?.error ?? 'request_failed');
        return;
      }
      const id = body?.account?.id;
      if (id) {
        router.push(`/dashboard/customer-accounts/${id}`);
      } else {
        router.refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'network');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      style={{
        display: 'grid',
        gridTemplateColumns: '1.4fr 1.2fr auto',
        gap: 8,
        alignItems: 'end',
      }}
    >
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span className="t-meta">Display name</span>
        <input
          required
          value={displayName}
          onChange={e => setDisplayName(e.target.value)}
          placeholder="AcmeCorp Travel"
          minLength={1}
          maxLength={200}
          disabled={busy}
          style={inputStyle}
        />
      </label>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span className="t-meta">Primary domain (optional)</span>
        <input
          value={primaryDomain}
          onChange={e => setPrimaryDomain(e.target.value)}
          placeholder="acmecorp.com"
          pattern="[a-z0-9.-]+\.[a-z]{2,}"
          disabled={busy}
          style={inputStyle}
        />
      </label>
      <button
        type="submit"
        disabled={busy || !displayName.trim()}
        style={{
          padding: '8px 16px',
          background: 'var(--ink-color)',
          color: 'var(--surface-color)',
          border: 'none',
          borderRadius: 4,
          fontSize: 13,
          fontWeight: 600,
          cursor: busy ? 'wait' : 'pointer',
          opacity: busy ? 0.6 : 1,
        }}
      >
        {busy ? 'Creating…' : 'Add account'}
      </button>
      {error ? (
        <div
          style={{
            gridColumn: '1 / -1',
            fontSize: 12,
            color: 'rgb(196, 84, 56)',
            fontFamily: 'var(--font-mono)',
          }}
        >
          {error === 'domain_already_registered'
            ? 'A customer account with that primary domain already exists.'
            : `Error: ${error}`}
        </div>
      ) : null}
    </form>
  );
}

const inputStyle: React.CSSProperties = {
  padding: '8px 10px',
  border: '1px solid var(--hairline-color)',
  borderRadius: 4,
  fontSize: 13,
  fontFamily: 'inherit',
  background: 'var(--surface-color)',
};
