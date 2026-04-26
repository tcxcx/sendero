'use client';

/**
 * "New trip" button — quick-create a draft Trip and bounce the
 * operator into the trip detail page. Distinct from the prefund flow
 * (`Create prepaid trip`), which mints an escrow + claim link via
 * /api/guest/invite. A trip can be prefunded later from its detail
 * page; this button is the lightweight primitive.
 */

import { useState, useTransition } from 'react';

import { useRouter } from 'next/navigation';

import { Button } from '@sendero/ui/button';

interface Props {
  label: string;
}

export function NewTripButton({ label }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const onClick = () => {
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch('/api/trips/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });
        if (!res.ok) {
          const text = await res.text().catch(() => '');
          setError(text || 'Failed to create trip.');
          return;
        }
        const data = (await res.json()) as { href?: string };
        if (data.href) {
          router.push(data.href);
        } else {
          router.refresh();
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to create trip.');
      }
    });
  };

  return (
    <div
      style={{ display: 'inline-flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end' }}
    >
      <Button variant="outline" onClick={onClick} disabled={pending}>
        {pending ? 'Creating…' : label}
      </Button>
      {error ? (
        <span className="t-mono" style={{ fontSize: 10, color: 'var(--vermillion)' }}>
          {error}
        </span>
      ) : null}
    </div>
  );
}
