'use client';

import { useState } from 'react';

import { useRouter } from 'next/navigation';

interface WhatsappConnectedProps {
  displayName: string | null;
  displayPhoneNumber: string | null;
  health?: {
    status: string | null;
    messagingStatus: string | null;
    webhookVerified: boolean | null;
    errors: string[];
  } | null;
}

type DisconnectResponse = {
  ok?: boolean;
  disconnected?: boolean;
  error?: string;
  message?: string;
};

export function WhatsappConnectedPanel({
  displayName,
  displayPhoneNumber,
  health,
}: WhatsappConnectedProps) {
  const router = useRouter();
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [disconnectError, setDisconnectError] = useState<string | null>(null);

  const disconnect = async () => {
    if (isDisconnecting) return;
    setDisconnectError(null);
    setIsDisconnecting(true);
    try {
      const response = await fetch('/api/channels/whatsapp/install', {
        method: 'DELETE',
        headers: { Accept: 'application/json' },
        cache: 'no-store',
      });
      const data = await readJson<DisconnectResponse>(response);
      if (!response.ok || data.ok !== true) {
        throw new Error(data.message ?? data.error ?? `Disconnect failed (${response.status})`);
      }

      const verify = await fetch('/api/channels/whatsapp/install', {
        headers: { Accept: 'application/json' },
        cache: 'no-store',
      });
      const snapshot = await readJson<{ install: unknown | null }>(verify);
      if (snapshot.install !== null) {
        throw new Error('Disconnect did not clear the WhatsApp install. Refresh and try again.');
      }

      router.replace('/dashboard/channels/whatsapp/connect');
      router.refresh();
    } catch (err) {
      setDisconnectError(err instanceof Error ? err.message : 'Disconnect failed');
    } finally {
      setIsDisconnecting(false);
    }
  };

  const state = summarizeHealth(health);

  return (
    <section className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-1 py-2">
      <header className="flex flex-col gap-2">
        <h1 className="t-h1">WhatsApp</h1>
        <p className="max-w-[58ch] text-sm leading-relaxed text-[color:var(--text-dim)]">
          This workspace is connected to a tenant-owned WhatsApp Business number through Kapso.
        </p>
      </header>

      <article className="rounded-md border border-[color:color-mix(in_oklab,var(--ink)_12%,transparent)] bg-[color:var(--surface-raised)] p-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-[color:var(--text-faint)]">
              Connected number
            </div>
            <div className="mt-1 truncate font-mono text-xl text-[color:var(--ink)]">
              {displayPhoneNumber ?? 'Unknown'}
            </div>
            {displayName ? (
              <div className="mt-1 text-sm text-[color:var(--text-dim)]">{displayName}</div>
            ) : null}
          </div>
          <span
            className={`inline-flex w-fit rounded-full px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.12em] ${state.className}`}
          >
            {state.label}
          </span>
        </div>

        <div className="mt-4 border-t border-[color:color-mix(in_oklab,var(--ink)_10%,transparent)] pt-4">
          <div className="text-sm leading-relaxed text-[color:var(--text)]">{state.next}</div>
          {health?.errors[0] ? (
            <div className="mt-1 text-xs leading-relaxed text-[color:var(--text-dim)]">
              {health.errors[0]}
            </div>
          ) : null}
        </div>
      </article>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={disconnect}
          disabled={isDisconnecting}
          className="inline-flex h-9 items-center rounded-md border border-[color:color-mix(in_oklab,var(--ink)_18%,transparent)] px-3 font-mono text-[11px] uppercase tracking-[0.08em] text-[color:var(--ink)] transition-colors hover:border-[color:var(--ink)] disabled:cursor-wait disabled:opacity-60"
        >
          {isDisconnecting ? 'Disconnecting...' : 'Disconnect and restart'}
        </button>
        {disconnectError ? (
          <span className="text-xs text-[color:var(--accent-rose)]">{disconnectError}</span>
        ) : null}
      </div>
    </section>
  );
}

async function readJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  if (!text) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Expected JSON response, received ${text.slice(0, 120)}`);
  }
}

function summarizeHealth(health: WhatsappConnectedProps['health']): {
  label: string;
  next: string;
  className: string;
} {
  const status = `${health?.status ?? ''} ${health?.messagingStatus ?? ''}`.trim();
  if (/blocked/i.test(status)) {
    return {
      label: 'Blocked',
      next: 'Meta is blocking messaging. Fix the Meta account issue, then refresh.',
      className:
        'bg-[color:color-mix(in_oklab,var(--accent-rose)_10%,transparent)] text-[color:var(--accent-rose)]',
    };
  }
  if (/limited|degraded/i.test(status)) {
    return {
      label: 'Limited',
      next: 'Inbound may work, but outbound templates can fail until Meta clears the account.',
      className: 'bg-[color:color-mix(in_oklab,#f59e0b_12%,transparent)] text-[color:#9a5a00]',
    };
  }
  if (health?.webhookVerified === false) {
    return {
      label: 'Waiting',
      next: 'Send the first inbound WhatsApp message, then refresh.',
      className:
        'bg-[color:color-mix(in_oklab,var(--ink)_8%,transparent)] text-[color:var(--text-dim)]',
    };
  }
  return {
    label: 'Ready',
    next: 'Send an inbound WhatsApp message to confirm the tenant agent receives it.',
    className: 'bg-[color:color-mix(in_oklab,#2EA876_12%,transparent)] text-[color:#15704e]',
  };
}
