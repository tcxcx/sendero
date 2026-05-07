'use client';

import * as React from 'react';
import { Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { provisionArcMultisigIntent } from '@/lib/treasury/provision-arc';

/**
 * Arc Circle MSCA provisioning form (Phase 7.5 intent mode).
 *
 * Submits to a server action that persists a `SuperOrgTreasury` row
 * with status `'intent'`. The actual on-chain MSCA deploy (Phase
 * 7.5.x) replaces the placeholder address + flips status to `live`.
 */
export function ArcProvisionForm() {
  const [pending, setPending] = React.useState(false);
  const [result, setResult] = React.useState<
    | null
    | { ok: true; placeholderAddress: string; threshold: number; members: string[] }
    | { ok: false; error: string }
  >(null);

  async function handleSubmit(formData: FormData) {
    setPending(true);
    setResult(null);
    const raw = (formData.get('memberAddresses') as string) ?? '';
    const memberAddresses = raw
      .split(/\s+/)
      .map(s => s.trim())
      .filter(Boolean);
    const threshold = Number(formData.get('threshold') ?? 1);
    const r = await provisionArcMultisigIntent({ memberAddresses, threshold });
    setResult(r);
    setPending(false);
  }

  return (
    <form action={handleSubmit} className="space-y-4">
      <div className="space-y-1.5">
        <label htmlFor="memberAddresses" className="block text-sm font-medium">
          Member EVM addresses
        </label>
        <textarea
          id="memberAddresses"
          name="memberAddresses"
          rows={4}
          required
          className="w-full rounded-md border bg-[color:var(--color-background)] px-3 py-2 font-mono text-xs"
          placeholder="One 0x-prefixed EVM address per line."
        />
      </div>
      <div className="flex items-center gap-3">
        <label htmlFor="threshold-arc" className="text-sm font-medium">
          Threshold
        </label>
        <input
          id="threshold-arc"
          name="threshold"
          type="number"
          min={1}
          defaultValue={1}
          required
          className="w-20 rounded-md border bg-[color:var(--color-background)] px-2 py-1 text-sm"
        />
        <span className="text-xs text-[color:var(--color-muted-foreground)]">
          signatures required to execute
        </span>
      </div>
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Reserving intent…
          </>
        ) : (
          'Reserve treasury intent'
        )}
      </Button>
      <p className="text-[11px] text-[color:var(--color-muted-foreground)]">
        Intent mode — persists the desired members + threshold. On-chain
        Circle MSCA deployment lands in Phase 7.5.x (counterfactual address +
        Gas Station paymaster + bundler glue).
      </p>
      {result?.ok === true ? (
        <div className="space-y-1 rounded-md border bg-[color:var(--color-muted)] p-3 text-xs">
          <div className="font-medium text-[color:var(--color-foreground)]">
            Intent reserved ✓
          </div>
          <div>
            Placeholder: <code className="break-all">{result.placeholderAddress}</code>
          </div>
          <div>
            {result.threshold} of {result.members.length} signers
          </div>
        </div>
      ) : null}
      {result?.ok === false ? (
        <div className="rounded-md border border-[color:var(--color-destructive)] bg-[color:var(--color-destructive)]/10 p-3 text-xs text-[color:var(--color-destructive)]">
          {result.error}
        </div>
      ) : null}
    </form>
  );
}
