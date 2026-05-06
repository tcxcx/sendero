/**
 * luma_event_discovery — HP1 Tool 8 / 47.
 *
 * Spec: docs/specs/anticipatory-concierge.md §HP1 + roadmap §B2.
 *
 * Luma's public API (`public-api.luma.com/v1/calendar/list-events`) is
 * calendar-scoped — it lists events for *your* Luma calendars given an
 * x-luma-api-key, not arbitrary public events in a city. So CSE
 * site:lu.ma is the realistic public-discovery path for traveler-side
 * agents.
 *
 * Same shape as `eventbrite_event_discovery`: CSE returns links + titles
 * + snippets; the agent reads URLs and times from CSE without needing
 * the API token. Token slot stays available for future calendar-owner
 * enrichment.
 *
 * **Experimental** (`experimental: true`). Dev-only gate at handler-time.
 */

import { z } from 'zod';

import { cseSearch } from '@sendero/web-search';

import { assertDevOnlyToolAllowed } from '../dev-gate';
import type { ToolContext, ToolDef } from '../types';

const inputSchema = z.object({
  city: z.string().min(1).max(120),
  countryCode: z.string().length(2).optional(),
  /** Free-form keywords. 'AI', 'founder', 'web3', 'design'. */
  keywords: z.string().max(200).optional(),
  limit: z.number().int().min(1).max(15).default(8),
  languageCode: z.string().max(10).default('en'),
});

export type LumaEventDiscoveryInput = z.infer<typeof inputSchema>;

export interface LumaEventHit {
  id: string;
  name: string;
  url: string;
  summary?: string;
  source: 'lu.ma';
}

export type LumaEventDiscoveryResult =
  | { status: 'ok'; city: string; events: LumaEventHit[]; message: string }
  | { status: 'production_refused'; message: string }
  | { status: 'unavailable'; reason: string; message: string };

export interface LumaEventDiscoveryDeps {
  cse: typeof cseSearch;
}

export const liveDependencies: LumaEventDiscoveryDeps = { cse: cseSearch };

export async function runLumaEventDiscovery(
  rawInput: LumaEventDiscoveryInput,
  ctx?: ToolContext,
  deps: LumaEventDiscoveryDeps = liveDependencies
): Promise<LumaEventDiscoveryResult> {
  const gate = assertDevOnlyToolAllowed(ctx);
  if (gate.allowed === false) return { status: 'production_refused', message: gate.reason };

  const input = inputSchema.parse(rawInput);

  const q = [input.keywords, input.city, 'event'].filter(Boolean).join(' ');
  const r = await deps.cse({
    query: q,
    site: 'lu.ma',
    limit: Math.min(input.limit, 10),
    lang: input.languageCode,
    ...(input.countryCode ? { country: input.countryCode } : {}),
    freshness: 'd30',
  });

  if (!r.available) {
    return {
      status: 'unavailable',
      reason: r.reason ?? 'cse-unavailable',
      message: `Luma CSE unavailable: ${r.reason ?? 'unknown'}.`,
    };
  }

  const events: LumaEventHit[] = r.results.slice(0, input.limit).map(hit => ({
    id: hit.cacheId ?? hit.link,
    name: hit.title.replace(/\s+\| Luma$/i, '').trim(),
    url: hit.link,
    ...(hit.snippet ? { summary: hit.snippet } : {}),
    source: 'lu.ma' as const,
  }));

  return {
    status: 'ok',
    city: input.city,
    events,
    message:
      events.length === 0
        ? `No Luma events surfaced for ${input.city}.`
        : `${events.length} Luma events in ${input.city}.`,
  };
}

export const lumaEventDiscoveryTool: ToolDef<LumaEventDiscoveryInput, LumaEventDiscoveryResult> = {
  name: 'luma_event_discovery',
  internal: true,
  experimental: true,
  description:
    "Find Luma events in a city — founder, AI, web3, design, climate, private community events. Public discovery via CSE site:lu.ma (Luma's public API is calendar-scoped, not city-search). Use when traveler asks 'AI events in <city>', 'founder meetups', 'lu.ma <city>', 'startup events <city>'. Compose with `meetup_event_discovery` + `eventbrite_event_discovery` + accelerator/coworking CSE passes via `professional_networking_scanner`.",
  inputSchema,
  jsonSchema: {
    type: 'object',
    required: ['city'],
    properties: {
      city: { type: 'string', minLength: 1, maxLength: 120 },
      countryCode: { type: 'string', minLength: 2, maxLength: 2 },
      keywords: { type: 'string', maxLength: 200 },
      limit: { type: 'integer', minimum: 1, maximum: 15 },
      languageCode: { type: 'string', maxLength: 10 },
    },
  },
  handler: runLumaEventDiscovery,
};
