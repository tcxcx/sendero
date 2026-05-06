/**
 * web_search — Gemini-grounded web search for real-time public data.
 *
 * Wraps Google's `googleSearch` grounding so the agent can answer
 * queries that aren't covered by canonical Sendero tools — soccer
 * fixtures, event dates, live news, sports standings, public-domain
 * factual questions.
 *
 * NOT a substitute for canonical Sendero tools. The persona slab
 * teaches the agent to always reach for `search_flights` /
 * `search_hotels` / `search_esim` / etc. before considering a web
 * lookup. `web_search` only fires when no Sendero tool covers the
 * query (e.g. "when does Deportivo Cuenca play next in Copa
 * Sudamericana?" — we have flights to ASU, but not the fixture).
 *
 * Returns a synthesized text answer + `sources[]` so the agent can
 * cite (WhatsApp message includes the top 1-3 source links).
 *
 * Cost: each grounded prompt is billed by Google at ~$25/1K queries
 * (free tier ≤ 500/day). Reserve for genuinely uncovered intents.
 *
 * Public read-only — no traveler-side state mutation. Safe across
 * channels.
 */

import { z } from 'zod';
import { generateText } from 'ai';
import { google } from '@ai-sdk/google';
import { createVertex } from '@ai-sdk/google-vertex';

import type { ToolDef } from './types';

const inputSchema = z.object({
  query: z
    .string()
    .min(3)
    .max(400)
    .describe(
      "The natural-language search query. Be specific: include team / event / city / dates when known. Examples: 'Deportivo Cuenca next Copa Sudamericana fixture 2026', 'Boca Juniors home games may 2026', 'Lollapalooza Argentina 2026 dates'."
    ),
  /**
   * Optional locale hint for the answer language. Defaults to es-AR
   * if unspecified — matches Sendero's primary traveler base.
   */
  locale: z
    .string()
    .min(2)
    .max(10)
    .optional()
    .describe("BCP-47 locale tag (e.g. 'es-AR', 'pt-BR', 'en-US'). Defaults to 'es-AR'."),
});

export type WebSearchInput = z.infer<typeof inputSchema>;

export interface WebSearchSource {
  uri: string;
  title: string | null;
}

export interface WebSearchResult {
  /** Synthesized answer grounded in live web results. */
  text: string;
  /** Sources cited by Gemini's grounding response. */
  sources: WebSearchSource[];
  /** Search queries Gemini ran (for ops / debugging). */
  searchQueries: string[];
  /** Locale used for the answer. */
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

function buildPrompt(input: WebSearchInput, locale: string): string {
  return `${input.query}\n\nAnswer in ${locale}. Be concise (≤ 4 sentences). When citing a date, source, or fixture, mention the source verbatim. If the answer isn't reliably available from public web sources, say "no encontré información confiable sobre eso" rather than guessing.`;
}

interface GenerateTextLike {
  text: string;
  sources?: ReadonlyArray<unknown>;
  providerMetadata?: unknown;
}

function extractResult(result: GenerateTextLike, locale: string): WebSearchResult {
  const sources: WebSearchSource[] = (result.sources ?? [])
    .map(s => ({
      uri: (s as { url?: string; uri?: string }).url ?? (s as { uri?: string }).uri ?? '',
      title: (s as { title?: string }).title ?? null,
    }))
    .filter(s => s.uri);
  const searchQueries: string[] =
    (
      result.providerMetadata as
        | { google?: { groundingMetadata?: { webSearchQueries?: string[] } } }
        | undefined
    )?.google?.groundingMetadata?.webSearchQueries ?? [];
  return {
    text: result.text,
    sources,
    searchQueries,
    locale,
  };
}

async function webSearch(input: WebSearchInput): Promise<WebSearchResult> {
  const locale = input.locale ?? 'es-AR';
  const prompt = buildPrompt(input, locale);

  // Path 1: Vertex direct (Vortex / corporate Google billing).
  const vertex = resolveVertex();
  if (vertex) {
    try {
      const r = await generateText({
        model: vertex(VERTEX_MODEL_ID),
        tools: { google_search: vertex.tools.googleSearch({}) },
        prompt,
      });
      return extractResult(r, locale);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(
        '[web_search] Vertex direct failed, falling back to AI Gateway:',
        (err as Error).message ?? err
      );
    }
  }

  // Path 2: Vercel AI Gateway. Routes to Google via Vercel-sponsored
  // billing; works wherever AI_GATEWAY_API_KEY is bound. Grounding
  // travels through as a provider tool descriptor — the gateway's
  // Google leg honors `google.tools.googleSearch`.
  const r = await generateText({
    model: GATEWAY_MODEL_ID,
    tools: { google_search: google.tools.googleSearch({}) },
    prompt,
    providerOptions: {
      gateway: { order: ['google'] },
    },
  });
  return extractResult(r, locale);
}

export const webSearchTool: ToolDef<WebSearchInput, WebSearchResult> = {
  name: 'web_search',
  description:
    "Real-time web search for public information no other Sendero tool covers — sports fixtures, event dates, news, factual lookups. Powered by Gemini's google_search grounding (live web). Use ONLY when no canonical Sendero tool fits: do not use for flights (`search_flights`), hotels (`search_hotels`), eSIM (`search_esim`), restaurants (`recommend_restaurants`), weather (`trip_weather_brief`), currency (`currency_convert`). Each call hits Google billing — be specific and don't loop.",
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
          'Natural-language search query. Be specific (include team, event, city, dates when known).',
      },
      locale: {
        type: 'string',
        minLength: 2,
        maxLength: 10,
        description: "BCP-47 locale tag (e.g. 'es-AR', 'pt-BR', 'en-US'). Defaults to 'es-AR'.",
      },
    },
  },
  handler: webSearch,
};
