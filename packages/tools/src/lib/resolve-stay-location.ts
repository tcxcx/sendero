/**
 * Resolve a free-form hotel-search location string into Duffel-ready
 * coordinates.
 *
 * The Duffel Stays API takes `geographic_coordinates: { latitude, longitude }`
 * and a radius — it doesn't accept city names. Sendero's prior wrapper
 * carried a hand-maintained `CITY_COORDS` map with a silent London
 * fallback, which mis-located any unknown city (Lima, Cusco, San José,
 * Bogotá, every LatAm dogfood city, etc.) and returned wrong-city
 * inventory without telling the agent.
 *
 * This helper replaces that path: it routes free-form input through the
 * Google Geocoding API via `geocode_trip_stop`, falling through cleanly
 * to:
 *   1. raw `lat,lng` strings (skip the geocoder, no API key needed)
 *   2. Google Geocoding (handles any city, neighborhood, hotel name,
 *      airport code; honors the optional CLDR region hint to bias
 *      candidates correctly)
 *
 * On geocoding failure the caller gets a typed `LocationNotResolvedError`
 * with the original input — surface that to the agent so the user
 * re-asks instead of getting wrong-city results.
 */

import { geocodeTripStop } from '../geocode-trip-stop';

export interface ResolvedStayLocation {
  latitude: number;
  longitude: number;
  /** Echoed back when the geocoder gave us a canonical address.
   *  Use this in the share card so the user sees what was actually
   *  searched. Null when the input was already raw `lat,lng`. */
  formattedAddress: string | null;
  source: 'coords' | 'geocoded';
}

export class LocationNotResolvedError extends Error {
  readonly code = 'location_not_resolved';
  readonly input: string;
  constructor(input: string, cause?: unknown) {
    super(
      `Could not resolve location "${input}" to coordinates. Pass a city, neighborhood, hotel name, airport code, or raw "lat,lng" string.`
    );
    this.input = input;
    if (cause) (this as { cause?: unknown }).cause = cause;
  }
}

const COORDS_RE = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/;

export async function resolveStayLocation(
  location: string,
  options: { regionCode?: string } = {}
): Promise<ResolvedStayLocation> {
  if (!location || typeof location !== 'string') {
    throw new LocationNotResolvedError(String(location));
  }

  // Fast path: already lat,lng. Skip the geocoder + the API key requirement.
  const m = location.match(COORDS_RE);
  if (m) {
    const lat = Number(m[1]);
    const lng = Number(m[2]);
    if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
      return { latitude: lat, longitude: lng, formattedAddress: null, source: 'coords' };
    }
  }

  try {
    const geo = await geocodeTripStop({
      address: location,
      languageCode: 'en',
      ...(options.regionCode ? { regionCode: options.regionCode } : {}),
    });
    return {
      latitude: geo.latitude,
      longitude: geo.longitude,
      formattedAddress: geo.formattedAddress,
      source: 'geocoded',
    };
  } catch (err) {
    throw new LocationNotResolvedError(location, err);
  }
}
