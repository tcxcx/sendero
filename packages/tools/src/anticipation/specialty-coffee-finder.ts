/**
 * specialty_coffee_finder — HP1 Tool 3.
 *
 * Composes editorial discovery (Sprudge, Eater, 50 Best Coffee, Monocle,
 * etc. via the curated CSE) with canonical Places (New) metadata to
 * surface a ranked list of specialty coffee shops in a city. Optional
 * traveler taste-graph awareness — if the traveler has the
 * `work_from_cafes` preference, work-friendliness is folded into the
 * ranking; otherwise we rank purely on specialty signal + quality.
 *
 * Spec: docs/specs/anticipatory-concierge.md §4.0 HP1 + Appendix A.4 #6.
 *
 * **Experimental** (`experimental: true`). Dev-only gate at handler-time.
 *
 * Discovery model:
 *  1. cseSearch — 15 hits across the curated 50-domain CSE allowlist
 *     (Sprudge, Monocle, Eater, Time Out, etc. boosted; whole-web
 *     fallback enabled). Snippets become editorial provenance.
 *  2. searchText (Places New) — canonical place rows for the city.
 *  3. Cross-reference: a place that appears in BOTH editorial AND
 *     Places gets a strong specialty boost. Editorial-only entries get
 *     a weaker editorial-only boost; Places-only entries fall back to
 *     rating × log10(reviews+1) quality scoring.
 *  4. Optional taste-graph composer if travelerId provided.
 *
 * Returns top-N decorated with `editorialSources[]` so the LLM ranker
 * downstream has evidence the place is *specialty*, not just a popular
 * café.
 */

import { z } from 'zod';

import { searchText, type PlacesPlace } from '@sendero/google-places';
import { cseSearch, type CseSearchHit } from '@sendero/web-search';

import { assertDevOnlyToolAllowed } from '../dev-gate';
import type { ToolContext, ToolDef } from '../types';

const inputSchema = z.object({
  city: z.string().min(1).max(120).describe('City name — "Tokyo", "Mexico City", "Buenos Aires".'),
  countryCode: z
    .string()
    .length(2)
    .optional()
    .describe('ISO-3166 alpha-2 — boosts ranking but not a strict filter.'),
  languageCode: z
    .string()
    .max(10)
    .default('en')
    .describe('BCP-47. "es" steers Places + CSE toward Spanish content.'),
  travelerId: z
    .string()
    .max(120)
    .optional()
    .describe('When provided, the traveler taste graph is folded into ranking.'),
  limit: z.number().int().min(1).max(15).default(8),
  /**
   * Optional bias to a hotel / current location — Places ranks shops
   * near this circle higher. 2km radius is a reasonable urban default.
   */
  locationBias: z
    .object({
      latitude: z.number(),
      longitude: z.number(),
      radiusMeters: z.number().int().min(500).max(20000).default(2000),
    })
    .optional(),
});

export type SpecialtyCoffeeFinderInput = z.infer<typeof inputSchema>;

export interface CoffeeShopHit {
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
  /** 0–1 score combining specialty signal + quality. */
  specialtyScore: number;
  /** Brief human-readable reason this shop ranked. */
  rationale: string;
  /** Editorial sources (max 3) where this shop was mentioned. */
  editorialSources: Array<{ title: string; url: string; snippet: string }>;
}

export type SpecialtyCoffeeFinderResult =
  | {
      status: 'ok';
      city: string;
      shops: CoffeeShopHit[];
      sourcesQueried: { cseAvailable: boolean; placesAvailable: boolean };
      message: string;
    }
  | { status: 'production_refused'; message: string }
  | { status: 'unavailable'; reason: string; message: string };

// ── Deps ─────────────────────────────────────────────────────────────

export interface SpecialtyCoffeeFinderDeps {
  cse: typeof cseSearch;
  places: typeof searchText;
  /**
   * Optional taste-graph reader. Returns the boolean signals the tool
   * cares about. When omitted (no travelerId on input, or DB
   * unreachable), we rank without taste context.
   */
  readTasteSignals?: (
    userId: string
  ) => Promise<{ prefersWorkingFromCafes: boolean; likesLocalHiddenGems: boolean } | null>;
}

export const liveDependencies: SpecialtyCoffeeFinderDeps = {
  cse: cseSearch,
  places: searchText,
};

// ── Editorial source weights ─────────────────────────────────────────

/**
 * Curated CSE domains that carry strong specialty-coffee signal. A
 * place mentioned by Sprudge weighs more than a Yelp listicle. The
 * weight feeds the cross-reference boost.
 */
const SPECIALTY_SOURCE_WEIGHTS: Record<string, number> = {
  'sprudge.com': 1.0,
  'perfectdailygrind.com': 0.9,
  'fiftybest.com': 0.95,
  'worldscoffeeawards.com': 0.95,
  'monocle.com': 0.85,
  'eater.com': 0.7,
  'timeout.com': 0.5,
  'cntraveler.com': 0.55,
  'nytimes.com': 0.6,
  'theguardian.com': 0.55,
  'wallpaper.com': 0.7,
  'tabelog.com': 0.65,
  'lecool.com': 0.45,
};

