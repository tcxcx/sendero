'use client';

/**
 * HotelResultsCard — typed render for `search_hotels` results.
 *
 * One row per hotel: photo, name, ★ rating, 0-10 review score, cheapest
 * rate (verbatim from Duffel — never re-summed), cancellation badge,
 * distance from search anchor, top amenities.
 *
 * Tap a row → `select_stay_hotel` CTA → invokes `list_stay_rates` with
 * the search-result id. The funnel from here on is:
 *   list_stay_rates → quote_stay → book_stay
 * No skipping — `search_hotels` doesn't return rate ids.
 */

import { BedSingleIcon, BuildingIcon, MapPinIcon, StarIcon } from 'lucide-react';

export interface HotelResultsCardHotel {
  searchResultId: string;
  name: string;
  country: string | null;
  city: string | null;
  stars: number | null;
  reviewScore: number | null;
  photos: string[];
  cheapestPrice: string;
  cheapestCurrency: string;
  cancellation: 'free' | 'partial' | 'non_refundable' | 'unknown';
  distanceMeters: number | null;
  amenities: string[];
}

export interface HotelResultsCardProps {
  data: {
    checkInDate: string;
    checkOutDate: string;
    rooms: number;
    guests: number;
    hotels: HotelResultsCardHotel[];
    business: {
      name: string;
      supportEmail: string;
      termsUrl: string;
    };
  };
  onSelectHotel?: (searchResultId: string) => void;
}

function fmtMoney(amount: string, currency: string): string {
  const n = Number(amount);
  if (!Number.isFinite(n)) return `${amount} ${currency}`;
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(n);
  } catch {
    return `${amount} ${currency}`;
  }
}

function fmtDistance(meters: number | null): string | null {
  if (meters === null || !Number.isFinite(meters)) return null;
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

function nightsBetween(a: string, b: string): number {
  const start = Date.parse(`${a}T00:00:00Z`);
  const end = Date.parse(`${b}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end)) return 0;
  return Math.max(0, Math.round((end - start) / 86_400_000));
}

function CancellationBadge({ kind }: { kind: HotelResultsCardHotel['cancellation'] }) {
  const label =
    kind === 'free'
      ? 'Free cancellation'
      : kind === 'partial'
        ? 'Partial refund'
        : kind === 'non_refundable'
          ? 'Non-refundable'
          : 'Refund TBC';
  const cls =
    kind === 'free'
      ? 'border-[color:var(--accent-green)] text-[color:var(--accent-green)]'
      : 'border-[color:var(--border)] text-[color:var(--text-dim)]';
  return (
    <span
      className={`rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] ${cls}`}
    >
      {label}
    </span>
  );
}

function StarRow({ stars }: { stars: number }) {
  const filled = Math.max(0, Math.min(5, Math.round(stars)));
  return (
    <span className="inline-flex items-center gap-0.5 text-[color:var(--ink)]">
      {Array.from({ length: filled }).map((_, i) => (
        <StarIcon key={i} className="size-3 fill-current" />
      ))}
    </span>
  );
}

export function HotelResultsCard({ data, onSelectHotel }: HotelResultsCardProps) {
  const nights = nightsBetween(data.checkInDate, data.checkOutDate);
  return (
    <div className="grid gap-3 rounded-2xl border border-[color:var(--border)] bg-[color:var(--panel)] px-4 py-4">
      <div className="flex items-start gap-3">
        <div className="mt-1 grid size-8 place-items-center rounded-lg bg-[color:var(--bg-soft)] text-[color:var(--ink)]">
          <BuildingIcon className="size-4" />
        </div>
        <div className="grid gap-0.5">
          <div className="text-sm font-semibold text-[color:var(--ink)]">
            {data.hotels.length} hotel{data.hotels.length === 1 ? '' : 's'} · {data.checkInDate} →{' '}
            {data.checkOutDate}
          </div>
          <div className="font-mono text-[11px] text-[color:var(--text-dim)]">
            {data.rooms} room{data.rooms === 1 ? '' : 's'} · {data.guests} guest
            {data.guests === 1 ? '' : 's'}
            {nights > 0 ? ` · ${nights} night${nights === 1 ? '' : 's'}` : ''}
          </div>
        </div>
      </div>

      {data.hotels.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[color:var(--border)] bg-[color:var(--bg-soft)] px-3 py-3 text-xs text-[color:var(--text-dim)]">
          No matching hotels for this window.
        </div>
      ) : (
        <div className="grid gap-2">
          {data.hotels.map(hotel => {
            const distance = fmtDistance(hotel.distanceMeters);
            return (
              <button
                key={hotel.searchResultId}
                type="button"
                onClick={() => onSelectHotel?.(hotel.searchResultId)}
                className="grid grid-cols-[64px_1fr_auto] items-center gap-3 rounded-xl border border-[color:var(--border)] bg-[color:var(--bg-soft)] px-3 py-3 text-left transition hover:border-[color:var(--ink)]/40"
              >
                {hotel.photos[0] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={hotel.photos[0]}
                    alt=""
                    className="size-16 rounded-lg object-cover"
                    loading="lazy"
                  />
                ) : (
                  <div className="grid size-16 place-items-center rounded-lg bg-[color:var(--panel)]">
                    <BedSingleIcon className="size-5 text-[color:var(--text-dim)]" />
                  </div>
                )}

                <div className="grid min-w-0 gap-0.5">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-semibold text-[color:var(--ink)]">
                      {hotel.name}
                    </span>
                    {hotel.stars ? <StarRow stars={hotel.stars} /> : null}
                  </div>
                  <div className="flex items-center gap-2 text-[11px] text-[color:var(--text-dim)]">
                    {hotel.reviewScore !== null ? (
                      <span className="font-mono">{hotel.reviewScore.toFixed(1)}/10</span>
                    ) : null}
                    {hotel.city ? <span>{hotel.city}</span> : null}
                    {hotel.country ? <span>· {hotel.country}</span> : null}
                    {distance ? (
                      <span className="inline-flex items-center gap-0.5">
                        <MapPinIcon className="size-3" /> {distance}
                      </span>
                    ) : null}
                  </div>
                  {hotel.amenities.length > 0 ? (
                    <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-[color:var(--text-dim)]">
                      {hotel.amenities.slice(0, 4).join(' · ')}
                    </div>
                  ) : null}
                </div>

                <div className="flex flex-col items-end gap-1">
                  <span className="font-mono text-sm font-semibold text-[color:var(--ink)]">
                    {fmtMoney(hotel.cheapestPrice, hotel.cheapestCurrency)}
                  </span>
                  <CancellationBadge kind={hotel.cancellation} />
                </div>
              </button>
            );
          })}
        </div>
      )}

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
