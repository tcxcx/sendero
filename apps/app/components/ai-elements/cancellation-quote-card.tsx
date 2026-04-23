'use client';

/**
 * CancellationQuoteCard — renders a Duffel order cancellation quote
 * (refund destination, amount, expiry, any airline credits that will
 * be issued). Matches the `cancel_order_quote` tool shape.
 */

import { AlertOctagonIcon, GiftIcon } from 'lucide-react';

export interface CancellationQuoteCardProps {
  data: {
    cancellationId?: string;
    orderId?: string;
    refundAmount?: string | null;
    refundCurrency?: string | null;
    refundTo?: string;
    expiresAt?: string | null;
    airlineCredits?: Array<{
      passengerId: string;
      creditName: string;
      creditAmount: string;
      creditCurrency: string;
    }>;
  };
}

function fmtExpiry(iso?: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
}

export function CancellationQuoteCard({ data }: CancellationQuoteCardProps) {
  const credits = data.airlineCredits ?? [];
  const refundTo = (data.refundTo ?? 'original_form_of_payment').replace(/_/g, ' ');
  return (
    <div className="grid gap-3 rounded-2xl border border-[color:var(--border)] bg-[color:var(--panel)] px-4 py-3">
      <div className="flex items-start gap-3">
        <div className="mt-1 grid size-8 place-items-center rounded-lg bg-[color:var(--bg-soft)] text-[color:var(--accent-rose)]">
          <AlertOctagonIcon className="size-4" />
        </div>
        <div className="flex-1">
          <div className="font-medium text-sm text-[color:var(--ink)]">Cancellation quote</div>
          <div className="mt-0.5 font-mono text-[11px] text-[color:var(--text-dim)]">
            Refund to · {refundTo}
          </div>
        </div>
        {data.refundAmount && data.refundCurrency ? (
          <span className="font-mono text-[11px] text-[color:var(--ink)]">
            {data.refundAmount} {data.refundCurrency}
          </span>
        ) : (
          <span className="font-mono text-[11px] text-[color:var(--text-dim)]">amount unknown</span>
        )}
      </div>
      {data.expiresAt ? (
        <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-[color:var(--text-faint)]">
          Quote expires: {fmtExpiry(data.expiresAt)}
        </div>
      ) : null}
      {credits.length > 0 ? (
        <div className="grid gap-2 border-t border-dashed border-[color:var(--border)] pt-2">
          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-[color:var(--text-faint)]">
            Airline credits to be issued
          </span>
          <ul className="grid gap-1 text-xs text-[color:var(--text-dim)]">
            {credits.map((c, i) => (
              <li key={`${c.passengerId}-${i}`} className="flex items-center gap-2">
                <GiftIcon className="size-3 text-[color:var(--ink)]" />
                <span className="min-w-0 flex-1">
                  <span className="font-medium text-[color:var(--ink)]">{c.creditName}</span>
                  <span>
                    {' '}
                    · {c.creditAmount} {c.creditCurrency}
                  </span>
                </span>
                <span className="font-mono text-[10px] uppercase tracking-[0.12em]">
                  pas {c.passengerId.slice(0, 12)}
                </span>
              </li>
            ))}
          </ul>
          <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-[color:var(--text-faint)]">
            Credit codes appear after confirmation.
          </div>
        </div>
      ) : null}
    </div>
  );
}
