/**
 * professional_networking_scanner — HP1 Tool 10 / 50.
 *
 * Spec: docs/specs/anticipatory-concierge.md §HP1 + roadmap §B2 #50.
 *
 * Aggregator over `luma_event_discovery` + `meetup_event_discovery` +
 * `eventbrite_event_discovery` + a curated CSE pass scoped to
 * accelerator / coworking / VC newsletter domains. Returns ONE merged
 * list of pro-network-relevant events for a city.
 *
 * Source-of-truth queries (in parallel):
 *   1. lu.ma — founder / AI / web3 / design events
 *   2. meetup.com — startup / tech / language / pro communities
 *   3. eventbrite.com — community / professional / class events
 *   4. Curated accelerator + coworking + VC CSE pass
 *
 * Dedup: by URL prefix (host + first path segment when long enough).
 *
 * **Experimental** (`experimental: true`). Dev-only gate at handler-time.
 */

import { z } from 'zod';

import { cseSearch } from '@sendero/web-search';

import { assertDevOnlyToolAllowed } from '../dev-gate';
import type { ToolContext, ToolDef } from '../types';

import { runEventbriteEventDiscovery } from './eventbrite-event-discovery';
import { runLumaEventDiscovery } from './luma-event-discovery';
import { runMeetupEventDiscovery } from './meetup-event-discovery';

/** Curated accelerator + coworking + VC newsletter domains. */
const ACCELERATOR_DOMAINS = [
  'techstars.com',
  'ycombinator.com',
  'antler.co',
  'plugandplaytechcenter.com',
  'masschallenge.org',
  'endeavor.org',
  '500.co',
  'startupgrind.com',
  'wework.com',
  'impacthub.net',
  'talentgarden.org',
  'factoryberlin.com',
  'a16z.com',
  'firstround.com',
  'sequoiacap.com',
  'nfx.com',
  'lsvp.com',
  'indexventures.com',
  'generalcatalyst.com',
  'lennysnewsletter.com',
  'theinformation.com',
  'techcrunch.com',
  'sifted.eu',
  'eu-startups.com',
];

const inputSchema = z.object({
  city: z.string().min(1).max(120),
  countryCode: z.string().length(2).optional(),
  /**
   * Slot. 'founder' = startup-builder events (default).
   * 'ai' = AI/ML events. 'web3' = crypto. 'design' = product/design.
   * 'tech' = generic tech meetups. 'pro' = white-collar networking.
   */
  slot: z.enum(['founder', 'ai', 'web3', 'design', 'tech', 'pro']).default('founder'),
  perSourceLimit: z.number().int().min(1).max(8).default(4),
  totalLimit: z.number().int().min(1).max(25).default(15),
  languageCode: z.string().max(10).default('en'),
});

export type ProfessionalNetworkingScannerInput = z.infer<typeof inputSchema>;

export interface NetworkingEventHit {
  id: string;
  name: string;
  url: string;
  summary?: string;
  source: 'lu.ma' | 'meetup.com' | 'eventbrite_api' | 'cse' | 'accelerator';
}

export interface ProfessionalNetworkingScannerResult {
  status: 'ok' | 'unavailable' | 'production_refused';
  message: string;
  city?: string;
  slot?: string;
  events?: NetworkingEventHit[];
  bySource?: Record<string, number>;
}

// ── Deps ─────────────────────────────────────────────────────────────

export interface ProfessionalNetworkingScannerDeps {
  cse?: typeof cseSearch;
}

export const liveDependencies: ProfessionalNetworkingScannerDeps = { cse: cseSearch };

const SLOT_KEYWORDS: Record<ProfessionalNetworkingScannerInput['slot'], string[]> = {
  founder: ['founder', 'startup', 'demo day', 'builder'],
  ai: ['AI', 'machine learning', 'LLM', 'AI builders'],
  web3: ['web3', 'crypto', 'ethereum', 'blockchain'],
  design: ['design', 'product design', 'UX'],
  tech: ['tech meetup', 'developer'],
  pro: ['professional', 'networking', 'business'],
};

function pickKeyword(slot: ProfessionalNetworkingScannerInput['slot']): string {
  return SLOT_KEYWORDS[slot][0]!;
}

function urlSig(url: string): string {
  try {
    const u = new URL(url);
    const seg = u.pathname.split('/').filter(Boolean)[0] ?? '';
    return `${u.host}|${seg}`;
  } catch {
    return url;
  }
}

async function scanAccelerators(
  input: ProfessionalNetworkingScannerInput,
  cse: typeof cseSearch
): Promise<NetworkingEventHit[]> {
  // One CSE call per slot, spanning all accelerator/coworking domains via
  // the curated allowlist (CSE itself is curated). We scope by query
  // term + city; site-specific calls would burn quota fast.
  const q = `${pickKeyword(input.slot)} events ${input.city}`;
  const r = await cse({
    query: q,
    limit: 10,
    lang: input.languageCode,
    ...(input.countryCode ? { country: input.countryCode } : {}),
    freshness: 'd30',
  });
  if (!r.available) return [];
  return r.results
    .filter(h => ACCELERATOR_DOMAINS.some(d => h.displayLink.toLowerCase().includes(d)))
    .slice(0, input.perSourceLimit)
    .map(hit => ({
      id: hit.cacheId ?? hit.link,
      name: hit.title.trim(),
      url: hit.link,
      ...(hit.snippet ? { summary: hit.snippet } : {}),
      source: 'accelerator' as const,
    }));
}

