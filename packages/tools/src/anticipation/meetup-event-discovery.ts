/**
 * meetup_event_discovery — HP1 Tool 9 / 48.
 *
 * Spec: docs/specs/anticipatory-concierge.md §HP1 + roadmap §B2.
 *
 * Meetup's GraphQL API (api.meetup.com/gql) requires OAuth2 and is
 * primarily organizer-scoped. For public discovery we use CSE
 * site:meetup.com — same pattern as `luma_event_discovery` and
 * `eventbrite_event_discovery`.
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
  keywords: z.string().max(200).optional(),
  limit: z.number().int().min(1).max(15).default(8),
  languageCode: z.string().max(10).default('en'),
  /**
   * Whether to scope to events specifically (vs. groups). Default true —
   * `inurl:/events/` narrows CSE to event pages.
   */
  eventsOnly: z.boolean().default(true),
});

export type MeetupEventDiscoveryInput = z.infer<typeof inputSchema>;

export interface MeetupEventHit {
  id: string;
  name: string;
  url: string;
  groupName?: string;
  summary?: string;
  source: 'meetup.com';
}

export type MeetupEventDiscoveryResult =
  | { status: 'ok'; city: string; events: MeetupEventHit[]; message: string }
  | { status: 'production_refused'; message: string }
  | { status: 'unavailable'; reason: string; message: string };

export interface MeetupEventDiscoveryDeps {
  cse: typeof cseSearch;
}

export const liveDependencies: MeetupEventDiscoveryDeps = { cse: cseSearch };

/**
 * Meetup URLs follow `meetup.com/<group-slug>/events/<id>/` — extract
 * group slug + event id when available.
 */
function parseMeetupUrl(url: string): { groupSlug?: string; eventId?: string } {
  const m = /meetup\.com\/([^/]+)\/events\/(\d+)/i.exec(url);
  if (!m) return {};
  return { groupSlug: m[1], eventId: m[2] };
}

export async function runMeetupEventDiscovery(
  rawInput: MeetupEventDiscoveryInput,
  ctx?: ToolContext,
  deps: MeetupEventDiscoveryDeps = liveDependencies
): Promise<MeetupEventDiscoveryResult> {
  const gate = assertDevOnlyToolAllowed(ctx);
  if (gate.allowed === false) return { status: 'production_refused', message: gate.reason };

  const input = inputSchema.parse(rawInput);

  const inurl = input.eventsOnly ? 'inurl:/events/' : '';
  const q = [input.keywords, input.city, inurl].filter(Boolean).join(' ');
  const r = await deps.cse({
    query: q,
    site: 'meetup.com',
    limit: Math.min(input.limit, 10),
    lang: input.languageCode,
    ...(input.countryCode ? { country: input.countryCode } : {}),
    freshness: 'd30',
  });

  if (!r.available) {
    return {
      status: 'unavailable',
      reason: r.reason ?? 'cse-unavailable',
      message: `Meetup CSE unavailable: ${r.reason ?? 'unknown'}.`,
    };
  }

  const events: MeetupEventHit[] = r.results.slice(0, input.limit).map(hit => {
    const parsed = parseMeetupUrl(hit.link);
    return {
      id: parsed.eventId ?? hit.cacheId ?? hit.link,
      name: hit.title.replace(/\s+\| Meetup$/i, '').trim(),
      url: hit.link,
      ...(parsed.groupSlug ? { groupName: parsed.groupSlug.replace(/-/g, ' ') } : {}),
      ...(hit.snippet ? { summary: hit.snippet } : {}),
      source: 'meetup.com' as const,
    };
  });

  return {
    status: 'ok',
    city: input.city,
    events,
    message:
      events.length === 0
        ? `No Meetup events surfaced for ${input.city}.`
        : `${events.length} Meetup events in ${input.city}.`,
  };
}

export const meetupEventDiscoveryTool: ToolDef<
  MeetupEventDiscoveryInput,
  MeetupEventDiscoveryResult
> = {
  name: 'meetup_event_discovery',
  internal: true,
  experimental: true,
  description:
    "Find Meetup events in a city — local communities, language exchange, tech meetups, running / hiking / social groups. Public discovery via CSE site:meetup.com (Meetup's GraphQL API is OAuth2-gated and primarily for organizers). `eventsOnly=true` (default) narrows to event pages. Compose with `luma_event_discovery` + `eventbrite_event_discovery` via `professional_networking_scanner`.",
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
      eventsOnly: { type: 'boolean' },
    },
  },
  handler: runMeetupEventDiscovery,
};
