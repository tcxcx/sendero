'use client';

/**
 * StayQuoteReviewCard — canonical pre-booking review per Duffel Go-Live.
 *
 * Surfaces every field Duffel reviews before approving Stays go-live:
 *   • guests + rooms + nights
 *   • accommodation name + address
 *   • check-in/out dates AND times
 *   • billing summary (Room/Taxes/Fees/Total — separated, never summed by us)
 *   • payment schedule (Paid today / Due at accommodation, even when 0)
 *   • cancellation policy (verbatim timeline)
 *   • rate conditions (verbatim, visible by default — no expand action)
 *   • key collection (always visible — even when null, with a fallback note)
 *   • Sendero business details + T&Cs link
 *
 * The legacy default export (`StayQuoteCard`) is preserved as a thin alias
 * so old imports keep working. New code should reach for
 * `StayQuoteReviewCard` directly.
 *
 * https://duffel.notion.site/Duffel-Stays-Go-Live-2026
 */

import { BuildingIcon, KeyIcon, ScrollTextIcon, SparklesIcon } from 'lucide-react';

import {
  CancellationTimeline,
  type CancellationTimelineEntry,
} from '@/components/ai-elements/cancellation-timeline';

export interface StayQuoteReviewBilling {
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
}

export interface StayQuoteReviewAccommodation {
  name: string;
  country: string | null;
  city: string | null;
  address: string | null;
  checkInAfter: string | null;
  checkOutBefore: string | null;
  keyCollection: string | null;
}

export interface StayQuoteReviewCondition {
  title: string;
  description: string;
}

export interface StayQuoteReviewBusiness {
  name: string;
  address: string;
  supportEmail: string;
  supportPhone: string;
  termsUrl: string;
  bookingComTermsUrl?: string;
}

export interface StayQuoteReviewCardProps {
  data: {
    quoteId: string;
    accommodation: StayQuoteReviewAccommodation;
    checkInDate: string;
    checkOutDate: string;
    nights: number;
    rooms: number;
    guests: number;
    roomName: string | null;
    paymentType: string | null;
    billing: StayQuoteReviewBilling;
    cancellationTimeline: Array<{ before: string; refundAmount: string; currency: string }>;
    conditions: StayQuoteReviewCondition[];
    supportedLoyaltyProgrammeName?: string | null;
    business: StayQuoteReviewBusiness;
    /** When `true`, render the "Booking confirmed" banner shape — used by
     *  StayBookingConfirmationCard which composes this for layout reuse. */
    confirmedBannerLabel?: string;
    confirmedAt?: string | null;
    bookingReference?: string;
  };
}

function fmtMoney(amount: string, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(Number(amount));
  } catch {
    return `${amount} ${currency}`;
  }
}

function fmtDate(iso: string): string {
  // Accept "YYYY-MM-DD" or full ISO; emit "Fri 19 May" style.
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(d);
}

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}

function toEntries(
  raw: Array<{ refundAmount: string; before: string; currency: string }>
): CancellationTimelineEntry[] {
  return raw.map(r => ({ refundAmount: r.refundAmount, before: r.before, currency: r.currency }));
}

