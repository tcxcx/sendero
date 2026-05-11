import { ExternalLink } from 'lucide-react';

import { listTreasuryProposals } from '@/lib/treasury/propose-solana';

import { ProposalActions } from './proposal-actions';

/**
 * Explorer URLs differ by chain. Solana uses the public Solana
 * Explorer; Arc-testnet uses Arcscan. The list component renders for
 * either chain, so the URL builder lives here.
 */
function txExplorerUrl(chain: 'sol' | 'arc', tx: string) {
  if (chain === 'sol') return `https://explorer.solana.com/tx/${tx}?cluster=devnet`;
  return `https://testnet.arcscan.net/tx/${tx}`;
}

/**
 * Server Component — renders the list of TreasuryProposal rows for a
 * given treasury, newest first. Each row mounts <ProposalActions />
 * (Phase 7.6.x) which surfaces Approve / Reject / Execute buttons
 * gated by the row's status + the connected wallet.
 *
 * Phase 7.6.y adds the "X of Y approved" pill (read from the cached
 * `approvedCount` reconciled by `refreshProposalStatus`) and threads
 * the multisig member list down so <ProposalActions /> can refuse
 * non-member wallets in the browser before signing — saves a round
 * trip to the chain just to hit `NotAMember`.
 */
export async function ProposalList({
  treasuryId,
  multisigAddress,
  threshold,
  members,
  chain,
}: {
  treasuryId: string;
  multisigAddress: string;
  threshold: number;
  members: string[];
  /**
   * Drives explorer URL templates + whether ProposalActions renders.
   * Approve/Reject/Execute on Arc is Phase 7.6.x — until then the Arc
   * branch just lists rows without action buttons.
   */
  chain: 'sol' | 'arc';
}) {
  const rows = await listTreasuryProposals(treasuryId);
  if (rows.length === 0) {
    return (
      <p className="text-xs text-[color:var(--color-muted-foreground)]">
        No proposals yet. The first proposal lands here once the form below submits.
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
            <div className="flex items-center justify-between gap-2">
              <div className="font-medium">
                #{row.txIndex} · {row.kind} · {amountUsdc} USDC
              </div>
              <div className="flex items-center gap-1.5">
                <span className="rounded-full border bg-[color:var(--color-background)] px-2 py-0.5 text-[10px] font-medium tabular-nums">
                  {row.approvedCount} of {threshold} approved
                </span>
                <span className="rounded-full bg-[color:var(--color-secondary)] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider">
                  {row.status}
                </span>
              </div>
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
                  href={txExplorerUrl(chain, row.proposalTxRef)}
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
                  href={txExplorerUrl(chain, row.executedTxRef)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 underline"
                >
                  Execution tx
                  <ExternalLink className="h-3 w-3" />
                </a>
              ) : null}
            </div>
            {chain === 'sol' ? (
              <ProposalActions
                proposalId={row.id}
                multisigAddress={multisigAddress}
                txIndex={row.txIndex}
                status={row.status}
                members={members}
              />
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
