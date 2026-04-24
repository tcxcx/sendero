/**
 * airport_arrival_playbook — narrow traveler-facing artifact for
 * arrival. One-screen briefing the traveler can read while walking
 * off the plane: pickup plan, local timezone + first moves, risk
 * level, and a single obvious primary action.
 *
 * Composes airport_transfer_coordinator + timezone_brief. Keeps
 * outputs compact enough for curbside reading on a phone.
 */

import { z } from 'zod';

import {
  airportTransferCoordinator,
  type AirportTransferCoordinatorResult,
} from './airport-transfer-coordinator';
import { timezoneBrief, type TimezoneBriefResult } from './timezone-brief';
import type { ToolDef } from './types';

const inputSchema = z.object({
  airport: z.string().min(3),
  airportLatitude: z.number().optional(),
  airportLongitude: z.number().optional(),
  destinationLabel: z.string().optional(),
  destinationAddress: z.string().min(3),
  regionCode: z.string().optional(),
  languageCode: z.string().default('en'),
  arrivalTimeIso: z.string().optional(),
  travelerName: z.string().optional(),
  flightNumber: z.string().optional(),
  pnr: z.string().optional(),
  mode: z.enum(['driving', 'transit', 'walking']).default('driving'),
});

export type AirportArrivalPlaybookInput = z.infer<typeof inputSchema>;

export interface ArrivalStep {
  id: string;
  label: string;
  detail: string;
  href?: string;
}

export interface ArrivalContact {
  label: string;
  value: string;
  href?: string;
}

export interface AirportArrivalPlaybookResult {
  summary: string;
  headline: string;
  arrivalSteps: ArrivalStep[];
  contacts: ArrivalContact[];
  routeLinks: AirportTransferCoordinatorResult['routeLinks'];
  timezone?: TimezoneBriefResult;
  transfer: AirportTransferCoordinatorResult;
  share: {
    title: string;
    body: string;
    bullets: string[];
    primaryCta: { label: string; href: string };
    secondaryCtas: Array<{ label: string; href: string }>;
    mapLinks: { googleMapsUrl: string; appleMapsUrl: string; staticMapUrl?: string };
    whatsappUrl: string;
    slackMrkdwn: string;
  };
  staticMapUrl?: string;
  googleMapsUrl?: string;
  appleMapsUrl?: string;
}

function localTimeLabel(iso?: string): string | undefined {
  if (!iso) return undefined;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toISOString().slice(0, 16).replace('T', ' ');
}

