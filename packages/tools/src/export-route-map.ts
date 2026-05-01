import { z } from 'zod';

import {
  buildStaticMapUrl,
  mapTravelModeToApple,
  mapTravelModeToGoogle,
  requireGoogleMapsApiKey,
  type TravelMode,
  toQueryLatLng,
} from './google-travel-shared';
import type { ToolDef } from './types';

const routeStopSchema = z
  .object({
    label: z.string().min(1).optional(),
    address: z.string().min(1).optional(),
    latitude: z.number().optional(),
    longitude: z.number().optional(),
    placeId: z.string().min(1).optional(),
  })
  .refine(
    stop =>
      Boolean(stop.address) ||
      (typeof stop.latitude === 'number' && typeof stop.longitude === 'number'),
    {
      message: 'Each stop needs an address or both latitude and longitude.',
    }
  );

const inputSchema = z.object({
  title: z.string().min(1).optional(),
  stops: z.array(routeStopSchema).min(2).max(10),
  mode: z.enum(['driving', 'walking', 'transit', 'bicycling']).default('driving'),
  channel: z.enum(['whatsapp', 'slack', 'web', 'email', 'mcp']).default('web'),
  notes: z.string().optional(),
  includeStaticMap: z.boolean().default(true),
});

export type ExportRouteMapInput = z.infer<typeof inputSchema>;

export interface RouteExportStop {
  role: 'origin' | 'waypoint' | 'destination';
  label: string;
  address?: string;
  latitude?: number;
  longitude?: number;
  placeId?: string;
}

export interface RouteExportLeg {
  from: string;
  to: string;
  appleMapsUrl: string;
}

export interface RouteExportPreviewCard {
  title: string;
  subtitle: string;
  imageUrl?: string;
  alt: string;
  primaryLink: {
    label: string;
    href: string;
  };
  secondaryLink: {
    label: string;
    href: string;
  };
}

export interface ExportRouteMapResult {
  title: string;
  summary: string;
  mode: TravelMode;
  googleMapsUrl: string;
  appleMapsUrl: string;
  appleMapsLegUrls: RouteExportLeg[];
  staticMapUrl?: string;
  previewCard: RouteExportPreviewCard;
  share: {
    text: string;
    whatsappUrl: string;
    slackMrkdwn: string;
  };
  stops: RouteExportStop[];
}

function getStopRole(index: number, total: number): RouteExportStop['role'] {
  if (index === 0) return 'origin';
  if (index === total - 1) return 'destination';
  return 'waypoint';
}

function getStopLabel(stop: z.infer<typeof routeStopSchema>, index: number): string {
  return stop.label ?? stop.address ?? `Stop ${index + 1}`;
}

function hasLatLng(stop: z.infer<typeof routeStopSchema>): stop is z.infer<
  typeof routeStopSchema
> & {
  latitude: number;
  longitude: number;
} {
  return typeof stop.latitude === 'number' && typeof stop.longitude === 'number';
}

function stopQuery(stop: z.infer<typeof routeStopSchema>): string {
  if (hasLatLng(stop)) return toQueryLatLng(stop);
  return stop.address ?? '';
}

function markerLabel(index: number): string {
  return String.fromCharCode(65 + index);
}

