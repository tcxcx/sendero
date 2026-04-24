'use client';

import { Alert, AlertDescription, AlertTitle } from '@sendero/ui/alert';
import { Button } from '@sendero/ui/button';
import { ExternalLink } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { PrefundResult } from './prefund-form';

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

  async function copy(label: string, value: string) {
    await navigator.clipboard.writeText(value);
    setCopied(label);
    window.setTimeout(() => setCopied(null), 1600);
  }

  return (
    <div className="flex flex-col gap-4 py-4">
      <Alert>
        <AlertTitle>Invite created</AlertTitle>
        <AlertDescription>
          Trip {result.tripId.slice(0, 10)} is saved with funding pending. Submit the returned
          on-chain calls from the buyer wallet before the traveler claims.
        </AlertDescription>
      </Alert>
      <Field label="Funding status" value="pending_onchain_submission" />
      <Field label="Guest link" value={result.guestLink} />
      {result.claimCode ? <Field label="Claim code" value={result.claimCode} large /> : null}
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
        Paste the same invite text into Slack for employee travel. The Slack app will use the
        workspace install for approvals, while the claim link keeps traveler budget custody in the
        escrow flow.
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
        <summary className="cursor-pointer text-muted-foreground">On-chain calls</summary>
        <pre className="mt-3 overflow-x-auto whitespace-pre-wrap">
          {JSON.stringify(result.onchainCalls, null, 2)}
        </pre>
      </details>
      <Button onClick={onDone}>Done</Button>
    </div>
  );
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
