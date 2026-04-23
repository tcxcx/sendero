'use client';

/**
 * CancellationTimeline — AI Elements-native cancellation schedule for
 * Duffel Stays quotes/bookings AND (shape-compatible) for flight offer
 * conditions. Adapted from the Duffel Components reference timeline
 * (https://github.com/duffelhq/duffel-components) with Sendero motion
 * rules: property-specific transitions, no scale-from-zero, deliberate
 * hierarchy around the refund/no-refund boundary.
 */

import type { ReactNode } from 'react';

export type CancellationPaymentType = 'pay_now' | 'deposit' | 'guarantee' | string;

export interface CancellationTimelineEntry {
  /** Amount refundable up until `before`. */
  refundAmount: string;
  before: string;
  currency: string;
}

export interface CancellationTimelineProps {
  entries: CancellationTimelineEntry[];
  totalAmount: string;
  /** ISO date of booking (for the "Booking" anchor). */
  bookingDate?: string;
  /** ISO datetime of check-in (for the "Check-in" anchor). */
  checkInDate?: string;
  paymentType?: CancellationPaymentType;
}

function fmtDate(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return d.toISOString().slice(0, 10);
}

function fmtMoney(amount: string, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(Number(amount));
  } catch {
    return `${amount} ${currency}`;
  }
}

function sectionColor(isFull: boolean): string {
  return isFull ? 'var(--accent-green)' : 'var(--ink)';
}

export function CancellationTimeline({
  entries,
  totalAmount,
  bookingDate,
  checkInDate,
  paymentType,
}: CancellationTimelineProps) {
  if (!entries.length) {
    return (
      <div className="rounded-xl border border-dashed border-[color:var(--border)] bg-[color:var(--bg-soft)] px-4 py-3 text-xs text-[color:var(--text-dim)]">
        Non-refundable — cancelling after booking returns no money.
      </div>
    );
  }

  const policies = entries.map((e, i) => {
    const isFull = Number(e.refundAmount) === Number(totalAmount);
    return {
      idx: i,
      isFull,
      color: sectionColor(isFull),
      label: isFull ? 'Full refund' : 'Partial refund',
      detail: fmtMoney(e.refundAmount, e.currency),
      before: e.before,
    };
  });

  return (
    <div className="grid gap-3">
      <div className="flex items-center justify-between text-[11px] font-mono uppercase tracking-[0.12em] text-[color:var(--text-faint)]">
        <span>Cancellation timeline</span>
        {paymentType ? <span>{paymentType.replace(/_/g, ' ')}</span> : null}
      </div>
      <ul className="grid gap-1.5 text-xs">
        {policies.map(p => (
          <li key={p.before} className="flex items-center gap-2">
            <span
              className="inline-block size-2 rounded-full"
              style={{ background: p.color }}
              aria-hidden="true"
            />
            <span className="min-w-0 flex-1">
              <span className="font-medium text-[color:var(--ink)]">{p.label}</span>
              <span className="text-[color:var(--text-dim)]"> · {p.detail}</span>
              <span className="text-[color:var(--text-dim)]"> · until {fmtDate(p.before)}</span>
            </span>
          </li>
        ))}
        <li className="flex items-center gap-2">
          <span
            className="inline-block size-2 rounded-full"
            style={{ background: 'var(--accent-rose)' }}
            aria-hidden="true"
          />
          <span className="font-medium text-[color:var(--accent-rose)]">No refund</span>
          <span className="text-[color:var(--text-dim)]">
            {' '}
            · after {fmtDate(entries[entries.length - 1].before)}
          </span>
        </li>
      </ul>
      <TimelineStrip policies={policies} bookingDate={bookingDate} checkInDate={checkInDate} />
    </div>
  );
}

function TimelineStrip({
  policies,
  bookingDate,
  checkInDate,
}: {
  policies: Array<{ color: string; label: string; before: string; idx: number; isFull: boolean }>;
  bookingDate?: string;
  checkInDate?: string;
}) {
  return (
    <div className="relative rounded-lg border border-[color:var(--border)] bg-[color:var(--panel)] px-3 py-6">
      {/* horizontal track */}
      <div className="relative h-2 w-full overflow-hidden rounded-full bg-[color:var(--bg-soft)]">
        {policies.map((p, i) => {
          const w = 100 / (policies.length + 1);
          return (
            <span
              key={p.before}
              className="absolute top-0 h-2"
              style={{
                left: `${i * w}%`,
                width: `${w}%`,
                background: p.color,
              }}
            />
          );
        })}
        <span
          className="absolute top-0 h-2"
          style={{
            left: `${policies.length * (100 / (policies.length + 1))}%`,
            width: `${100 / (policies.length + 1)}%`,
            background: 'var(--accent-rose)',
          }}
        />
      </div>
      {/* anchor labels */}
      <div className="mt-2 flex items-center justify-between font-mono text-[10px] text-[color:var(--text-faint)]">
        <Anchor label="Booking" date={bookingDate} />
        <Anchor label="Check-in" date={checkInDate} />
      </div>
    </div>
  );
}

function Anchor({ label, date }: { label: string; date?: string }): ReactNode {
  return (
    <span className="flex flex-col items-center">
      <span className="uppercase tracking-[0.14em]">{label}</span>
      {date ? <span>{fmtDate(date)}</span> : null}
    </span>
  );
}
