/**
 * recommend_visa_application_path — Sendero's intelligence layer on top
 * of the raw visa-eligibility lookup.
 *
 * Two layers compose:
 *   1. `lookupVisaStatus(nationality, destination)` from `@sendero/vault`
 *      — returns the raw `VisaStatus` ('visa_free' | 'eta_required' | …).
 *   2. THIS tool — branches on that status into a discriminated union
 *      and, for the hard `consular` cases (UK Standard Visitor, US
 *      B1/B2, Schengen consular), enriches with:
 *        a. Curated corridor notes (`data/consular-corridors.json`) —
 *           midnight slot patterns, document checklists, alt posts,
 *           processing-time bands, fee.
 *        b. Live consulate lookup via Google Places (when applicant
 *           location is known) — finds nearby consulates of the
 *           DESTINATION country in the applicant's country and ranks
 *           by proximity. Falls back to the curated portal URL when
 *           Places returns nothing.
 *
 * Discriminated return type so the agent's downstream switch is type-
 * safe — never string-match `application_method` then drift.
 *
 * **Never auto-books.** This tool informs; the traveler clicks through
 * the consulate's own booking site themselves. Anything else crosses
 * the TOS line.
 */

import { z } from 'zod';

import { lookupVisaStatus, type VisaStatus } from '@sendero/vault';

import { parseJsonOrThrow, requireGoogleMapsApiKey } from './google-travel-shared';
import corridorCatalogue from './data/consular-corridors.json' with { type: 'json' };
import type { ToolDef, ToolContext } from './types';

const inputSchema = z.object({
  destinationIso3: z
    .string()
    .length(3)
    .describe('Destination country as ISO 3166-1 alpha-3 (USA, GBR, ESP, etc.).'),
  nationalityIso3: z
    .string()
    .length(3)
    .optional()
    .describe(
      "Traveler nationality. Optional — when omitted, resolved from ctx.traveler's PassportVault. Pass explicitly when checking on behalf of someone else."
    ),
  applicantCountryIso2: z
    .string()
    .length(2)
    .optional()
    .describe(
      "Country the traveler is applying FROM (where they live now). Drives consulate-search and alternate-post logic. Defaults to home country = nationality (the common case)."
    ),
  applicantCity: z
    .string()
    .optional()
    .describe('City where the traveler is applying from. Improves Places ranking when set.'),
  arrivalDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .describe('Planned arrival date (YYYY-MM-DD). Used to flag urgency vs processing time.'),
  /** Skip live Places lookup (test mode / no key). */
  skipConsulateSearch: z.boolean().optional(),
});

export type RecommendVisaApplicationPathInput = z.infer<typeof inputSchema>;

// ── Discriminated return ─────────────────────────────────────────────

export interface ConsularOption {
  /** Google Places id when sourced from Places API; synthetic id for curated alternates. */
  placeId?: string;
  /** Display name from Places or curated label ("Spanish Consulate Quito"). */
  name: string;
  /** Country the consulate sits in (ISO-2). */
  hostCountryIso2: string;
  city?: string;
  formattedAddress?: string;
  websiteUri?: string;
  /** Coords when known (Places returns them; curated entries usually omit). */
  location?: { latitude: number; longitude: number };
  /** When true, this is from the curated corridor table; treat as authoritative. */
  curated: boolean;
  /** Surfaced when curated table flagged the alternate post with a note. */
  note?: string;
}

interface PortalRef {
  name: string;
  url: string;
  operator?: string;
}

export type RecommendVisaApplicationPathResult =
  | {
      application_method: 'visa_free';
      maxStayDays?: number;
      notes?: string;
      destinationIso3: string;
      nationalityIso3: string;
    }
  | {
      application_method: 'visa_on_arrival';
      leadTimeDays: number;
      notes?: string;
      destinationIso3: string;
      nationalityIso3: string;
    }
  | {
      application_method: 'eta';
      programName: string;
      applyUrl: string;
      leadTimeDays: number;
      destinationIso3: string;
      nationalityIso3: string;
    }
  | {
      application_method: 'evisa';
      programName: string;
      applyUrl: string;
      leadTimeDays: number;
      destinationIso3: string;
      nationalityIso3: string;
    }
  | {
      application_method: 'consular';
      visaClass: string;
      primaryPortal: PortalRef;
      consularOptions: ConsularOption[];
      processingTimeDays: [number, number];
      appointmentPattern?: string;
      documentChecklist: string[];
      interviewExpected: boolean;
      feeUsd?: number;
      warnings: string[];
      destinationIso3: string;
      nationalityIso3: string;
      /** True when corridor data was found in the curated table. */
      hasCuratedCorridor: boolean;
    }
  | {
      application_method: 'unknown';
      reason: string;
      destinationIso3: string;
      nationalityIso3: string;
      embassyLookupQuery?: string;
    };

