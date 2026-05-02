/**
 * airport_transfer_coordinator — turn arrival details into a pickup
 * plan with meeting-point confidence and backup transport.
 *
 * Composes `geocode_trip_stop` (for the airport), `validate_travel_address`
 * (for the destination), `export_route_map` (for the airport→destination
 * leg), and `travel_safety_aid` (destination risk) into a single
 * canonical artifact. No new external APIs.
 */

import { z } from 'zod';

import { exportRouteMap } from './export-route-map';
import { geocodeTripStop } from './geocode-trip-stop';
import { type TravelSafetyAidResult, travelSafetyAid } from './travel-safety-aid';
import type { ToolDef } from './types';
import { validateTravelAddress } from './validate-travel-address';

const inputSchema = z.object({
  airport: z
    .string()
    .min(3)
    .describe('IATA code, airport name, or free-form text (e.g. "EZE", "Charles de Gaulle").'),
  airportLatitude: z.number().optional(),
  airportLongitude: z.number().optional(),
  destinationLabel: z
    .string()
    .optional()
    .describe('Short label for the destination, e.g. "Hotel Park Hyatt".'),
  destinationAddress: z.string().min(3),
  regionCode: z.string().optional(),
  languageCode: z.string().default('en'),
  arrivalTimeIso: z
    .string()
    .optional()
    .describe('Planned flight arrival in ISO 8601. Used for timing hints in the share copy.'),
  travelerCount: z.number().int().min(1).max(12).default(1),
  mode: z.enum(['driving', 'transit', 'walking']).default('driving'),
  includeSafety: z.boolean().default(true),
});

export type AirportTransferCoordinatorInput = z.infer<typeof inputSchema>;

export interface TransferLeg {
  from: string;
  to: string;
  mode: AirportTransferCoordinatorInput['mode'];
  googleMapsUrl: string;
  appleMapsUrl: string;
  staticMapUrl?: string;
}

export interface PickupPlan {
  meetingPoint: string;
  meetingPointDetail: string;
  primaryMode: AirportTransferCoordinatorInput['mode'];
  arrivalHint?: string;
  travelerSignText: string;
}

export interface BackupTransport {
  mode: 'rideshare' | 'airport_taxi' | 'transit' | 'hotel_shuttle';
  label: string;
  note: string;
  href?: string;
}

export interface AirportTransferCoordinatorResult {
  summary: string;
  pickupPlan: PickupPlan;
  backupTransport: BackupTransport[];
  routeLinks: TransferLeg;
  airport: {
    query: string;
    formattedAddress?: string;
    latitude: number;
    longitude: number;
  };
  destination: {
    label: string;
    formattedAddress?: string;
    latitude?: number;
    longitude?: number;
    placeId?: string;
    verified: boolean;
  };
  safety?: TravelSafetyAidResult;
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
  // Top-level fields so existing ToolPreview picks up the map preview.
  staticMapUrl?: string;
  googleMapsUrl?: string;
  appleMapsUrl?: string;
}

const RIDESHARE_BY_REGION: Record<string, { label: string; href: string }> = {
  US: { label: 'Uber / Lyft curbside', href: 'https://m.uber.com/' },
  AR: { label: 'Cabify or Uber', href: 'https://cabify.com/' },
  BR: { label: '99 or Uber', href: 'https://99app.com/' },
  MX: { label: 'Uber or DiDi', href: 'https://m.uber.com/' },
  GB: { label: 'Uber or Bolt', href: 'https://m.uber.com/' },
  FR: { label: 'Uber or Bolt', href: 'https://m.uber.com/' },
  ES: { label: 'Cabify or FreeNow', href: 'https://cabify.com/' },
  JP: { label: 'Go or Uber Premier', href: 'https://go.mo-t.com/' },
};

function ridesharePick(regionCode?: string) {
  if (!regionCode)
    return { label: 'Rideshare (Uber / Bolt / Cabify)', href: 'https://m.uber.com/' };
  return (
    RIDESHARE_BY_REGION[regionCode.toUpperCase()] ?? {
      label: 'Rideshare (Uber / Bolt / Cabify)',
      href: 'https://m.uber.com/',
    }
  );
}

