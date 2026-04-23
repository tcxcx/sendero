import { env } from '@sendero/env';

export interface LatLng {
  latitude: number;
  longitude: number;
}

export type TravelMode = 'driving' | 'walking' | 'transit' | 'bicycling';

export function requireGoogleMapsApiKey(toolName: string): string {
  const apiKey = env.googleMapsApiKey();
  if (!apiKey) {
    throw new Error(
      `${toolName} unavailable: set GOOGLE_MAPS_API_KEY (preferred) or GOOGLE_PLACES_API_KEY in .env.local.`
    );
  }
  return apiKey;
}

export async function parseJsonOrThrow(response: Response, label: string) {
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${label} ${response.status}: ${body.slice(0, 500)}`);
  }
  return response.json();
}

export function toQueryLatLng(input: LatLng): string {
  return `${input.latitude},${input.longitude}`;
}

export function mapTravelModeToGoogle(mode: TravelMode): string {
  return mode;
}

export function mapTravelModeToApple(mode: TravelMode): string {
  if (mode === 'walking') return 'w';
  if (mode === 'transit') return 'r';
  return 'd';
}

export function buildStreetViewStaticUrl(args: {
  apiKey: string;
  location: string;
  size?: string;
  heading?: number;
  pitch?: number;
  fov?: number;
}) {
  const params = new URLSearchParams({
    location: args.location,
    size: args.size ?? '640x360',
    key: args.apiKey,
  });
  if (typeof args.heading === 'number') params.set('heading', String(args.heading));
  if (typeof args.pitch === 'number') params.set('pitch', String(args.pitch));
  if (typeof args.fov === 'number') params.set('fov', String(args.fov));
  return `https://maps.googleapis.com/maps/api/streetview?${params.toString()}`;
}

export function buildStaticMapUrl(args: {
  apiKey: string;
  size?: string;
  scale?: 1 | 2 | 4;
  mapType?: 'roadmap' | 'satellite' | 'terrain' | 'hybrid';
  markers?: Array<{ color?: string; label?: string; location: string }>;
  path?: { color?: string; weight?: number; points: string[] };
}) {
  const params = new URLSearchParams({
    size: args.size ?? '1200x630',
    scale: String(args.scale ?? 2),
    maptype: args.mapType ?? 'roadmap',
    key: args.apiKey,
  });
  for (const marker of args.markers ?? []) {
    const parts = [];
    if (marker.color) parts.push(`color:${marker.color}`);
    if (marker.label) parts.push(`label:${marker.label}`);
    parts.push(marker.location);
    params.append('markers', parts.join('|'));
  }
  if (args.path?.points.length) {
    const pathParts = [];
    if (args.path.color) pathParts.push(`color:${args.path.color}`);
    if (typeof args.path.weight === 'number') pathParts.push(`weight:${args.path.weight}`);
    pathParts.push(...args.path.points);
    params.append('path', pathParts.join('|'));
  }
  return `https://maps.googleapis.com/maps/api/staticmap?${params.toString()}`;
}