export function StayQuoteReviewCard({ data }: StayQuoteReviewCardProps) {
  const { accommodation, billing, business } = data;

  // Spec: surface even when 0. The fallback below is a defense-in-depth so
  // unstructured upstream payloads never strip the row out of the render.
  const dueAtProp = billing.dueAtAccommodationAmount ?? '0';
  const dueAtPropCurrency = billing.dueAtAccommodationCurrency ?? billing.totalCurrency;

  const keyCollection =
    accommodation.keyCollection ??
    'Ask at the property on arrival — Duffel returned no key-collection note.';

  return (
    <div className="grid gap-4 rounded-2xl border border-[color:var(--border)] bg-[color:var(--panel)] px-4 py-4">
      {/* Header — booking-confirmed banner OR plain quote header. */}
      {data.confirmedBannerLabel ? (
        <div className="flex items-center justify-center text-sm font-semibold text-[color:var(--ink)]">
          <span className="inline-flex items-center gap-2">
            <span aria-hidden>✓</span> {data.confirmedBannerLabel}
          </span>
        </div>
      ) : (
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="mt-1 grid size-8 place-items-center rounded-lg bg-[color:var(--bg-soft)] text-[color:var(--ink)]">
              <BuildingIcon className="size-4" />
            </div>
            <div>
              <div className="font-medium text-sm text-[color:var(--ink)]">
                Quote {fmtMoney(billing.totalAmount, billing.totalCurrency)}
              </div>
              <div className="font-mono text-[11px] text-[color:var(--text-dim)]">
                {data.checkInDate} → {data.checkOutDate}
                {data.paymentType ? ` · ${data.paymentType.replace(/_/g, ' ')}` : ''}
              </div>
            </div>
          </div>
          {data.supportedLoyaltyProgrammeName ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-[color:var(--ink)]/30 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-[color:var(--ink)]">
              <SparklesIcon className="size-3" />
              {data.supportedLoyaltyProgrammeName}
            </span>
          ) : null}
        </div>
      )}

      {data.bookingReference ? (
        <div className="grid gap-1">
          <div className="text-[11px] uppercase tracking-[0.16em] text-[color:var(--text-dim)]">
            Booking reference
          </div>
          <div className="font-mono text-sm font-semibold text-[color:var(--ink)]">
            {data.bookingReference}
          </div>
        </div>
      ) : null}

      <div className="text-[11px] text-[color:var(--text-dim)]">
        {data.rooms} room{data.rooms === 1 ? '' : 's'} · {data.guests} guest
        {data.guests === 1 ? '' : 's'} · {data.nights} night{data.nights === 1 ? '' : 's'}
      </div>

      {data.confirmedAt ? (
        <div className="text-xs text-[color:var(--text-dim)]">
          Confirmed {fmtDateTime(data.confirmedAt)}
        </div>
      ) : null}

      {/* Accommodation block. */}
      <div className="grid gap-1">
        <div className="text-sm font-semibold text-[color:var(--ink)]">{accommodation.name}</div>
        {accommodation.address ? (
          <div className="text-xs text-[color:var(--text-dim)]">{accommodation.address}</div>
        ) : accommodation.city ? (
          <div className="text-xs text-[color:var(--text-dim)]">
            {accommodation.city}
            {accommodation.country ? ` · ${accommodation.country}` : ''}
          </div>
        ) : null}
        {data.roomName ? (
          <div className="text-[11px] uppercase tracking-[0.12em] text-[color:var(--text-dim)]">
            {data.roomName}
          </div>
        ) : null}
      </div>

      {/* Check-in / check-out grid. */}
      <div className="grid grid-cols-2 gap-4 rounded-xl border border-[color:var(--border)] bg-[color:var(--bg-soft)] px-3 py-3">
        <div>
          <div className="text-[11px] uppercase tracking-[0.12em] text-[color:var(--text-dim)]">
            Check in
          </div>
          <div className="text-sm font-semibold text-[color:var(--ink)]">
            {fmtDate(data.checkInDate)}
          </div>
          <div className="text-[11px] text-[color:var(--text-dim)]">
            {accommodation.checkInAfter ? `from ${accommodation.checkInAfter}` : '—'}
          </div>
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-[0.12em] text-[color:var(--text-dim)]">
            Check out
          </div>
          <div className="text-sm font-semibold text-[color:var(--ink)]">
            {fmtDate(data.checkOutDate)}
          </div>
          <div className="text-[11px] text-[color:var(--text-dim)]">
            {accommodation.checkOutBefore ? `until ${accommodation.checkOutBefore}` : '—'}
          </div>
        </div>
      </div>

      {/* Billing summary. */}
      <div className="grid gap-2">
        <div className="text-[11px] uppercase tracking-[0.16em] text-[color:var(--text-dim)]">
          Billing summary
        </div>
        <BillingRow
          label="Room"
          amount={billing.baseAmount ?? billing.totalAmount}
          currency={billing.baseCurrency ?? billing.totalCurrency}
        />
        <BillingRow label="Taxes" amount={billing.taxAmount} currency={billing.taxCurrency} />
        <BillingRow label="Fees" amount={billing.feeAmount} currency={billing.feeCurrency} />
        <div className="border-t border-[color:var(--border)] pt-2">
          <BillingRow
            label="Total"
            amount={billing.totalAmount}
            currency={billing.totalCurrency}
            emphasis
          />
        </div>
      </div>

      {/* Payment schedule — always render due-at-prop, even when 0. */}
      <div className="grid gap-2">
        <div className="text-[11px] uppercase tracking-[0.16em] text-[color:var(--text-dim)]">
          Payment schedule
        </div>
        <BillingRow
          label="Paid today"
          amount={billing.totalAmount}
          currency={billing.totalCurrency}
        />
        <BillingRow label="Due at accommodation" amount={dueAtProp} currency={dueAtPropCurrency} />
      </div>

      {/* Cancellation policy. */}
      <div className="grid gap-2">
        <div className="text-[11px] uppercase tracking-[0.16em] text-[color:var(--text-dim)]">
          Cancellation policy
        </div>
        <CancellationTimeline
          entries={toEntries(data.cancellationTimeline)}
          totalAmount={billing.totalAmount}
          checkInDate={data.checkInDate}
          paymentType={data.paymentType ?? undefined}
        />
      </div>

      {/* Conditions verbatim — no expand action; full text always visible. */}
      {data.conditions.length > 0 ? (
        <div className="grid gap-2">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.16em] text-[color:var(--text-dim)]">
            <ScrollTextIcon className="size-3" />
            Hotel policy &amp; rate conditions
          </div>
          <div className="grid gap-3 rounded-xl border border-[color:var(--border)] bg-[color:var(--bg-soft)] px-3 py-3">
            {data.conditions.map((c, i) => (
              <div key={i} className="grid gap-1">
                <div className="text-xs font-semibold text-[color:var(--ink)]">{c.title}</div>
                {c.description ? (
                  <p className="whitespace-pre-wrap text-xs leading-relaxed text-[color:var(--text-dim)]">
                    {c.description}
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* Key collection — always visible, with fallback when API returned null. */}
      <div className="flex items-start gap-2 rounded-xl border border-[color:var(--border)] bg-[color:var(--bg-soft)] px-3 py-3">
        <KeyIcon className="size-4 text-[color:var(--ink)]" />
        <div className="grid gap-1">
          <div className="text-[11px] uppercase tracking-[0.12em] text-[color:var(--text-dim)]">
            Key collection
          </div>
          <p className="text-xs leading-relaxed text-[color:var(--ink)]">{keyCollection}</p>
        </div>
      </div>

      {/* Business details footer. */}
      <div className="border-t border-[color:var(--border)] pt-3 text-[11px] text-[color:var(--text-dim)]">
        <div className="font-semibold text-[color:var(--ink)]">Sold by {business.name}</div>
        <div>{business.address}</div>
        <div className="grid gap-1 pt-1 sm:flex sm:items-center sm:gap-3">
          <a
            href={`mailto:${business.supportEmail}`}
            className="text-[color:var(--ink)] underline-offset-2 hover:underline"
          >
            {business.supportEmail}
          </a>
          <a
            href={`tel:${business.supportPhone.replace(/[^0-9+]/g, '')}`}
            className="text-[color:var(--ink)] underline-offset-2 hover:underline"
          >
            {business.supportPhone}
          </a>
        </div>
        <div className="grid gap-1 pt-1 sm:flex sm:items-center sm:gap-3">
          <a
            href={business.termsUrl}
            target="_blank"
            rel="noreferrer"
            className="text-[color:var(--ink)] underline-offset-2 hover:underline"
          >
            Booking conditions &amp; T&amp;C
          </a>
          {business.bookingComTermsUrl ? (
            <a
              href={business.bookingComTermsUrl}
              target="_blank"
              rel="noreferrer"
              className="text-[color:var(--ink)] underline-offset-2 hover:underline"
            >
              Booking.com terms
            </a>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function BillingRow({
  label,
  amount,
  currency,
  emphasis,
}: {
  label: string;
  amount: string;
  currency: string;
  emphasis?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span
        className={
          emphasis
            ? 'text-sm font-semibold text-[color:var(--ink)]'
            : 'text-xs text-[color:var(--text-dim)]'
        }
      >
        {label}
      </span>
      <span
        className={
          emphasis
            ? 'font-mono text-sm font-semibold text-[color:var(--ink)]'
            : 'font-mono text-xs text-[color:var(--ink)]'
        }
      >
        {fmtMoney(amount, currency)}
      </span>
    </div>
  );
}

/**
 * Legacy back-compat alias. Old tool callers passing the narrower shape
 * (no accommodation/billing/conditions split) still render — the card
 * fills missing fields with safe defaults so the bigger shape opt-in
 * doesn't break stale call sites mid-rollout.
 */
export interface StayQuoteCardLegacyProps {
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
    supportedLoyaltyProgramme?: { reference?: string; name?: string; logo_url?: string } | null;
    conditions?: Array<{ title: string; description?: string }>;
  };
}

export function StayQuoteCard({ data }: StayQuoteCardLegacyProps) {
  return (
    <StayQuoteReviewCard
      data={{
        quoteId: data.quoteId ?? '',
        accommodation: {
          name: 'Property',
          country: null,
          city: null,
          address: null,
          checkInAfter: null,
          checkOutBefore: null,
          keyCollection: null,
        },
        checkInDate: data.checkInDate ?? '',
        checkOutDate: data.checkOutDate ?? '',
        nights: 0,
        rooms: 1,
        guests: 1,
        roomName: null,
        paymentType: data.paymentType ?? null,
        billing: {
          baseAmount: null,
          baseCurrency: data.totalCurrency ?? 'USD',
          taxAmount: '0',
          taxCurrency: data.totalCurrency ?? 'USD',
          feeAmount: '0',
          feeCurrency: data.totalCurrency ?? 'USD',
          totalAmount: data.totalAmount ?? '0',
          totalCurrency: data.totalCurrency ?? 'USD',
          dueAtAccommodationAmount: data.dueAtAccommodationAmount ?? '0',
          dueAtAccommodationCurrency:
            data.dueAtAccommodationCurrency ?? data.totalCurrency ?? 'USD',
        },
        cancellationTimeline: (data.cancellationTimeline ?? []).map(t => ({
          refundAmount: t.refund_amount,
          before: t.before,
          currency: t.currency,
        })),
        conditions: (data.conditions ?? []).map(c => ({
          title: c.title,
          description: c.description ?? '',
        })),
        supportedLoyaltyProgrammeName:
          data.supportedLoyaltyProgramme?.name ?? data.supportedLoyaltyProgramme?.reference ?? null,
        business: {
          name: 'Sendero Travel',
          address: '548 Market St #38322, San Francisco, CA 94104, USA',
          supportEmail: 'hello@sendero.travel',
          supportPhone: '+1 (415) 813-1131',
          termsUrl: 'https://sendero.travel/legal/terms',
        },
      }}
    />
  );
}