function arrivalHint(iso?: string): string | undefined {
  if (!iso) return undefined;
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return undefined;
    return `Flight arrives ${d.toISOString().slice(0, 16).replace('T', ' ')} UTC.`;
  } catch {
    // expected — invalid or unparseable ISO string
    return undefined;
  }
}

export async function airportTransferCoordinator(
  input: AirportTransferCoordinatorInput
): Promise<AirportTransferCoordinatorResult> {
  const hasAirportCoords =
    typeof input.airportLatitude === 'number' && typeof input.airportLongitude === 'number';

  const [airportStop, destValidation] = await Promise.all([
    hasAirportCoords
      ? Promise.resolve({
          formattedAddress: input.airport,
          latitude: input.airportLatitude!,
          longitude: input.airportLongitude!,
          placeId: undefined,
        })
      : geocodeTripStop({
          address: input.airport,
          languageCode: input.languageCode,
          regionCode: input.regionCode,
        }),
    validateTravelAddress({
      addressLines: [input.destinationAddress],
      regionCode: input.regionCode,
    }),
  ]);

  const destLabel =
    input.destinationLabel ?? destValidation.formattedAddress ?? input.destinationAddress;
  const destLat = destValidation.latitude;
  const destLng = destValidation.longitude;

  const [route, safety] = await Promise.all([
    exportRouteMap({
      title: `${input.airport} → ${destLabel}`,
      stops: [
        {
          label: input.airport,
          latitude: airportStop.latitude,
          longitude: airportStop.longitude,
          address: airportStop.formattedAddress ?? input.airport,
          placeId: airportStop.placeId,
        },
        {
          label: destLabel,
          address: destValidation.formattedAddress ?? input.destinationAddress,
          latitude: destLat,
          longitude: destLng,
          placeId: destValidation.placeId,
        },
      ],
      mode: input.mode,
      channel: 'web',
      includeStaticMap: true,
    }),
    input.includeSafety && typeof destLat === 'number' && typeof destLng === 'number'
      ? travelSafetyAid({
          latitude: destLat,
          longitude: destLng,
          addressLines: [input.destinationAddress],
          regionCode: input.regionCode,
          languageCode: input.languageCode,
        })
      : Promise.resolve<TravelSafetyAidResult | undefined>(undefined),
  ]);

  const rideshare = ridesharePick(input.regionCode);
  const pickup: PickupPlan = {
    meetingPoint:
      input.mode === 'transit'
        ? `${input.airport} airport transit hub`
        : `${input.airport} arrivals curbside`,
    meetingPointDetail:
      input.mode === 'transit'
        ? 'Follow signs to the airport train / express coach. Keep the route link open — directions include the platform.'
        : 'After baggage claim, exit to arrivals curbside. Rideshare pickup is on the designated rideshare lane.',
    primaryMode: input.mode,
    arrivalHint: arrivalHint(input.arrivalTimeIso),
    travelerSignText: `Sendero · ${destLabel}`,
  };

  const backupTransport: BackupTransport[] = [
    {
      mode: 'rideshare',
      label: rideshare.label,
      note: 'Summon from the rideshare pickup zone. Share the destination label from this card.',
      href: rideshare.href,
    },
    {
      mode: 'airport_taxi',
      label: 'Official airport taxi rank',
      note: 'Fixed-rate or metered, always at the designated airport taxi line. Avoid unsolicited drivers.',
    },
    {
      mode: 'transit',
      label: 'Airport express / regional rail',
      note: 'Cheapest option for central destinations when luggage is manageable.',
    },
    {
      mode: 'hotel_shuttle',
      label: 'Hotel shuttle (if available)',
      note: 'Call the hotel after landing; many properties run a complimentary van on request.',
    },
  ];

  const title = `${input.airport} → ${destLabel}`;
  const bullets: string[] = [
    `Primary: ${pickup.primaryMode} · ${pickup.meetingPoint}`,
    `Sign text: ${pickup.travelerSignText}`,
    `Backup: ${backupTransport[0].label}`,
    safety ? `Destination risk: ${safety.riskLevel}.` : '',
    pickup.arrivalHint ?? '',
    destValidation.possibleNextAction === 'collect_missing_fields'
      ? 'Confirm destination address before departure.'
      : '',
  ].filter(Boolean);

  const body =
    input.mode === 'transit'
      ? `Take airport transit to ${destLabel}. Backup: ${backupTransport[0].label}.`
      : `Meet the driver at arrivals curbside. Primary: ${rideshare.label}. Backup: official airport taxi rank.`;
  const shareText = [
    title,
    body,
    '',
    ...bullets.map(b => `• ${b}`),
    '',
    `Route: ${route.googleMapsUrl}`,
    `Apple Maps: ${route.appleMapsUrl}`,
  ].join('\n');

  const slackMrkdwn = [
    `*${title}*`,
    body,
    ...bullets.map(b => `• ${b}`),
    `<${route.googleMapsUrl}|Google Maps route> · <${route.appleMapsUrl}|Apple Maps>`,
  ].join('\n');

  return {
    summary: `${title}. ${body}${safety ? ` Risk ${safety.riskLevel}.` : ''}`,
    pickupPlan: pickup,
    backupTransport,
    routeLinks: {
      from: input.airport,
      to: destLabel,
      mode: input.mode,
      googleMapsUrl: route.googleMapsUrl,
      appleMapsUrl: route.appleMapsUrl,
      staticMapUrl: route.staticMapUrl,
    },
    airport: {
      query: input.airport,
      formattedAddress: airportStop.formattedAddress,
      latitude: airportStop.latitude,
      longitude: airportStop.longitude,
    },
    destination: {
      label: destLabel,
      formattedAddress: destValidation.formattedAddress,
      latitude: destLat,
      longitude: destLng,
      placeId: destValidation.placeId,
      verified: destValidation.possibleNextAction === 'confirm',
    },
    safety,
    share: {
      title,
      body,
      bullets,
      primaryCta: { label: 'Open route in Google Maps', href: route.googleMapsUrl },
      secondaryCtas: [
        { label: 'Apple Maps', href: route.appleMapsUrl },
        ...(rideshare.href ? [{ label: rideshare.label, href: rideshare.href }] : []),
      ],
      mapLinks: {
        googleMapsUrl: route.googleMapsUrl,
        appleMapsUrl: route.appleMapsUrl,
        staticMapUrl: route.staticMapUrl,
      },
      whatsappUrl: `https://wa.me/?text=${encodeURIComponent(shareText)}`,
      slackMrkdwn,
    },
    staticMapUrl: route.staticMapUrl,
    googleMapsUrl: route.googleMapsUrl,
    appleMapsUrl: route.appleMapsUrl,
  };
}

