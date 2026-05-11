'use client';

import * as React from 'react';

import { Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { provisionSolanaMultisig } from '@/lib/treasury/provision-solana';

import { ApproverAddressFields } from './approver-address-fields';

/**
 * Solana treasury onboarding form.
 */
export function SolanaProvisionForm() {
  const [pending, setPending] = React.useState(false);
  const [addressesValid, setAddressesValid] = React.useState(false);
  const [result, setResult] = React.useState<
    | null
    | { ok: true; multisigAddress: string; vaultAddress: string; txSignature: string }
    | { ok: false; error: string }
  >(null);

  async function handleSubmit(formData: FormData) {
    if (!addressesValid) return;
    setPending(true);
    setResult(null);
    const memberPubkeys = formData
      .getAll('memberPubkeys')
      .map(value => String(value).trim())
      .filter(Boolean);
    const threshold = Number(formData.get('threshold') ?? 1);
    const r = await provisionSolanaMultisig({ memberPubkeys, threshold });
    setResult(r);
    setPending(false);
  }

  return (
    <form action={handleSubmit} className="space-y-3">
      <ApproverAddressFields
        kind="solana"
        name="memberPubkeys"
        disabled={pending}
        onValidityChange={setAddressesValid}
      />
      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor="threshold" className="text-sm font-medium">
          Threshold
        </label>
        <input
          id="threshold"
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
          'Create Solana treasury'
        )}
      </Button>
      {result?.ok === true ? (
        <div className="space-y-1 rounded-md border bg-[color:var(--color-muted)] p-3 text-xs">
          <div className="font-medium text-[color:var(--color-foreground)]">
            Solana treasury live
          </div>
          <div>
            Governance: <code className="break-all">{result.multisigAddress}</code>
          </div>
          <div>
            Funds settle to: <code className="break-all">{result.vaultAddress}</code>
          </div>
          <div>
            Tx:{' '}
            <a
              href={`https://explorer.solana.com/tx/${result.txSignature}?cluster=devnet`}
              target="_blank"
              rel="noopener noreferrer"
              className="break-all underline"
            >
              {result.txSignature.slice(0, 24)}…
            </a>
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
