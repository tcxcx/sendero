'use client';

import * as React from 'react';

import { Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { provisionArcMultisigIntent } from '@/lib/treasury/provision-arc';

import { ApproverAddressFields } from './approver-address-fields';

/**
 * Arc treasury onboarding form.
 */
export function ArcProvisionForm() {
  const [pending, setPending] = React.useState(false);
  const [addressesValid, setAddressesValid] = React.useState(false);
  const [result, setResult] = React.useState<
    | null
    | { ok: true; placeholderAddress: string; threshold: number; members: string[] }
    | { ok: false; error: string }
  >(null);

  async function handleSubmit(formData: FormData) {
    if (!addressesValid) return;
    setPending(true);
    setResult(null);
    const memberAddresses = formData
      .getAll('memberAddresses')
      .map(value => String(value).trim())
      .filter(Boolean);
    const threshold = Number(formData.get('threshold') ?? 1);
    const r = await provisionArcMultisigIntent({ memberAddresses, threshold });
    setResult(r);
    setPending(false);
  }

  return (
    <form action={handleSubmit} className="space-y-3">
      <ApproverAddressFields
        kind="evm"
        name="memberAddresses"
        disabled={pending}
        onValidityChange={setAddressesValid}
      />
      <div className="flex flex-wrap items-center gap-3">
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
          className="h-9 w-20 rounded-md border bg-[color:var(--color-background)] px-2 text-sm"
        />
        <span className="text-xs text-[color:var(--color-muted-foreground)]">
          approvals required
        </span>
      </div>
      <Button type="submit" disabled={pending || !addressesValid} className="w-full">
        {pending ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Creating treasury…
          </>
        ) : (
          'Create Arc treasury'
        )}
      </Button>
      {result?.ok === true ? (
        <div className="space-y-1 rounded-md border bg-[color:var(--color-muted)] p-3 text-xs">
          <div className="font-medium text-[color:var(--color-foreground)]">
            Arc treasury setup started
          </div>
          <div>
            Reserved address: <code className="break-all">{result.placeholderAddress}</code>
          </div>
          <div>
            {result.threshold} of {result.members.length} approvers
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
