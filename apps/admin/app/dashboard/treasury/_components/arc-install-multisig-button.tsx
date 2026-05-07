'use client';

/**
 * Phase 7.5.x.yy — installs the multi-owner weighted multisig
 * config on a deployed Arc MSCA. Visible when `status='live'` AND
 * `multisigInstalledAt` is null.
 */

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { installArcMultisig } from '@/lib/treasury/install-arc-multisig';

interface Props {
  treasuryId: string;
  alreadyInstalled: boolean;
}

export function ArcInstallMultisigButton({ treasuryId, alreadyInstalled }: Props) {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  if (alreadyInstalled) return null;

  async function run() {
    setPending(true);
    setError(null);
    try {
      const result = await installArcMultisig({ treasuryId });
      if (result.ok) {
        router.refresh();
      } else {
        setError(result.error);
      }
    } catch (err) {
      setError((err as Error).message ?? 'Install failed.');
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
        Install weighted multisig (Gas Station sponsored)
      </Button>
      {error ? (
        <div className="rounded-md border border-[color:var(--color-destructive)] bg-[color:var(--color-destructive)]/10 p-2 text-[11px] text-[color:var(--color-destructive)]">
          {error}
        </div>
      ) : null}
    </div>
  );
}
