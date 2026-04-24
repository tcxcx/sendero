/**
 * restaurant_route_card — composed concierge card.
 *
 * Pairs `recommend_restaurants` with `export_route_map` so the
 * traveler gets a shortlisted pick plus a ready-to-open route from
 * their current location (hotel, meeting, airport lounge) to the
 * restaurant. One canonical MCP JSON result + a share shape usable
 * verbatim in WhatsApp, Slack, or web.
 */

import { z } from 'zod';

import { exportRouteMap } from './export-route-map';
import { buildStaticMapUrl, requireGoogleMapsApiKey } from './google-travel-shared';
import { recommendRestaurants, type RestaurantPlace } from './recommend-restaurants';
import type { ToolDef } from './types';

const inputSchema = z.object({
  location: z.string().min(1).describe('City, neighborhood, or landmark for the search.'),
  cuisine: z.string().optional(),
  priceLevel: z.enum(['inexpensive', 'moderate', 'expensive', 'very_expensive']).optional(),
  partySize: z.number().int().min(1).max(20).optional(),
  limit: z.number().int().min(1).max(5).default(3),
  languageCode: z.string().default('en'),
  // Optional "from" origin — a hotel address, coords, or label. If
  // provided, we export a route to the top pick.
  fromLabel: z.string().optional(),
  fromAddress: z.string().optional(),
  fromLatitude: z.number().optional(),
  fromLongitude: z.number().optional(),
  mode: z.enum(['driving', 'walking', 'transit', 'bicycling']).default('walking'),
  occasion: z
    .string()
    .optional()
    .describe('Optional occasion — e.g. "anniversary", "client dinner".'),
});

export type RestaurantRouteCardInput = z.infer<typeof inputSchema>;

export interface RestaurantRouteShortlistItem {
  placeId: string;
  name: string;
  shortAddress?: string;
  formattedAddress?: string;
  primaryType?: string;
  rating?: number;
  userRatingCount?: number;
  priceLevel?: RestaurantPlace['priceLevel'];
  openNow?: boolean;
  phone?: string;
  website?: string;
  googleMapsUrl: string;
  appleMapsUrl: string;
  location?: { latitude: number; longitude: number };
}

export interface RestaurantRouteCardShare {
  title: string;
  body: string;
  bullets: string[];
  primaryCta: { label: string; href: string };
  secondaryCtas: Array<{ label: string; href: string }>;
  mapLinks: { googleMapsUrl?: string; appleMapsUrl?: string; staticMapUrl?: string };
  whatsappUrl: string;
  slackMrkdwn: string;
}

export interface RestaurantRouteCardResult {
  summary: string;
  query: string;
  restaurants: RestaurantRouteShortlistItem[];
  topPick?: RestaurantRouteShortlistItem;
  routeLinks?: {
    googleMapsUrl: string;
    appleMapsUrl: string;
    staticMapUrl?: string;
    mode: RestaurantRouteCardInput['mode'];
  };
  previewCard: {
    title: string;
    subtitle: string;
    imageUrl?: string;
    alt: string;
    primaryLink: { label: string; href: string };
    secondaryLink?: { label: string; href: string };
  };
  share: RestaurantRouteCardShare;
  // Map-preview fields at the top level so existing ToolPreview
  // (chat-col) picks up the concierge preview without custom wiring.
  staticMapUrl?: string;
  googleMapsUrl?: string;
  appleMapsUrl?: string;
}

function priceTier(level?: RestaurantPlace['priceLevel']): string | null {
  if (!level) return null;
  if (level === 'PRICE_LEVEL_INEXPENSIVE') return '$';
  if (level === 'PRICE_LEVEL_MODERATE') return '$$';
  if (level === 'PRICE_LEVEL_EXPENSIVE') return '$$$';
  if (level === 'PRICE_LEVEL_VERY_EXPENSIVE') return '$$$$';
  return null;
}

function placeGoogleUrl(place: RestaurantPlace): string {
  if (place.placeId) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place.name)}&query_place_id=${encodeURIComponent(place.placeId)}`;
  }
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place.name + ' ' + (place.formattedAddress ?? ''))}`;
}

function placeAppleUrl(place: RestaurantPlace): string {
  if (place.location) {
    return `https://maps.apple.com/?ll=${place.location.latitude},${place.location.longitude}&q=${encodeURIComponent(place.name)}`;
  }
  return `https://maps.apple.com/?q=${encodeURIComponent(place.name + ' ' + (place.formattedAddress ?? ''))}`;
}

