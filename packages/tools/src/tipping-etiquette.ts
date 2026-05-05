/**
 * tipping_etiquette — return tipping guidance for a country + scenario.
 *
 * Source: curated static catalogue at `data/tipping-etiquette.json`.
 * Tipping norms drift slowly; manual table beats every "tipping API"
 * we evaluated (all are scraped Wikipedia or one-off datasets that
 * decay faster than the table).
 *
 * Scenarios: restaurant | taxi | hotel_housekeeping | hotel_porter |
 *            tour_guide | spa.
 *
 * Public read-only — not a privileged tool.
 */

import { z } from 'zod';

import catalogue from './data/tipping-etiquette.json' with { type: 'json' };
import type { ToolDef } from './types';

export const TIPPING_SCENARIOS = [
  'restaurant',
  'taxi',
  'hotel_housekeeping',
  'hotel_porter',
  'tour_guide',
  'spa',
] as const;
export type TippingScenario = (typeof TIPPING_SCENARIOS)[number];

const inputSchema = z.object({
  countryIso2: z
    .string()
    .regex(/^[A-Za-z]{2}$/, 'countryIso2 must be 2 letters (ISO-3166-1)')
    .transform(s => s.toUpperCase()),
  scenario: z.enum(TIPPING_SCENARIOS),
});

export type TippingEtiquetteInput = z.infer<typeof inputSchema>;

export interface TippingFlat {
  amount: number;
  currency: string;
}

export interface TippingEtiquetteResult {
  countryIso2: string;
  countryName: string;
  scenario: TippingScenario;
  /** Recommended percentage of bill, when convention is percentage-based. */
  recommendedPct?: number;
  /** Acceptable range [min, max]. */
  range?: [number, number];
  /** Recommended flat amount, when convention is per-bag/per-night/per-tour. */
  recommendedFlat?: TippingFlat;
  /** What the flat amount applies to (e.g. 'per_night', 'per_bag'). */
  flatUnit?: string;
  notes?: string;
  /** Currency hint for display, mirrors the country's local currency. */
  localCurrency?: string;
  source: 'sendero-curated';
  /** ISO date the catalogue was last reviewed. */
  lastReviewed: string;
}

interface CountryRowScenario {
  pct?: number;
  range?: [number, number];
  flat?: TippingFlat;
  unit?: string;
  notes?: string;
}

interface CountryRow {
  name: string;
  currency: string;
  restaurant: CountryRowScenario;
  taxi: CountryRowScenario;
  hotel_housekeeping: CountryRowScenario;
  hotel_porter: CountryRowScenario;
  tour_guide: CountryRowScenario;
  spa: CountryRowScenario;
}

interface Catalogue {
  _meta: { version: number; lastReviewed: string; source: string };
  countries: Record<string, CountryRow>;
}

const TYPED_CATALOGUE = catalogue as unknown as Catalogue;

export class TippingCountryUnknownError extends Error {
  readonly code = 'TIPPING_COUNTRY_UNKNOWN';
  constructor(public readonly countryIso2: string) {
    super(`tipping_etiquette: no curated data for country ${countryIso2}`);
    this.name = 'TippingCountryUnknownError';
  }
}

export async function tippingEtiquette(
  input: TippingEtiquetteInput
): Promise<TippingEtiquetteResult> {
  const country = TYPED_CATALOGUE.countries[input.countryIso2];
  if (!country) throw new TippingCountryUnknownError(input.countryIso2);

  const row = country[input.scenario];
  if (!row) {
    // Defensive: every curated row should cover every scenario.
    throw new Error(
      `tipping_etiquette: missing scenario ${input.scenario} for ${input.countryIso2}`
    );
  }

  return {
    countryIso2: input.countryIso2,
    countryName: country.name,
    scenario: input.scenario,
    recommendedPct: row.pct,
    range: row.range,
    recommendedFlat: row.flat,
    flatUnit: row.unit,
    notes: row.notes,
    localCurrency: country.currency,
    source: 'sendero-curated',
    lastReviewed: TYPED_CATALOGUE._meta.lastReviewed,
  };
}

/** Test-only — exposes the curated country list for coverage assertions. */
export function _listSupportedCountries(): string[] {
  return Object.keys(TYPED_CATALOGUE.countries);
}

export const tippingEtiquetteTool: ToolDef<TippingEtiquetteInput, TippingEtiquetteResult> = {
  name: 'tipping_etiquette',
  description:
    'Return tipping guidance for a country + service scenario (restaurant, taxi, hotel housekeeping, hotel porter, tour guide, spa). Use this when the user asks "how much should I tip in X?" or before any payment scenario abroad. Returns a recommended percentage OR flat amount + range + cultural notes (service-included caveats, baksheesh culture, etc.). Rejects unknown countries — if the result is null, fall back to a brief plain-English answer like "tipping varies — generally 10-15% in service industries" rather than inventing numbers.',
  inputSchema,
  jsonSchema: {
    type: 'object',
    required: ['countryIso2', 'scenario'],
    properties: {
      countryIso2: {
        type: 'string',
        pattern: '^[A-Za-z]{2}$',
        description: 'ISO-3166-1 alpha-2 country code (e.g. JP, US, AR).',
      },
      scenario: {
        type: 'string',
        enum: [...TIPPING_SCENARIOS],
        description: 'Service scenario the tip applies to.',
      },
    },
  },
  handler: tippingEtiquette,
};
