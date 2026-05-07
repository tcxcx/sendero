import { ExternalLink } from 'lucide-react';

import { listTreasuryProposals } from '@/lib/treasury/propose-solana';

import { ProposalActions } from './proposal-actions';

/**
 * Server Component — renders the list of TreasuryProposal rows for a
 * given treasury, newest first. Each row mounts <ProposalActions />
 * (Phase 7.6.x) which surfaces Approve / Reject / Execute buttons
 * gated by the row's status + the connected wallet.
 */
export async function ProposalList({
  treasuryId,
  multisigAddress,
}: {
  treasuryId: string;
  multisigAddress: string;
}) {
  const rows = await listTreasuryProposals(treasuryId);
  if (rows.length === 0) {
    return (
      <p className="text-xs text-[color:var(--color-muted-foreground)]">
        No proposals yet. The first proposal lands here once the form below
        submits.
      </p>
    );
  }
  return (
    <ul className="space-y-2">
      {rows.map(row => {
        const payload = row.payload as {
          recipient?: string;
          amountMicro?: string;
          memo?: string | null;
        };
        const amountUsdc = payload.amountMicro
          ? (Number(payload.amountMicro) / 1_000_000).toFixed(2)
          : '?';
        return (
          <li
            key={row.id}
            className="rounded-md border bg-[color:var(--color-background)] p-3 text-xs"
          >
            <div className="flex items-center justify-between">
              <div className="font-medium">
                #{row.txIndex} · {row.kind} · {amountUsdc} USDC
              </div>
              <span className="rounded-full bg-[color:var(--color-secondary)] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider">
                {row.status}
              </span>
            </div>
            {payload.recipient ? (
              <div className="mt-1 break-all font-mono text-[11px] text-[color:var(--color-muted-foreground)]">
                → {payload.recipient}
              </div>
            ) : null}
            {payload.memo ? (
              <div className="mt-1 text-[11px] text-[color:var(--color-muted-foreground)]">
                memo: {payload.memo}
              </div>
            ) : null}
            <div className="mt-1.5 flex items-center gap-3 text-[11px]">
              {row.proposalTxRef ? (
                <a
                  href={`https://explorer.solana.com/tx/${row.proposalTxRef}?cluster=devnet`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 underline"
                >
                  Proposal tx
                  <ExternalLink className="h-3 w-3" />
                </a>
              ) : null}
              {row.executedTxRef ? (
                <a
                  href={`https://explorer.solana.com/tx/${row.executedTxRef}?cluster=devnet`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 underline"
                >
                  Execution tx
                  <ExternalLink className="h-3 w-3" />
                </a>
              ) : null}
            </div>
            <ProposalActions
              proposalId={row.id}
              multisigAddress={multisigAddress}
              txIndex={row.txIndex}
              status={row.status}
            />
          </li>
        );
      })}
    </ul>
  );
}