function rankRestaurants(places: RestaurantPlace[]): RestaurantPlace[] {
  return [...places]
    .filter(p => p.businessStatus !== 'CLOSED_PERMANENTLY')
    .sort((a, b) => {
      // operational + open-now first
      const aOp = a.openNow ? 1 : 0;
      const bOp = b.openNow ? 1 : 0;
      if (aOp !== bOp) return bOp - aOp;
      // then rating * log(count) to avoid a 5.0 with 3 reviews beating a 4.6 with 900
      const aScore = (a.rating ?? 0) * Math.log10(Math.max(10, a.userRatingCount ?? 0));
      const bScore = (b.rating ?? 0) * Math.log10(Math.max(10, b.userRatingCount ?? 0));
      return bScore - aScore;
    });
}

function buildWhyLine(place: RestaurantPlace, occasion?: string): string {
  const bits: string[] = [];
  if (place.rating && place.userRatingCount) {
    bits.push(`${place.rating.toFixed(1)}★ (${place.userRatingCount.toLocaleString()})`);
  } else if (place.rating) {
    bits.push(`${place.rating.toFixed(1)}★`);
  }
  const tier = priceTier(place.priceLevel);
  if (tier) bits.push(tier);
  if (place.openNow) bits.push('open now');
  if (place.primaryType && place.primaryType !== 'restaurant')
    bits.push(place.primaryType.replace(/_/g, ' '));
  const line = bits.join(' · ');
  return occasion ? `${line} · ${occasion}` : line;
}

