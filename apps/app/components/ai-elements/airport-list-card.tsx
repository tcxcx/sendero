'use client';

/**
 * AirportListCard — render the `find_airports_nearby` tool result as a
 * short list of airports with distance, cabin-class-free, and a
 * deep-link into the Sendero search surface.
 */

import { PlaneIcon } from 'lucide-react';

export interface AirportListCardProps {
  data: {
    airports?: Array<{
      iataCode: string;
      name: string;
      cityName?: string;
      countryCode?: string;
      distanceKm?: number;
      googleMapsUrl?: string;
    }>;
    cities?: Array<{ id: string; name: string; iataCityCode?: string }>;
  };
}

export function AirportListCard({ data }: AirportListCardProps) {
  const airports = data.airports ?? [];
  if (airports.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-[color:var(--border)] bg-[color:var(--panel)] px-4 py-3 text-xs text-[color:var(--text-dim)]">
        No airports matched. Widen the radius or try a different query.
      </div>
    );
  }
  return (
    <div className="grid gap-2 rounded-2xl border border-[color:var(--border)] bg-[color:var(--panel)] px-3 py-2.5">
      <div className="flex items-center justify-between px-1">
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-[color:var(--text-faint)]">
          Nearby airports
        </span>
        <span className="font-mono text-[10px] text-[color:var(--text-dim)]">
          {airports.length} found
        </span>
      </div>
      <ul className="grid gap-1">
        {airports.map(a => (
          <li key={a.iataCode + a.name}>
            <a
              href={a.googleMapsUrl ?? '#'}
              target="_blank"
              rel="noreferrer"
              className="group flex items-center gap-3 rounded-lg border border-transparent px-2 py-1.5 transition-colors duration-150 ease-out hover:border-[color:var(--border)]"
            >
              <span className="grid size-7 place-items-center rounded-md bg-[color:var(--bg-soft)] text-[color:var(--ink)]">
                <PlaneIcon className="size-3.5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="font-mono text-[11px] font-semibold text-[color:var(--ink)]">
                    {a.iataCode || '—'}
                  </span>
                  <span className="truncate text-sm text-[color:var(--ink)]">{a.name}</span>
                </span>
                {a.cityName ? (
                  <span className="text-xs text-[color:var(--text-dim)]">
                    {a.cityName}
                    {a.countryCode ? ` · ${a.countryCode}` : ''}
                  </span>
                ) : null}
              </span>
              {typeof a.distanceKm === 'number' ? (
                <span className="font-mono text-[10px] text-[color:var(--text-dim)]">
                  {a.distanceKm}km
                </span>
              ) : null}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
