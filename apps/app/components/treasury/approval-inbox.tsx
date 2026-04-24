'use client';

/**
 * TreasuryApprovalInbox — list + act on pending weighted-multisig ops.
 *
 * Inspired by desk-v1's MultisigApprovalInbox
 * (`apps/app/src/components/multisig/multisig-approval-inbox.tsx`).
 * Simplified for Sendero: no private-transfer envelopes, no cross-chain
 * children, no email reminder action. Uses shadcn primitives from
 * `@/components/ui/*`.
 *
 * Data flow:
 *  - GET /api/treasury/approvals → list
 *  - POST /api/treasury/approvals/:opHash/sign → append approval
 *  - DELETE /api/treasury/approvals/:opHash → cancel
 *
 * The signing flow here is a placeholder — the `onApprove` callback is where
 * the wallet-setup client would sign the opHash with the current user's MSCA
 * passkey; the ported desk-v1 does this via `signRawHashWithUcwOwner`, which
 * does not yet have a Sendero equivalent (phase 11h).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Circle, Loader2, ShieldAlert, XCircle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

// ---------------------------------------------------------------------------
// Types — mirror the route's response shape (see /api/treasury/approvals).
// ---------------------------------------------------------------------------

export interface SignatureRecord {
  signerAddress: string;
  signature: string;
  weight: number;
  signedAt: string;
  userOpSigType?: string;
}

export interface PendingMultisigOp {
  id: string;
  opHash: string;
  walletId: string;
  callData: string;
  threshold: number;
  collectedWeight: number;
  status: string;
  signatures: SignatureRecord[];
  transferMeta: Record<string, unknown>;
  initiatedByClerkUserId: string;
  expiresAt: string;
  createdAt: string;
  submittedAt: string | null;
  confirmedAt: string | null;
  txHash: string | null;
}

interface ApprovalInboxProps {
  /** Current user's MSCA address — decides which ops show the "Approve" button. */
  currentUserAddress?: `0x${string}`;
  /** Per-user signature weight — used when appending the approval. */
  currentUserWeight?: number;
  /**
   * Called when the current user taps "Approve". Must sign the opHash with the
   * current user's MSCA owner key and return { signature, userOpSigType }.
   * If omitted the Approve button is hidden.
   */
  onSignHash?: (opHash: `0x${string}`) => Promise<{ signature: string; userOpSigType?: string }>;
  /** Refresh interval in ms (default 15s). */
  pollIntervalMs?: number;
  /** Optional heading text. */
  title?: string;
  description?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function shortAddr(address: string): string {
  if (!address || address.length < 12) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function formatCountdown(isoDate: string, now: number): string {
  const expiresAt = new Date(isoDate).getTime();
  const diff = expiresAt - now;
  if (diff <= 0) return 'Expired';
  const hours = Math.floor(diff / 3_600_000);
  const minutes = Math.floor((diff % 3_600_000) / 60_000);
  if (hours >= 24) return `${Math.floor(hours / 24)}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function summarizeTransfer(meta: Record<string, unknown>): string | null {
  const to = typeof meta.to === 'string' ? meta.to : null;
  const amount =
    typeof meta.amount === 'string' || typeof meta.amount === 'number' ? String(meta.amount) : null;
  const symbol = typeof meta.tokenSymbol === 'string' ? meta.tokenSymbol : '';
  if (to && amount) return `Send ${amount}${symbol ? ` ${symbol}` : ''} → ${shortAddr(to)}`;
  if (typeof meta.description === 'string') return meta.description;
  return null;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TreasuryApprovalInbox({
  currentUserAddress,
  currentUserWeight,
  onSignHash,
  pollIntervalMs = 15_000,
  title = 'Pending treasury approvals',
  description = 'Approvals collect weighted signatures until threshold is met. Once ready, the action is submitted on-chain.',
}: ApprovalInboxProps) {
  const [ops, setOps] = useState<PendingMultisigOp[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyOpHash, setBusyOpHash] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const fetchOps = useCallback(async () => {
    try {
      const res = await fetch('/api/treasury/approvals', { cache: 'no-store' });
      if (!res.ok) {
        const payload = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(payload?.message || `Failed to load (HTTP ${res.status})`);
      }
      const payload = (await res.json()) as { ops: PendingMultisigOp[] };
      setOps(payload.ops);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load approvals');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchOps();
  }, [fetchOps]);

  // Periodic refresh.
  useEffect(() => {
    if (pollIntervalMs <= 0) return;
    const id = window.setInterval(() => void fetchOps(), pollIntervalMs);
    return () => window.clearInterval(id);
  }, [fetchOps, pollIntervalMs]);

  // Tick every 60s so countdowns stay fresh without re-fetching.
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  const handleApprove = useCallback(
    async (op: PendingMultisigOp) => {
      if (!onSignHash || !currentUserAddress || !currentUserWeight) return;
      setBusyOpHash(op.opHash);
      try {
        const signed = await onSignHash(op.opHash as `0x${string}`);
        const res = await fetch(`/api/treasury/approvals/${encodeURIComponent(op.opHash)}/sign`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            signerAddress: currentUserAddress,
            signature: signed.signature,
            weight: currentUserWeight,
            ...(signed.userOpSigType ? { userOpSigType: signed.userOpSigType } : {}),
          }),
        });
        if (!res.ok) {
          const payload = (await res.json().catch(() => null)) as { message?: string } | null;
          throw new Error(payload?.message || `Approval failed (HTTP ${res.status})`);
        }
        await fetchOps();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Approval failed');
      } finally {
        setBusyOpHash(null);
      }
    },
    [currentUserAddress, currentUserWeight, fetchOps, onSignHash]
  );

  const handleCancel = useCallback(
    async (op: PendingMultisigOp) => {
      setBusyOpHash(op.opHash);
      try {
        const res = await fetch(`/api/treasury/approvals/${encodeURIComponent(op.opHash)}`, {
          method: 'DELETE',
        });
        if (!res.ok) {
          const payload = (await res.json().catch(() => null)) as { message?: string } | null;
          throw new Error(payload?.message || `Cancel failed (HTTP ${res.status})`);
        }
        await fetchOps();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Cancel failed');
      } finally {
        setBusyOpHash(null);
      }
    },
    [fetchOps]
  );

  const content = useMemo(() => {
    if (isLoading) {
      return (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading approvals…
        </div>
      );
    }

    if (error) {
      return (
        <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <p>{error}</p>
        </div>
      );
    }

    if (ops.length === 0) {
      return (
        <p className="text-sm text-muted-foreground">
          No pending approvals. Pending treasury operations will show up here as soon as they are
          proposed.
        </p>
      );
    }

    return (
      <TooltipProvider delayDuration={150}>
        <ul className="space-y-3">
          {ops.map(op => {
            const isBusy = busyOpHash === op.opHash;
            const percent = Math.min(
              100,
              Math.round((op.collectedWeight / Math.max(1, op.threshold)) * 100)
            );
            const summary = summarizeTransfer(op.transferMeta);
            const hasApproved =
              currentUserAddress &&
              op.signatures.some(
                s =>
                  typeof s.signerAddress === 'string' &&
                  s.signerAddress.toLowerCase() === currentUserAddress.toLowerCase()
              );
            const canApprove =
              !!onSignHash &&
              !!currentUserAddress &&
              !!currentUserWeight &&
              !hasApproved &&
              op.status === 'pending';

            return (
              <li key={op.opHash} className="rounded-lg border bg-background p-4 shadow-sm">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="space-y-1">
                    <p className="text-sm font-semibold">{summary ?? 'Treasury operation'}</p>
                    <p className="font-mono text-[10px] text-muted-foreground">
                      {shortAddr(op.opHash)}
                    </p>
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="rounded-full border bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide">
                          {op.status.replace('_', ' ')}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>
                        Expires in {formatCountdown(op.expiresAt, now)}
                      </TooltipContent>
                    </Tooltip>

                    {canApprove ? (
                      <Button size="sm" onClick={() => void handleApprove(op)} disabled={isBusy}>
                        {isBusy ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <CheckCircle2 className="h-3.5 w-3.5" />
                        )}
                        Approve
                      </Button>
                    ) : null}

                    {op.status === 'pending' || op.status === 'threshold_met' ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void handleCancel(op)}
                        disabled={isBusy}
                      >
                        <XCircle className="h-3.5 w-3.5" />
                        Cancel
                      </Button>
                    ) : null}
                  </div>
                </div>

                {/* Progress bar */}
                <div className="mt-3">
                  <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                    <span>
                      Weight {op.collectedWeight} / {op.threshold}
                    </span>
                    <span>{percent}%</span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary transition-all"
                      style={{ width: `${percent}%` }}
                    />
                  </div>
                </div>

                {/* Signer dots */}
                {op.signatures.length > 0 ? (
                  <div className="mt-3 flex flex-wrap items-center gap-1.5">
                    <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      Signers
                    </span>
                    {op.signatures.map(sig => (
                      <Tooltip key={sig.signerAddress}>
                        <TooltipTrigger asChild>
                          <span className="inline-flex items-center gap-1 rounded-full border bg-muted px-2 py-0.5 text-[10px]">
                            <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                            {shortAddr(sig.signerAddress)} · w{sig.weight}
                          </span>
                        </TooltipTrigger>
                        <TooltipContent>
                          Signed {new Date(sig.signedAt).toLocaleString()}
                        </TooltipContent>
                      </Tooltip>
                    ))}
                  </div>
                ) : (
                  <div className="mt-3 flex items-center gap-1 text-[10px] text-muted-foreground">
                    <Circle className="h-3 w-3" />
                    Awaiting first signature
                  </div>
                )}

                {op.status === 'threshold_met' ? (
                  <p className="mt-3 text-[11px] text-emerald-600 dark:text-emerald-400">
                    Threshold met. Submission to the bundler lands in phase 11h.
                  </p>
                ) : null}

                {hasApproved ? (
                  <p className="mt-3 text-[11px] text-muted-foreground">
                    Your approval is recorded.
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      </TooltipProvider>
    );
  }, [
    busyOpHash,
    currentUserAddress,
    currentUserWeight,
    error,
    handleApprove,
    handleCancel,
    isLoading,
    now,
    onSignHash,
    ops,
  ]);

  return (
    <section className="space-y-3">
      {title ? (
        <div>
          <h2 className="text-sm font-semibold">{title}</h2>
          {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
        </div>
      ) : null}
      {content}
    </section>
  );
}