export async function restaurantRouteCard(
  input: RestaurantRouteCardInput
): Promise<RestaurantRouteCardResult> {
  const apiKey = requireGoogleMapsApiKey('restaurant_route_card');

  const placesResult = await recommendRestaurants({
    location: input.location,
    cuisine: input.cuisine,
    priceLevel: input.priceLevel,
    partySize: input.partySize,
    limit: Math.max(input.limit, 6),
    languageCode: input.languageCode,
  });
  const ranked = rankRestaurants(placesResult.restaurants).slice(0, input.limit);

  if (ranked.length === 0) {
    throw new Error(
      `No restaurants matched "${placesResult.query}". Broaden the location or drop the cuisine/price filter.`
    );
  }

  const shortlist: RestaurantRouteShortlistItem[] = ranked.map(place => ({
    placeId: place.placeId,
    name: place.name,
    shortAddress: place.shortAddress,
    formattedAddress: place.formattedAddress,
    primaryType: place.primaryType,
    rating: place.rating,
    userRatingCount: place.userRatingCount,
    priceLevel: place.priceLevel,
    openNow: place.openNow,
    phone: place.phone,
    website: place.website,
    googleMapsUrl: placeGoogleUrl(place),
    appleMapsUrl: placeAppleUrl(place),
    location: place.location,
  }));

  const topPick = shortlist[0];
  const hasOrigin =
    Boolean(input.fromAddress) ||
    (typeof input.fromLatitude === 'number' && typeof input.fromLongitude === 'number');

  let routeLinks: RestaurantRouteCardResult['routeLinks'];
  let routeStaticMap: string | undefined;

  if (hasOrigin && topPick.location) {
    const route = await exportRouteMap({
      title: `${input.fromLabel ?? 'Your location'} → ${topPick.name}`,
      stops: [
        {
          label: input.fromLabel ?? 'Start',
          address: input.fromAddress,
          latitude: input.fromLatitude,
          longitude: input.fromLongitude,
        },
        {
          label: topPick.name,
          address: topPick.formattedAddress,
          latitude: topPick.location.latitude,
          longitude: topPick.location.longitude,
          placeId: topPick.placeId || undefined,
        },
      ],
      mode: input.mode,
      channel: 'web',
      includeStaticMap: true,
    });
    routeLinks = {
      googleMapsUrl: route.googleMapsUrl,
      appleMapsUrl: route.appleMapsUrl,
      staticMapUrl: route.staticMapUrl,
      mode: input.mode,
    };
    routeStaticMap = route.staticMapUrl;
  } else if (topPick.location) {
    // No origin — just a single pin preview so the card still renders.
    routeStaticMap = buildStaticMapUrl({
      apiKey,
      markers: [
        {
          color: 'red',
          label: 'A',
          location: `${topPick.location.latitude},${topPick.location.longitude}`,
        },
      ],
    });
  }

  const summaryPrefix = input.cuisine
    ? `${input.cuisine} in ${input.location}`
    : `Restaurants in ${input.location}`;
  const summary = `${summaryPrefix}: top pick ${topPick.name}${priceTier(topPick.priceLevel) ? ` (${priceTier(topPick.priceLevel)})` : ''}${topPick.rating ? ` · ${topPick.rating.toFixed(1)}★` : ''}.`;

  const title = input.cuisine
    ? `${capitalize(input.cuisine)} in ${input.location}`
    : `Dinner in ${input.location}`;

  const bullets = shortlist.map(r => {
    const why = buildWhyLine(r as unknown as RestaurantPlace, input.occasion);
    const where = r.shortAddress ?? r.formattedAddress ?? '';
    return `${r.name}${why ? ` — ${why}` : ''}${where ? ` · ${where}` : ''}`;
  });

  const primaryCta = routeLinks
    ? { label: `Route to ${topPick.name}`, href: routeLinks.googleMapsUrl }
    : { label: `Open ${topPick.name}`, href: topPick.googleMapsUrl };
  const secondaryCtas: Array<{ label: string; href: string }> = shortlist.slice(1).map(r => ({
    label: r.name,
    href: r.googleMapsUrl,
  }));
  if (routeLinks) {
    secondaryCtas.push({ label: 'Apple Maps route', href: routeLinks.appleMapsUrl });
  }

  const body = input.occasion
    ? `Pick for ${input.occasion}: ${topPick.name}.`
    : `Top pick: ${topPick.name}.`;
  const shareText = [
    title,
    body,
    '',
    ...bullets.map(b => `• ${b}`),
    '',
    routeLinks ? `Route: ${routeLinks.googleMapsUrl}` : `Open: ${primaryCta.href}`,
  ].join('\n');

  const slackMrkdwn = [
    `*${title}*`,
    body,
    ...bullets.map(b => `• ${b}`),
    routeLinks
      ? `<${routeLinks.googleMapsUrl}|Route in Google Maps> · <${routeLinks.appleMapsUrl}|Apple Maps>`
      : `<${primaryCta.href}|Open ${topPick.name}>`,
  ].join('\n');

  return {
    summary,
    query: placesResult.query,
    restaurants: shortlist,
    topPick,
    routeLinks,
    previewCard: {
      title,
      subtitle: bullets[0] ?? `${topPick.name}`,
      imageUrl: routeStaticMap,
      alt: `${title} map preview`,
      primaryLink: primaryCta,
      secondaryLink: secondaryCtas[0],
    },
    share: {
      title,
      body,
      bullets,
      primaryCta,
      secondaryCtas,
      mapLinks: {
        googleMapsUrl: routeLinks?.googleMapsUrl ?? topPick.googleMapsUrl,
        appleMapsUrl: routeLinks?.appleMapsUrl ?? topPick.appleMapsUrl,
        staticMapUrl: routeStaticMap,
      },
      whatsappUrl: `https://wa.me/?text=${encodeURIComponent(shareText)}`,
      slackMrkdwn,
    },
    staticMapUrl: routeStaticMap,
    googleMapsUrl: routeLinks?.googleMapsUrl,
    appleMapsUrl: routeLinks?.appleMapsUrl,
  };
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export const restaurantRouteCardTool: ToolDef<RestaurantRouteCardInput, RestaurantRouteCardResult> =
  {
    name: 'restaurant_route_card',
    description:
      "Produce a polished concierge recommendation: a shortlisted restaurant with a route preview from the traveler's current location (hotel, office, airport). Composes recommend_restaurants + export_route_map into one canonical share card for web, WhatsApp, and Slack.",
    inputSchema,
    jsonSchema: {
      type: 'object',
      required: ['location'],
      properties: {
        location: { type: 'string', description: 'City, neighborhood, or landmark.' },
        cuisine: { type: 'string' },
        priceLevel: {
          type: 'string',
          enum: ['inexpensive', 'moderate', 'expensive', 'very_expensive'],
        },
        partySize: { type: 'integer', minimum: 1, maximum: 20 },
        limit: { type: 'integer', default: 3, minimum: 1, maximum: 5 },
        languageCode: { type: 'string', default: 'en' },
        fromLabel: {
          type: 'string',
          description: 'Label for the route start, e.g. "Hotel Park Hyatt".',
        },
        fromAddress: { type: 'string' },
        fromLatitude: { type: 'number' },
        fromLongitude: { type: 'number' },
        mode: {
          type: 'string',
          enum: ['driving', 'walking', 'transit', 'bicycling'],
          default: 'walking',
        },
        occasion: { type: 'string' },
      },
    },
    handler: restaurantRouteCard,
  };
