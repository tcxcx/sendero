'use client';

/**
 * Phase 7.5.x.y — submits the bootstrap userOp via Circle's bundler
 * to lazy-deploy the MSCA. Visible when status='pending'.
 *
 * On success: status flips to 'live', the parent card re-reads the
 * row via router.refresh() and shows the userOpHash.
 */

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { deployArcMscaUserOp } from '@/lib/treasury/deploy-arc-msca-userop';

interface Props {
  treasuryId: string;
  status: string;
}

export function ArcDeployButton({ treasuryId, status }: Props) {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Only relevant in the pending state. Intent rows go through the
  // derive button; live rows go through the proposal-execution flow.
  if (status !== 'pending') return null;

  async function run() {
    setPending(true);
    setError(null);
    try {
      const result = await deployArcMscaUserOp({ treasuryId });
      if (result.ok) {
        router.refresh();
      } else {
        setError(result.error);
      }
    } catch (err) {
      setError((err as Error).message ?? 'Deploy failed.');
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
        Deploy MSCA on Arc (Gas Station sponsored)
      </Button>
      {error ? (
        <div className="rounded-md border border-[color:var(--color-destructive)] bg-[color:var(--color-destructive)]/10 p-2 text-[11px] text-[color:var(--color-destructive)]">
          {error}
        </div>
      ) : null}
    </div>
  );
}
