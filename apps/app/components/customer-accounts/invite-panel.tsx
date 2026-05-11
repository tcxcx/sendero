'use client';

import { useState } from 'react';

/**
 * Operator-facing invite-link panel on the customer-account detail page.
 * POSTs to /api/customer-accounts/[id]/invite which mints a signed
 * 1h token, then surfaces the resulting URL for copy / email.
 */
export function CustomerAccountInvitePanel({
  accountId,
  alreadyInstalled,
}: {
  accountId: string;
  alreadyInstalled: boolean;
}) {
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [expiresIn, setExpiresIn] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function mintLink() {
    setError(null);
    setCopied(false);
    setBusy(true);
    try {
      const res = await fetch(`/api/customer-accounts/${accountId}/invite`, {
        method: 'POST',
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body?.error ?? 'request_failed');
        return;
      }
      setInviteUrl(body.inviteUrl);
      setExpiresIn(body.expiresInSeconds);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'network');
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!inviteUrl) return;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard API can be unavailable on non-https / older browsers
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={mintLink}
          disabled={busy}
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
          {busy ? 'Minting…' : inviteUrl ? 'Mint new link' : 'Mint invite link'}
        </button>
        {alreadyInstalled ? (
          <span className="t-meta" style={{ color: 'rgb(34, 138, 86)' }}>
            ✓ Slack already installed
          </span>
        ) : null}
      </div>

      {inviteUrl ? (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            padding: 12,
            background: 'rgba(31, 42, 68, 0.04)',
            borderRadius: 4,
            border: '1px solid var(--hairline-color)',
          }}
        >
          <div className="t-meta">
            Invite URL — expires in {Math.floor((expiresIn ?? 0) / 60)} minutes
          </div>
          <div
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              wordBreak: 'break-all',
              padding: 8,
              background: 'var(--surface-color)',
              borderRadius: 3,
              border: '1px solid var(--hairline-color)',
            }}
          >
            {inviteUrl}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              onClick={copy}
              style={{
                padding: '6px 12px',
                background: 'transparent',
                color: 'var(--ink-color)',
                border: '1px solid var(--hairline-color)',
                borderRadius: 4,
                fontSize: 12,
                cursor: 'pointer',
              }}
            >
              {copied ? 'Copied ✓' : 'Copy link'}
            </button>
            <span className="t-meta ink-60" style={{ alignSelf: 'center' }}>
              Email this to the corporate admin. They click → Slack OAuth → install lands attached
              to this customer account.
            </span>
          </div>
        </div>
      ) : null}

      {error ? (
        <div
          style={{
            fontSize: 12,
            color: 'rgb(196, 84, 56)',
            fontFamily: 'var(--font-mono)',
          }}
        >
          Error: {error}
        </div>
      ) : null}
    </div>
  );
}
