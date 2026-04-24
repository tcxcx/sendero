'use client';

/**
 * OfferConditionsCard — render the canonical change/refund conditions
 * for a flight offer. Five verdicts:
 *   free · penalty · allowed-unknown-fee · not allowed · unknown
 * Slice-level conditions render below the top-level verdict so operators
 * can see "you can change the outbound only" cases at a glance.
 */

import { CheckIcon, InfoIcon, XIcon } from 'lucide-react';

type Verdict = 'free' | 'penalty' | 'not_allowed' | 'unknown' | 'allowed_unknown_fee';

interface Penalty {
  allowed: boolean;
  penaltyAmount: string | null;
  penaltyCurrency: string | null;
  verdict: Verdict;
}

export interface OfferConditionsCardProps {
  data: {
    offerId?: string;
    totalAmount?: string;
    totalCurrency?: string;
    change?: Penalty;
    refund?: Penalty;
    slices?: Array<{
      sliceId: string;
      origin: string;
      destination: string;
      change: Penalty;
    }>;
    privateFaresApplied?: Array<{ type: string; corporateCode?: string; tourCode?: string }>;
    availableAirlineCreditIds?: string[];
    supportedLoyaltyProgrammes?: string[];
  };
}

function VerdictChip({ kind, penalty }: { kind: 'Changes' | 'Refunds'; penalty?: Penalty }) {
  if (!penalty || penalty.verdict === 'unknown') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-dashed border-[color:var(--border)] px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-[color:var(--text-dim)]">
        <InfoIcon className="size-3" />
        {kind} · unknown
      </span>
    );
  }
  if (penalty.verdict === 'not_allowed') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-[color:var(--accent-rose)]/40 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-[color:var(--accent-rose)]">
        <XIcon className="size-3" />
        {kind} · not allowed
      </span>
    );
  }
  if (penalty.verdict === 'free') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-[color:var(--accent-green)]/40 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-[color:var(--accent-green)]">
        <CheckIcon className="size-3" />
        {kind} · free
      </span>
    );
  }
  if (penalty.verdict === 'allowed_unknown_fee') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-[color:var(--border)] px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-[color:var(--ink)]">
        <CheckIcon className="size-3" />
        {kind} · fee unknown
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-[color:var(--ink)]/40 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-[color:var(--ink)]">
      <CheckIcon className="size-3" />
      {kind} · {penalty.penaltyAmount} {penalty.penaltyCurrency}
    </span>
  );
}

export function OfferConditionsCard({ data }: OfferConditionsCardProps) {
  return (
    <div className="grid gap-3 rounded-2xl border border-[color:var(--border)] bg-[color:var(--panel)] px-4 py-3">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-[color:var(--text-faint)]">
          Offer conditions
        </span>
        {data.totalAmount ? (
          <span className="font-mono text-[11px] text-[color:var(--ink)]">
            {data.totalAmount} {data.totalCurrency}
          </span>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-2">
        <VerdictChip kind="Changes" penalty={data.change} />
        <VerdictChip kind="Refunds" penalty={data.refund} />
      </div>
      {data.slices && data.slices.length > 1 ? (
        <div className="grid gap-1 border-t border-dashed border-[color:var(--border)] pt-2">
          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-[color:var(--text-faint)]">
            Per slice
          </span>
          {data.slices.map(s => (
            <div
              key={s.sliceId}
              className="flex items-center justify-between gap-2 text-xs text-[color:var(--text-dim)]"
            >
              <span className="font-medium text-[color:var(--ink)]">
                {s.origin} → {s.destination}
              </span>
              <VerdictChip kind="Changes" penalty={s.change} />
            </div>
          ))}
        </div>
      ) : null}
      {data.privateFaresApplied && data.privateFaresApplied.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {data.privateFaresApplied.map((f, i) => (
            <span
              key={i}
              className="inline-flex items-center gap-1 rounded-full border border-[color:var(--border)] px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-[color:var(--ink)]"
            >
              {f.type}
              {f.corporateCode ? ` · ${f.corporateCode}` : ''}
              {f.tourCode ? ` · ${f.tourCode}` : ''}
            </span>
          ))}
        </div>
      ) : null}
      {data.availableAirlineCreditIds && data.availableAirlineCreditIds.length > 0 ? (
        <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-[color:var(--text-dim)]">
          {data.availableAirlineCreditIds.length} airline credit
          {data.availableAirlineCreditIds.length === 1 ? '' : 's'} applicable
        </div>
      ) : null}
    </div>
  );
}
