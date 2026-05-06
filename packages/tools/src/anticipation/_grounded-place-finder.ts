/**
 * Internal helper — generic CSE + Places cross-reference scaffold.
 *
 * Used by `cheap_michelin_finder`, `ramen_finder`, and similar HP1
 * specialty finders. Same shape as `specialty_coffee_finder` but with
 * pluggable source weights, query composition, and Places-type filter.
 *
 * NOT a public tool. Consumers wrap this with their own ToolDef.
 */

import { searchText, type PlacesPlace } from '@sendero/google-places';
import { cseSearch, type CseSearchHit } from '@sendero/web-search';

export interface GroundedFinderConfig {
  /** Compose the CSE query for a given (city, lang). */
  composeCseQuery(city: string, lang: 'en' | 'es' | 'pt' | string, countryCode?: string): string;
  /** Compose the Places searchText query. */
  composePlacesQuery(city: string, lang: 'en' | 'es' | 'pt' | string): string;
  /** Source-weight table keyed by host. */
  sourceWeights: Record<string, number>;
  /** Default weight for any host not in `sourceWeights`. */
  defaultSourceWeight: number;
  /** Returns true when the Place fits this finder's category. */
  isRelevantPlaceType(place: PlacesPlace): boolean;
  /** Optional must-mention check — only places matching this pattern in CSE snippet count as cross-referenced. */
  cseSnippetMustMatch?: RegExp;
}

export interface GroundedShopHit {
  placeId: string;
  name: string;
  formattedAddress?: string;
  shortAddress?: string;
  website?: string;
  phone?: string;
  rating?: number;
  userRatingCount?: number;
  priceLevel?: PlacesPlace['priceLevel'];
  location?: { latitude: number; longitude: number };
  openNow?: boolean;
  editorialSummary?: string;
  /** 0-1 score. */
  qualityScore: number;
  rationale: string;
  editorialSources: Array<{ title: string; url: string; snippet: string }>;
}

export interface GroundedFinderInput {
  city: string;
  countryCode?: string;
  languageCode?: string;
  limit: number;
  locationBias?: { latitude?: number; longitude?: number; radiusMeters?: number };
}

export interface GroundedFinderDeps {
  cse: typeof cseSearch;
  places: typeof searchText;
}

export const liveFinderDeps: GroundedFinderDeps = {
  cse: cseSearch,
  places: searchText,
};

export type GroundedFinderResult =
  | {
      status: 'ok';
      city: string;
      shops: GroundedShopHit[];
      sourcesQueried: { cseAvailable: boolean; placesAvailable: boolean };
      message: string;
    }
  | { status: 'unavailable'; reason: string; message: string };

function weightForSource(
  displayLink: string,
  weights: Record<string, number>,
  fallback: number
): number {
  const host = displayLink.toLowerCase().replace(/^www\./, '');
  for (const [domain, w] of Object.entries(weights)) {
    if (host === domain || host.endsWith(`.${domain}`)) return w;
  }
  return fallback;
}

function placeMatchesEditorial(placeName: string, hit: CseSearchHit): boolean {
  const norm = (s: string) =>
    s
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  const target = norm(placeName);
  if (target.length < 4) return false;
  const haystack = `${norm(hit.title)} ${norm(hit.snippet)}`;
  return haystack.includes(target);
}

