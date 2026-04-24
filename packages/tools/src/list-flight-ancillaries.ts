/**
 * list_flight_ancillaries — surface the ancillary services the airline
 * attached to a Duffel offer: checked/carry-on bags, cancel-for-any-
 * reason, and seat options from the seat map.
 *
 * Returns a canonical shape ready to render in AI Elements artifacts,
 * render as WhatsApp/Slack bullets, or feed back into `book_flight`'s
 * `services: [{ id, quantity }]` attachment.
 */

import { z } from 'zod';

import {
  getOfferWithAncillaries,
  type DuffelAvailableService,
  type DuffelSeatOption,
} from '@sendero/duffel';

import type { ToolDef } from './types';

const inputSchema = z.object({
  offerId: z.string().min(1),
  /** Upper bound for seat options to include (keeps payloads bounded). */
  maxSeats: z.number().int().min(1).max(48).default(24),
});

export type ListFlightAncillariesInput = z.infer<typeof inputSchema>;

export interface AncillaryBagOption {
  serviceId: string;
  label: string;
  kind: 'carry_on' | 'checked' | 'other';
  price: string;
  currency: string;
  weightKg?: number | null;
  dimensions?: string;
  passengerIds: string[];
}

export interface AncillaryCfarOption {
  serviceId: string;
  price: string;
  currency: string;
  refundAmount?: string;
  summary: string;
  termsUrl?: string;
}

export interface AncillarySeatOption {
  serviceId: string;
  designator: string;
  cabinClass?: string;
  price: string;
  currency: string;
  passengerId: string;
  disclosures: string[];
}

export interface ListFlightAncillariesResult {
  offerId: string;
  currency: string;
  bags: AncillaryBagOption[];
  cancelForAnyReason: AncillaryCfarOption[];
  seats: AncillarySeatOption[];
  share: {
    title: string;
    body: string;
    bullets: string[];
  };
}

function mapBag(svc: Extract<DuffelAvailableService, { type: 'baggage' }>): AncillaryBagOption {
  const kind = svc.metadata.kind ?? 'other';
  const weight = svc.metadata.maxWeightKg ?? null;
  const dims = [svc.metadata.maxHeightCm, svc.metadata.maxLengthCm, svc.metadata.maxDepthCm]
    .filter(v => typeof v === 'number')
    .join('×');
  return {
    serviceId: svc.id,
    kind: kind === 'carry_on' || kind === 'checked' ? kind : 'other',
    label: kind === 'carry_on' ? 'Carry-on bag' : kind === 'checked' ? 'Checked bag' : 'Baggage',
    price: svc.totalAmount,
    currency: svc.totalCurrency,
    weightKg: weight,
    dimensions: dims || undefined,
    passengerIds: svc.passengerIds,
  };
}

function mapCfar(
  svc: Extract<DuffelAvailableService, { type: 'cancel_for_any_reason' }>
): AncillaryCfarOption {
  return {
    serviceId: svc.id,
    price: svc.totalAmount,
    currency: svc.totalCurrency,
    refundAmount: svc.metadata.refundAmount,
    summary:
      svc.metadata.merchantCopy ||
      `Refund${svc.metadata.refundAmount ? ` up to ${svc.metadata.refundAmount} ${svc.totalCurrency}` : ''} for any reason.`,
    termsUrl: svc.metadata.termsAndConditionsUrl,
  };
}

function mapSeat(s: DuffelSeatOption): AncillarySeatOption {
  return {
    serviceId: s.serviceId,
    designator: s.designator,
    cabinClass: s.cabinClass,
    price: s.totalAmount,
    currency: s.totalCurrency,
    passengerId: s.passengerId,
    disclosures: s.disclosures,
  };
}

export async function listFlightAncillaries(
  input: ListFlightAncillariesInput
): Promise<ListFlightAncillariesResult> {
  const ancillaries = await getOfferWithAncillaries(input.offerId);

  const bags = ancillaries.available.filter(s => s.type === 'baggage').map(s => mapBag(s));
  const cfar = ancillaries.available
    .filter(s => s.type === 'cancel_for_any_reason')
    .map(s => mapCfar(s));

  // Seats can be huge; order by price ascending and cap.
  const seatsSorted = [...ancillaries.seats]
    .sort((a, b) => Number(a.totalAmount) - Number(b.totalAmount))
    .slice(0, input.maxSeats)
    .map(mapSeat);

  const bullets: string[] = [];
  if (bags.length) {
    for (const b of bags) {
      bullets.push(
        `${b.label}${b.weightKg ? ` · ${b.weightKg}kg` : ''} · ${b.price} ${b.currency}`
      );
    }
  }
  if (cfar.length) {
    for (const c of cfar) bullets.push(`Cancel-for-any-reason · ${c.price} ${c.currency}`);
  }
  if (seatsSorted.length) {
    const cheapest = seatsSorted[0];
    bullets.push(
      `Seats from ${cheapest.price} ${cheapest.currency} (${seatsSorted.length} available)`
    );
  }
  if (bullets.length === 0) {
    bullets.push('No optional extras from the airline on this fare.');
  }

  return {
    offerId: input.offerId,
    currency: ancillaries.currency,
    bags,
    cancelForAnyReason: cfar,
    seats: seatsSorted,
    share: {
      title: 'Ancillary options on this fare',
      body: bullets.join(' · '),
      bullets,
    },
  };
}

export const listFlightAncillariesTool: ToolDef<
  ListFlightAncillariesInput,
  ListFlightAncillariesResult
> = {
  name: 'list_flight_ancillaries',
  description:
    'Return the bags, cancel-for-any-reason, and seat options available on a flight offer. Use right after search_flights to show the traveler which extras the airline will sell. The canonical service ids can be passed straight into book_flight as `services: [{ id, quantity }]`.',
  inputSchema,
  jsonSchema: {
    type: 'object',
    required: ['offerId'],
    properties: {
      offerId: { type: 'string', description: 'Flight offer id (off_…).' },
      maxSeats: { type: 'integer', default: 24, minimum: 1, maximum: 48 },
    },
  },
  handler: listFlightAncillaries,
};
