'use client';

import * as React from 'react';
import { Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { proposeSolanaUsdcTransfer } from '@/lib/treasury/propose-solana';

/**
 * Compact propose-USDC-transfer form mounted inside the live Solana
 * treasury card. Submits to a server action that builds Squads V4
 * `vaultTransactionCreate` + `proposalCreate` and persists a
 * TreasuryProposal row. Vote/execute UI ships in Phase 7.6.x.
 */
export function SolanaProposeForm({ treasuryId }: { treasuryId: string }) {
  const [pending, setPending] = React.useState(false);
  const [result, setResult] = React.useState<
    | null
    | {
        ok: true;
        txIndex: number;
        proposalPda: string;
        proposalTxRef: string;
      }
    | { ok: false; error: string }
  >(null);

  async function handleSubmit(formData: FormData) {
    setPending(true);
    setResult(null);
    const r = await proposeSolanaUsdcTransfer({
      treasuryId,
      recipient: (formData.get('recipient') as string) ?? '',
      amountUsdc: (formData.get('amountUsdc') as string) ?? '',
      memo: ((formData.get('memo') as string) ?? '').trim() || undefined,
    });
    setResult(r);
    setPending(false);
  }

  return (
    <form action={handleSubmit} className="space-y-3 border-t pt-4">
      <div className="text-sm font-medium">Propose USDC transfer</div>
      <div className="space-y-1.5">
        <label htmlFor="recipient" className="block text-xs font-medium">
          Recipient pubkey
        </label>
        <input
          id="recipient"
          name="recipient"
          required
          className="w-full rounded-md border bg-[color:var(--color-background)] px-3 py-2 font-mono text-xs"
          placeholder="Solana base58 pubkey"
        />
      </div>
      <div className="flex items-center gap-3">
        <label htmlFor="amountUsdc" className="text-xs font-medium">
          Amount (USDC)
        </label>
        <input
          id="amountUsdc"
          name="amountUsdc"
          required
          inputMode="decimal"
          pattern="^\d+(\.\d{1,6})?$"
          className="w-32 rounded-md border bg-[color:var(--color-background)] px-2 py-1 text-sm"
          placeholder="5.00"
        />
        <span className="text-xs text-[color:var(--color-muted-foreground)]">
          devnet USDC mint
        </span>
      </div>
      <div className="space-y-1.5">
        <label htmlFor="memo" className="block text-xs font-medium">
          Memo <span className="text-[color:var(--color-muted-foreground)]">(optional, ≤32 chars)</span>
        </label>
        <input
          id="memo"
          name="memo"
          maxLength={32}
          className="w-full rounded-md border bg-[color:var(--color-background)] px-3 py-2 text-xs"
        />
      </div>
      <Button type="submit" disabled={pending} variant="outline" className="w-full">
        {pending ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Proposing…
          </>
        ) : (
          'Create proposal'
        )}
      </Button>
      {result?.ok === true ? (
        <div className="space-y-1 rounded-md border bg-[color:var(--color-muted)] p-3 text-xs">
          <div className="font-medium text-[color:var(--color-foreground)]">
            Proposal #{result.txIndex} created ✓
          </div>
          <div>
            <a
              href={`https://explorer.solana.com/tx/${result.proposalTxRef}?cluster=devnet`}
              target="_blank"
              rel="noopener noreferrer"
              className="break-all underline"
            >
              View tx →
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
