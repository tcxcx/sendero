'use client';

import { Alert, AlertDescription, AlertTitle } from '@sendero/ui/alert';
import { Button } from '@sendero/ui/button';
import type { PrefundResult } from './prefund-form';

export function PrefundSuccess({ result, onDone }: { result: PrefundResult; onDone: () => void }) {
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
      {result.invite?.ok === false ? (
        <p className="rounded-md bg-muted p-3 text-sm text-muted-foreground">
          Email delivery was not confirmed: {result.invite.error ?? 'not configured'}.
        </p>
      ) : null}
      <details className="rounded-md border border-border p-3 text-xs">
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
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div
        className={
          large
            ? 'rounded-md bg-muted p-4 text-center font-mono text-2xl tracking-widest'
            : 'break-all rounded-md bg-muted p-3 font-mono text-xs'
        }
      >
        {value}
      </div>
    </div>
  );
}
