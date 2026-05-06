/**
 * @sendero/google-places/client — env helpers + enable check.
 *
 * Places API (New) shares the same GCP project + key as Custom Search.
 * `GOOGLE_PLACES_API_KEY` is preferred (some teams isolate Places quota
 * for billing observability); falls back to `GOOGLE_API_KEY`.
 */

export function isPlacesEnabled(): boolean {
  const explicit = process.env.GOOGLE_PLACES_ENABLED;
  if (explicit === 'false') return false;
  if (explicit === 'true') return true;
  return !!getPlacesApiKey();
}

export function getPlacesApiKey(): string | undefined {
  return process.env.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_API_KEY || undefined;
}
