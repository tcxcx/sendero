'use client';

/**
 * Approve / Reject / Execute buttons for a TreasuryProposal row.
 * Uses Solana wallet-adapter to sign the Squads instructions from
 * the connected member's wallet (NOT the platform keypair).
 *
 * Three states drive button visibility:
 *   - status='pending' → Approve + Reject (the connected wallet's
 *     pubkey must be a multisig member; SDK rejects otherwise).
 *   - status='approved' → Execute (anyone can execute once threshold
 *     is met — SDK validates).
 *   - status='executed' / 'rejected' / 'cancelled' / 'failed' → no
 *     buttons; row is terminal.
 *
 * After every successful tx we call `refreshProposalStatus(...)` to
 * pull the on-chain state back into the row, then `router.refresh()`
 * so the Server Component re-renders with the new status pill.
 */

import * as React from 'react';
import * as multisig from '@sqds/multisig';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { PublicKey, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { refreshProposalStatus } from '@/lib/treasury/refresh-proposal-status';

interface Props {
  proposalId: string;
  multisigAddress: string;
  txIndex: number;
  status: string;
}

type Action = 'approve' | 'reject' | 'execute';

export function ProposalActions({
  proposalId,
  multisigAddress,
  txIndex,
  status,
}: Props) {
  const router = useRouter();
  const { connection } = useConnection();
  const { publicKey, sendTransaction, connected } = useWallet();
  const [pending, setPending] = React.useState<Action | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const isTerminal =
    status === 'executed' ||
    status === 'rejected' ||
    status === 'cancelled' ||
    status === 'failed';

  if (isTerminal) return null;

  const showApproveReject = status === 'pending';
  const showExecute = status === 'approved';

  async function run(action: Action) {
    if (!publicKey || !connected) {
      setError('Connect a Solana wallet first.');
      return;
    }
    setPending(action);
    setError(null);
    try {
      const multisigPda = new PublicKey(multisigAddress);
      const txIndexBig = BigInt(txIndex);

      // Approve / Reject return `TransactionInstruction` synchronously.
      // Execute is async (reads vault tx + supplies lookup tables) and
      // returns `{ instruction, lookupTableAccounts }`. Branch on shape.
      let instruction;
      let lookupTableAccounts: ReturnType<
        typeof multisig.instructions.vaultTransactionExecute
      > extends Promise<infer R>
        ? R extends { lookupTableAccounts: infer L }
          ? L
          : never
        : never;
      if (action === 'approve') {
        instruction = multisig.instructions.proposalApprove({
          multisigPda,
          transactionIndex: txIndexBig,
          member: publicKey,
        });
        lookupTableAccounts = [] as never;
      } else if (action === 'reject') {
        instruction = multisig.instructions.proposalReject({
          multisigPda,
          transactionIndex: txIndexBig,
          member: publicKey,
        });
        lookupTableAccounts = [] as never;
      } else {
        const result = await multisig.instructions.vaultTransactionExecute({
          connection,
          multisigPda,
          transactionIndex: txIndexBig,
          member: publicKey,
        });
        instruction = result.instruction;
        lookupTableAccounts = result.lookupTableAccounts as never;
      }

      const blockhashCtx = await connection.getLatestBlockhash();
      const message = new TransactionMessage({
        payerKey: publicKey,
        recentBlockhash: blockhashCtx.blockhash,
        instructions: [instruction],
      }).compileToV0Message(lookupTableAccounts);
      const versionedTx = new VersionedTransaction(message);

      const sig = await sendTransaction(versionedTx, connection);
      await connection.confirmTransaction(
        {
          signature: sig,
          blockhash: blockhashCtx.blockhash,
          lastValidBlockHeight: blockhashCtx.lastValidBlockHeight,
        },
        'confirmed'
      );

      // Reconcile the row's status from on-chain.
      await refreshProposalStatus(
        proposalId,
        action === 'execute' ? sig : undefined
      );
      router.refresh();
    } catch (err) {
      setError((err as Error).message ?? 'Action failed.');
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="mt-2 space-y-1.5">
      <div className="flex flex-wrap gap-2">
        {showApproveReject ? (
          <>
            <Button
              type="button"
              size="sm"
              variant="default"
              disabled={!connected || pending !== null}
              onClick={() => run('approve')}
            >
              {pending === 'approve' ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : null}
              Approve
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={!connected || pending !== null}
              onClick={() => run('reject')}
            >
              {pending === 'reject' ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : null}
              Reject
            </Button>
          </>
        ) : null}
        {showExecute ? (
          <Button
            type="button"
            size="sm"
            variant="default"
            disabled={!connected || pending !== null}
            onClick={() => run('execute')}
          >
            {pending === 'execute' ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : null}
            Execute
          </Button>
        ) : null}
        {!connected ? (
          <span className="self-center text-[11px] text-[color:var(--color-muted-foreground)]">
            Connect a member wallet to vote
          </span>
        ) : null}
      </div>
      {error ? (
        <div className="rounded-md border border-[color:var(--color-destructive)] bg-[color:var(--color-destructive)]/10 p-2 text-[11px] text-[color:var(--color-destructive)]">
          {error}
        </div>
      ) : null}
    </div>
  );
}
