/**
 * @sendero/google-places/getPlace — fetch full place details by id.
 *
 * Same field mask as `searchText` to keep the cost-shape consistent.
 * Used by HP1/HP2 tools that started from a CSE editorial hit (which
 * gives URL + name only) and need canonical Places metadata to enrich
 * the result.
 */

import { placesFetch } from './_fetch';
import { getPlacesApiKey, isPlacesEnabled } from './client';
import type { GetPlaceArgs, GetPlaceResult, PlacesPlace } from './types';

const ENDPOINT_BASE = 'https://places.googleapis.com/v1';

const PLACE_FIELD_MASK = [
  'id',
  'displayName',
  'formattedAddress',
  'shortFormattedAddress',
  'nationalPhoneNumber',
  'internationalPhoneNumber',
  'websiteUri',
  'location',
  'businessStatus',
  'types',
  'primaryType',
  'priceLevel',
  'rating',
  'userRatingCount',
  'regularOpeningHours.openNow',
  'editorialSummary',
].join(',');

interface RawPlaceDetail {
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
  error?: { code?: number; message?: string };
}

export async function getPlace(args: GetPlaceArgs): Promise<GetPlaceResult> {
  if (!isPlacesEnabled()) {
    return { available: false, reason: 'places-not-configured' };
  }

  const apiKey = getPlacesApiKey()!;
  // Accept both `places/<id>` and bare `<id>` from callers.
  const idPath = args.placeId.startsWith('places/') ? args.placeId : `places/${args.placeId}`;

  const url = new URL(`${ENDPOINT_BASE}/${idPath}`);
  if (args.languageCode) url.searchParams.set('languageCode', args.languageCode);
  if (args.regionCode) url.searchParams.set('regionCode', args.regionCode);

  try {
    const res = await placesFetch(url.toString(), {
      method: 'GET',
      headers: {
        accept: 'application/json',
        'x-goog-api-key': apiKey,
        'x-goog-fieldmask': PLACE_FIELD_MASK,
      },
      timeoutMs: args.timeoutMs ?? 6000,
    });

    if (!res.ok) {
      return { available: false, reason: `places-http-${res.status}` };
    }

    const data = (await res.json()) as RawPlaceDetail | null;
    if (!data || data.error) {
      return {
        available: false,
        reason: `places-api-error-${data?.error?.code ?? 'unknown'}`,
      };
    }

    const place = toPlace(data);
    if (!place) {
      return { available: false, reason: 'places-malformed-response' };
    }
    return { available: true, place };
  } catch (err) {
    return {
      available: false,
      reason: err instanceof Error ? `places-process-${err.name}` : 'places-process-error',
    };
  }
}

function toPlace(raw: RawPlaceDetail): PlacesPlace | null {
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
