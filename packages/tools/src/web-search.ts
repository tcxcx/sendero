/**
 * web_search — Gemini-grounded web search for real-time public data.
 *
 * Wraps the Vercel AI SDK's `google.tools.googleSearch` grounding so
 * the agent can answer queries that aren't covered by canonical
 * Sendero tools — soccer fixtures, event dates, live news, sports
 * standings, public-domain factual questions.
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
import { createGoogleGenerativeAI, google } from '@ai-sdk/google';

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

const MODEL_ID = 'gemini-3-flash-preview';

async function webSearch(input: WebSearchInput): Promise<WebSearchResult> {
  const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY ?? process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      'web_search: GOOGLE_GENERATIVE_AI_API_KEY (or GEMINI_API_KEY) not set. Add it to env.'
    );
  }

  const client = createGoogleGenerativeAI({ apiKey });
  const locale = input.locale ?? 'es-AR';

  const result = await generateText({
    model: client(MODEL_ID),
    tools: {
      google_search: google.tools.googleSearch({}),
    },
    prompt: `${input.query}\n\nAnswer in ${locale}. Be concise (≤ 4 sentences). When citing a date, source, or fixture, mention the source verbatim. If the answer isn't reliably available from public web sources, say "no encontré información confiable sobre eso" rather than guessing.`,
  });

  // AI SDK exposes `sources` (grounding citations) on the result. Each
  // source has a `url` + `title`. We surface the canonical (gateway)
  // URI Gemini emits — that's what's safe to share with travelers.
  const sources: WebSearchSource[] = (result.sources ?? []).map(s => ({
    uri: (s as { url?: string; uri?: string }).url ?? (s as { uri?: string }).uri ?? '',
    title: (s as { title?: string }).title ?? null,
  })).filter(s => s.uri);

  // groundingMetadata.webSearchQueries surfaces the actual queries the
  // model ran. Useful when ops audits which search terms hit the bill.
  const searchQueries: string[] =
    (result.providerMetadata as { google?: { groundingMetadata?: { webSearchQueries?: string[] } } } | undefined)
      ?.google?.groundingMetadata?.webSearchQueries ?? [];

  return {
    text: result.text,
    sources,
    searchQueries,
    locale,
  };
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
          "Natural-language search query. Be specific (include team, event, city, dates when known).",
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