export async function airportArrivalPlaybook(
  input: AirportArrivalPlaybookInput
): Promise<AirportArrivalPlaybookResult> {
  const transfer = await airportTransferCoordinator({
    airport: input.airport,
    airportLatitude: input.airportLatitude,
    airportLongitude: input.airportLongitude,
    destinationLabel: input.destinationLabel,
    destinationAddress: input.destinationAddress,
    regionCode: input.regionCode,
    languageCode: input.languageCode,
    arrivalTimeIso: input.arrivalTimeIso,
    mode: input.mode,
    includeSafety: true,
  });

  const tz = await timezoneBrief({
    latitude: transfer.airport.latitude,
    longitude: transfer.airport.longitude,
  }).catch(() => undefined);

  const destLabel = transfer.destination.label;
  const who = input.travelerName ? input.travelerName.split(' ')[0] : 'traveler';
  const flightLabel = [input.flightNumber, input.pnr ? `PNR ${input.pnr}` : undefined]
    .filter(Boolean)
    .join(' · ');

  const headline = `Arrival plan · ${input.airport} → ${destLabel}`;
  const tzName = tz?.timeZoneName ?? tz?.timeZoneId;
  const localArrival = localTimeLabel(input.arrivalTimeIso);

  const arrivalSteps: ArrivalStep[] = [
    {
      id: 'land',
      label: 'Land and clear immigration',
      detail: flightLabel
        ? `Confirm flight ${flightLabel}. Keep passport + arrival card in hand.`
        : 'Keep passport + arrival card in hand. Follow signs to immigration.',
    },
    {
      id: 'bags',
      label: 'Collect bags',
      detail:
        'Wait at the carousel for your flight. If a bag is missing, file at the airline desk before leaving the hall.',
    },
    {
      id: 'meet',
      label: transfer.pickupPlan.meetingPoint,
      detail: transfer.pickupPlan.meetingPointDetail,
    },
    {
      id: 'route',
      label: `Route to ${destLabel}`,
      detail: `Mode: ${transfer.pickupPlan.primaryMode}. Backup: ${transfer.backupTransport[0].label}.`,
      href: transfer.routeLinks.googleMapsUrl,
    },
    {
      id: 'checkin',
      label: 'Check in + first moves',
      detail:
        tzName && localArrival
          ? `Local time: ${localArrival} (${tzName}). Reset phone clock, grab water, confirm WiFi at the destination.`
          : 'Reset phone clock, grab water, confirm WiFi at the destination.',
    },
  ];

  const contacts: ArrivalContact[] = [];
  if (transfer.destination.formattedAddress) {
    contacts.push({
      label: destLabel,
      value: transfer.destination.formattedAddress,
      href: transfer.routeLinks.googleMapsUrl,
    });
  }
  const rideshareCta = transfer.share.secondaryCtas.find(c =>
    /uber|bolt|cabify|didi/i.test(c.label)
  );
  if (rideshareCta)
    contacts.push({ label: rideshareCta.label, value: 'rideshare app', href: rideshareCta.href });
  if (transfer.safety?.streetViewPreviewUrl) {
    contacts.push({
      label: 'Street view of destination',
      value: 'open',
      href: transfer.safety.streetViewPreviewUrl,
    });
  }

  const bullets = [
    `Meet at: ${transfer.pickupPlan.meetingPoint}`,
    `Sign text: ${transfer.pickupPlan.travelerSignText}`,
    transfer.safety ? `Destination risk: ${transfer.safety.riskLevel}` : '',
    flightLabel || '',
    localArrival ? `Local arrival: ${localArrival}${tzName ? ` (${tzName})` : ''}` : '',
    `Backup: ${transfer.backupTransport[0].label}`,
  ].filter(Boolean);

  const body = `${who.charAt(0).toUpperCase() + who.slice(1)}: follow the 5-step arrival plan. Primary ride is ${transfer.pickupPlan.primaryMode}. Route is already open.`;

  const shareText = [
    headline,
    body,
    '',
    ...arrivalSteps.map((s, i) => `${i + 1}. ${s.label} — ${s.detail}`),
    '',
    `Route: ${transfer.routeLinks.googleMapsUrl}`,
  ].join('\n');

  const slackMrkdwn = [
    `*${headline}*`,
    body,
    ...arrivalSteps.map((s, i) => `*${i + 1}. ${s.label}* — ${s.detail}`),
    `<${transfer.routeLinks.googleMapsUrl}|Open route>`,
  ].join('\n');

  return {
    summary: `${headline}. ${transfer.pickupPlan.meetingPoint}, sign "${transfer.pickupPlan.travelerSignText}".`,
    headline,
    arrivalSteps,
    contacts,
    routeLinks: transfer.routeLinks,
    timezone: tz,
    transfer,
    share: {
      title: headline,
      body,
      bullets,
      primaryCta: { label: 'Open route', href: transfer.routeLinks.googleMapsUrl },
      secondaryCtas: [
        { label: 'Apple Maps', href: transfer.routeLinks.appleMapsUrl },
        ...(rideshareCta ? [rideshareCta] : []),
      ],
      mapLinks: {
        googleMapsUrl: transfer.routeLinks.googleMapsUrl,
        appleMapsUrl: transfer.routeLinks.appleMapsUrl,
        staticMapUrl: transfer.routeLinks.staticMapUrl,
      },
      whatsappUrl: `https://wa.me/?text=${encodeURIComponent(shareText)}`,
      slackMrkdwn,
    },
    staticMapUrl: transfer.routeLinks.staticMapUrl,
    googleMapsUrl: transfer.routeLinks.googleMapsUrl,
    appleMapsUrl: transfer.routeLinks.appleMapsUrl,
  };
}

export const airportArrivalPlaybookTool: ToolDef<
  AirportArrivalPlaybookInput,
  AirportArrivalPlaybookResult
> = {
  name: 'airport_arrival_playbook',
  description:
    'Deliver a one-screen arrival briefing: 5-step playbook from deplane to check-in, primary + backup transport, local timezone, destination risk, and a ready route. Composes airport_transfer_coordinator + timezone_brief. Use right before or during landing.',
  inputSchema,
  jsonSchema: {
    type: 'object',
    required: ['airport', 'destinationAddress'],
    properties: {
      airport: { type: 'string' },
      airportLatitude: { type: 'number' },
      airportLongitude: { type: 'number' },
      destinationLabel: { type: 'string' },
      destinationAddress: { type: 'string' },
      regionCode: { type: 'string' },
      languageCode: { type: 'string', default: 'en' },
      arrivalTimeIso: { type: 'string' },
      travelerName: { type: 'string' },
      flightNumber: { type: 'string' },
      pnr: { type: 'string' },
      mode: {
        type: 'string',
        enum: ['driving', 'transit', 'walking'],
        default: 'driving',
      },
    },
  },
  handler: airportArrivalPlaybook,
};
