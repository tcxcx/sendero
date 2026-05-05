/**
 * list_stay_rates — fetch the full rate matrix for a Duffel Stays
 * search result. The list-search response (`search_hotels`) only carries
 * `cheapest_rate_*` summaries; rate ids + cancellation timelines + payment
 * methods + tax/fee separation only come back from
 * `searchResults.fetchAllRates`. Without this step the agent has nothing
 * to hand to `quote_stay`.
 *
 * Funnel: search_hotels → list_stay_rates → quote_stay → book_stay.
 *
 * Returns the raw rate list AND a typed `stayRatePicker` payload the
 * channel-render layer extracts to paint the dedicated picker card.
 *
 * https://duffel.com/docs/api/v2/stays-search-results/get-stays-search-result-rates
 */

import { z } from 'zod';

import { listStayRates } from '@sendero/duffel';
import type { StayRatesResult } from '@sendero/duffel';

import { senderoBusinessDetails, type SenderoBusinessDetails } from './lib/sendero-business';
import type { ToolDef } from './types';

const inputSchema = z.object({
  searchResultId: z
    .string()
    .min(3)
    .describe(
      "The `id` of a hotel returned by `search_hotels` (Duffel Stays search-result id, e.g. 'ssr_…')."
    ),
  /** Search context — required for the picker card pre-booking display
   *  (Duffel Go-Live mandates rooms + guests + nights visible). */
  checkInDate: z.string().describe('YYYY-MM-DD').optional(),
  checkOutDate: z.string().describe('YYYY-MM-DD').optional(),
  rooms: z.number().int().min(1).max(9).default(1).optional(),
  guests: z.number().int().min(1).max(9).default(1).optional(),
});

export type ListStayRatesInput = z.infer<typeof inputSchema>;

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
  cancellationTimeline: Array<{ before: string; refundAmount: string; currency: string }>;
}

export interface StayRatePickerPayload {
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
  /** Echoed from the search context so the picker can surface nights. */
  checkInDate: string | null;
  checkOutDate: string | null;
  rooms: number;
  guests: number;
  rates: StayRatePickerRate[];
  business: SenderoBusinessDetails;
}

export interface ListStayRatesResult extends StayRatesResult {
  /** Typed payload the channel-render extractor matches on. */
  stayRatePicker: StayRatePickerPayload;
}

function buildPickerPayload(
  raw: StayRatesResult,
  ctx: { checkInDate?: string; checkOutDate?: string; rooms?: number; guests?: number },
  business: SenderoBusinessDetails
): StayRatePickerPayload {
  return {
    searchResultId: raw.searchResultId,
    accommodation: {
      name: raw.hotelName,
      country: raw.country,
      city: raw.city,
      address: null, // Duffel doesn't echo full address on search-result rates; address surfaces post-quote.
      checkInAfter: raw.checkInAfter,
      checkOutBefore: raw.checkOutBefore,
      keyCollection: raw.keyCollection,
    },
    checkInDate: ctx.checkInDate ?? null,
    checkOutDate: ctx.checkOutDate ?? null,
    rooms: ctx.rooms ?? 1,
    guests: ctx.guests ?? 1,
    rates: raw.rates.map(r => ({
      rateId: r.rateId,
      roomName: r.roomName,
      paymentType: r.paymentType,
      availablePaymentMethods: r.availablePaymentMethods,
      refundable: r.refundable,
      boardType: r.boardType,
      billing: {
        baseAmount: r.baseAmount,
        baseCurrency: r.baseCurrency,
        taxAmount: r.taxAmount,
        taxCurrency: r.taxCurrency,
        feeAmount: r.feeAmount,
        feeCurrency: r.feeCurrency,
        totalAmount: r.totalAmount,
        totalCurrency: r.totalCurrency,
        dueAtAccommodationAmount: r.dueAtAccommodationAmount,
        dueAtAccommodationCurrency: r.dueAtAccommodationCurrency,
      },
      cancellationTimeline: (r.cancellationTimeline ?? []).map(t => ({
        before: t.before,
        refundAmount: t.refund_amount,
        currency: t.currency,
      })),
    })),
    business,
  };
}

export const listStayRatesTool: ToolDef<ListStayRatesInput, ListStayRatesResult> = {
  name: 'list_stay_rates',
  description:
    "Fetch the full room × rate matrix for a hotel previously returned by `search_hotels`. Returns each rate's id, room name, full billing breakdown (tax + fee separated), payment type, available payment methods, refundability, and cancellation timeline. Hand the chosen `rateId` to `quote_stay`. Required between search and quote — `search_hotels` does not return rate ids. Pass through the search context (checkInDate/checkOutDate/rooms/guests) so the picker card can display nights + occupancy.",
  inputSchema,
  jsonSchema: {
    type: 'object',
    required: ['searchResultId'],
    properties: {
      searchResultId: {
        type: 'string',
        description: 'Duffel Stays search-result id from `search_hotels` (`id` field).',
      },
      checkInDate: { type: 'string', description: 'YYYY-MM-DD' },
      checkOutDate: { type: 'string', description: 'YYYY-MM-DD' },
      rooms: { type: 'integer', minimum: 1, maximum: 9 },
      guests: { type: 'integer', minimum: 1, maximum: 9 },
    },
  },
  async handler(input) {
    const raw = await listStayRates(input.searchResultId);
    return {
      ...raw,
      stayRatePicker: buildPickerPayload(raw, input, senderoBusinessDetails()),
    };
  },
};