// ── Implementation ───────────────────────────────────────────────────

interface CorridorEntry {
  label: string;
  visaClass: string;
  primaryPortal: PortalRef;
  alternatePosts: Array<{ country: string; city: string; note?: string }>;
  processingTimeDays: [number, number];
  appointmentPattern?: string;
  documentChecklist: string[];
  interviewExpected: boolean;
  feeUsd?: number;
  warnings: string[];
}

interface CorridorCatalogue {
  _meta: { version: number; lastReviewed: string; source: string };
  corridors: Record<string, CorridorEntry>;
}

const TYPED_CATALOGUE = corridorCatalogue as unknown as CorridorCatalogue;

function corridorKey(nationalityIso3: string, destinationIso3: string): string {
  return `${nationalityIso3.toUpperCase()}-${destinationIso3.toUpperCase()}`;
}

const ETA_PROGRAMS: Record<string, { programName: string; applyUrl: string; leadTimeDays: number }> = {
  USA: { programName: 'ESTA', applyUrl: 'https://esta.cbp.dhs.gov', leadTimeDays: 3 },
  CAN: {
    programName: 'eTA',
    applyUrl:
      'https://www.canada.ca/en/immigration-refugees-citizenship/services/visit-canada/eta.html',
    leadTimeDays: 1,
  },
  GBR: {
    programName: 'ETA',
    applyUrl: 'https://www.gov.uk/guidance/apply-for-an-electronic-travel-authorisation-eta',
    leadTimeDays: 3,
  },
  AUS: {
    programName: 'ETA',
    applyUrl:
      'https://immi.homeaffairs.gov.au/visas/getting-a-visa/visa-listing/electronic-travel-authority-601',
    leadTimeDays: 7,
  },
  NZL: {
    programName: 'NZeTA',
    applyUrl: 'https://nzeta.immigration.govt.nz/',
    leadTimeDays: 3,
  },
};

const EVISA_PROGRAMS: Record<string, { programName: string; applyUrl: string; leadTimeDays: number }> = {
  IND: { programName: 'e-Visa India', applyUrl: 'https://indianvisaonline.gov.in/evisa', leadTimeDays: 4 },
  TUR: { programName: 'e-Visa Türkiye', applyUrl: 'https://www.evisa.gov.tr', leadTimeDays: 1 },
  KEN: { programName: 'eVisa Kenya', applyUrl: 'https://evisa.go.ke/evisa.html', leadTimeDays: 7 },
  EGY: { programName: 'e-Visa Egypt', applyUrl: 'https://visa2egypt.gov.eg/', leadTimeDays: 7 },
  SAU: { programName: 'eVisa Saudi Arabia', applyUrl: 'https://visa.visitsaudi.com/', leadTimeDays: 1 },
};

// Country ISO-2 → ISO-3 for the small subset we recognize. Avoids
// pulling a 40KB country table for one lookup.
const ISO2_TO_ISO3: Record<string, string> = {
  AR: 'ARG', BO: 'BOL', BR: 'BRA', CL: 'CHL', CO: 'COL', EC: 'ECU', GY: 'GUY', PE: 'PER',
  PY: 'PRY', SR: 'SUR', UY: 'URY', VE: 'VEN', US: 'USA', CA: 'CAN', MX: 'MEX', GB: 'GBR',
  ES: 'ESP', FR: 'FRA', DE: 'DEU', IT: 'ITA', PT: 'PRT', NL: 'NLD', BE: 'BEL', GR: 'GRC',
  IE: 'IRL', AT: 'AUT', CH: 'CHE', JP: 'JPN', KR: 'KOR', CN: 'CHN', HK: 'HKG', SG: 'SGP',
  TH: 'THA', VN: 'VNM', ID: 'IDN', PH: 'PHL', MY: 'MYS', IN: 'IND', AE: 'ARE', SA: 'SAU',
  IL: 'ISR', TR: 'TUR', EG: 'EGY', MA: 'MAR', ZA: 'ZAF', AU: 'AUS', NZ: 'NZL',
};

