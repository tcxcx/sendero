/**
 * URL helpers for the Sendero OG endpoint.
 *
 * Pairs with `apps/<surface>/app/api/og/route.tsx` — the same query
 * shape works on every Sendero surface (marketing, app, docs). Caller
 * gives a public origin + props, gets back a stable absolute URL safe
 * for `<meta property="og:image">`.
 *
 * Decoder side (`parseOgQueryParams`) is used by the route handler.
 * Keeps the param vocabulary in one place so adding a new field
 * happens once.
 */

import type { SenderoOgCardProps } from './card';

export interface OgImageUrlParams {
  title: string;
  description?: string;
  eyebrow?: string;
  bullets?: string[];
  cta?: string;
  /** Optional accent color override (hex, with #). */
  accent?: string;
  /** Surface label override (defaults to the origin's hostname). */
  site?: string;
}

export function buildOgImageUrl(origin: string, params: OgImageUrlParams): string {
  const url = new URL('/api/og', origin);
  url.searchParams.set('title', params.title);
  if (params.description) url.searchParams.set('description', params.description);
  if (params.eyebrow) url.searchParams.set('eyebrow', params.eyebrow);
  if (params.cta) url.searchParams.set('cta', params.cta);
  if (params.accent) url.searchParams.set('accent', params.accent);
  if (params.site) url.searchParams.set('site', params.site);
  if (params.bullets && params.bullets.length > 0) {
    for (const b of params.bullets) url.searchParams.append('bullet', b);
  }
  return url.toString();
}

export function parseOgQueryParams(searchParams: URLSearchParams): SenderoOgCardProps {
  const title = searchParams.get('title')?.trim() || 'Sendero';
  const description = searchParams.get('description')?.trim() || undefined;
  const eyebrow = searchParams.get('eyebrow')?.trim() || undefined;
  const cta = searchParams.get('cta')?.trim() || undefined;
  // `accent` query param is accepted but not part of SenderoOgCardProps
  // (the card derives its accent from the site domain). Drop it.
  const site = searchParams.get('site')?.trim() || undefined;
  const bullets = searchParams
    .getAll('bullet')
    .map(b => b.trim())
    .filter(Boolean);
  // `heroSrc` is required by SenderoOgCardProps but resolved at module
  // load by the route handler (see apps/marketing/app/api/og/route.tsx
  // — it calls `loadHalftoneHeroDataUrl()` and merges the result into
  // these props). Return an empty string so the route can override.
  return {
    title,
    description,
    eyebrow,
    ctaLabel: cta,
    site,
    bullets,
    heroSrc: '',
  };
}
