/**
 * B2 close-out — the 3 remaining tools after `professional_networking_scanner`:
 *
 *   - coworking_event_calendar_scanner       B2 #52
 *   - university_entrepreneurship_event_scanner B2 #54
 *   - networking_intro_strategy              B2 #56
 *
 * The first two are CSE-scoped to curated coworking / accelerator
 * domains. The third is pure: given an event description, returns
 * tasteful intro-strategy advice (analog of `date_game_tips`, but for
 * professional networking).
 *
 * All experimental + internal + dev-gated.
 */

import { z } from 'zod';

import { cseSearch } from '@sendero/web-search';

import { assertDevOnlyToolAllowed } from '../dev-gate';
import type { ToolContext, ToolDef } from '../types';

// Curated lists from the roadmap §B2 source seeds.
const COWORKING_DOMAINS = [
  'wework.com',
  'impacthub.net',
  'talentgarden.org',
  'factoryberlin.com',
  'lamaquinita.co',
  'urbanstation.com',
  'soho.house',
  'theassemblage.com',
];

const UNIVERSITY_DOMAINS = [
  'ecorner.stanford.edu',
  'innovationlabs.harvard.edu',
  'entrepreneurship.mit.edu',
  'calendar.mit.edu',
  'skydeck.berkeley.edu',
  'entrepreneurship.columbia.edu',
  'entrepreneur.nyu.edu',
  'jbs.cam.ac.uk',
  'lse.ac.uk',
  'ie.edu',
  'esade.edu',
];

const baseInput = z.object({
  city: z.string().min(1).max(120),
  countryCode: z.string().length(2).optional(),
  keywords: z.string().max(200).optional(),
  limit: z.number().int().min(1).max(15).default(8),
  languageCode: z.string().max(10).default('en'),
});
type BaseInput = z.infer<typeof baseInput>;

interface ScannerEventHit {
  id: string;
  name: string;
  url: string;
  summary?: string;
  source: string;
}

interface ScannerOk {
  status: 'ok';
  city: string;
  events: ScannerEventHit[];
  message: string;
}
interface ScannerRefused {
  status: 'production_refused';
  message: string;
}
interface ScannerUnavailable {
  status: 'unavailable';
  reason: string;
  message: string;
}
type ScannerResult = ScannerOk | ScannerRefused | ScannerUnavailable;

async function runDomainScopedScan(
  input: BaseInput,
  domains: string[],
  scopeLabel: string,
  ctx?: ToolContext
): Promise<ScannerResult> {
  const gate = assertDevOnlyToolAllowed(ctx);
  if (gate.allowed === false) return { status: 'production_refused', message: gate.reason };

  // Single-pass scan with the full keyword query against the curated
  // CSE allowlist. Filter results client-side to the curated domain
  // set so we surface only the intended sources.
  const keywords = [input.keywords, input.city, 'events'].filter(Boolean).join(' ');
  const r = await cseSearch({
    query: keywords,
    limit: 10,
    lang: input.languageCode,
    ...(input.countryCode ? { country: input.countryCode } : {}),
    freshness: 'd30',
  });
  if (!r.available) {
    return {
      status: 'unavailable',
      reason: r.reason ?? 'cse-unavailable',
      message: `CSE unavailable: ${r.reason ?? 'unknown'}.`,
    };
  }
  const filtered = r.results.filter(hit =>
    domains.some(d => hit.displayLink.toLowerCase().includes(d))
  );
  if (filtered.length === 0) {
    return {
      status: 'ok',
      city: input.city,
      events: [],
      message: `No ${scopeLabel} events surfaced for ${input.city} this month.`,
    };
  }
  return {
    status: 'ok',
    city: input.city,
    events: filtered.slice(0, input.limit).map(hit => ({
      id: hit.cacheId ?? hit.link,
      name: hit.title.trim(),
      url: hit.link,
      ...(hit.snippet ? { summary: hit.snippet } : {}),
      source: hit.displayLink,
    })),
    message: `${filtered.length} ${scopeLabel} events in ${input.city}.`,
  };
}

const coworkingEventCalendarScannerTool: ToolDef<BaseInput, ScannerResult> = {
  name: 'coworking_event_calendar_scanner',
  internal: true,
  experimental: true,
  description:
    "Scan coworking-space event calendars in a city — WeWork, Impact Hub, Talent Garden, Factory Berlin, La Maquinita, Urban Station, Soho House. Same shape as the curated networking scanners. Use when the traveler is a digital nomad asking 'what's happening at WeWork <city>' or 'coworking events <city> this week'.",
  inputSchema: baseInput,
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
  handler: (input, ctx) => runDomainScopedScan(input, COWORKING_DOMAINS, 'coworking', ctx),
};

