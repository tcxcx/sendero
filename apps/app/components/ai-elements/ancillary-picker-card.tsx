'use client';

/**
 * AncillaryPickerCard — renders the output of `list_flight_ancillaries`
 * as a channel-safe picker: bags, cancel-for-any-reason, and a
 * compact list of seat options. Each row has a click target that
 * emits a selection callback; the parent composer writes the selection
 * into the workflow pause resolution so `book_flight` attaches them.
 *
 * Works as a standalone AI Elements artifact inside the chat transcript.
 * For WhatsApp/Slack the same data renders via the tool's `share.bullets`
 * field, which the channel adapter serializes to plain text.
 */

import { useMemo, useState } from 'react';

import { ArmchairIcon, BriefcaseIcon, ShieldCheckIcon } from 'lucide-react';

type BagOption = {
  serviceId: string;
  label: string;
  kind: 'carry_on' | 'checked' | 'other';
  price: string;
  currency: string;
  weightKg?: number | null;
  dimensions?: string;
  passengerIds: string[];
};

type CfarOption = {
  serviceId: string;
  price: string;
  currency: string;
  refundAmount?: string;
  summary: string;
  termsUrl?: string;
};

type SeatOption = {
  serviceId: string;
  designator: string;
  cabinClass?: string;
  price: string;
  currency: string;
  passengerId: string;
  disclosures: string[];
};

export interface AncillaryPickerResult {
  offerId?: string;
  currency?: string;
  bags?: BagOption[];
  cancelForAnyReason?: CfarOption[];
  seats?: SeatOption[];
  share?: { title?: string; body?: string; bullets?: string[] };
}

export interface AncillarySelection {
  bags: Record<string, number>; // serviceId → quantity
  cfar: Set<string>;
  seats: Set<string>;
}

const cardShell =
  'rounded-2xl border border-[color:var(--border)] bg-[color:var(--panel)] transition-[background-color,border-color] duration-150 ease-out';

function priceLine(p: { price: string; currency: string }) {
  return `${p.price} ${p.currency}`;
}

