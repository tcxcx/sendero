/**
 * place_details — Tripadvisor location/{id}/details via x402.
 *
 * Full TA record for a single location: amenities, hours, contact,
 * booking URLs, awards, photo + review counts, descriptive text.
 * Pair with `places_search` to take an ID → full picture.
 *
 * One x402 call ($0.01 outbound, tenant charged $0.025).
 */

import { z } from 'zod';

import type { ToolDef, ToolContext } from './types';
import { x402Fetch, X402Error } from './x402-fetch';

export interface PlaceDetailsDeps {
  fetch: typeof x402Fetch;
}

const defaultDeps: PlaceDetailsDeps = { fetch: x402Fetch };

const inputSchema = z.object({
  locationId: z.string().min(1).max(40).describe('Tripadvisor location_id from `places_search`.'),
  language: z.string().min(2).max(10).optional().describe('BCP-47 language tag (e.g. en, es, fr).'),
  currency: z.string().length(3).optional().describe('ISO-4217 currency code (USD, EUR, …).'),
});

export type PlaceDetailsInput = z.infer<typeof inputSchema>;

interface TripAdvisorDetails {
  location_id?: string;
  name?: string;
  description?: string;
  web_url?: string;
  address_obj?: {
    street1?: string;
    city?: string;
    country?: string;
    address_string?: string;
  };
  ranking_data?: { ranking_string?: string };
  rating?: string;
  num_reviews?: string;
  rating_image_url?: string;
  photo_count?: string;
  see_all_photos?: string;
  price_level?: string;
  amenities?: string[];
  features?: string[];
  cuisine?: Array<{ name?: string; localized_name?: string }>;
  category?: { name?: string; localized_name?: string };
  subcategory?: Array<{ name?: string; localized_name?: string }>;
  awards?: Array<{ award_type?: string; year?: string; display_name?: string }>;
  phone?: string;
  email?: string;
  hours?: { week_ranges?: unknown; timezone?: string };
  latitude?: string;
  longitude?: string;
}

export interface PlaceDetailsResult {
  locationId: string;
  name?: string;
  description?: string;
  webUrl?: string;
  address?: string;
  category?: string;
  subcategories: string[];
  rating?: number;
  numReviews?: number;
  priceLevel?: string;
  rankingString?: string;
  amenities: string[];
  features: string[];
  cuisines: string[];
  awards: Array<{ type?: string; year?: string; name?: string }>;
  phone?: string;
  email?: string;
  latitude?: number;
  longitude?: number;
  share: {
    title: string;
    body: string;
    bullets: string[];
    primaryCta?: { label: string; href: string };
  };
  error?: string;
}

function parseFloatSafe(v: string | undefined): number | undefined {
  if (v === undefined) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

export const placeDetailsTool: ToolDef<PlaceDetailsInput, PlaceDetailsResult> = {
  name: 'place_details',
  description:
    'Tripadvisor location/{id}/details — full record for one location: description, address, rating, reviews, amenities, hours, contact, booking URL, awards. Pair with `places_search` (search → ID → details). Production-key only ($0.025 charged, $0.01 outbound).',
  inputSchema,
  jsonSchema: {
    type: 'object',
    required: ['locationId'],
    properties: {
      locationId: { type: 'string', minLength: 1, maxLength: 40 },
      language: { type: 'string', minLength: 2, maxLength: 10 },
      currency: { type: 'string', minLength: 3, maxLength: 3 },
    },
  },
  async handler(input, ctx) {
    return runPlaceDetails(input, ctx ?? {}, defaultDeps);
  },
};

export async function runPlaceDetails(
  input: PlaceDetailsInput,
  ctx: ToolContext,
  deps: PlaceDetailsDeps = defaultDeps
): Promise<PlaceDetailsResult> {
  const parsed = inputSchema.parse(input);
  const id = encodeURIComponent(parsed.locationId);
  const query: Record<string, string | undefined> = {
    language: parsed.language,
    currency: parsed.currency,
  };

  try {
    const { data: d } = await deps.fetch<TripAdvisorDetails>(
      `https://tripadvisor.x402.paysponge.com/api/v1/location/${id}/details`,
      {
        method: 'GET',
        toolName: 'place_details',
        query,
        ctx,
      }
    );

    const rating = parseFloatSafe(d.rating);
    const reviews = d.num_reviews ? Number(d.num_reviews) : undefined;
    const subcategories = (d.subcategory ?? [])
      .map(s => s.localized_name ?? s.name)
      .filter((s): s is string => Boolean(s));
    const cuisines = (d.cuisine ?? [])
      .map(c => c.localized_name ?? c.name)
      .filter((s): s is string => Boolean(s));

    const bullets: string[] = [];
    if (d.ranking_data?.ranking_string) bullets.push(d.ranking_data.ranking_string);
    if (d.price_level) bullets.push(`Price: ${d.price_level}`);
    if (cuisines.length) bullets.push(`Cuisine: ${cuisines.slice(0, 3).join(', ')}`);
    if (d.amenities?.length) bullets.push(`Amenities: ${d.amenities.slice(0, 3).join(', ')}`);
    if (d.phone) bullets.push(`Phone: ${d.phone}`);

    return {
      locationId: parsed.locationId,
      name: d.name,
      description: d.description,
      webUrl: d.web_url,
      address: d.address_obj?.address_string,
      category: d.category?.localized_name ?? d.category?.name,
      subcategories,
      rating,
      numReviews: reviews,
      priceLevel: d.price_level,
      rankingString: d.ranking_data?.ranking_string,
      amenities: d.amenities ?? [],
      features: d.features ?? [],
      cuisines,
      awards: (d.awards ?? []).map(a => ({
        type: a.award_type,
        year: a.year,
        name: a.display_name,
      })),
      phone: d.phone,
      email: d.email,
      latitude: parseFloatSafe(d.latitude),
      longitude: parseFloatSafe(d.longitude),
      share: {
        title: d.name
          ? `${d.name}${typeof rating === 'number' ? ` · ${rating}★` : ''}${
              typeof reviews === 'number' ? ` (${reviews})` : ''
            }`
          : `Location ${parsed.locationId}`,
        body: d.description ?? d.address_obj?.address_string ?? '',
        bullets,
        primaryCta: d.web_url ? { label: 'View on Tripadvisor', href: d.web_url } : undefined,
      },
    };
  } catch (err) {
    if (err instanceof X402Error) {
      return {
        locationId: parsed.locationId,
        subcategories: [],
        amenities: [],
        features: [],
        cuisines: [],
        awards: [],
        share: { title: 'Place details unavailable', body: err.message, bullets: [] },
        error: `[${err.code}] ${err.message}`,
      };
    }
    throw err;
  }
}
