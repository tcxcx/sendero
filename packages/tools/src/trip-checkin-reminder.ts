/**
 * trip_checkin_reminder — canonical, channel-safe reminder around
 * check-in timing and airport movement. This is the tool the
 * existing `sendero.check_in_reminder` workflow calls after fetching
 * booking data — one tool, one JSON result, no parallel system.
 *
 * Composes `timezone_brief` (when coords are provided) and optionally
 * `export_route_map` (when a stay origin is provided) into a compact
 * nudge ready for WhatsApp, Slack, or web chat.
 */

import { z } from 'zod';

import { exportRouteMap, type ExportRouteMapResult } from './export-route-map';
import { timezoneBrief, type TimezoneBriefResult } from './timezone-brief';
import type { ToolDef, ToolContext } from './types';

const inputSchema = z.object({
  pnr: z.string().min(3).optional(),
  flightNumber: z.string().optional(),
  carrier: z.string().optional(),
  origin: z.string().length(3).describe('IATA of the departure airport, e.g. SFO.'),
  destination: z.string().length(3).optional(),
  departureDateTimeIso: z
    .string()
    .describe('Scheduled departure in ISO 8601 (with timezone offset if known).'),
  airportLatitude: z.number().optional(),
  airportLongitude: z.number().optional(),
  stayLabel: z.string().optional(),
  stayAddress: z.string().optional(),
  stayLatitude: z.number().optional(),
  stayLongitude: z.number().optional(),
  transferMode: z.enum(['driving', 'transit']).default('driving'),
  travelerName: z.string().optional(),
  checkInWindowHours: z
    .number()
    .int()
    .min(1)
    .max(72)
    .default(24)
    .describe('Hours before departure that online check-in opens.'),
  language: z.string().default('en'),
});

export type TripCheckinReminderInput = z.infer<typeof inputSchema>;

export interface CheckInWindow {
  opensAtIso: string;
  closesAtIso: string;
  /** Minutes before departure when counter/gate closes. */
  gateCloseMinutesBeforeDeparture: number;
}

export interface TripCheckinReminderResult {
  summary: string;
  checkInWindow: CheckInWindow;
  airportTransitNote: string;
  nextAction: { label: string; kind: 'check_in' | 'leave_for_airport' | 'reply'; href?: string };
  headline: string;
  timezone?: TimezoneBriefResult;
  route?: {
    googleMapsUrl: string;
    appleMapsUrl: string;
    staticMapUrl?: string;
    leaveByIso: string;
  };
  share: {
    title: string;
    body: string;
    bullets: string[];
    primaryCta: {
      label: string;
      href?: string;
      kind: TripCheckinReminderResult['nextAction']['kind'];
    };
    secondaryCtas: Array<{ label: string; href: string }>;
    mapLinks?: { googleMapsUrl: string; appleMapsUrl: string; staticMapUrl?: string };
    whatsappUrl: string;
    slackMrkdwn: string;
  };
  staticMapUrl?: string;
  googleMapsUrl?: string;
  appleMapsUrl?: string;
}

function fmtShort(iso: string, tzName?: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const base = d.toISOString().slice(0, 16).replace('T', ' ');
  return tzName ? `${base} (${tzName})` : `${base} UTC`;
}

function hoursUntil(iso: string, nowMs: number): number {
  const d = new Date(iso).getTime();
  return (d - nowMs) / (60 * 60 * 1000);
}

function airlineCheckInHref(carrier?: string): string {
  if (!carrier) return 'https://www.google.com/search?q=airline+online+check-in';
  return `https://www.google.com/search?q=${encodeURIComponent(`${carrier} online check-in`)}`;
}

function leaveByIso(departureIso: string, transferModeMinutes: number, bufferMinutes = 90): string {
  const d = new Date(departureIso).getTime();
  const leaveAt = d - (bufferMinutes + transferModeMinutes) * 60_000;
  return new Date(leaveAt).toISOString();
}

