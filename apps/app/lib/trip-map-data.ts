import { countries } from '@sendero/location/countries-intl';
import type { Booking, Trip } from '@sendero/database';
import type { SenderoMapPoint, SenderoMapRoute } from '@sendero/ui/map-blocks';

type CountryRow = {
  alpha2: string;
  name: string;
  latitude: string;
  longitude: string;
};

type TripWithBookings = Trip & { bookings: Booking[] };

const countryRows = countries as CountryRow[];

function countryPoint(input: {
  id: string;
  iso2: string | null | undefined;
  label: string;
  description?: string | null;
  metric?: string | number | null;
  href?: string | null;
  status?: SenderoMapPoint['status'];
}): SenderoMapPoint | null {
  const iso2 = input.iso2?.toUpperCase();
  if (!iso2) return null;
  const country = countryRows.find(row => row.alpha2 === iso2);
  if (!country) return null;
  const latitude = Number(country.latitude);
  const longitude = Number(country.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return {
    id: input.id,
    label: input.label,
    description: input.description ?? country.name,
    metric: input.metric,
    href: input.href,
    status: input.status ?? 'active',
    latitude,
    longitude,
  };
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function pickString(
  obj: Record<string, unknown> | null | undefined,
  keys: string[]
): string | null {
  if (!obj) return null;
  for (const key of keys) {
    const value = stringValue(obj[key]);
    if (value) return value;
  }
  return null;
}

function firstString(value: unknown): string | null {
  if (typeof value === 'string' && value.length > 0) return value;
  if (Array.isArray(value)) {
    return value.find(v => typeof v === 'string' && v.length > 0) ?? null;
  }
  return null;
}

function firstFlightSegment(bookings: Booking[]): Record<string, unknown> | null {
  for (const booking of bookings) {
    const segments = Array.isArray(booking.segments) ? booking.segments : [];
    const segment = objectValue(segments[0]);
    if (segment) return segment;
    const metadata = objectValue(booking.metadata);
    const metadataSegments = Array.isArray(metadata?.segments) ? metadata.segments : [];
    const metadataSegment = objectValue(metadataSegments[0]);
    if (metadataSegment) return metadataSegment;
  }
  return null;
}

export function routeForTrip(trip: TripWithBookings): SenderoMapRoute | null {
  const intent = objectValue(trip.intent) ?? {};
  const firstSegment = firstFlightSegment(trip.bookings);
  // Phase E layer 2 — Trip.originCountry / destinationCountry are
  // first-class scalar columns now. Prefer those before falling back
  // to JSON resolution; the columns get backfilled at write time via
  // `@sendero/tools/lib/derive-route-countries`.
  const fromIso2 =
    trip.originCountry ??
    pickString(firstSegment, [
      'originCountry',
      'originIso2',
      'origin_country',
      'origin_country_code',
      'originIataCountryCode',
      'origin_iata_country_code',
    ]) ??
    pickString(intent, [
      'originIso2',
      'originCountry',
      'origin_country',
      'origin_country_code',
      'originIataCountryCode',
      'origin_iata_country_code',
    ]);
  const toIso2 =
    trip.destinationCountry ??
    pickString(firstSegment, [
      'destinationCountry',
      'destinationIso2',
      'destination_country',
      'destination_country_code',
      'destinationIataCountryCode',
      'destination_iata_country_code',
      'arrivalCountry',
      'arrival_country_code',
    ]) ??
    firstString(intent.destinationIso2) ??
    pickString(intent, [
      'destinationCountry',
      'destination_country',
      'destination_country_code',
      'destinationIataCountryCode',
      'destination_iata_country_code',
      'arrivalCountry',
      'arrival_country_code',
    ]);
  const fromLabel =
    pickString(firstSegment, [
      'originCity',
      'origin_city',
      'originIata',
      'originIATA',
      'origin_iata',
      'originCode',
      'origin_code',
    ]) ??
    pickString(intent, ['origin', 'originCity', 'origin_city', 'originIata', 'originCode']) ??
    'Origin';
  const toLabel =
    pickString(firstSegment, [
      'destinationCity',
      'destination_city',
      'destinationIata',
      'destinationIATA',
      'destination_iata',
      'destinationCode',
      'destination_code',
      'arrivalCity',
      'arrival_city',
    ]) ??
    pickString(intent, [
      'destination',
      'destinationCity',
      'destination_city',
      'destinationIata',
      'destinationCode',
    ]) ??
    'Destination';
  const from = countryPoint({
    id: `${trip.id}-from`,
    iso2: fromIso2,
    label: fromLabel,
    status: 'quiet',
  });
  const to = countryPoint({
    id: `${trip.id}-to`,
    iso2: toIso2,
    label: toLabel,
    metric: trip.status,
    href: `/dashboard/trips/${trip.id}`,
    status: trip.status === 'in_progress' || trip.status === 'booked' ? 'active' : 'pending',
  });
  if (!from || !to) return null;
  return {
    id: trip.id,
    label: `${fromLabel} → ${toLabel}`,
    from,
    to,
    detail: `${trip.status} · ${trip.bookings.length} booking(s)`,
    href: `/dashboard/trips/${trip.id}`,
    status: trip.status === 'in_progress' || trip.status === 'booked' ? 'active' : 'pending',
  };
}

export function destinationPointForTrip(trip: TripWithBookings): SenderoMapPoint | null {
  return routeForTrip(trip)?.to ?? null;
}