function weightForSource(displayLink: string): number {
  const host = displayLink.toLowerCase().replace(/^www\./, '');
  for (const [domain, weight] of Object.entries(SPECIALTY_SOURCE_WEIGHTS)) {
    if (host === domain || host.endsWith(`.${domain}`)) return weight;
  }
  return 0.25; // any other source contributes a small editorial signal
}

// ── Cross-reference logic ────────────────────────────────────────────

/**
 * Decide if a Places entry is referenced in an editorial CSE hit.
 * We use a normalized substring match — Place names are short and
 * specific enough that this is reliable in practice. Lower-cases both
 * sides, strips diacritics + punctuation, requires ≥4 chars to avoid
 * false-positive matches on common short words.
 */
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

// ── Scoring ──────────────────────────────────────────────────────────

interface ScoreInputs {
  place: PlacesPlace;
  editorialMatches: CseSearchHit[];
  prefersWorkFromCafes: boolean;
  likesHiddenGems: boolean;
}

function computeSpecialtyScore({
  place,
  editorialMatches,
  prefersWorkFromCafes,
  likesHiddenGems,
}: ScoreInputs): { score: number; rationale: string } {
  const reasons: string[] = [];

  // Editorial signal: best source-weight wins (strong taste signal).
  let editorial = 0;
  if (editorialMatches.length > 0) {
    const weights = editorialMatches.map(h => weightForSource(h.displayLink));
    editorial = Math.max(...weights);
    const topSource = editorialMatches[0]?.displayLink ?? 'editorial source';
    reasons.push(`featured by ${topSource}`);
  }

  // Quality signal: rating × log10(reviews+1), capped to [0, 1].
  // 4.6 rating × log10(500+1) ≈ 4.6 × 2.7 ≈ 12.4 → /15 = 0.83.
  // 5.0 rating × log10(3+1) ≈ 5.0 × 0.6 ≈ 3.0 → /15 = 0.20 (correctly downweighted).
  let quality = 0;
  if (typeof place.rating === 'number' && typeof place.userRatingCount === 'number') {
    const rawQuality = (place.rating * Math.log10(place.userRatingCount + 1)) / 15;
    quality = Math.max(0, Math.min(1, rawQuality));
    if (place.rating >= 4.5 && place.userRatingCount >= 200) {
      reasons.push(`${place.rating.toFixed(1)}★ over ${place.userRatingCount} reviews`);
    }
  }

  // Editorial summary signal — Places (New) only emits this for places
  // it considers notable. Treat as a soft boost.
  const summaryBoost = place.editorialSummary ? 0.1 : 0;
  if (place.editorialSummary) reasons.push('editorial summary on Places');

  // Hidden-gem boost: when the traveler likes hidden gems, weight
  // editorial higher than raw popularity.
  const hiddenGemTilt = likesHiddenGems ? 0.15 : 0;

  // Combine: editorial (50%) + quality (40%) + summary (10%), tilted
  // toward editorial for hidden-gem fans.
  const base = editorial * (0.5 + hiddenGemTilt) + quality * (0.4 - hiddenGemTilt) + summaryBoost;
  const score = Math.max(0, Math.min(1, base));

  // Work-from-cafes signal isn't computed here — it's the
  // `work_from_cafe_ranker` tool's job. We just leave a hint in the
  // rationale when the traveler prefers it so the next tool's
  // re-ranking is justifiable.
  if (prefersWorkFromCafes) {
    reasons.push('work-from-cafés in taste graph; ranker downstream will refine');
  }

  return {
    score,
    rationale: reasons.length > 0 ? reasons.join(' · ') : 'specialty signal weighted by quality',
  };
}

// ── Orchestrator ─────────────────────────────────────────────────────

