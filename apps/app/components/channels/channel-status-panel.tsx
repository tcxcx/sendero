'use client';

import { useTransition } from 'react';
import { CheckCircle2, AlertTriangle, Loader2, RefreshCw, ExternalLink } from 'lucide-react';
import Link from 'next/link';

export type ChannelStatusKind = 'active' | 'pending' | 'disabled' | 'error' | 'not_installed';

export interface ChannelStatusPanelProps {
  brand: 'whatsapp' | 'slack';
  status: ChannelStatusKind;
  /** Display name (WhatsApp display number / Slack team name). */
  identifier: string | null;
  lastHealthyAt: string | null;
  lastErrorMessage: string | null;
  /** Onboarding URL to (re)connect. */
  connectHref: string;
  /** Server action that re-pings the channel and revalidates the page. */
  onProbe?: () => Promise<{ ok: boolean; message?: string } | void>;
}

const STATUS_COPY: Record<
  ChannelStatusKind,
  { label: string; tone: 'ok' | 'warn' | 'bad' | 'neutral' }
> = {
  active: { label: 'Connected', tone: 'ok' },
  pending: { label: 'Pending', tone: 'warn' },
  disabled: { label: 'Disabled', tone: 'neutral' },
  error: { label: 'Error', tone: 'bad' },
  not_installed: { label: 'Not connected', tone: 'neutral' },
};

const TONE_CLASSES: Record<'ok' | 'warn' | 'bad' | 'neutral', string> = {
  ok: 'border-[color:var(--accent-green,#16a34a)] text-[color:var(--accent-green,#16a34a)]',
  warn: 'border-[color:var(--accent-amber,#d97706)] text-[color:var(--accent-amber,#d97706)]',
  bad: 'border-[color:var(--accent-rose,#e11d48)] text-[color:var(--accent-rose,#e11d48)]',
  neutral: 'border-border text-muted-foreground',
};

export function ChannelStatusPanel({
  brand,
  status,
  identifier,
  lastHealthyAt,
  lastErrorMessage,
  connectHref,
  onProbe,
}: ChannelStatusPanelProps) {
  const [pending, start] = useTransition();
  const copy = STATUS_COPY[status];
  const brandName = brand === 'whatsapp' ? 'WhatsApp' : 'Slack';
  const lastHealthyLabel = lastHealthyAt ? formatRelative(new Date(lastHealthyAt)) : '—';

  return (
    <section className="flex flex-col gap-4 rounded-[var(--radius-lg)] bg-[color:var(--surface-raised)] p-6 shadow-[var(--shadow-md)]">
      <header className="flex flex-wrap items-center gap-3">
        <span
          className={
            'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] ' +
            TONE_CLASSES[copy.tone]
          }
          aria-label={`${brandName} channel status: ${copy.label}`}
        >
          {copy.tone === 'ok' ? (
            <CheckCircle2 className="size-3" aria-hidden="true" />
          ) : copy.tone === 'bad' ? (
            <AlertTriangle className="size-3" aria-hidden="true" />
          ) : null}
          {copy.label}
        </span>
        {identifier ? (
          <span className="font-mono text-xs text-foreground">{identifier}</span>
        ) : null}
        <div className="ml-auto flex items-center gap-2">
          {onProbe ? (
            <button
              type="button"
              disabled={pending || status === 'not_installed'}
              onClick={() =>
                start(async () => {
                  await onProbe();
                })
              }
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-foreground hover:border-[color:var(--ink)] hover:text-[color:var(--ink)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {pending ? (
                <Loader2 className="size-3 animate-spin" aria-hidden="true" />
              ) : (
                <RefreshCw className="size-3" aria-hidden="true" />
              )}
              {pending ? 'Probing…' : 'Run health check'}
            </button>
          ) : null}
          <Link
            href={connectHref}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-foreground hover:border-[color:var(--ink)] hover:text-[color:var(--ink)]"
          >
            {status === 'not_installed' ? 'Connect' : 'Manage install'}
            <ExternalLink className="size-3" aria-hidden="true" />
          </Link>
        </div>
      </header>

      <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-0.5">
          <dt className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            Last healthy
          </dt>
          <dd className="text-sm text-foreground">{lastHealthyLabel}</dd>
        </div>
        <div className="flex flex-col gap-0.5">
          <dt className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            Last error
          </dt>
          <dd className="text-sm text-foreground">
            {lastErrorMessage ? (
              <code className="break-words font-mono text-xs text-[color:var(--accent-rose,#e11d48)]">
                {lastErrorMessage}
              </code>
            ) : (
              <span className="text-muted-foreground">None recorded</span>
            )}
          </dd>
        </div>
      </dl>
    </section>
  );
}

function formatRelative(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const sec = Math.round(diffMs / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 48) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  return `${day}d ago`;
}