export function AncillaryPickerCard({
  data,
  onSelectionChange,
}: {
  data: AncillaryPickerResult;
  onSelectionChange?: (selection: AncillarySelection) => void;
}) {
  const [bagQty, setBagQty] = useState<Record<string, number>>({});
  const [cfar, setCfar] = useState<Set<string>>(new Set());
  const [seats, setSeats] = useState<Set<string>>(new Set());

  const bags = data.bags ?? [];
  const cfarOptions = data.cancelForAnyReason ?? [];
  const seatOptions = data.seats ?? [];

  const total = useMemo(() => {
    let sum = 0;
    let currency = data.currency ?? 'USD';
    for (const b of bags) {
      const q = bagQty[b.serviceId] ?? 0;
      sum += q * Number(b.price);
      currency = b.currency || currency;
    }
    for (const c of cfarOptions) {
      if (cfar.has(c.serviceId)) {
        sum += Number(c.price);
        currency = c.currency || currency;
      }
    }
    for (const s of seatOptions) {
      if (seats.has(s.serviceId)) {
        sum += Number(s.price);
        currency = s.currency || currency;
      }
    }
    return { sum, currency };
  }, [bags, cfarOptions, seatOptions, bagQty, cfar, seats, data.currency]);

  function emit(next: { bags?: typeof bagQty; cfar?: Set<string>; seats?: Set<string> }) {
    onSelectionChange?.({
      bags: next.bags ?? bagQty,
      cfar: next.cfar ?? cfar,
      seats: next.seats ?? seats,
    });
  }

  return (
    <div className={`${cardShell} overflow-hidden`}>
      <div className="flex items-center justify-between border-b border-border px-4 py-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          Ancillary options
        </span>
        <span className="font-mono text-[11px] text-[color:var(--ink)]">
          + {total.sum.toFixed(2)} {total.currency}
        </span>
      </div>
      {bags.length > 0 ? (
        <section className="border-b border-border">
          <SectionHeader icon={<BriefcaseIcon className="size-3.5" />} label="Bags" />
          <div className="grid gap-1 px-3 py-2">
            {bags.map(b => {
              const q = bagQty[b.serviceId] ?? 0;
              return (
                <div
                  key={b.serviceId}
                  className="flex items-center gap-2 rounded-lg border border-transparent px-2 py-1.5 hover:border-border"
                >
                  <span className="flex-1 text-sm text-[color:var(--ink)]">{b.label}</span>
                  <span className="font-mono text-[11px] text-[color:var(--text-dim)]">
                    {b.weightKg ? `${b.weightKg}kg` : ''}
                  </span>
                  <span className="font-mono text-[11px] text-[color:var(--text-dim)]">
                    {priceLine(b)}
                  </span>
                  <Stepper
                    value={q}
                    max={4}
                    onChange={next => {
                      const copy = { ...bagQty, [b.serviceId]: next };
                      setBagQty(copy);
                      emit({ bags: copy });
                    }}
                  />
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      {cfarOptions.length > 0 ? (
        <section className="border-b border-border">
          <SectionHeader
            icon={<ShieldCheckIcon className="size-3.5" />}
            label="Cancel for any reason"
          />
          <div className="grid gap-1 px-3 py-2">
            {cfarOptions.map(c => {
              const picked = cfar.has(c.serviceId);
              return (
                <button
                  key={c.serviceId}
                  type="button"
                  aria-pressed={picked}
                  onClick={() => {
                    const next = new Set(cfar);
                    if (picked) next.delete(c.serviceId);
                    else next.add(c.serviceId);
                    setCfar(next);
                    emit({ cfar: next });
                  }}
                  className={
                    'flex items-center gap-2 rounded-lg border px-2 py-1.5 text-left transition-colors duration-150 ease-out ' +
                    (picked
                      ? 'border-[color:var(--ink)] bg-[color:var(--bg-soft)]'
                      : 'border-transparent hover:border-border')
                  }
                >
                  <span className="flex-1 text-sm text-[color:var(--ink)]">{c.summary}</span>
                  <span className="font-mono text-[11px] text-[color:var(--text-dim)]">
                    {priceLine(c)}
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      ) : null}

      {seatOptions.length > 0 ? (
        <section>
          <SectionHeader
            icon={<ArmchairIcon className="size-3.5" />}
            label={`Seats · ${seatOptions.length}`}
          />
          <div className="grid grid-cols-2 gap-1 px-3 py-2 md:grid-cols-3">
            {seatOptions.slice(0, 12).map(s => {
              const picked = seats.has(s.serviceId);
              return (
                <button
                  key={s.serviceId}
                  type="button"
                  aria-pressed={picked}
                  onClick={() => {
                    const next = new Set(seats);
                    if (picked) next.delete(s.serviceId);
                    else next.add(s.serviceId);
                    setSeats(next);
                    emit({ seats: next });
                  }}
                  className={
                    'flex items-center justify-between gap-2 rounded-md border px-2 py-1 text-left transition-colors duration-150 ease-out ' +
                    (picked
                      ? 'border-[color:var(--ink)] bg-[color:var(--bg-soft)]'
                      : 'border-border hover:border-[color:var(--ink)]')
                  }
                  title={s.disclosures.join(' · ')}
                >
                  <span className="font-mono text-[11px] text-[color:var(--ink)]">
                    {s.designator}
                  </span>
                  <span className="font-mono text-[10px] text-[color:var(--text-dim)]">
                    {priceLine(s)}
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function SectionHeader({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-2 border-b border-dashed border-border px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
      {icon}
      {label}
    </div>
  );
}

function Stepper({
  value,
  max,
  onChange,
}: {
  value: number;
  max: number;
  onChange: (next: number) => void;
}) {
  return (
    <div className="inline-flex items-center gap-0 rounded-md border border-border">
      <button
        type="button"
        onClick={() => onChange(Math.max(0, value - 1))}
        disabled={value === 0}
        className="px-2 text-[12px] text-[color:var(--ink)] disabled:opacity-40"
      >
        −
      </button>
      <span className="w-5 text-center font-mono text-[11px] text-[color:var(--ink)]">{value}</span>
      <button
        type="button"
        onClick={() => onChange(Math.min(max, value + 1))}
        disabled={value === max}
        className="px-2 text-[12px] text-[color:var(--ink)] disabled:opacity-40"
      >
        +
      </button>
    </div>
  );
}