const ISO3_TO_ISO2: Record<string, string> = Object.fromEntries(
  Object.entries(ISO2_TO_ISO3).map(([iso2, iso3]) => [iso3, iso2])
);

function iso3ToCountryName(iso3: string): string {
  // Curated subset; Places copes with full English country names better
  // than ISO codes in text-search queries.
  const NAMES: Record<string, string> = {
    USA: 'United States', GBR: 'United Kingdom', ESP: 'Spain', FRA: 'France',
    DEU: 'Germany', ITA: 'Italy', PRT: 'Portugal', NLD: 'Netherlands', BEL: 'Belgium',
    GRC: 'Greece', IRL: 'Ireland', AUT: 'Austria', CHE: 'Switzerland',
    JPN: 'Japan', KOR: 'South Korea', CHN: 'China', SGP: 'Singapore',
    AUS: 'Australia', NZL: 'New Zealand', CAN: 'Canada', MEX: 'Mexico',
    BRA: 'Brazil', ARG: 'Argentina', CHL: 'Chile', COL: 'Colombia',
    PER: 'Peru', URY: 'Uruguay', VEN: 'Venezuela', ECU: 'Ecuador', BOL: 'Bolivia',
    IND: 'India', ARE: 'United Arab Emirates', TUR: 'Türkiye', EGY: 'Egypt',
    SAU: 'Saudi Arabia', ZAF: 'South Africa', ISR: 'Israel', MAR: 'Morocco',
  };
  return NAMES[iso3] ?? iso3;
}

interface PlacesSearchResult {
  places?: Array<{
    id?: string;
    displayName?: { text?: string };
    formattedAddress?: string;
    websiteUri?: string;
    location?: { latitude?: number; longitude?: number };
  }>;
}

const PLACES_ENDPOINT = 'https://places.googleapis.com/v1/places:searchText';
const FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.websiteUri',
  'places.location',
].join(',');

async function searchConsulates(
  destinationIso3: string,
  applicantCountryIso2: string,
  applicantCity?: string
): Promise<ConsularOption[]> {
  let apiKey: string;
  try {
    apiKey = requireGoogleMapsApiKey('recommend_visa_application_path');
  } catch {
    return []; // Places key absent → fall back silently to curated portal only.
  }

  const destName = iso3ToCountryName(destinationIso3);
  const where = applicantCity
    ? `${applicantCity}, ${applicantCountryIso2.toUpperCase()}`
    : applicantCountryIso2.toUpperCase();
  const query = `${destName} consulate in ${where}`;

  let response: Response;
  try {
    response = await fetch(PLACES_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': FIELD_MASK,
      },
      body: JSON.stringify({
        textQuery: query,
        // Bias to applicant country so we don't surface a consulate of
        // the destination country sitting in a third country.
        regionCode: applicantCountryIso2.toUpperCase(),
        maxResultCount: 5,
      }),
    });
  } catch {
    return [];
  }
  if (!response.ok) return [];

  const data = (await parseJsonOrThrow(response, 'Google Places API')) as PlacesSearchResult;
  const places = data.places ?? [];
  return places.map(p => ({
    placeId: p.id,
    name: p.displayName?.text ?? `${destName} Consulate`,
    hostCountryIso2: applicantCountryIso2.toUpperCase(),
    city: applicantCity,
    formattedAddress: p.formattedAddress,
    websiteUri: p.websiteUri,
    location:
      typeof p.location?.latitude === 'number' && typeof p.location?.longitude === 'number'
        ? { latitude: p.location.latitude, longitude: p.location.longitude }
        : undefined,
    curated: false,
  }));
}

function curatedAlternatesAsOptions(entry: CorridorEntry): ConsularOption[] {
  return entry.alternatePosts.map(alt => ({
    name: `${entry.visaClass} — ${alt.city}`,
    hostCountryIso2: ISO3_TO_ISO2[alt.country] ?? alt.country.slice(0, 2),
    city: alt.city,
    websiteUri: entry.primaryPortal.url,
    curated: true,
    note: alt.note,
  }));
}

