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
import { generateObject, generateText } from 'ai';
import { google } from '@ai-sdk/google';
import { createVertex } from '@ai-sdk/google-vertex';

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
      'ISO 8601 date or datetime. Use full datetime when kickoff time is known (e.g. 2026-05-22T21:30:00-03:00); date-only when only the day is reported (2026-05-22).'
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

/**
 * Vertex direct uses the model's preview ID; the AI Gateway exposes
 * the same family under its canonical alias (no `-preview` suffix).
 * See `packages/agent/src/models.ts::GATEWAY_MODELS`.
 */
const VERTEX_MODEL_ID = 'gemini-3-flash-preview';
const GATEWAY_MODEL_ID = 'google/gemini-3-flash';

function resolveVertex() {
  const project = process.env.GOOGLE_CLOUD_PROJECT ?? process.env.GOOGLE_VERTEX_PROJECT ?? null;
  const location = process.env.GOOGLE_CLOUD_LOCATION ?? 'global';
  const saJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
  if (!project || !saJson) return null;
  try {
    return createVertex({
      project,
      location,
      googleAuthOptions: { credentials: JSON.parse(saJson) },
    });
  } catch {
    return null;
  }
}

interface PromptBundle {
  groundingPrompt: string;
  coerce: (groundedText: string, sourceUris: string[]) => string;
}

function buildPrompts(
  input: LookupMatchFixturesInput,
  locale: string,
  limit: number
): PromptBundle {
  const groundingPrompt = `Look up the most recent public fixture schedule for: ${input.query}

Return the next ${limit} fixtures as a clear list. For each fixture include:
- Date and (when known) kick-off time, in the local time zone of the host city.
- Home team and away team (full club name).
- Host city and country.
- Stadium / venue, when reported.
- Brief one-line note about confidence (e.g. "kickoff times TBD pending broadcaster").

If reliable public information is unavailable, say so explicitly. Never invent dates.

Cite the official confederation or league source when possible (e.g. conmebol.com, fifa.com, espn.com).`;

  const coerce = (groundedText: string, sourceUris: string[]) =>
    `Coerce the following grounded fixture report into a structured list of AT MOST ${limit} fixtures.

Grounded report:
"""
${groundedText}
"""

Sources Gemini cited (use for sourceUri when matching a fixture):
${
  sourceUris
    .slice(0, 8)
    .map((u, i) => `${i + 1}. ${u}`)
    .join('\n') || '(none)'
}

Rules:
- Return AT MOST ${limit} fixtures. Prefer the next-up matches.
- Use ISO 8601 for kickoff (full datetime when known, date-only when not).
- Resolve city + countryIso2 + airportIataHint for each fixture (major airport IATA closest to the host city — e.g. Asunción → ASU, São Paulo → GRU, Buenos Aires → EZE, Cuenca Ecuador → CUE).
- If a fixture's date isn't in the grounded report, omit that fixture rather than guessing.
- Notes: one short line in ${locale} reflecting Gemini's confidence statement.`;

  return { groundingPrompt, coerce };
}

interface GenerateTextLike {
  text: string;
  providerMetadata?: unknown;
}

function extractGrounded(result: GenerateTextLike): {
  text: string;
  sourceUris: string[];
} {
  const text = result.text?.trim() ?? '';
  const sourceUris: string[] = [];
  type GroundingMeta = {
    google?: { groundingMetadata?: { groundingChunks?: Array<{ web?: { uri?: string } }> } };
  };
  const meta = result.providerMetadata as GroundingMeta | undefined;
  const chunks = meta?.google?.groundingMetadata?.groundingChunks ?? [];
  for (const c of chunks) {
    const uri = c?.web?.uri;
    if (typeof uri === 'string') sourceUris.push(uri);
  }
  return { text, sourceUris };
}

async function runVertex(
  input: LookupMatchFixturesInput,
  vertex: ReturnType<typeof createVertex>,
  locale: string,
  limit: number
): Promise<LookupMatchFixturesResult> {
  const { groundingPrompt, coerce } = buildPrompts(input, locale, limit);

  // Pass 1: grounded text via Vertex + googleSearch tool.
  const grounded = await generateText({
    model: vertex(VERTEX_MODEL_ID),
    tools: { google_search: vertex.tools.googleSearch({}) },
    prompt: groundingPrompt,
  });
  const { text: groundedText, sourceUris } = extractGrounded(grounded);
  if (!groundedText) {
    return {
      status: 'no_results',
      fixtures: [],
      notes: 'Gemini search grounding returned no text. Try a more specific query.',
      locale,
    };
  }

  // Pass 2: structured-output coercion (no grounding — mutually exclusive).
  const result = await generateObject({
    model: vertex(VERTEX_MODEL_ID),
    schema: outputShape,
    prompt: coerce(groundedText, sourceUris),
  });
  const fixtures = result.object.fixtures.slice(0, limit);
  return {
    status: fixtures.length > 0 ? 'ok' : 'no_results',
    fixtures,
    notes: result.object.notes,
    locale,
  };
}

async function runGateway(
  input: LookupMatchFixturesInput,
  locale: string,
  limit: number
): Promise<LookupMatchFixturesResult> {
  const { groundingPrompt, coerce } = buildPrompts(input, locale, limit);

  // Pass 1: grounded text via gateway. Grounding travels as a provider
  // tool descriptor — the gateway's Google leg honors `googleSearch`.
  const grounded = await generateText({
    model: GATEWAY_MODEL_ID,
    tools: { google_search: google.tools.googleSearch({}) },
    prompt: groundingPrompt,
    providerOptions: {
      gateway: { order: ['google'] },
    },
  });
  const { text: groundedText, sourceUris } = extractGrounded(grounded);
  if (!groundedText) {
    return {
      status: 'no_results',
      fixtures: [],
      notes: 'Gemini search grounding returned no text. Try a more specific query.',
      locale,
    };
  }

  // Pass 2: structured-output coercion via gateway. No grounding here.
  const result = await generateObject({
    model: GATEWAY_MODEL_ID,
    schema: outputShape,
    prompt: coerce(groundedText, sourceUris),
    providerOptions: {
      gateway: { order: ['google'] },
    },
  });
  const fixtures = result.object.fixtures.slice(0, limit);
  return {
    status: fixtures.length > 0 ? 'ok' : 'no_results',
    fixtures,
    notes: result.object.notes,
    locale,
  };
}

async function lookupMatchFixtures(
  input: LookupMatchFixturesInput
): Promise<LookupMatchFixturesResult> {
  const locale = input.locale ?? 'es-AR';
  const limit = input.limit ?? 4;

  // Path 1: Vertex direct (Vortex / corporate Google billing).
  const vertex = resolveVertex();
  if (vertex) {
    try {
      return await runVertex(input, vertex, locale, limit);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(
        '[lookup_match_fixtures] Vertex direct failed, falling back to AI Gateway:',
        (err as Error).message ?? err
      );
    }
  }

  // Path 2: Vercel AI Gateway fallback.
  return runGateway(input, locale, limit);
}

export const lookupMatchFixturesTool: ToolDef<LookupMatchFixturesInput, LookupMatchFixturesResult> =
  {
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
