'use client';

import * as React from 'react';
import { Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { provisionSolanaMultisig } from '@/lib/treasury/provision-solana';

/**
 * Solana multisig provisioning form. Submits to a server action that
 * calls Squads V4 `multisigCreateV2`. Inputs are intentionally
 * minimal — paste pubkeys (one per line) and pick a threshold. The
 * platform hot wallet is auto-appended as a Vote-only signer
 * server-side; threshold is calibrated against the human signers
 * only.
 */
export function SolanaProvisionForm() {
  const [pending, setPending] = React.useState(false);
  const [result, setResult] = React.useState<
    | null
    | { ok: true; multisigAddress: string; vaultAddress: string; txSignature: string }
    | { ok: false; error: string }
  >(null);

  async function handleSubmit(formData: FormData) {
    setPending(true);
    setResult(null);
    const raw = (formData.get('memberPubkeys') as string) ?? '';
    const memberPubkeys = raw
      .split(/\s+/)
      .map(s => s.trim())
      .filter(Boolean);
    const threshold = Number(formData.get('threshold') ?? 1);
    const r = await provisionSolanaMultisig({ memberPubkeys, threshold });
    setResult(r);
    setPending(false);
  }

  return (
    <form action={handleSubmit} className="space-y-4">
      <div className="space-y-1.5">
        <label
          htmlFor="memberPubkeys"
          className="block text-sm font-medium"
        >
          Member pubkeys
        </label>
        <textarea
          id="memberPubkeys"
          name="memberPubkeys"
          rows={4}
          required
          className="w-full rounded-md border bg-[color:var(--color-background)] px-3 py-2 font-mono text-xs"
          placeholder="One Solana pubkey per line. The platform hot wallet is auto-appended as a Vote-only signer."
        />
      </div>
      <div className="flex items-center gap-3">
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
            Provisioning…
          </>
        ) : (
          'Provision Solana multisig'
        )}
      </Button>
      {result?.ok === true ? (
        <div className="space-y-1 rounded-md border bg-[color:var(--color-muted)] p-3 text-xs">
          <div className="font-medium text-[color:var(--color-foreground)]">
            Provisioned ✓
          </div>
          <div>
            Multisig: <code className="break-all">{result.multisigAddress}</code>
          </div>
          <div>
            Vault: <code className="break-all">{result.vaultAddress}</code>
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
