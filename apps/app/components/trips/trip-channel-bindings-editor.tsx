'use client';

/**
 * TripChannelBindingsEditor — small per-trip editor that calls
 * `PATCH /api/trips/:id/channel-bindings`. Lets an operator (or the
 * trip's traveler) set the primary channel for a trip and pick which
 * other channels get notify copies.
 *
 * The shape here matches the zod validator on the API route exactly:
 *   { primary: 'whatsapp'|'slack'|'email'|'web',
 *     notifyChannels?: ChannelKind[] }
 *
 * The `whatsapp.identityId` and `slack.channelId` deep paths the API
 * also accepts are not exposed here — those need an identity picker
 * UI we don't have yet. Operators who need that level of routing
 * still hit the JSON API directly.
 */

import { useState, useTransition } from 'react';

type ChannelKind = 'whatsapp' | 'slack' | 'email' | 'web';

const CHANNELS: Array<{ value: ChannelKind; label: string }> = [
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'slack', label: 'Slack' },
  { value: 'email', label: 'Email' },
  { value: 'web', label: 'Web' },
];

type Bindings = {
  primary: ChannelKind;
  notifyChannels?: ChannelKind[];
};

export function TripChannelBindingsEditor({
  tripId,
  initial,
}: {
  tripId: string;
  initial: Bindings | null;
}) {
  const [primary, setPrimary] = useState<ChannelKind>(initial?.primary ?? 'web');
  const [notify, setNotify] = useState<Set<ChannelKind>>(new Set(initial?.notifyChannels ?? []));
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const toggleNotify = (c: ChannelKind) => {
    setNotify(prev => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      return next;
    });
  };

  const save = () => {
    setStatus('saving');
    setErrorMsg(null);
    startTransition(async () => {
      try {
        const res = await fetch(`/api/trips/${tripId}/channel-bindings`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            primary,
            notifyChannels: Array.from(notify).filter(c => c !== primary),
          }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          setStatus('error');
          setErrorMsg(body.error ?? `HTTP ${res.status}`);
          return;
        }
        setStatus('saved');
        setTimeout(() => setStatus('idle'), 1500);
      } catch (err) {
        setStatus('error');
        setErrorMsg(err instanceof Error ? err.message : 'Unknown error');
      }
    });
  };

  return (
    <section className="flex flex-col gap-3 rounded-[var(--radius-lg)] bg-[color:var(--surface-raised)] p-5 shadow-[var(--shadow-md)]">
      <header className="flex items-baseline justify-between gap-2">
        <h3 className="text-[15px] font-semibold tracking-normal text-foreground">
          Channel routing
        </h3>
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-[color:var(--text-faint)]">
          per trip
        </span>
      </header>

      <div className="flex flex-col gap-1.5">
        <label className="font-mono text-[10px] uppercase tracking-[0.12em] text-[color:var(--text-dim)]">
          Primary channel
        </label>
        <div className="flex flex-wrap gap-1.5">
          {CHANNELS.map(c => (
            <button
              key={c.value}
              type="button"
              onClick={() => setPrimary(c.value)}
              className={
                'rounded-full border px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] transition-colors ' +
                (primary === c.value
                  ? 'border-[color:var(--ink)] bg-[color:var(--ink)] text-white'
                  : 'border-[color:color-mix(in_oklab,var(--ink)_22%,transparent)] bg-transparent text-[color:var(--text)] hover:border-[color:var(--ink)] hover:text-[color:var(--ink)]')
              }
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="font-mono text-[10px] uppercase tracking-[0.12em] text-[color:var(--text-dim)]">
          Also notify (CC)
        </label>
        <div className="flex flex-wrap gap-1.5">
          {CHANNELS.filter(c => c.value !== primary).map(c => {
            const on = notify.has(c.value);
            return (
              <button
                key={c.value}
                type="button"
                onClick={() => toggleNotify(c.value)}
                className={
                  'rounded-full border px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] transition-colors ' +
                  (on
                    ? 'border-[color:var(--ink)] bg-[color:var(--tint-vermillion-soft)] text-[color:var(--ink)]'
                    : 'border-[color:color-mix(in_oklab,var(--ink)_18%,transparent)] bg-transparent text-[color:var(--text-dim)] hover:border-[color:var(--ink)] hover:text-[color:var(--ink)]')
                }
              >
                {c.label}
                {on ? ' ✓' : ''}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex items-center gap-2 pt-1">
        <button
          type="button"
          onClick={save}
          disabled={pending || status === 'saving'}
          className="rounded-md bg-[color:var(--ink)] px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-white transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {status === 'saving' ? 'Saving…' : 'Save'}
        </button>
        {status === 'saved' ? (
          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-[color:var(--accent-green)]">
            Saved
          </span>
        ) : null}
        {status === 'error' && errorMsg ? (
          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-[color:var(--accent-rose)]">
            {errorMsg}
          </span>
        ) : null}
      </div>
    </section>
  );
}