export async function runSpecialtyCoffeeFinder(
  input: SpecialtyCoffeeFinderInput,
  ctx?: ToolContext,
  deps: SpecialtyCoffeeFinderDeps = liveDependencies
): Promise<SpecialtyCoffeeFinderResult> {
  const gate = assertDevOnlyToolAllowed(ctx);
  if (gate.allowed === false) {
    return { status: 'production_refused', message: gate.reason };
  }

  const lang = input.languageCode ?? 'en';

  // CSE query composes "specialty coffee" + city in the requested
  // language. ES travelers should see ES-language editorial too.
  const cseQuery =
    lang === 'es'
      ? `cafés de especialidad en ${input.city}`
      : lang === 'pt'
        ? `cafeterias de especialidade ${input.city}`
        : `specialty coffee in ${input.city}`;

  const cseRes = await deps.cse({
    query: cseQuery,
    limit: 10,
    lang,
    ...(input.countryCode ? { country: input.countryCode } : {}),
  });

  const placesRes = await deps.places({
    query: `${cseQuery}`,
    limit: 12,
    languageCode: lang,
    ...(input.countryCode ? { regionCode: input.countryCode } : {}),
    ...(input.locationBias
      ? {
          locationBias: {
            circle: {
              center: {
                latitude: input.locationBias.latitude,
                longitude: input.locationBias.longitude,
              },
              radius: input.locationBias.radiusMeters,
            },
          },
        }
      : {}),
  });

  // Hard outage: both upstream sources unavailable. Surface an
  // unambiguous status so the agent can fall back to a different
  // approach (e.g. ask the traveler for known shops to seed from).
  if (!cseRes.available && !placesRes.available) {
    return {
      status: 'unavailable',
      reason: `cse:${cseRes.reason ?? 'unknown'} places:${placesRes.reason ?? 'unknown'}`,
      message: `Couldn't query Custom Search or Places for ${input.city}. Try again or share a few shops you've heard about so we can seed from there.`,
    };
  }

  // Optional: read traveler taste signals when caller passed a
  // travelerId AND deps.readTasteSignals is wired. Failing-soft —
  // if the read errors we proceed without taste context.
  let prefersWorkFromCafes = false;
  let likesHiddenGems = false;
  if (input.travelerId && deps.readTasteSignals) {
    try {
      const taste = await deps.readTasteSignals(input.travelerId);
      prefersWorkFromCafes = taste?.prefersWorkingFromCafes ?? false;
      likesHiddenGems = taste?.likesLocalHiddenGems ?? false;
    } catch {
      // taste graph unavailable → silently fall back to no-taste ranking.
    }
  }

  // Score every Places hit, attach editorial provenance.
  const cseHits = cseRes.available ? cseRes.results : [];
  const placeHits = placesRes.available ? placesRes.results : [];

  const ranked: CoffeeShopHit[] = placeHits
    .filter(p => isCafeOrCoffeeShop(p))
    .map(place => {
      const editorialMatches = cseHits.filter(h => placeMatchesEditorial(place.name, h));
      const { score, rationale } = computeSpecialtyScore({
        place,
        editorialMatches,
        prefersWorkFromCafes,
        likesHiddenGems,
      });
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
        specialtyScore: score,
        rationale,
        editorialSources: editorialMatches.slice(0, 3).map(h => ({
          title: h.title,
          url: h.link,
          snippet: h.snippet,
        })),
      };
    })
    .sort((a, b) => b.specialtyScore - a.specialtyScore)
    .slice(0, input.limit);

  return {
    status: 'ok',
    city: input.city,
    shops: ranked,
    sourcesQueried: {
      cseAvailable: cseRes.available,
      placesAvailable: placesRes.available,
    },
    message:
      ranked.length === 0
        ? `No specialty coffee shops surfaced for ${input.city}. CSE: ${cseRes.available ? `${cseHits.length} hits` : cseRes.reason ?? 'down'}, Places: ${placesRes.available ? `${placeHits.length} hits` : placesRes.reason ?? 'down'}.`
        : `${ranked.length} specialty coffee shops in ${input.city}, ranked by editorial × quality.`,
  };
}

/**
 * Filter Places hits to actual cafés / coffee shops. Places (New)
 * emits specific primary types like `coffee_shop`, `cafe`, but also
 * groups things like `bakery`, `restaurant` that may have showed up
 * in the broader text query. Keep the cafe-shaped types only.
 */
function isCafeOrCoffeeShop(place: PlacesPlace): boolean {
  const primary = place.primaryType ?? '';
  const types = place.types ?? [];
  if (primary === 'coffee_shop' || primary === 'cafe') return true;
  if (types.includes('coffee_shop') || types.includes('cafe')) return true;
  return false;
}

// ── Tool registration ────────────────────────────────────────────────

export const specialtyCoffeeFinderTool: ToolDef<
  SpecialtyCoffeeFinderInput,
  SpecialtyCoffeeFinderResult
> = {
  name: 'specialty_coffee_finder',
  internal: true,
  experimental: true,
  description:
    "Find specialty coffee shops in a city, ranked by editorial × quality signal. Composes the curated CSE (Sprudge / 50 Best Coffee / Monocle / Eater / Time Out / etc.) with Google Places (New) canonical metadata. Folds traveler taste graph when travelerId is given. Use when the traveler asks for 'specialty coffee', 'tercera ola', 'third wave coffee', 'where should I get coffee in <city>'. For laptop / work-friendly ranking, follow up with `work_from_cafe_ranker`.",
  inputSchema,
  jsonSchema: {
    type: 'object',
    required: ['city'],
    properties: {
      city: { type: 'string', minLength: 1, maxLength: 120 },
      countryCode: { type: 'string', minLength: 2, maxLength: 2 },
      languageCode: { type: 'string', maxLength: 10 },
      travelerId: { type: 'string', maxLength: 120 },
      limit: { type: 'integer', minimum: 1, maximum: 15 },
      locationBias: {
        type: 'object',
        required: ['latitude', 'longitude'],
        properties: {
          latitude: { type: 'number' },
          longitude: { type: 'number' },
          radiusMeters: { type: 'integer', minimum: 500, maximum: 20000 },
        },
      },
    },
  },
  handler: runSpecialtyCoffeeFinder,
};
