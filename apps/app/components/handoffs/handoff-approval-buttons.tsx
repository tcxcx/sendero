'use client';

import { useState } from 'react';

interface ApprovalButtonsProps {
  handoffId: string;
}

export function HandoffApprovalButtons({ handoffId }: ApprovalButtonsProps) {
  const [note, setNote] = useState('');
  const [status, setStatus] = useState<'idle' | 'submitting' | 'done' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  const submit = async (decision: 'approve' | 'reject') => {
    setStatus('submitting');
    setError(null);
    try {
      const res = await fetch(`/api/handoffs/${handoffId}/${decision}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ note: note.trim() || undefined }),
      });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !body.ok) {
        setStatus('error');
        setError(body.error ?? `Failed (${res.status})`);
        return;
      }
      setStatus('done');
      // Reload after a beat so the page re-renders with the row in
      // the "Recently decided" pane.
      setTimeout(() => {
        window.location.reload();
      }, 700);
    } catch (e) {
      setStatus('error');
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  if (status === 'done') {
    return (
      <div className="t-meta" style={{ color: 'var(--ink, #fb542b)', fontSize: 12 }}>
        Decision recorded. Refreshing…
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <input
        type="text"
        placeholder="Optional note for the agent + audit trail"
        value={note}
        onChange={e => setNote(e.target.value)}
        maxLength={1000}
        disabled={status === 'submitting'}
        style={{
          padding: '8px 10px',
          border: '1px solid var(--border, #d8c1a7)',
          borderRadius: 6,
          background: 'var(--bg-elev, #fdfbf7)',
          fontSize: 13,
        }}
      />
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          type="button"
          disabled={status === 'submitting'}
          onClick={() => submit('approve')}
          style={{
            padding: '8px 14px',
            borderRadius: 6,
            border: '1px solid var(--ink, #fb542b)',
            background: 'var(--ink, #fb542b)',
            color: '#fff',
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            cursor: status === 'submitting' ? 'not-allowed' : 'pointer',
            opacity: status === 'submitting' ? 0.5 : 1,
          }}
        >
          {status === 'submitting' ? 'Submitting…' : 'Approve'}
        </button>
        <button
          type="button"
          disabled={status === 'submitting'}
          onClick={() => submit('reject')}
          style={{
            padding: '8px 14px',
            borderRadius: 6,
            border: '1px solid var(--accent-rose, #b54848)',
            background: 'transparent',
            color: 'var(--accent-rose, #b54848)',
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            cursor: status === 'submitting' ? 'not-allowed' : 'pointer',
            opacity: status === 'submitting' ? 0.5 : 1,
          }}
        >
          Reject
        </button>
      </div>
      {error ? (
        <span style={{ color: 'var(--accent-rose, #b54848)', fontSize: 12 }}>{error}</span>
      ) : null}
    </div>
  );
}
