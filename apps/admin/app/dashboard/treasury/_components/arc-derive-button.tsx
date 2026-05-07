'use client';

/**
 * Phase 7.5.x — kicks the counterfactual derivation server action.
 *
 * Available when the Arc treasury row is in `status='intent'`. On
 * success, the server action updates the row to `status='pending'`
 * with the real Circle MSCA address; this component calls
 * `router.refresh()` so the parent card re-reads the row.
 */

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { deriveArcMscaCounterfactual } from '@/lib/treasury/deploy-arc-msca';

interface Props {
  treasuryId: string;
  status: string;
}

export function ArcDeriveButton({ treasuryId, status }: Props) {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Phase 7.5.x derivation only applies to intent rows. Once status
  // is 'pending' or 'live', the button hides — proposal-execution
  // surfaces (Phase 7.6) take over.
  if (status !== 'intent') return null;

  async function run() {
    setPending(true);
    setError(null);
    try {
      const result = await deriveArcMscaCounterfactual({ treasuryId });
      if (result.ok) {
        router.refresh();
      } else {
        setError(result.error);
      }
    } catch (err) {
      setError((err as Error).message ?? 'Derivation failed.');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-1.5 w-full">
      <Button
        type="button"
        variant="default"
        className="w-full"
        disabled={pending}
        onClick={run}
      >
        {pending ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : null}
        Derive Circle MSCA address
      </Button>
      {error ? (
        <div className="rounded-md border border-[color:var(--color-destructive)] bg-[color:var(--color-destructive)]/10 p-2 text-[11px] text-[color:var(--color-destructive)]">
          {error}
        </div>
      ) : null}
    </div>
  );
}
