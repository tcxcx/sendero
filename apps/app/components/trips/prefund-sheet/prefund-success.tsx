'use client';

import { Alert, AlertDescription, AlertTitle } from '@sendero/ui/alert';
import { Button } from '@sendero/ui/button';
import {
  isPasskeyConfigured,
  loginPasskey,
  passkeyConfigIssue,
  registerPasskey,
  restoreFromStorage,
  sendUserOp,
  type UserWallet,
} from '@sendero/circle/modular-wallets';
import { ExternalLink } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { Hex } from 'viem';
import type { PrefundResult } from './prefund-form';

type FundPhase = 'idle' | 'enrolling' | 'submitting' | 'funded' | 'error';
type ClaimPhase = 'idle' | 'submitting' | 'claimed' | 'error';

const ARC_EXPLORER = process.env.NEXT_PUBLIC_ARC_EXPLORER_URL ?? 'https://testnet.arcscan.app';

export function PrefundSuccess({ result, onDone }: { result: PrefundResult; onDone: () => void }) {
  const [copied, setCopied] = useState<string | null>(null);
  const shareText = useMemo(() => {
    const lines = [
      'Your Sendero trip budget is ready.',
      `Claim link: ${result.guestLink}`,
      result.claimCode ? `Claim code: ${result.claimCode}` : null,
      'Open the link, claim the escrow, then keep booking with Sendero in WhatsApp or Slack.',
    ].filter(Boolean);
    return lines.join('\n');
  }, [result.claimCode, result.guestLink]);
  const whatsappHref = `https://wa.me/?text=${encodeURIComponent(shareText)}`;

  // ── Passkey + fund state ─────────────────────────────────────────────
  const passkeyOk = isPasskeyConfigured();
  const passkeyIssue = useMemo(() => passkeyConfigIssue(), []);
  const [wallet, setWallet] = useState<UserWallet | null>(null);
  const [enrollName, setEnrollName] = useState('Sendero buyer');
  const [phase, setPhase] = useState<FundPhase>('idle');
  const [fundError, setFundError] = useState<string | null>(null);
  const [fundTxHash, setFundTxHash] = useState<Hex | null>(null);

  // ── Channel-bound DCW claim state ────────────────────────────────────
  const boundTraveler = result.boundTraveler ?? null;
  const [claimPhase, setClaimPhase] = useState<ClaimPhase>('idle');
  const [claimError, setClaimError] = useState<string | null>(null);
  const [claimTxHash, setClaimTxHash] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const existing = await restoreFromStorage();
      if (!cancelled && existing) setWallet(existing);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function copy(label: string, value: string) {
    await navigator.clipboard.writeText(value);
    setCopied(label);
    window.setTimeout(() => setCopied(null), 1600);
  }

  async function fund() {
    setFundError(null);
    setPhase('enrolling');
    try {
      let active = wallet;
      if (!active) {
        const trimmed = enrollName.trim();
        if (!trimmed) {
          throw new Error('Display name is required to register a passkey.');
        }
        // Buyer doesn't need WhatsApp binding — email/phone are optional
        // here. The display name is used as the passkey label so the OS
        // prompt reads "Sendero buyer" rather than a random hex.
        active = await registerPasskey({ displayName: trimmed, email: '', phone: '' });
        setWallet(active);
      } else if (!wallet) {
        // Defensive — if the cached wallet failed to restore but the
        // browser still has the credential, log in fresh.
        active = await loginPasskey();
        setWallet(active);
      }

      setPhase('submitting');
      const calls = result.onchainCalls.map(c => ({
        to: c.to,
        data: c.data,
        value: BigInt(c.value),
      }));
      const { txHash, userOpHash } = await sendUserOp(active, calls);
      setFundTxHash(txHash);

      // Best-effort: tell the server the userOp landed so the trip row
      // reflects the on-chain truth. Failure here is non-fatal — the
      // chain is the source of truth and a drift sweeper can reconcile.
      try {
        await fetch('/api/guest/funded', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            tripId: result.tripId,
            txHash,
            userOpHash,
            fundingWalletAddress: active.address,
          }),
        });
      } catch (err) {
        console.warn('[prefund-success] /api/guest/funded notify failed', err);
      }

      setPhase('funded');
    } catch (err) {
      setFundError(err instanceof Error ? err.message : String(err));
      setPhase('error');
    }
  }

  async function claimViaDcw() {
    if (!boundTraveler) return;
    setClaimError(null);
    setClaimPhase('submitting');
    try {
      const res = await fetch('/api/guest/claim-via-dcw', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tripId: result.tripId,
          guestLink: result.guestLink,
          guestWallet: boundTraveler.dcwAddress,
          signerWalletId: boundTraveler.dcwWalletId,
          ...(result.claimCode ? { claimCode: result.claimCode } : {}),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        txHash?: string;
        message?: string;
        error?: string;
      };
      if (!res.ok || !data.ok) {
        throw new Error(data.message ?? data.error ?? `claim_failed (${res.status})`);
      }
      setClaimTxHash(data.txHash ?? null);
      setClaimPhase('claimed');
    } catch (err) {
      setClaimError(err instanceof Error ? err.message : String(err));
      setClaimPhase('error');
    }
  }

  const fundDisabled = !passkeyOk || phase === 'enrolling' || phase === 'submitting';
  const fundLabel =
    phase === 'enrolling'
      ? 'Confirming passkey…'
      : phase === 'submitting'
        ? 'Submitting userOp…'
        : wallet
          ? `Fund this trip from ${shortAddr(wallet.address)}`
          : 'Create passkey & fund';

  return (
    <div className="flex flex-col gap-4 py-4">
      <Alert>
        <AlertTitle>Invite created</AlertTitle>
        <AlertDescription>
          Trip {result.tripId.slice(0, 10)} is saved. Fund the escrow on-chain below, then share the
          claim link with the traveler.
        </AlertDescription>
      </Alert>
      <Field
        label="Funding status"
        value={phase === 'funded' ? 'funded' : 'pending_onchain_submission'}
      />
      <Field label="Guest link" value={result.guestLink} />
      {result.claimCode ? <Field label="Claim code" value={result.claimCode} large /> : null}

      {/* ── Buyer-MSCA submitter ──────────────────────────────────── */}
      {phase !== 'funded' ? (
        <div
          className="flex flex-col gap-3 rounded-[var(--radius-md)] p-4"
          style={{ border: 'var(--hairline-strong)' }}
        >
          <div
            className="font-mono uppercase text-muted-foreground"
            style={{
              fontSize: 'var(--label-meta, 0.6875rem)',
              letterSpacing: 'var(--label-meta-tracking, 0.12em)',
            }}
          >
            Step 1 · Fund on Arc
          </div>
          {!passkeyOk ? (
            <p className="text-sm text-destructive">
              Passkey not configured. {passkeyIssue ?? 'Set NEXT_PUBLIC_CIRCLE_CLIENT_KEY.'}
            </p>
          ) : !wallet ? (
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted-foreground">Display name on this device</span>
              <input
                value={enrollName}
                onChange={e => setEnrollName(e.target.value)}
                maxLength={40}
                className="rounded-[var(--radius-md)] bg-[color:var(--surface-base)] p-2 font-mono text-sm"
                style={{ border: 'var(--hairline-soft)' }}
              />
            </label>
          ) : (
            <p className="text-sm text-muted-foreground">
              Signing from your Modular Wallet. Circle Paymaster covers gas — no native token
              needed.
            </p>
          )}
          <Button type="button" onClick={fund} disabled={fundDisabled}>
            {fundLabel}
          </Button>
          {fundError ? (
            <p className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{fundError}</p>
          ) : null}
        </div>
      ) : (
        <div
          className="flex flex-col gap-2 rounded-[var(--radius-md)] p-4"
          style={{ border: 'var(--hairline-strong)' }}
        >
          <div
            className="font-mono uppercase text-muted-foreground"
            style={{
              fontSize: 'var(--label-meta, 0.6875rem)',
              letterSpacing: 'var(--label-meta-tracking, 0.12em)',
            }}
          >
            Funded on Arc
          </div>
          <div className="break-all rounded-[var(--radius-md)] bg-[color:var(--surface-base)] p-3 font-mono text-xs">
            {fundTxHash}
          </div>
          {fundTxHash ? (
            <a
              href={`${ARC_EXPLORER}/tx/${fundTxHash}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
            >
              View on Arcscan
              <ExternalLink data-icon="inline-end" />
            </a>
          ) : null}
        </div>
      )}

      <div
        className="font-mono uppercase text-muted-foreground"
        style={{
          fontSize: 'var(--label-meta, 0.6875rem)',
          letterSpacing: 'var(--label-meta-tracking, 0.12em)',
        }}
      >
        Step 2 · {boundTraveler ? `Claim for ${boundTraveler.displayName} via DCW` : 'Send the link'}
      </div>

      {boundTraveler ? (
        <div
          className="flex flex-col gap-3 rounded-[var(--radius-md)] p-4"
          style={{ border: 'var(--hairline-strong)' }}
        >
          {claimPhase !== 'claimed' ? (
            <>
              <p className="text-sm text-muted-foreground">
                {boundTraveler.displayName} already has a Circle DCW on Arc-Testnet
                (<span className="font-mono text-xs">{shortAddr(boundTraveler.dcwAddress)}</span>).
                Claim on their behalf — no link share, no passkey ceremony. Peanut sig comes from
                the URL fragment; the DCW just submits.
              </p>
              <Button
                type="button"
                onClick={claimViaDcw}
                disabled={phase !== 'funded' || claimPhase === 'submitting'}
              >
                {claimPhase === 'submitting'
                  ? 'Submitting claim…'
                  : phase !== 'funded'
                    ? 'Fund the trip first (Step 1)'
                    : `Claim for ${boundTraveler.displayName}`}
              </Button>
              {claimError ? (
                <p className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                  {claimError}
                </p>
              ) : null}
            </>
          ) : (
            <>
              <div
                className="font-mono uppercase text-muted-foreground"
                style={{
                  fontSize: 'var(--label-meta, 0.6875rem)',
                  letterSpacing: 'var(--label-meta-tracking, 0.12em)',
                }}
              >
                Claimed on Arc
              </div>
              <div className="break-all rounded-[var(--radius-md)] bg-[color:var(--surface-base)] p-3 font-mono text-xs">
                {claimTxHash}
              </div>
              {claimTxHash ? (
                <a
                  href={`${ARC_EXPLORER}/tx/${claimTxHash}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                >
                  View on Arcscan
                  <ExternalLink data-icon="inline-end" />
                </a>
              ) : null}
            </>
          )}
        </div>
      ) : null}

      {/* Cold-guest fallback (or backup share when DCW path is preferred). */}
      <div className="grid gap-2 sm:grid-cols-2">
        <Button type="button" variant="outline" onClick={() => copy('invite', shareText)}>
          {copied === 'invite' ? 'Invite copied' : 'Copy traveler invite'}
        </Button>
        <Button asChild type="button" variant="outline">
          <a href={whatsappHref} target="_blank" rel="noreferrer">
            Open in WhatsApp
            <ExternalLink data-icon="inline-end" />
          </a>
        </Button>
      </div>
      <div
        className="rounded-[var(--radius-md)] bg-[color:var(--surface-floating)] p-3 text-sm text-muted-foreground"
        style={{ border: 'var(--hairline-soft)' }}
      >
        {boundTraveler
          ? 'Backup: share the peanut link if the DCW claim fails. The traveler can still claim from the link via passkey.'
          : 'Paste the same invite text into Slack for employee travel. The Slack app will use the workspace install for approvals, while the claim link keeps traveler budget custody in the escrow flow.'}
      </div>
      {result.invite?.ok === false ? (
        <p className="rounded-md bg-muted p-3 text-sm text-muted-foreground">
          Email delivery was not confirmed: {result.invite.error ?? 'not configured'}.
        </p>
      ) : null}
      <details
        className="rounded-[var(--radius-md)] p-3 text-xs"
        style={{ border: 'var(--hairline-soft)' }}
      >
        <summary className="cursor-pointer text-muted-foreground">On-chain calls (debug)</summary>
        <pre className="mt-3 overflow-x-auto whitespace-pre-wrap">
          {JSON.stringify(result.onchainCalls, null, 2)}
        </pre>
      </details>
      <Button onClick={onDone}>Done</Button>
    </div>
  );
}

function shortAddr(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function Field({ label, value, large = false }: { label: string; value: string; large?: boolean }) {
  return (
    <div className="flex flex-col gap-1">
      <div
        className="font-mono uppercase text-muted-foreground"
        style={{
          fontSize: 'var(--label-meta, 0.6875rem)',
          letterSpacing: 'var(--label-meta-tracking, 0.12em)',
        }}
      >
        {label}
      </div>
      <div
        className={
          large
            ? 'rounded-[var(--radius-md)] bg-[color:var(--surface-base)] p-4 text-center font-mono text-2xl tracking-widest'
            : 'break-all rounded-[var(--radius-md)] bg-[color:var(--surface-base)] p-3 font-mono text-xs'
        }
      >
        {value}
      </div>
    </div>
  );
}