const universityEntrepreneurshipEventScannerTool: ToolDef<BaseInput, ScannerResult> = {
  name: 'university_entrepreneurship_event_scanner',
  internal: true,
  experimental: true,
  description:
    'Scan university entrepreneurship-center event calendars — Stanford eCorner, Harvard Innovation Labs, MIT Entrepreneurship + calendar, Berkeley SkyDeck, Columbia Entrepreneurship, NYU Entrepreneur, Cambridge JBS, LSE, IE Madrid, Esade. Use when the traveler is in a university town and wants pitch nights / lecture series / VC panels.',
  inputSchema: baseInput,
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
  handler: (input, ctx) =>
    runDomainScopedScan(input, UNIVERSITY_DOMAINS, 'university entrepreneurship', ctx),
};

// ─────────────────────────────────────────────────────────────────────
// networking_intro_strategy — pure, no external API.
// Given an event descriptor + traveler hints, returns tasteful advice.
// ─────────────────────────────────────────────────────────────────────

const introStrategyInput = z.object({
  event: z.object({
    name: z.string().min(1).max(200),
    kind: z.enum([
      'demo_day',
      'panel',
      'meetup',
      'happy_hour',
      'pitch_night',
      'breakfast',
      'workshop',
      'mixer',
      'conference',
      'private_dinner',
    ]),
    cityKnown: z.string().max(120).optional(),
    expectedAttendance: z.enum(['under_30', '30_to_100', '100_to_300', '300_plus']).optional(),
    attendeeProfile: z.string().max(200).optional(),
  }),
  travelerProfile: z.object({
    role: z
      .enum(['founder', 'engineer', 'designer', 'investor', 'operator', 'student', 'other'])
      .default('founder'),
    isFirstTime: z.boolean().default(false),
    extroversion: z.enum(['low', 'medium', 'high']).default('medium'),
    /** Specific outcome the traveler wants. Drives the advice tilt. */
    desiredOutcome: z
      .enum([
        'hire',
        'fundraise',
        'learn',
        'hire_or_fundraise',
        'social',
        'recruit_customers',
        'none',
      ])
      .default('learn'),
  }),
});
type IntroStrategyInput = z.infer<typeof introStrategyInput>;

interface IntroStrategy {
  worthAttending: 'yes' | 'maybe' | 'pass';
  worthAttendingReason: string;
  arrivalTiming: string;
  introOpener: string;
  whoToTalkTo: string[];
  whatToBring: string[];
  exitStrategy: string;
  followUpRule: string;
}