export const airportTransferCoordinatorTool: ToolDef<
  AirportTransferCoordinatorInput,
  AirportTransferCoordinatorResult
> = {
  name: 'airport_transfer_coordinator',
  description:
    'Turn arrival details into a pickup plan with meeting point, primary transport, backup options, and a ready route from airport to destination. Composes geocode_trip_stop, validate_travel_address, export_route_map, and travel_safety_aid. Use for hotel pickups, embassy visits, or any post-landing ground leg.',
  inputSchema,
  jsonSchema: {
    type: 'object',
    required: ['airport', 'destinationAddress'],
    properties: {
      airport: {
        type: 'string',
        description: 'IATA code, airport name, or free-form text for the arrival airport.',
      },
      airportLatitude: { type: 'number' },
      airportLongitude: { type: 'number' },
      destinationLabel: { type: 'string', description: 'Short label for the destination.' },
      destinationAddress: { type: 'string' },
      regionCode: { type: 'string', description: 'CLDR region code, e.g. AR, US, FR.' },
      languageCode: { type: 'string', default: 'en' },
      arrivalTimeIso: { type: 'string', description: 'ISO 8601 scheduled arrival.' },
      travelerCount: { type: 'integer', minimum: 1, maximum: 12, default: 1 },
      mode: {
        type: 'string',
        enum: ['driving', 'transit', 'walking'],
        default: 'driving',
      },
      includeSafety: { type: 'boolean', default: true },
    },
  },
  handler: airportTransferCoordinator,
};