export async function tripCheckinReminder(
  input: TripCheckinReminderInput,
  ctx?: ToolContext
): Promise<TripCheckinReminderResult> {
  const travelerName = input.travelerName ?? ctx?.traveler?.name;
  const now = Date.now();
  const departureMs = new Date(input.departureDateTimeIso).getTime();
  if (Number.isNaN(departureMs)) {
    throw new Error(`Invalid departureDateTimeIso: ${input.departureDateTimeIso}`);
  }

  const opensAtIso = new Date(departureMs - input.checkInWindowHours * 60 * 60_000).toISOString();
  const closesAtIso = new Date(departureMs - 60 * 60_000).toISOString();
  const window: CheckInWindow = {
    opensAtIso,
    closesAtIso,
    gateCloseMinutesBeforeDeparture: 20,
  };

  const tz =
    typeof input.airportLatitude === 'number' && typeof input.airportLongitude === 'number'
      ? await timezoneBrief({
          latitude: input.airportLatitude,
          longitude: input.airportLongitude,
        }).catch(() => undefined)
      : undefined;

  const hasStay =
    Boolean(input.stayAddress) ||
    (typeof input.stayLatitude === 'number' && typeof input.stayLongitude === 'number');
  const hasAirport =
    typeof input.airportLatitude === 'number' && typeof input.airportLongitude === 'number';

  let route: ExportRouteMapResult | undefined;
  if (hasStay && hasAirport) {
    route = await exportRouteMap({
      title: `${input.stayLabel ?? 'Stay'} → ${input.origin}`,
      stops: [
        {
          label: input.stayLabel ?? 'Stay',
          address: input.stayAddress,
          latitude: input.stayLatitude,
          longitude: input.stayLongitude,
        },
        {
          label: input.origin,
          address: input.origin,
          latitude: input.airportLatitude!,
          longitude: input.airportLongitude!,
        },
      ],
      mode: input.transferMode,
      channel: 'web',
      includeStaticMap: true,
    });
  }

  const transferBufferMinutes = input.transferMode === 'transit' ? 60 : 35;
  const leaveBy = leaveByIso(input.departureDateTimeIso, transferBufferMinutes);
  const hoursOut = hoursUntil(input.departureDateTimeIso, now);
  const hoursUntilLeave = hoursUntil(leaveBy, now);

  const tzName = tz?.timeZoneName ?? tz?.timeZoneId;
  const headline = travelerName
    ? `${travelerName.split(' ')[0]}: check-in for ${input.origin}${input.destination ? ` → ${input.destination}` : ''}`
    : `Check-in for ${input.origin}${input.destination ? ` → ${input.destination}` : ''}`;

  const airportTransitNote = route
    ? `Leave ${input.stayLabel ?? 'your stay'} by ${fmtShort(leaveBy, tzName)} via ${input.transferMode} to ${input.origin}.`
    : tzName
      ? `Departure ${fmtShort(input.departureDateTimeIso, tzName)}. Gate closes ~${window.gateCloseMinutesBeforeDeparture}min before.`
      : `Departure ${fmtShort(input.departureDateTimeIso)}. Gate closes ~${window.gateCloseMinutesBeforeDeparture}min before.`;

  const needsToLeaveSoon = hoursUntilLeave < 3;
  const nextAction: TripCheckinReminderResult['nextAction'] = needsToLeaveSoon
    ? {
        label: route ? 'Leave for airport' : 'Leave for airport soon',
        kind: 'leave_for_airport',
        href: route?.googleMapsUrl,
      }
    : hoursOut <= input.checkInWindowHours
      ? { label: 'Check in now', kind: 'check_in', href: airlineCheckInHref(input.carrier) }
      : { label: 'Reply if anything changes', kind: 'reply' };

  const bullets = [
    `Check-in window: ${fmtShort(opensAtIso, tzName)} → ${fmtShort(closesAtIso, tzName)}`,
    `Gate closes ~${window.gateCloseMinutesBeforeDeparture}min before departure`,
    input.pnr ? `PNR: ${input.pnr}` : '',
    input.flightNumber ? `Flight: ${input.flightNumber}` : '',
    airportTransitNote,
  ].filter(Boolean);

  const body = needsToLeaveSoon
    ? `Leave now. ${airportTransitNote}`
    : hoursOut <= input.checkInWindowHours
      ? `Online check-in is open. ${airportTransitNote}`
      : `Online check-in opens ${fmtShort(opensAtIso, tzName)}. ${airportTransitNote}`;

  const shareText = [
    headline,
    body,
    '',
    ...bullets.map(b => `• ${b}`),
    route ? `\nRoute: ${route.googleMapsUrl}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const slackMrkdwn = [
    `*${headline}*`,
    body,
    ...bullets.map(b => `• ${b}`),
    route ? `<${route.googleMapsUrl}|Route to airport>` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const summary = `${headline}. ${body}`;

  return {
    summary,
    checkInWindow: window,
    airportTransitNote,
    nextAction,
    headline,
    timezone: tz,
    route: route
      ? {
          googleMapsUrl: route.googleMapsUrl,
          appleMapsUrl: route.appleMapsUrl,
          staticMapUrl: route.staticMapUrl,
          leaveByIso: leaveBy,
        }
      : undefined,
    share: {
      title: headline,
      body,
      bullets,
      primaryCta: { label: nextAction.label, href: nextAction.href, kind: nextAction.kind },
      secondaryCtas: route
        ? [
            { label: 'Apple Maps', href: route.appleMapsUrl },
            ...(nextAction.kind === 'leave_for_airport'
              ? [{ label: 'Check in', href: airlineCheckInHref(input.carrier) }]
              : []),
          ]
        : [],
      mapLinks: route
        ? {
            googleMapsUrl: route.googleMapsUrl,
            appleMapsUrl: route.appleMapsUrl,
            staticMapUrl: route.staticMapUrl,
          }
        : undefined,
      whatsappUrl: `https://wa.me/?text=${encodeURIComponent(shareText)}`,
      slackMrkdwn,
    },
    staticMapUrl: route?.staticMapUrl,
    googleMapsUrl: route?.googleMapsUrl,
    appleMapsUrl: route?.appleMapsUrl,
  };
}

