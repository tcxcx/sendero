'use client';

/**
 * Phase 7.5.x.yy.y — destructive removal of the Sendero platform
 * recovery owner. Requires explicit user confirmation; once removed,
 * re-adding the platform EOA needs a current-owner-signed proposal
 * (Phase 7.6 flow).
 */

import * as React from 'react';

import { useRouter } from 'next/navigation';

import { Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { removeArcPlatformOwner } from '@/lib/treasury/remove-arc-platform-owner';

interface Props {
  treasuryId: string;
  alreadyRemoved: boolean;
}

export function ArcRemovePlatformButton({ treasuryId, alreadyRemoved }: Props) {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  if (alreadyRemoved) return null;

  async function run() {
    if (
      !window.confirm(
        'Remove the Sendero platform recovery signer? This is irreversible from this surface — re-adding requires a current-owner-signed proposal (Phase 7.6).'
      )
    ) {
      return;
    }
    setPending(true);
    setError(null);
    try {
      const result = await removeArcPlatformOwner({ treasuryId });
      if (result.ok) {
        router.refresh();
      } else {
        setError(result.error);
      }
    } catch (err) {
      setError((err as Error).message ?? 'Removal failed.');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-1.5 w-full">
      <Button type="button" variant="outline" className="w-full" disabled={pending} onClick={run}>
        {pending ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : null}
        Complete self-custody
      </Button>
      {error ? (
        <div className="rounded-md border border-[color:var(--color-destructive)] bg-[color:var(--color-destructive)]/10 p-2 text-[11px] text-[color:var(--color-destructive)]">
          {error}
        </div>
      ) : null}
    </div>
  );
}