export async function runGroundedFinder(
  cfg: GroundedFinderConfig,
  input: GroundedFinderInput,
  deps: GroundedFinderDeps = liveFinderDeps
): Promise<GroundedFinderResult> {
  const lang = input.languageCode ?? 'en';

  const cseRes = await deps.cse({
    query: cfg.composeCseQuery(input.city, lang, input.countryCode),
    limit: 10,
    lang,
    ...(input.countryCode ? { country: input.countryCode } : {}),
  });

  const lb = input.locationBias;
  const lbReady =
    lb && typeof lb.latitude === 'number' && typeof lb.longitude === 'number'
      ? {
          locationBias: {
            circle: {
              center: { latitude: lb.latitude, longitude: lb.longitude },
              radius: lb.radiusMeters ?? 2500,
            },
          },
        }
      : {};
  const placesRes = await deps.places({
    query: cfg.composePlacesQuery(input.city, lang),
    limit: 14,
    languageCode: lang,
    ...(input.countryCode ? { regionCode: input.countryCode } : {}),
    ...lbReady,
  });

  if (!cseRes.available && !placesRes.available) {
    return {
      status: 'unavailable',
      reason: `cse:${cseRes.reason ?? 'unknown'} places:${placesRes.reason ?? 'unknown'}`,
      message: `Couldn't query Custom Search or Places for ${input.city}.`,
    };
  }

  const cseHits = (cseRes.available ? cseRes.results : []).filter(h =>
    cfg.cseSnippetMustMatch ? cfg.cseSnippetMustMatch.test(`${h.title} ${h.snippet}`) : true
  );
  const placeHits = placesRes.available ? placesRes.results : [];

  const ranked: GroundedShopHit[] = placeHits
    .filter(p => cfg.isRelevantPlaceType(p))
    .map(place => {
      const editorialMatches = cseHits.filter(h => placeMatchesEditorial(place.name, h));
      const reasons: string[] = [];

      let editorial = 0;
      if (editorialMatches.length > 0) {
        const weights = editorialMatches.map(h =>
          weightForSource(h.displayLink, cfg.sourceWeights, cfg.defaultSourceWeight)
        );
        editorial = Math.max(...weights);
        const top = editorialMatches[0]?.displayLink ?? 'editorial source';
        reasons.push(`featured by ${top}`);
      }

      let quality = 0;
      if (typeof place.rating === 'number' && typeof place.userRatingCount === 'number') {
        quality = Math.max(
          0,
          Math.min(1, (place.rating * Math.log10(place.userRatingCount + 1)) / 15)
        );
        if (place.rating >= 4.5 && place.userRatingCount >= 200) {
          reasons.push(`${place.rating.toFixed(1)}★ over ${place.userRatingCount} reviews`);
        }
      }

      const summaryBoost = place.editorialSummary ? 0.1 : 0;
      if (place.editorialSummary) reasons.push('editorial summary on Places');

      const score = Math.max(0, Math.min(1, editorial * 0.55 + quality * 0.35 + summaryBoost));

      return {
        placeId: place.placeId,
        name: place.name,
        ...(place.formattedAddress ? { formattedAddress: place.formattedAddress } : {}),
        ...(place.shortAddress ? { shortAddress: place.shortAddress } : {}),
        ...(place.website ? { website: place.website } : {}),
        ...(place.phone ? { phone: place.phone } : {}),
        ...(typeof place.rating === 'number' ? { rating: place.rating } : {}),
        ...(typeof place.userRatingCount === 'number'
          ? { userRatingCount: place.userRatingCount }
          : {}),
        ...(place.priceLevel ? { priceLevel: place.priceLevel } : {}),
        ...(place.location ? { location: place.location } : {}),
        ...(typeof place.openNow === 'boolean' ? { openNow: place.openNow } : {}),
        ...(place.editorialSummary ? { editorialSummary: place.editorialSummary } : {}),
        qualityScore: score,
        rationale: reasons.length > 0 ? reasons.join(' · ') : 'quality signal weighted by reviews',
        editorialSources: editorialMatches.slice(0, 3).map(h => ({
          title: h.title,
          url: h.link,
          snippet: h.snippet,
        })),
      } satisfies GroundedShopHit;
    })
    .sort((a, b) => b.qualityScore - a.qualityScore)
    .slice(0, input.limit);

  return {
    status: 'ok',
    city: input.city,
    shops: ranked,
    sourcesQueried: { cseAvailable: cseRes.available, placesAvailable: placesRes.available },
    message:
      ranked.length === 0
        ? `No matches surfaced for ${input.city}.`
        : `${ranked.length} matches in ${input.city}.`,
  };
}
