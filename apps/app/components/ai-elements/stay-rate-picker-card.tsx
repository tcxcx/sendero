'use client';

/**
 * StayRatePickerCard — room × rate matrix from `list_stay_rates`.
 *
 * Each row is a tap target. The CTA emits `select_stay_rate` with the
 * rate id; the agent then invokes `quote_stay`. Rooms are grouped so the
 * operator can compare "Successful Booking by Card" vs "Successful
 * Booking by Balance" (Duffel's test-hotel naming convention) at a glance.
 *
 * Per Duffel Go-Live, every per-rate row surfaces:
 *   • room name
 *   • total + tax + fee separately (room subtotal computed from base when present)
 *   • due-at-accommodation (always — even when 0)
 *   • payment_type + accepted methods
 *   • refundable badge
 */

import { BedSingleIcon, BuildingIcon, CreditCardIcon, WalletIcon } from 'lucide-react';

export interface StayRatePickerRate {
  rateId: string;
  roomName: string | null;
  paymentType: string | null;
  availablePaymentMethods: string[];
  refundable: boolean;
  boardType: string | null;
  billing: {
    baseAmount: string | null;
    baseCurrency: string | null;
    taxAmount: string;
    taxCurrency: string;
    feeAmount: string;
    feeCurrency: string;
    totalAmount: string;
    totalCurrency: string;
    dueAtAccommodationAmount: string;
    dueAtAccommodationCurrency: string;
  };
}

export interface StayRatePickerCardProps {
  data: {
    searchResultId: string;
    accommodation: {
      name: string;
      country: string | null;
      city: string | null;
      address: string | null;
      checkInAfter: string | null;
      checkOutBefore: string | null;
      keyCollection: string | null;
    };
    checkInDate: string | null;
    checkOutDate: string | null;
    rooms: number;
    guests: number;
    rates: StayRatePickerRate[];
    business: {
      name: string;
      supportEmail: string;
      termsUrl: string;
    };
  };
  /** Optional callback when an operator taps a rate. The agent runtime
   *  will read the CTA's `value: rateId` instead in production; the prop
   *  exists so the operator preview can intercept and stage the call. */
  onSelectRate?: (rateId: string) => void;
}

function fmtMoney(amount: string, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(Number(amount));
  } catch {
    return `${amount} ${currency}`;
  }
}

