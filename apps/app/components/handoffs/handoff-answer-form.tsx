'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

interface HandoffAnswerFormProps {
  handoffId: string;
  /** Optional placeholder for the answer textarea. */
  placeholder?: string;
}

export function HandoffAnswerForm({ handoffId, placeholder }: HandoffAnswerFormProps) {
  const router = useRouter();
  const [answer, setAnswer] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = async () => {
    const value = answer.trim();
    if (!value) {
      setError('Type an answer first.');
      return;
    }
    setError(null);
    try {
      const res = await fetch(`/api/internal/handoffs/${handoffId}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answer: value }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
        setError(data.message ?? data.error ?? `HTTP ${res.status}`);
        return;
      }
      setAnswer('');
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send');
    }
  };

  return (
    <form
      onSubmit={e => {
        e.preventDefault();
        void submit();
      }}
      style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
    >
      <textarea
        value={answer}
        onChange={e => setAnswer(e.target.value)}
        placeholder={placeholder ?? 'Answer the traveler — short, in their voice…'}
        rows={3}
        disabled={pending}
        style={{
          width: '100%',
          padding: '10px 12px',
          fontSize: 13,
          lineHeight: 1.5,
          border: '1px solid var(--hairline-color)',
          borderRadius: 8,
          background: 'var(--surface-raised)',
          color: 'var(--ink)',
          fontFamily: 'inherit',
          resize: 'vertical',
        }}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, justifyContent: 'flex-end' }}>
        {error ? (
          <span className="t-meta" style={{ color: 'var(--accent-rose)' }}>
            {error}
          </span>
        ) : null}
        <button
          type="submit"
          disabled={pending || !answer.trim()}
          style={{
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
            cursor: pending ? 'wait' : 'pointer',
            opacity: pending || !answer.trim() ? 0.6 : 1,
          }}
        >
          {pending ? 'Sending…' : 'Send to traveler'}
        </button>
      </div>
    </form>
  );
}
