'use client';

/**
 * Trip-scoped channel picker. Lets the traveler (or booking agent) pick
 * the primary nudge channel for this trip. Persists to
 * `Trip.channelBindings` via PATCH /api/trips/:id/channel-bindings.
 */

import { Button } from '@sendero/ui/button';
import { useState, useTransition } from 'react';

type Channel = 'whatsapp' | 'slack' | 'email' | 'web';

const OPTIONS: Array<{ value: Channel; label: string; hint: string }> = [
  { value: 'whatsapp', label: 'WhatsApp', hint: 'Most responsive for disruptions.' },
  { value: 'slack', label: 'Slack', hint: 'For employees on Slack-first orgs.' },
  { value: 'email', label: 'Email', hint: 'Formal record / out-of-band backup.' },
  { value: 'web', label: 'In-app only', hint: 'No push nudges.' },
];

export function TripChannelPicker({
  tripId,
  initial,
  disabled,
}: {
  tripId: string;
  initial: Channel;
  disabled?: boolean;
}) {
  const [primary, setPrimary] = useState<Channel>(initial);
  const [pending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function save(next: Channel) {
    setPrimary(next);
    setSaved(false);
    setError(null);
    startTransition(async () => {
      const res = await fetch(`/api/trips/${tripId}/channel-bindings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ primary: next }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? 'Failed to save');
        return;
      }
      setSaved(true);
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <span className="font-mono text-xs uppercase tracking-[0.12em] text-muted-foreground">
        Nudge channel
      </span>
      <div className="flex flex-wrap gap-2">
        {OPTIONS.map(opt => (
          <Button
            key={opt.value}
            type="button"
            variant={primary === opt.value ? 'default' : 'outline'}
            size="sm"
            disabled={disabled || pending}
            onClick={() => save(opt.value)}
            title={opt.hint}
          >
            {opt.label}
          </Button>
        ))}
      </div>
      {error ? <span className="text-xs text-red-700">{error}</span> : null}
      {saved ? <span className="text-xs text-muted-foreground">Saved.</span> : null}
    </div>
  );
}