function nightsBetween(a: string | null, b: string | null): number {
  if (!a || !b) return 0;
  const start = Date.parse(`${a}T00:00:00Z`);
  const end = Date.parse(`${b}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end)) return 0;
  return Math.max(0, Math.round((end - start) / 86_400_000));
}

function PaymentMethodChips({ methods }: { methods: string[] }) {
  if (!methods.length) return null;
  return (
    <div className="flex items-center gap-1">
      {methods.map(m => (
        <span
          key={m}
          className="inline-flex items-center gap-1 rounded-full border border-[color:var(--border)] bg-[color:var(--bg-soft)] px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.1em] text-[color:var(--text-dim)]"
        >
          {m === 'card' ? (
            <CreditCardIcon className="size-2.5" />
          ) : m === 'balance' ? (
            <WalletIcon className="size-2.5" />
          ) : null}
          {m}
        </span>
      ))}
    </div>
  );
}

export function StayRatePickerCard({ data, onSelectRate }: StayRatePickerCardProps) {
  const nights = nightsBetween(data.checkInDate, data.checkOutDate);
  const grouped = new Map<string, StayRatePickerRate[]>();
  for (const r of data.rates) {
    const key = r.roomName ?? '—';
    const list = grouped.get(key);
    if (list) list.push(r);
    else grouped.set(key, [r]);
  }

  return (
    <div className="grid gap-3 rounded-2xl border border-[color:var(--border)] bg-[color:var(--panel)] px-4 py-4">
      {/* Header */}
      <div className="flex items-start gap-3">
        <div className="mt-1 grid size-8 place-items-center rounded-lg bg-[color:var(--bg-soft)] text-[color:var(--ink)]">
          <BuildingIcon className="size-4" />
        </div>
        <div className="grid gap-0.5">
          <div className="text-sm font-semibold text-[color:var(--ink)]">
            {data.accommodation.name}
          </div>
          <div className="text-[11px] text-[color:var(--text-dim)]">
            {data.accommodation.address ??
              [data.accommodation.city, data.accommodation.country].filter(Boolean).join(' · ') ??
              '—'}
          </div>
          <div className="text-[11px] text-[color:var(--text-dim)]">
            {data.rooms} room{data.rooms === 1 ? '' : 's'} · {data.guests} guest
            {data.guests === 1 ? '' : 's'}
            {nights > 0 ? ` · ${nights} night${nights === 1 ? '' : 's'}` : ''}
            {data.checkInDate && data.checkOutDate
              ? ` · ${data.checkInDate} → ${data.checkOutDate}`
              : ''}
          </div>
        </div>
      </div>

      {/* Rooms × rates */}
      <div className="grid gap-3">
        {[...grouped.entries()].map(([roomName, rates]) => (
          <div key={roomName} className="grid gap-2">
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.16em] text-[color:var(--text-dim)]">
              <BedSingleIcon className="size-3" />
              {roomName}
            </div>
            <div className="grid gap-2">
              {rates.map(rate => (
                <button
                  key={rate.rateId}
                  type="button"
                  onClick={() => onSelectRate?.(rate.rateId)}
                  className="grid gap-2 rounded-xl border border-[color:var(--border)] bg-[color:var(--bg-soft)] px-3 py-3 text-left transition hover:border-[color:var(--ink)]/40"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <div className="grid gap-0.5">
                      <div className="text-sm font-semibold text-[color:var(--ink)]">
                        {fmtMoney(rate.billing.totalAmount, rate.billing.totalCurrency)}
                      </div>
                      <div className="font-mono text-[11px] text-[color:var(--text-dim)]">
                        Tax {fmtMoney(rate.billing.taxAmount, rate.billing.taxCurrency)} · Fee{' '}
                        {fmtMoney(rate.billing.feeAmount, rate.billing.feeCurrency)} · Due at
                        property{' '}
                        {fmtMoney(
                          rate.billing.dueAtAccommodationAmount,
                          rate.billing.dueAtAccommodationCurrency
                        )}
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <span
                        className={
                          rate.refundable
                            ? 'rounded-full border border-[color:var(--accent-green)] px-2 py-0.5 text-[10px] font-mono uppercase tracking-[0.12em] text-[color:var(--accent-green)]'
                            : 'rounded-full border border-[color:var(--border)] px-2 py-0.5 text-[10px] font-mono uppercase tracking-[0.12em] text-[color:var(--text-dim)]'
                        }
                      >
                        {rate.refundable ? 'Refundable' : 'Non-refundable'}
                      </span>
                      {rate.paymentType ? (
                        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-[color:var(--text-dim)]">
                          {rate.paymentType.replace(/_/g, ' ')}
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <PaymentMethodChips methods={rate.availablePaymentMethods} />
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Footer — minimal here; full Sendero details surface on the quote review. */}
      <div className="border-t border-[color:var(--border)] pt-2 text-[10px] text-[color:var(--text-dim)]">
        Sold by {data.business.name} ·{' '}
        <a
          href={`mailto:${data.business.supportEmail}`}
          className="text-[color:var(--ink)] underline-offset-2 hover:underline"
        >
          {data.business.supportEmail}
        </a>{' '}
        ·{' '}
        <a
          href={data.business.termsUrl}
          target="_blank"
          rel="noreferrer"
          className="text-[color:var(--ink)] underline-offset-2 hover:underline"
        >
          T&amp;C
        </a>
      </div>
    </div>
  );
}