export async function recommendVisaApplicationPath(
  input: RecommendVisaApplicationPathInput,
  ctx?: ToolContext
): Promise<RecommendVisaApplicationPathResult> {
  // Resolve nationality from input first, then ctx.traveler hints.
  // We can't reach into the vault directly without a tenant-bound
  // accessor; that's the dispatch route's job — the tool stays stateless.
  const nationalityIso3 = (input.nationalityIso3 ?? '').toUpperCase();
  const destinationIso3 = input.destinationIso3.toUpperCase();
  const applicantCountryIso2 = (input.applicantCountryIso2 ?? '').toUpperCase();
  // Fall back: nationality from ctx if passed (when dispatch loaded the
  // vault and stuffed it onto traveler — extension point).
  const effectiveNationality =
    nationalityIso3 ||
    ((ctx as { traveler?: { nationalityIso3?: string } })?.traveler?.nationalityIso3 ?? '').toUpperCase();

  if (!effectiveNationality) {
    return {
      application_method: 'unknown',
      reason: 'Traveler nationality unknown — pass nationalityIso3 explicitly or scan their passport first via scan_passport_inline.',
      destinationIso3,
      nationalityIso3: '',
    };
  }

  const rawStatus: VisaStatus = lookupVisaStatus(effectiveNationality, destinationIso3);

  // The curated corridor table is itself authoritative for "this needs a
  // consular visa" — if the visa-rules lookup hasn't been seeded for this
  // pair but we DO have a corridor entry, promote the status. Avoids
  // dropping into the 'unknown' branch when we have richer info elsewhere.
  const corridorKnown = Object.prototype.hasOwnProperty.call(
    TYPED_CATALOGUE.corridors,
    corridorKey(effectiveNationality, destinationIso3)
  );
  const status: VisaStatus =
    rawStatus === 'unknown' && corridorKnown ? 'visa_required' : rawStatus;

  switch (status) {
    case 'visa_free':
      return {
        application_method: 'visa_free',
        destinationIso3,
        nationalityIso3: effectiveNationality,
      };

    case 'visa_on_arrival':
      return {
        application_method: 'visa_on_arrival',
        leadTimeDays: 0,
        destinationIso3,
        nationalityIso3: effectiveNationality,
        notes: 'Visa issued at arrival immigration. Bring fee in USD cash + return ticket + accommodation proof.',
      };

    case 'eta_required': {
      const program = ETA_PROGRAMS[destinationIso3];
      if (program) {
        return {
          application_method: 'eta',
          ...program,
          destinationIso3,
          nationalityIso3: effectiveNationality,
        };
      }
      // Edge case: status says ETA but we don't have program metadata.
      return {
        application_method: 'unknown',
        reason: `An ETA is required but Sendero doesn't have the program details for ${destinationIso3}. Check the destination's official immigration site.`,
        destinationIso3,
        nationalityIso3: effectiveNationality,
        embassyLookupQuery: `${iso3ToCountryName(destinationIso3)} ETA application`,
      };
    }

    case 'evisa_required': {
      const program = EVISA_PROGRAMS[destinationIso3];
      if (program) {
        return {
          application_method: 'evisa',
          ...program,
          destinationIso3,
          nationalityIso3: effectiveNationality,
        };
      }
      return {
        application_method: 'unknown',
        reason: `An eVisa is required but Sendero doesn't have the program details for ${destinationIso3}. Check sherpa° Requirements API or the destination's immigration site.`,
        destinationIso3,
        nationalityIso3: effectiveNationality,
        embassyLookupQuery: `${iso3ToCountryName(destinationIso3)} eVisa application`,
      };
    }

    case 'visa_required': {
      // The moat case. Look up curated corridor + Places in parallel.
      const key = corridorKey(effectiveNationality, destinationIso3);
      const entry = TYPED_CATALOGUE.corridors[key];

      const applicantCountry =
        applicantCountryIso2 || (ISO3_TO_ISO2[effectiveNationality] ?? '');

      const [liveOptions] = await Promise.all([
        applicantCountry && !input.skipConsulateSearch
          ? searchConsulates(destinationIso3, applicantCountry, input.applicantCity)
          : Promise.resolve<ConsularOption[]>([]),
      ]);

      // Merge live + curated alternates; dedup by name.
      const curatedAlternates = entry ? curatedAlternatesAsOptions(entry) : [];
      const seen = new Set<string>();
      const consularOptions: ConsularOption[] = [];
      for (const o of [...liveOptions, ...curatedAlternates]) {
        const k = `${o.name}|${o.hostCountryIso2}|${o.city ?? ''}`;
        if (seen.has(k)) continue;
        seen.add(k);
        consularOptions.push(o);
      }

      if (entry) {
        return {
          application_method: 'consular',
          visaClass: entry.visaClass,
          primaryPortal: entry.primaryPortal,
          consularOptions,
          processingTimeDays: entry.processingTimeDays,
          appointmentPattern: entry.appointmentPattern,
          documentChecklist: entry.documentChecklist,
          interviewExpected: entry.interviewExpected,
          feeUsd: entry.feeUsd,
          warnings: entry.warnings,
          destinationIso3,
          nationalityIso3: effectiveNationality,
          hasCuratedCorridor: true,
        };
      }

      // No curated entry — degraded consular response: portal points at
      // a generic embassy lookup query, document checklist generic.
      return {
        application_method: 'consular',
        visaClass: 'Consular visitor visa',
        primaryPortal: {
          name: `${iso3ToCountryName(destinationIso3)} embassy / consulate`,
          url: `https://www.google.com/search?q=${encodeURIComponent(
            `${iso3ToCountryName(destinationIso3)} embassy in ${
              applicantCountry ? iso3ToCountryName(effectiveNationality) : 'home country'
            } visa application`
          )}`,
        },
        consularOptions,
        processingTimeDays: [15, 60],
        documentChecklist: [
          'Passport (valid 6+ months past trip)',
          'Visa application form (download from consulate site)',
          'Photo (2×2 inches typical; check consulate spec)',
          'Proof of travel (flight reservation, hotel)',
          'Proof of funds (bank statements last 3 months)',
          'Proof of strong ties to home country',
        ],
        interviewExpected: false,
        warnings: [
          `Sendero does not yet have curated corridor data for ${effectiveNationality} → ${destinationIso3}. Verify requirements directly with the consulate.`,
        ],
        destinationIso3,
        nationalityIso3: effectiveNationality,
        hasCuratedCorridor: false,
      };
    }

    case 'unknown':
    default:
      return {
        application_method: 'unknown',
        reason: `Sendero doesn't have a visa rule for ${effectiveNationality} → ${destinationIso3}. Check sherpa° Requirements API or the destination's official immigration site.`,
        destinationIso3,
        nationalityIso3: effectiveNationality,
        embassyLookupQuery: `${iso3ToCountryName(destinationIso3)} visa requirements ${iso3ToCountryName(effectiveNationality)}`,
      };
  }
}

