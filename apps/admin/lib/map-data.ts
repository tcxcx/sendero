import { countries } from '@sendero/location/countries-intl';
import type { SenderoMapPoint, SenderoMapRoute } from '@sendero/ui/map-blocks';

type CountryRow = {
  alpha2: string;
  name: string;
  latitude: string;
  longitude: string;
};

const countryRows = countries as CountryRow[];

export function pointForCountry(input: {
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

export function routeFromCountries(input: {
  id: string;
  label: string;
  fromIso2: string | null | undefined;
  toIso2: string | null | undefined;
  fromLabel: string;
  toLabel: string;
  detail?: string | null;
  href?: string | null;
  status?: SenderoMapRoute['status'];
}): SenderoMapRoute | null {
  const from = pointForCountry({
    id: `${input.id}-from`,
    iso2: input.fromIso2,
    label: input.fromLabel,
    status: 'quiet',
  });
  const to = pointForCountry({
    id: `${input.id}-to`,
    iso2: input.toIso2,
    label: input.toLabel,
    status: input.status ?? 'active',
  });
  if (!from || !to) return null;
  return {
    id: input.id,
    label: input.label,
    from,
    to,
    detail: input.detail,
    href: input.href,
    status: input.status ?? 'active',
  };
}

export function latestVisitedIso2(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  for (let i = value.length - 1; i >= 0; i -= 1) {
    const row = value[i];
    if (!row || typeof row !== 'object') continue;
    const iso2 = (row as Record<string, unknown>).iso2;
    if (typeof iso2 === 'string' && /^[a-z]{2}$/i.test(iso2)) {
      return iso2.toUpperCase();
    }
  }
  return null;
}