async function runNetworkingIntroStrategy(
  rawInput: IntroStrategyInput,
  ctx?: ToolContext
): Promise<{ status: 'ok' | 'production_refused'; message: string; strategy?: IntroStrategy }> {
  const gate = assertDevOnlyToolAllowed(ctx);
  if (gate.allowed === false) return { status: 'production_refused', message: gate.reason };

  const input = introStrategyInput.parse(rawInput);
  const e = input.event;
  const t = input.travelerProfile;

  // Worth attending heuristic.
  let worth: IntroStrategy['worthAttending'] = 'maybe';
  let worthReason = '';
  if (e.kind === 'demo_day' && (t.desiredOutcome === 'fundraise' || t.desiredOutcome === 'learn')) {
    worth = 'yes';
    worthReason = 'Demo days have explicit deal-making energy — go.';
  } else if (
    e.kind === 'mixer' &&
    e.expectedAttendance === '300_plus' &&
    t.extroversion === 'low'
  ) {
    worth = 'pass';
    worthReason =
      '300+ mixers are the worst ROI for low-extroversion travelers — find a smaller event.';
  } else if (e.kind === 'happy_hour' && t.desiredOutcome === 'fundraise') {
    worth = 'maybe';
    worthReason =
      'Happy hours are weak for fundraise asks — better to set up a coffee with a target investor.';
  } else if (e.kind === 'private_dinner') {
    worth = 'yes';
    worthReason = 'Private dinners are high-signal — every attendee is curated.';
  } else if (e.kind === 'workshop' && t.desiredOutcome === 'learn') {
    worth = 'yes';
    worthReason = 'Workshops give you something to talk about beyond the elevator pitch.';
  } else {
    worthReason = `${e.kind} events are usually worth showing up to with a clear outcome in mind.`;
  }

  // Arrival timing.
  const arrivalTiming = (() => {
    if (e.kind === 'demo_day' || e.kind === 'panel' || e.kind === 'workshop')
      return "Arrive 5 minutes early — the agenda is the point. Don't walk in mid-pitch.";
    if (e.kind === 'happy_hour' || e.kind === 'mixer')
      return "Arrive 20-30 minutes after start. Earlier is awkward; later you've missed the introduction phase.";
    if (e.kind === 'pitch_night')
      return 'Arrive 10 minutes early. Find a spot near the back so you can step out between pitches if needed.';
    if (e.kind === 'private_dinner')
      return 'Arrive on time exactly. Hosts notice both early and late.';
    if (e.kind === 'breakfast') return 'Arrive 10 minutes early — breakfast crowds dissipate fast.';
    return 'Arrive 10-15 minutes after start time.';
  })();

  // Intro opener.
  const introOpener = (() => {
    if (t.isFirstTime)
      return '"This is my first time at one of these — what brought you here?" Honest disclosure beats canned pitches.';
    if (t.desiredOutcome === 'fundraise')
      return '"I work on [one-line product]. Curious what people are building / investing in lately." Soft entry — never lead with the ask.';
    if (t.desiredOutcome === 'hire' || t.desiredOutcome === 'hire_or_fundraise')
      return "\"What's the most interesting thing you're working on right now?\" Listen first, then volunteer that you're hiring.";
    if (t.desiredOutcome === 'learn')
      return '"What brought you here tonight?" — then follow whatever thread they pick.';
    return '"What brought you here?" — works in 90% of cases.';
  })();

  // Who to talk to.
  const whoToTalkTo: string[] = [];
  whoToTalkTo.push("Someone standing alone — they're relieved when you walk over.");
  whoToTalkTo.push('Two people not in deep conversation — say "mind if I join?" and listen first.');
  if (t.desiredOutcome === 'fundraise')
    whoToTalkTo.push(
      "Anyone wearing the host org's lanyard — they tend to know who's actively writing checks."
    );
  if (t.desiredOutcome === 'hire')
    whoToTalkTo.push('People asking thoughtful questions during Q&A — recruit them.');

  // What to bring.
  const whatToBring: string[] = [];
  if (e.kind === 'demo_day' || e.kind === 'pitch_night')
    whatToBring.push('Phone with the pitch deck on Drive (open in browser, not Keynote).');
  whatToBring.push('Two pens.');
  whatToBring.push(
    "A small notebook — write down what you want to remember about each conversation while it's fresh."
  );
  if (t.desiredOutcome !== 'social')
    whatToBring.push('A 1-line bio: "I work on X" — practiced enough to deliver in 5 seconds.');
  if (e.kind === 'private_dinner' || e.kind === 'breakfast')
    whatToBring.push(
      'A small thank-you for the host — book / wine / chocolate from your home country travels well.'
    );

  // Exit strategy.
  const exitStrategy = (() => {
    if (e.kind === 'demo_day' || e.kind === 'pitch_night')
      return "Leave 15 minutes after the formal program ends. Quality conversations don't happen at minute 90.";
    if (e.kind === 'happy_hour' || e.kind === 'mixer')
      return "Set yourself a 90-minute limit. If you haven't had two real conversations by then, the room isn't for you tonight.";
    return 'Leave when energy dips — not when the event "officially" ends.';
  })();

  const followUpRule =
    'Send a one-line follow-up within 24h. Reference one specific thing from the conversation. Never paste the same template — feels like spam.';

  return {
    status: 'ok',
    strategy: {
      worthAttending: worth,
      worthAttendingReason: worthReason,
      arrivalTiming,
      introOpener,
      whoToTalkTo,
      whatToBring,
      exitStrategy,
      followUpRule,
    },
    message: `Strategy for ${e.name} (${e.kind}, outcome=${t.desiredOutcome}): ${worth.toUpperCase()} — ${worthReason}`,
  };
}

const networkingIntroStrategyTool: ToolDef = {
  name: 'networking_intro_strategy',
  internal: true,
  description:
    'Practical advice for a specific networking event — worth attending? what time to arrive? whom to talk to? what to bring? when to leave? Pure tool, no external API. Pair with `professional_networking_scanner` (or its B2 cousins) to give the traveler the *strategy*, not just the *list*.',
  inputSchema: introStrategyInput,
  jsonSchema: {
    type: 'object',
    required: ['event', 'travelerProfile'],
    properties: {
      event: {
        type: 'object',
        required: ['name', 'kind'],
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 200 },
          kind: {
            type: 'string',
            enum: [
              'demo_day',
              'panel',
              'meetup',
              'happy_hour',
              'pitch_night',
              'breakfast',
              'workshop',
              'mixer',
              'conference',
              'private_dinner',
            ],
          },
          cityKnown: { type: 'string', maxLength: 120 },
          expectedAttendance: {
            type: 'string',
            enum: ['under_30', '30_to_100', '100_to_300', '300_plus'],
          },
          attendeeProfile: { type: 'string', maxLength: 200 },
        },
      },
      travelerProfile: {
        type: 'object',
        properties: {
          role: {
            type: 'string',
            enum: ['founder', 'engineer', 'designer', 'investor', 'operator', 'student', 'other'],
          },
          isFirstTime: { type: 'boolean' },
          extroversion: { type: 'string', enum: ['low', 'medium', 'high'] },
          desiredOutcome: {
            type: 'string',
            enum: [
              'hire',
              'fundraise',
              'learn',
              'hire_or_fundraise',
              'social',
              'recruit_customers',
              'none',
            ],
          },
        },
      },
    },
  },
  handler: runNetworkingIntroStrategy,
};

export {
  coworkingEventCalendarScannerTool,
  universityEntrepreneurshipEventScannerTool,
  networkingIntroStrategyTool,
  runNetworkingIntroStrategy,
};
