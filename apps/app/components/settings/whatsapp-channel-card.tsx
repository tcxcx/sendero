'use client';

/**
 * WhatsApp BYO onboarding card. Shows current install status, or a
 * "Start onboarding" CTA that calls /api/channels/whatsapp/setup-link
 * and surfaces the hosted Kapso URL.
 */

import { Button } from '@sendero/ui/button';
import { useState, useTransition } from 'react';

interface SetupLink {
  url: string;
  expires_at: string;
}

interface WhatsAppInstallView {
  id: string;
  status: string;
  phoneNumberId: string | null;
  displayPhoneNumber: string | null;
  businessDisplayName: string | null;
  lastHealthyAt: Date | null;
  lastErrorMessage: string | null;
}

export function WhatsAppChannelCard({
  install,
  setupLink,
}: {
  install: WhatsAppInstallView | null;
  setupLink: SetupLink | null;
}) {
  const [pending, startTransition] = useTransition();
  const [link, setLink] = useState<SetupLink | null>(setupLink);
  const [error, setError] = useState<string | null>(null);

  function startOnboarding() {
    setError(null);
    startTransition(async () => {
      const res = await fetch('/api/channels/whatsapp/setup-link', { method: 'POST' });
      const data = (await res.json().catch(() => ({}))) as {
        setupLink?: SetupLink;
        error?: string;
        message?: string;
      };
      if (!res.ok || !data.setupLink) {
        setError(data.message ?? data.error ?? 'Failed to create setup link');
        return;
      }
      setLink(data.setupLink);
    });
  }

  const isActive = install?.status === 'active';
  const isPending = install?.status === 'pending';
  const isError = install?.status === 'error';

  return (
    <div className="rounded-md border border-border p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold">WhatsApp Business</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Bring your own Meta WhatsApp number via Kapso. Travelers message your number; Sendero
            runs the conversation per trip policy.
          </p>
        </div>
        <span
          className={
            isActive
              ? 'rounded-full bg-green-500/15 px-2.5 py-1 text-xs font-medium text-green-700'
              : isError
                ? 'rounded-full bg-red-500/15 px-2.5 py-1 text-xs font-medium text-red-700'
                : isPending
                  ? 'rounded-full bg-amber-500/15 px-2.5 py-1 text-xs font-medium text-amber-700'
                  : 'rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground'
          }
        >
          {install?.status ?? 'not_connected'}
        </span>
      </div>

      {isActive ? (
        <dl className="mt-4 grid grid-cols-2 gap-3 text-xs">
          <div>
            <dt className="text-muted-foreground">Display number</dt>
            <dd className="font-mono">{install?.displayPhoneNumber ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Verified name</dt>
            <dd>{install?.businessDisplayName ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Meta phone id</dt>
            <dd className="font-mono">{install?.phoneNumberId ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Last healthy</dt>
            <dd>{install?.lastHealthyAt?.toLocaleString() ?? '—'}</dd>
          </div>
        </dl>
      ) : null}

      {isError && install?.lastErrorMessage ? (
        <p className="mt-3 rounded bg-red-500/10 p-2 text-xs text-red-700">
          {install.lastErrorMessage}
        </p>
      ) : null}

      {link ? (
        <div className="mt-4 rounded border border-dashed border-border p-3 text-xs">
          <p className="font-medium">Finish onboarding on Kapso:</p>
          <a
            className="mt-1 block break-all font-mono text-primary underline-offset-2 hover:underline"
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
          >
            {link.url}
          </a>
          <p className="mt-2 text-muted-foreground">
            Expires {new Date(link.expires_at).toLocaleString()}.
          </p>
        </div>
      ) : null}

      <div className="mt-4 flex items-center gap-2">
        <Button type="button" onClick={startOnboarding} disabled={pending}>
          {isActive ? 'Re-connect' : 'Start onboarding'}
        </Button>
        {error ? <span className="text-xs text-red-700">{error}</span> : null}
      </div>
    </div>
  );
}