function buildGoogleMapsUrl(stops: z.infer<typeof routeStopSchema>[], mode: TravelMode): string {
  const origin = stops[0];
  const destination = stops[stops.length - 1];
  const params = new URLSearchParams({
    api: '1',
    origin: stopQuery(origin),
    destination: stopQuery(destination),
    travelmode: mapTravelModeToGoogle(mode),
  });
  if (origin.placeId) params.set('origin_place_id', origin.placeId);
  if (destination.placeId) params.set('destination_place_id', destination.placeId);
  const waypoints = stops.slice(1, -1).map(stopQuery).filter(Boolean);
  if (waypoints.length) params.set('waypoints', waypoints.join('|'));
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

function buildAppleMapsUrl(
  from: z.infer<typeof routeStopSchema>,
  to: z.infer<typeof routeStopSchema>,
  mode: TravelMode
): string {
  const params = new URLSearchParams({
    saddr: stopQuery(from),
    daddr: stopQuery(to),
    dirflg: mapTravelModeToApple(mode),
  });
  return `https://maps.apple.com/?${params.toString()}`;
}

function buildStaticPreview(
  apiKey: string,
  stops: z.infer<typeof routeStopSchema>[]
): string | undefined {
  const markers = stops.map((stop, index) => ({
    color: index === 0 ? 'green' : index === stops.length - 1 ? 'red' : 'orange',
    label: markerLabel(index),
    location: stopQuery(stop),
  }));
  const pathPoints = stops.filter(hasLatLng).map(toQueryLatLng);
  return buildStaticMapUrl({
    apiKey,
    markers,
    path: pathPoints.length >= 2 ? { color: '0xd9480f', weight: 5, points: pathPoints } : undefined,
  });
}

function buildSummary(args: {
  title: string;
  stopCount: number;
  mode: TravelMode;
  hasWaypoints: boolean;
}) {
  const modeLabel = args.mode === 'bicycling' ? 'bike' : args.mode;
  if (args.hasWaypoints) {
    return `${args.title}: ${args.stopCount}-stop ${modeLabel} itinerary. Google Maps includes all waypoints; Apple Maps links are returned per leg.`;
  }
  return `${args.title}: ${args.stopCount}-stop ${modeLabel} route ready for Google Maps and Apple Maps.`;
}

function buildSlackMrkdwn(args: {
  title: string;
  googleMapsUrl: string;
  appleMapsUrl: string;
  staticMapUrl?: string;
  summary: string;
}) {
  const parts = [
    `*${args.title}*`,
    args.summary,
    `<${args.googleMapsUrl}|Open in Google Maps>`,
    `<${args.appleMapsUrl}|Open in Apple Maps>`,
  ];
  if (args.staticMapUrl) parts.push(`<${args.staticMapUrl}|Preview map>`);
  return parts.join('\n');
}

export async function exportRouteMap(input: ExportRouteMapInput): Promise<ExportRouteMapResult> {
  const title = input.title ?? 'Sendero route';
  const googleMapsUrl = buildGoogleMapsUrl(input.stops, input.mode);
  const appleMapsUrl = buildAppleMapsUrl(
    input.stops[0],
    input.stops[input.stops.length - 1],
    input.mode
  );
  const appleMapsLegUrls = input.stops.slice(0, -1).map((stop, index) => ({
    from: getStopLabel(stop, index),
    to: getStopLabel(input.stops[index + 1], index + 1),
    appleMapsUrl: buildAppleMapsUrl(stop, input.stops[index + 1], input.mode),
  }));
  const staticMapUrl = input.includeStaticMap
    ? buildStaticPreview(requireGoogleMapsApiKey('export_route_map'), input.stops)
    : undefined;
  const stopCount = input.stops.length;
  const hasWaypoints = stopCount > 2;
  const summary = buildSummary({
    title,
    stopCount,
    mode: input.mode,
    hasWaypoints,
  });
  const shareText = [
    title,
    summary,
    input.notes?.trim(),
    `Google Maps: ${googleMapsUrl}`,
    `Apple Maps: ${appleMapsUrl}`,
    staticMapUrl ? `Preview: ${staticMapUrl}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  return {
    title,
    summary,
    mode: input.mode,
    googleMapsUrl,
    appleMapsUrl,
    appleMapsLegUrls,
    staticMapUrl,
    previewCard: {
      title,
      subtitle: hasWaypoints
        ? 'Google Maps opens the full itinerary. Apple Maps links are available per leg.'
        : 'Open the route in Google Maps or Apple Maps.',
      imageUrl: staticMapUrl,
      alt: `${title} route preview map`,
      primaryLink: { label: 'Open in Google Maps', href: googleMapsUrl },
      secondaryLink: {
        label: hasWaypoints ? 'Open Apple Maps (direct)' : 'Open in Apple Maps',
        href: appleMapsUrl,
      },
    },
    share: {
      text: shareText,
      whatsappUrl: `https://wa.me/?text=${encodeURIComponent(shareText)}`,
      slackMrkdwn: buildSlackMrkdwn({
        title,
        summary,
        googleMapsUrl,
        appleMapsUrl,
        staticMapUrl,
      }),
    },
    stops: input.stops.map((stop, index) => ({
      role: getStopRole(index, input.stops.length),
      label: getStopLabel(stop, index),
      address: stop.address,
      latitude: stop.latitude,
      longitude: stop.longitude,
      placeId: stop.placeId,
    })),
  };
}

export const exportRouteMapTool: ToolDef<ExportRouteMapInput, ExportRouteMapResult> = {
  name: 'export_route_map',
  description:
    'Export a Sendero route or itinerary into shareable Google Maps and Apple Maps links, plus a static map preview card for WhatsApp, Slack, or web chat. Use after picking a restaurant, hotel, airport transfer, or multi-stop itinerary.',
  inputSchema,
  jsonSchema: {
    type: 'object',
    required: ['stops'],
    properties: {
      title: { type: 'string', description: 'Short itinerary title for the share card.' },
      stops: {
        type: 'array',
        minItems: 2,
        maxItems: 10,
        items: {
          type: 'object',
          properties: {
            label: { type: 'string' },
            address: { type: 'string' },
            latitude: { type: 'number' },
            longitude: { type: 'number' },
            placeId: { type: 'string' },
          },
        },
        description:
          'Ordered route stops. Each stop needs an address or both latitude and longitude.',
      },
      mode: {
        type: 'string',
        enum: ['driving', 'walking', 'transit', 'bicycling'],
        default: 'driving',
      },
      channel: {
        type: 'string',
        enum: ['whatsapp', 'slack', 'web', 'email', 'mcp'],
        default: 'web',
      },
      notes: { type: 'string' },
      includeStaticMap: { type: 'boolean', default: true },
    },
  },
  handler: exportRouteMap,
};
