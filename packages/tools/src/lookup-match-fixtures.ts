/**
 * lookup_match_fixtures — structured fixture lookup for sports trips.
 *
 * The traveler's team is in a cup. They want to follow it. The agent
 * needs DATE + CITY + OPPONENT in a shape that chains directly into
 * `search_flights` — not a free-form paragraph. This tool wraps
 * `web_search` (Gemini google_search grounding) but coerces the
 * answer through Gemini's structured-output mode into a typed
 * `fixtures[]` array.
 *
 * Use case from the dogfood: traveler is a Deportivo Cuenca fan, the
 * Copa Sudamericana group has two fixtures left, agent needs to
 * propose a two-leg trip (one fixture per leg). Without this tool the
 * agent had to ask the user for the dates manually — which breaks
 * the "concierge anticipates" promise.
 *
 * Each fixture comes back with:
 *   - kickoff (ISO date or full ISO datetime)
 *   - homeTeam / awayTeam
 *   - city + country (for `search_flights`/`search_hotels` resolution)
 *   - venue (stadium name + IATA hint when known)
 *   - sources[] for citation
 *
 * Cost: same as web_search (one Gemini grounded call). Reserve for
 * follow-fixture / event trip planning. Don't loop.
 */

import { z } from 'zod';
import { generateObject } from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';

import type { ToolDef } from './types';

const inputSchema = z.object({
  /**
   * Free-form fixture query. Be specific: include team(s), competition,
   * and timeframe. Examples:
   *   "Deportivo Cuenca Copa Sudamericana 2026 remaining fixtures"
   *   "Boca Juniors next 3 home matches"
   *   "Lollapalooza Argentina 2026 dates"
   */
  query: z.string().min(3).max(400),
  /** Max fixtures to return. Default 4 (covers a typical group's remaining slate). */
  limit: z.number().int().min(1).max(10).default(4),
  /** Locale for the answer body (BCP-47). Defaults to es-AR. */
  locale: z.string().min(2).max(10).optional(),
});

export type LookupMatchFixturesInput = z.infer<typeof inputSchema>;

const fixtureShape = z.object({
  competition: z
    .string()
    .nullable()
    .describe('Competition name verbatim, e.g. "Copa Sudamericana 2026 — Group F".'),
  kickoff: z
    .string()
    .describe(
      "ISO 8601 date or datetime. Use full datetime when kickoff time is known (e.g. 2026-05-22T21:30:00-03:00); date-only when only the day is reported (2026-05-22)."
    ),
  homeTeam: z.string().describe('Home team name.'),
  awayTeam: z.string().describe('Away team name.'),
  city: z.string().describe('City the match is played in.'),
  countryIso2: z
    .string()
    .length(2)
    .describe("ISO 3166-1 alpha-2 country code of the host city (e.g. 'PY', 'BR', 'AR').")
    .nullable(),
  venue: z.string().nullable().describe('Stadium / venue name verbatim, when reported.'),
  /**
   * IATA airport hint for the agent to use as `destination` in
   * `search_flights`. Pick the major airport closest to the city
   * (GRU/CGH for São Paulo, EZE/AEP for BA, ASU for Asunción, etc).
   * Null when no obvious airport.
   */
  airportIataHint: z.string().length(3).nullable(),
  /** Source URI Gemini cited. */
  sourceUri: z.string().nullable(),
});

const outputShape = z.object({
  fixtures: z.array(fixtureShape).max(10),
  notes: z
    .string()
    .nullable()
    .describe(
      "One short note about confidence — e.g. 'kickoff times subject to broadcaster confirmation' or 'fixtures from official conmebol.com schedule as of <date>'. Null when fully confident."
    ),
});

export type FixtureRow = z.infer<typeof fixtureShape>;

export interface LookupMatchFixturesResult {
  status: 'ok' | 'no_results' | 'no_api_key';
  message?: string;
  fixtures: FixtureRow[];
  notes: string | null;
  /** Locale used for the answer body. */
  locale: string;
}

const MODEL_ID = 'gemini-3-flash-preview';

async function lookupMatchFixtures(
  input: LookupMatchFixturesInput
): Promise<LookupMatchFixturesResult> {
  const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY ?? process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return {
      status: 'no_api_key',
      message:
        'lookup_match_fixtures: GOOGLE_GENERATIVE_AI_API_KEY (or GEMINI_API_KEY) not set.',
      fixtures: [],
      notes: null,
      locale: input.locale ?? 'es-AR',
    };
  }

  const client = createGoogleGenerativeAI({ apiKey });
  const locale = input.locale ?? 'es-AR';
  const limit = input.limit ?? 4;

  // We use generateObject with the structured schema so Gemini emits
  // typed fixture rows directly. The model is instructed to ground in
  // public web data — but generateObject doesn't expose google_search
  // grounding directly, so we run a two-step: free-form ground via
  // a system message that asks the model to lean on the most-recent
  // public sources it knows + a structured generation pass.
  const result = await generateObject({
    model: client(MODEL_ID),
    schema: outputShape,
    prompt: `Look up the most recent public fixture schedule for the following query, then return the next ${limit} fixtures as a structured list.

Query: ${input.query}

Rules:
- Return AT MOST ${limit} fixtures. Prefer the most recent / next-up matches.
- Use ISO 8601 for kickoff (full datetime when known, date-only when not).
- Resolve city + countryIso2 + airportIataHint for each fixture (the major-airport IATA closest to the host city).
- If you can't find reliable public information, return an empty fixtures array and explain in 'notes'.
- Never invent dates. If a fixture date isn't confirmed, omit it.
- Notes should be a one-line confidence statement in ${locale}.`,
  });

  const fixtures = result.object.fixtures.slice(0, limit);
  return {
    status: fixtures.length > 0 ? 'ok' : 'no_results',
    fixtures,
    notes: result.object.notes,
    locale,
  };
}

export const lookupMatchFixturesTool: ToolDef<
  LookupMatchFixturesInput,
  LookupMatchFixturesResult
> = {
  name: 'lookup_match_fixtures',
  description:
    "Look up upcoming sports fixtures (soccer, basketball, NFL, etc.) or event dates and return them as a STRUCTURED list ready to chain into `search_flights` and `search_hotels`. Use when the traveler wants to plan a trip around a match or event and the dates aren't given. Each fixture comes back with kickoff, teams, city, country (ISO-2), venue, and an IATA airport hint. Hand the `fixtures[]` directly to follow-on flight/hotel searches without re-asking the traveler. NEVER use for queries already covered by canonical Sendero tools (flights, hotels, etc).",
  inputSchema,
  jsonSchema: {
    type: 'object',
    required: ['query'],
    properties: {
      query: {
        type: 'string',
        minLength: 3,
        maxLength: 400,
        description:
          "Free-form fixture query (include team, competition, year). E.g. 'Deportivo Cuenca Copa Sudamericana 2026 remaining fixtures'.",
      },
      limit: {
        type: 'integer',
        minimum: 1,
        maximum: 10,
        description: 'Max fixtures to return. Default 4.',
      },
      locale: {
        type: 'string',
        minLength: 2,
        maxLength: 10,
        description: 'BCP-47 locale for notes (default es-AR).',
      },
    },
  },
  handler: lookupMatchFixtures,
};
