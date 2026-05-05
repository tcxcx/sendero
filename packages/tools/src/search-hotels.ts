/**
 * search_hotels — Duffel Stays search by location/dates/guests.
 *
 * Returns the canonical `hotels` list for the agent to reason over PLUS
 * a structured `staySearchResults` payload the channel-render layer
 * extracts to paint the typed hotel-results card (operator preview, web
 * traveler bubble, Slack interactive list, WhatsApp interactive list).
 *
 * `search_hotels` does NOT return rate ids — the agent must call
 * `list_stay_rates({ searchResultId })` after the traveler taps a hotel
 * to get the per-rate cancellation timeline + payment methods + the
 * `rateId` it hands to `quote_stay`. Skipping that step will fail.
 */

import { z } from 'zod';
import { searchHotels } from '@sendero/duffel';
import type { HotelOfferSummary } from '@sendero/duffel';

import { resolveStayLocation, LocationNotResolvedError } from './lib/resolve-stay-location';
import { senderoBusinessDetails, type SenderoBusinessDetails } from './lib/sendero-business';
import type { ToolDef } from './types';

const inputSchema = z.object({
  location: z.string().describe('City, neighborhood, or airport code. Free-form text works.'),
  checkInDate: z.string().describe('YYYY-MM-DD'),
  checkOutDate: z.string().describe('YYYY-MM-DD'),
  guests: z.number().int().min(1).max(9).default(1),
  rooms: z.number().int().min(1).max(9).default(1),
});

export type SearchHotelsInput = z.infer<typeof inputSchema>;

export interface StaySearchResultsHotelView {
  searchResultId: string;
  name: string;
  country: string | null;
  city: string | null;
  stars: number | null;
  reviewScore: number | null;
  photos: string[];
  cheapestPrice: string;
  cheapestCurrency: string;
  cancellation: HotelOfferSummary['cancellation'];
  distanceMeters: number | null;
  amenities: string[];
}

export interface StaySearchResultsPayload {
  checkInDate: string;
  checkOutDate: string;
  rooms: number;
  guests: number;
  hotels: StaySearchResultsHotelView[];
  business: SenderoBusinessDetails;
}

export interface SearchHotelsResult {
  hotels: HotelOfferSummary[];
  /** Duffel-mandated structured payload — operator + channel renderers extract. */
  staySearchResults: StaySearchResultsPayload;
  share: {
    title: string;
    body: string;
    bullets: string[];
  };
}

export const searchHotelsTool: ToolDef<SearchHotelsInput, SearchHotelsResult> = {
  name: 'search_hotels',
  description:
    "Search hotels in a city for given dates. Returns up to 6 accommodations with real photos, star rating, review score, cheapest rate, and cancellation badge. Hand the chosen hotel's `id` to `list_stay_rates` to get rate ids for `quote_stay`. Use when the user asks for lodging.",
  inputSchema,
  jsonSchema: {
    type: 'object',
    required: ['location', 'checkInDate', 'checkOutDate'],
    properties: {
      location: {
        type: 'string',
        description: 'City, neighborhood, or airport code. Free-form text works.',
      },
      checkInDate: { type: 'string', description: 'YYYY-MM-DD' },
      checkOutDate: { type: 'string', description: 'YYYY-MM-DD' },
      guests: { type: 'integer', default: 1, minimum: 1, maximum: 9 },
      rooms: { type: 'integer', default: 1, minimum: 1, maximum: 9 },
    },
  },
  async handler(input) {
    const hotels = (
      await searchHotels({
        location: input.location,
        checkInDate: input.checkInDate,
        checkOutDate: input.checkOutDate,
        guests: input.guests ?? 1,
        rooms: input.rooms ?? 1,
      })
    ).slice(0, 6);
    const business = senderoBusinessDetails();
    const view: StaySearchResultsHotelView[] = hotels.map(h => ({
      searchResultId: h.id,
      name: h.name,
      country: h.country,
      city: h.city,
      stars: h.stars,
      reviewScore: h.reviewScore,
      photos: h.photos,
      cheapestPrice: h.price,
      cheapestCurrency: h.currency,
      cancellation: h.cancellation,
      distanceMeters: h.distanceMeters,
      amenities: h.amenities,
    }));

    const summaryHotel = view[0];
    const summaryLine = summaryHotel
      ? `${summaryHotel.name} from ${summaryHotel.cheapestPrice} ${summaryHotel.cheapestCurrency}`
      : 'No hotels found.';

    return {
      hotels,
      staySearchResults: {
        checkInDate: input.checkInDate,
        checkOutDate: input.checkOutDate,
        rooms: input.rooms ?? 1,
        guests: input.guests ?? 1,
        hotels: view,
        business,
      },
      share: {
        title: `🏨 ${view.length} hotel${view.length === 1 ? '' : 's'} · ${input.checkInDate} → ${input.checkOutDate}`,
        body: summaryLine,
        bullets: view.slice(0, 5).map(h => {
          const stars = h.stars ? `${'★'.repeat(h.stars)} · ` : '';
          const review = h.reviewScore ? `${h.reviewScore.toFixed(1)}/10 · ` : '';
          return `${h.name} — ${stars}${review}${h.cheapestPrice} ${h.cheapestCurrency} · ${h.cancellation}`;
        }),
      },
    };
  },
};
