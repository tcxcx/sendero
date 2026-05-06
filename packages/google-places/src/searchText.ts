/**
 * @sendero/google-places/searchText — generic Places (New) text-search wrapper.
 *
 * Generic primitive HP1/HP2 anticipation tools compose with `cseSearch`
 * from `@sendero/web-search`. CSE finds editorial sources + names;
 * Places gives us canonical metadata + coords + ratings + opening
 * hours for the names we already know about.
 *
 * **Cost shape.** Places (New) bills per-field-mask. The shared
 * `DEFAULT_FIELD_MASK` here mirrors what `recommend_restaurants` asks
 * for — adding a field to this list raises the per-call cost for
 * every downstream tool, so think before extending.
 *
 * **Returns `{ available: false, reason }` on every error path.**
 * Never throws. Callers treat `available === false` as cold-path.
 */

import { placesFetch } from './_fetch';
import { getPlacesApiKey, isPlacesEnabled } from './client';
import type { PlacesPlace, SearchTextArgs, SearchTextResult } from './types';

const ENDPOINT = 'https://places.googleapis.com/v1/places:searchText';

/**
 * Field mask shared across all Sendero searchText calls. Every entry
 * costs against Places billing — keep tight.
 *
 * NOTE: `editorialSummary` is on the SKU's "Atmosphere" tier (~3× cost)
 * but useful for ranking. We include it because the LLM-as-ranker
 * step downstream needs the snippet to disambiguate "is this the
 * specialty coffee place we want, or a generic chain?".
 */
const DEFAULT_FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.shortFormattedAddress',
  'places.nationalPhoneNumber',
  'places.internationalPhoneNumber',
  'places.websiteUri',
  'places.location',
  'places.businessStatus',
  'places.types',
  'places.primaryType',
  'places.priceLevel',
  'places.rating',
  'places.userRatingCount',
  'places.regularOpeningHours.openNow',
  'places.editorialSummary',
].join(',');

interface RawPlace {
  id?: string;
  displayName?: { text?: string; languageCode?: string };
  formattedAddress?: string;
  shortFormattedAddress?: string;
  nationalPhoneNumber?: string;
  internationalPhoneNumber?: string;
  websiteUri?: string;
  location?: { latitude?: number; longitude?: number };
  businessStatus?: string;
  types?: string[];
  primaryType?: string;
  priceLevel?: string;
  rating?: number;
  userRatingCount?: number;
  regularOpeningHours?: { openNow?: boolean };
  editorialSummary?: { text?: string };
}

export async function searchText(args: SearchTextArgs): Promise<SearchTextResult> {
  if (!isPlacesEnabled()) {
    return { available: false, reason: 'places-not-configured', results: [] };
  }

  const apiKey = getPlacesApiKey()!;
  const limit = Math.min(Math.max(args.limit ?? 10, 1), 20);

  const body: Record<string, unknown> = {
    textQuery: args.query,
    maxResultCount: limit,
    languageCode: args.languageCode ?? 'en',
  };
  if (args.regionCode) body.regionCode = args.regionCode;
  if (args.locationBias) body.locationBias = args.locationBias;

  try {
    const res = await placesFetch(ENDPOINT, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'x-goog-api-key': apiKey,
        'x-goog-fieldmask': DEFAULT_FIELD_MASK,
      },
      body: JSON.stringify(body),
      timeoutMs: args.timeoutMs ?? 6000,
    });

    if (!res.ok) {
      return { available: false, reason: `places-http-${res.status}`, results: [] };
    }

    const data = (await res.json()) as {
      places?: RawPlace[];
      error?: { code?: number; message?: string };
    } | null;

    if (data?.error) {
      return {
        available: false,
        reason: `places-api-error-${data.error.code ?? 'unknown'}`,
        results: [],
      };
    }

    const items = Array.isArray(data?.places) ? data.places : [];
    const results: PlacesPlace[] = items.map(mapPlace).filter((p): p is PlacesPlace => p !== null);

    return { available: true, results };
  } catch (err) {
    return {
      available: false,
      reason: err instanceof Error ? `places-process-${err.name}` : 'places-process-error',
      results: [],
    };
  }
}

function mapPlace(raw: RawPlace): PlacesPlace | null {
  if (!raw.id || !raw.displayName?.text) return null;
  const lat = raw.location?.latitude;
  const lng = raw.location?.longitude;
  return {
    placeId: raw.id,
    name: raw.displayName.text,
    ...(raw.formattedAddress ? { formattedAddress: raw.formattedAddress } : {}),
    ...(raw.shortFormattedAddress ? { shortAddress: raw.shortFormattedAddress } : {}),
    ...(raw.nationalPhoneNumber ? { phone: raw.nationalPhoneNumber } : {}),
    ...(raw.internationalPhoneNumber ? { internationalPhone: raw.internationalPhoneNumber } : {}),
    ...(raw.websiteUri ? { website: raw.websiteUri } : {}),
    ...(typeof lat === 'number' && typeof lng === 'number'
      ? { location: { latitude: lat, longitude: lng } }
      : {}),
    ...(raw.businessStatus ? { businessStatus: raw.businessStatus } : {}),
    types: raw.types ?? [],
    ...(raw.primaryType ? { primaryType: raw.primaryType } : {}),
    ...(raw.priceLevel ? { priceLevel: raw.priceLevel as PlacesPlace['priceLevel'] } : {}),
    ...(typeof raw.rating === 'number' ? { rating: raw.rating } : {}),
    ...(typeof raw.userRatingCount === 'number' ? { userRatingCount: raw.userRatingCount } : {}),
    ...(typeof raw.regularOpeningHours?.openNow === 'boolean'
      ? { openNow: raw.regularOpeningHours.openNow }
      : {}),
    ...(raw.editorialSummary?.text ? { editorialSummary: raw.editorialSummary.text } : {}),
  };
}
