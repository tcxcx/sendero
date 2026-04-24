'use client';

/**
 * StayQuoteCard — canonical render for `quote_stay` results. Pairs the
 * cancellation timeline with the loyalty badge + rate conditions so the
 * operator can forward a single artifact to the traveler on any channel.
 */

import { BuildingIcon, SparklesIcon } from 'lucide-react';

import {
  CancellationTimeline,
  type CancellationTimelineEntry,
} from '@/components/ai-elements/cancellation-timeline';

export interface StayQuoteCardProps {
  data: {
    quoteId?: string;
    totalAmount?: string;
    totalCurrency?: string;
    checkInDate?: string;
    checkOutDate?: string;
    paymentType?: string;
    dueAtAccommodationAmount?: string;
    dueAtAccommodationCurrency?: string;
    cancellationTimeline?: Array<{ refund_amount: string; before: string; currency: string }>;
    supportedLoyaltyProgramme?: {
      reference?: string;
      name?: string;
      logo_url?: string;
    } | null;
    conditions?: Array<{ title: string; description?: string }>;
  };
}

function toEntries(
  raw: Array<{ refund_amount: string; before: string; currency: string }> | undefined
): CancellationTimelineEntry[] {
  return (raw ?? []).map(r => ({
    refundAmount: r.refund_amount,
    before: r.before,
    currency: r.currency,
  }));
}

export function StayQuoteCard({ data }: StayQuoteCardProps) {
  return (
    <div className="grid gap-3 rounded-2xl border border-[color:var(--border)] bg-[color:var(--panel)] px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="mt-1 grid size-8 place-items-center rounded-lg bg-[color:var(--bg-soft)] text-[color:var(--ink)]">
            <BuildingIcon className="size-4" />
          </div>
          <div>
            <div className="font-medium text-sm text-[color:var(--ink)]">
              Quote {data.totalAmount} {data.totalCurrency}
            </div>
            <div className="font-mono text-[11px] text-[color:var(--text-dim)]">
              {data.checkInDate ?? '—'} → {data.checkOutDate ?? '—'}
              {data.paymentType ? ` · ${data.paymentType.replace(/_/g, ' ')}` : ''}
            </div>
          </div>
        </div>
        {data.supportedLoyaltyProgramme ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-[color:var(--ink)]/30 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-[color:var(--ink)]">
            <SparklesIcon className="size-3" />
            {data.supportedLoyaltyProgramme.name ??
              data.supportedLoyaltyProgramme.reference ??
              'Loyalty'}
          </span>
        ) : null}
      </div>
      {data.dueAtAccommodationAmount ? (
        <div className="font-mono text-[11px] text-[color:var(--text-dim)]">
          Due at check-in: {data.dueAtAccommodationAmount} {data.dueAtAccommodationCurrency}
        </div>
      ) : null}
      {data.cancellationTimeline && data.cancellationTimeline.length > 0 ? (
        <CancellationTimeline
          entries={toEntries(data.cancellationTimeline)}
          totalAmount={data.totalAmount ?? '0'}
          checkInDate={data.checkInDate}
          paymentType={data.paymentType}
        />
      ) : null}
      {data.conditions && data.conditions.length > 0 ? (
        <ul className="grid gap-1 text-xs text-[color:var(--text-dim)]">
          {data.conditions.map((c, i) => (
            <li key={i}>
              <span className="font-medium text-[color:var(--ink)]">{c.title}</span>
              {c.description ? ` — ${c.description}` : ''}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