export async function runProfessionalNetworkingScanner(
  rawInput: ProfessionalNetworkingScannerInput,
  ctx?: ToolContext,
  deps: ProfessionalNetworkingScannerDeps = liveDependencies
): Promise<ProfessionalNetworkingScannerResult> {
  const gate = assertDevOnlyToolAllowed(ctx);
  if (gate.allowed === false) return { status: 'production_refused', message: gate.reason };

  const input = inputSchema.parse(rawInput);
  const keyword = pickKeyword(input.slot);

  const lumaP = runLumaEventDiscovery(
    {
      city: input.city,
      keywords: keyword,
      limit: input.perSourceLimit,
      languageCode: input.languageCode,
      ...(input.countryCode ? { countryCode: input.countryCode } : {}),
    } as never,
    ctx
  );
  const meetupP = runMeetupEventDiscovery(
    {
      city: input.city,
      keywords: keyword,
      limit: input.perSourceLimit,
      languageCode: input.languageCode,
      ...(input.countryCode ? { countryCode: input.countryCode } : {}),
      eventsOnly: true,
    } as never,
    ctx
  );
  const eventbriteP = runEventbriteEventDiscovery(
    {
      city: input.city,
      keywords: keyword,
      limit: input.perSourceLimit,
      languageCode: input.languageCode,
      ...(input.countryCode ? { countryCode: input.countryCode } : {}),
    } as never,
    ctx
  );
  const acceleratorP = deps.cse
    ? scanAccelerators(input, deps.cse)
    : Promise.resolve([] as NetworkingEventHit[]);

  const [luma, meetup, eventbrite, accelerator] = await Promise.all([
    lumaP,
    meetupP,
    eventbriteP,
    acceleratorP,
  ]);

  const merged: NetworkingEventHit[] = [];
  if (luma.status === 'ok') merged.push(...luma.events);
  if (meetup.status === 'ok') merged.push(...meetup.events);
  if (eventbrite.status === 'ok') {
    merged.push(
      ...eventbrite.events.map(e => ({
        id: e.id,
        name: e.name,
        url: e.url,
        ...(e.summary ? { summary: e.summary } : {}),
        source: e.source,
      }))
    );
  }
  merged.push(...accelerator);

  // Dedup by URL signature.
  const seen = new Set<string>();
  const deduped: NetworkingEventHit[] = [];
  for (const e of merged) {
    const sig = urlSig(e.url);
    if (seen.has(sig)) continue;
    seen.add(sig);
    deduped.push(e);
    if (deduped.length >= input.totalLimit) break;
  }

  if (deduped.length === 0) {
    return {
      status: 'unavailable',
      message: `No networking events surfaced for ${input.city} (slot=${input.slot}). Sources: luma=${luma.status}, meetup=${meetup.status}, eventbrite=${eventbrite.status}, accelerator=${accelerator.length}.`,
    };
  }

  const bySource = deduped.reduce<Record<string, number>>((acc, e) => {
    acc[e.source] = (acc[e.source] ?? 0) + 1;
    return acc;
  }, {});

  return {
    status: 'ok',
    city: input.city,
    slot: input.slot,
    events: deduped,
    bySource,
    message: `${deduped.length} ${input.slot} events in ${input.city} across ${Object.keys(bySource).length} sources.`,
  };
}

export const professionalNetworkingScannerTool: ToolDef<
  ProfessionalNetworkingScannerInput,
  ProfessionalNetworkingScannerResult
> = {
  name: 'professional_networking_scanner',
  internal: true,
  experimental: true,
  description:
    "Aggregate networking-relevant events across Luma + Meetup + Eventbrite + curated accelerator / VC newsletter sources. Pick a `slot`: 'founder' (default — startup builders), 'ai', 'web3', 'design', 'tech' (generic dev meetups), 'pro' (white-collar networking). Use when the traveler asks 'founder events <city>', 'AI meetups this week', 'startup events', 'where do builders hang out in <city>'. Single high-level entry — composes the three event tools so the agent doesn't have to.",
  inputSchema,
  jsonSchema: {
    type: 'object',
    required: ['city'],
    properties: {
      city: { type: 'string', minLength: 1, maxLength: 120 },
      countryCode: { type: 'string', minLength: 2, maxLength: 2 },
      slot: { type: 'string', enum: ['founder', 'ai', 'web3', 'design', 'tech', 'pro'] },
      perSourceLimit: { type: 'integer', minimum: 1, maximum: 8 },
      totalLimit: { type: 'integer', minimum: 1, maximum: 25 },
      languageCode: { type: 'string', maxLength: 10 },
    },
  },
  handler: runProfessionalNetworkingScanner,
};