export const recommendVisaApplicationPathTool: ToolDef<
  RecommendVisaApplicationPathInput,
  RecommendVisaApplicationPathResult
> = {
  name: 'recommend_visa_application_path',
  description:
    "Sendero's intelligence layer on visa applications. After `check_visa_requirements` says a visa is needed, call THIS tool to get the actual application path: which consulate to use, processing time, document checklist, midnight-slot drop pattern (when known), curated alternate posts. For consular cases (UK Standard Visitor, US B1/B2, Schengen consular), enriches with live consulate lookup via Google Places + curated corridor notes from sendero-curated. Returns a discriminated union — branch on `application_method` (visa_free | visa_on_arrival | eta | evisa | consular | unknown). NEVER auto-books — surfaces the URL for the traveler to click.",
  inputSchema,
  jsonSchema: {
    type: 'object',
    required: ['destinationIso3'],
    properties: {
      destinationIso3: {
        type: 'string',
        minLength: 3,
        maxLength: 3,
        description: 'Destination country ISO 3166-1 alpha-3.',
      },
      nationalityIso3: {
        type: 'string',
        minLength: 3,
        maxLength: 3,
        description: 'Traveler nationality ISO 3166-1 alpha-3 (optional — falls back to vault).',
      },
      applicantCountryIso2: {
        type: 'string',
        minLength: 2,
        maxLength: 2,
        description: 'Country the traveler applies FROM (where they live now). ISO 3166-1 alpha-2.',
      },
      applicantCity: {
        type: 'string',
        description: 'City where the traveler applies from. Improves Places consulate ranking.',
      },
      arrivalDate: {
        type: 'string',
        pattern: '^\\d{4}-\\d{2}-\\d{2}$',
        description: 'Planned arrival YYYY-MM-DD.',
      },
      skipConsulateSearch: {
        type: 'boolean',
        description: 'Skip live Places lookup. For test mode or environments without a Google key.',
      },
    },
  },
  handler: recommendVisaApplicationPath,
};

/** Test-only — exposes the catalogue for coverage assertions. */
export function _listSupportedCorridors(): string[] {
  return Object.keys(TYPED_CATALOGUE.corridors);
}
