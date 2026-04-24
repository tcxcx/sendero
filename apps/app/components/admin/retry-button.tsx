'use client';

import { RefreshCw } from 'lucide-react';
import { useState, useTransition } from 'react';
import { Button } from '@sendero/ui/button';
import {
  retryFailedBatchesAction,
  retryInvoicePdfAction,
  retryWalletProvisionAction,
} from '@/app/(app)/dashboard/admin-retries/actions';

type RetryKind = 'invoice-pdf' | 'failed-batches' | 'wallet-provision';

export function RetryButton({
  kind,
  id,
  label,
  variant = 'outline',
}: {
  kind: RetryKind;
  id?: string;
  label: string;
  variant?: 'default' | 'outline' | 'secondary' | 'ghost';
}) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  function run() {
    setMessage(null);
    startTransition(async () => {
      const result =
        kind === 'invoice-pdf'
          ? await retryInvoicePdfAction(id ?? '')
          : kind === 'failed-batches'
            ? await retryFailedBatchesAction()
            : await retryWalletProvisionAction();
      setMessage(result.message);
    });
  }

  return (
    <div className="flex flex-col gap-1">
      <Button type="button" variant={variant} onClick={run} disabled={pending}>
        <RefreshCw data-icon="inline-start" className={pending ? 'animate-spin' : undefined} />
        {pending ? 'Retrying...' : label}
      </Button>
      {message ? <p className="max-w-sm text-xs text-muted-foreground">{message}</p> : null}
    </div>
  );
}