export const tripCheckinReminderTool: ToolDef<TripCheckinReminderInput, TripCheckinReminderResult> =
  {
    name: 'trip_checkin_reminder',
    description:
      'Generate the canonical trip check-in nudge: check-in window, airport transit note, leave-by time, and one obvious next action. Composes timezone_brief and (when stay coordinates are provided) export_route_map. Returns a WhatsApp/Slack-ready share shape. This is the tool the sendero.check_in_reminder workflow calls.',
    inputSchema,
    jsonSchema: {
      type: 'object',
      required: ['origin', 'departureDateTimeIso'],
      properties: {
        pnr: { type: 'string' },
        flightNumber: { type: 'string' },
        carrier: { type: 'string' },
        origin: { type: 'string', minLength: 3, maxLength: 3 },
        destination: { type: 'string', minLength: 3, maxLength: 3 },
        departureDateTimeIso: { type: 'string', description: 'ISO 8601 departure time.' },
        airportLatitude: { type: 'number' },
        airportLongitude: { type: 'number' },
        stayLabel: { type: 'string' },
        stayAddress: { type: 'string' },
        stayLatitude: { type: 'number' },
        stayLongitude: { type: 'number' },
        transferMode: { type: 'string', enum: ['driving', 'transit'], default: 'driving' },
        travelerName: { type: 'string' },
        checkInWindowHours: {
          type: 'integer',
          minimum: 1,
          maximum: 72,
          default: 24,
        },
        language: { type: 'string', default: 'en' },
      },
    },
    handler: tripCheckinReminder,
  };
