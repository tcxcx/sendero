'use client';

import * as React from 'react';
import { Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { proposeArcUsdcTransfer } from '@/lib/treasury/propose-arc';

/**
 * Solana-parity propose form for Arc treasuries. Captures recipient
 * + amount + memo, persists a `TreasuryProposal` row with the
 * encoded ERC-20 transfer callData. The signing UI (MetaMask +
 * bundler submit) is the next phase.
 */
export function ArcProposeForm({ treasuryId }: { treasuryId: string }) {
  const [pending, setPending] = React.useState(false);
  const [result, setResult] = React.useState<
    null | { ok: true; txIndex: number; callData: `0x${string}` } | { ok: false; error: string }
  >(null);

  async function handleSubmit(formData: FormData) {
    setPending(true);
    setResult(null);
    const r = await proposeArcUsdcTransfer({
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
        <label htmlFor="arc-recipient" className="block text-xs font-medium">
          Recipient address
        </label>
        <input
          id="arc-recipient"
          name="recipient"
          required
          className="w-full rounded-md border bg-[color:var(--color-background)] px-3 py-2 font-mono text-xs"
          placeholder="0x…"
        />
      </div>
      <div className="flex items-center gap-3">
        <label htmlFor="arc-amount" className="text-xs font-medium">
          Amount (USDC)
        </label>
        <input
          id="arc-amount"
          name="amountUsdc"
          required
          inputMode="decimal"
          pattern="^\d+(\.\d{1,6})?$"
          className="w-32 rounded-md border bg-[color:var(--color-background)] px-2 py-1 text-sm"
          placeholder="5.00"
        />
        <span className="text-xs text-[color:var(--color-muted-foreground)]">arc-testnet USDC</span>
      </div>
      <div className="space-y-1.5">
        <label htmlFor="arc-memo" className="block text-xs font-medium">
          Memo{' '}
          <span className="text-[color:var(--color-muted-foreground)]">(optional, ≤32 chars)</span>
        </label>
        <input
          id="arc-memo"
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
          <div className="break-all font-mono text-[10px] text-[color:var(--color-muted-foreground)]">
            {result.callData}
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
