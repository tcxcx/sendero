/**
 * GET /api/openapi.json (docs origin)
 *
 * Forwards to the canonical OpenAPI doc on the app origin so any
 * relative `/api/openapi.json` reference inside docs MDX resolves
 * cleanly. The actual generator lives in
 * `apps/app/app/api/openapi.json/route.ts` (single source of truth
 * derived from the canonical tool registry).
 *
 *   docs.sendero.travel/api/openapi.json  →  app.sendero.travel/api/openapi.json
 *   localhost:3020/api/openapi.json       →  localhost:3010/api/openapi.json
 *
 * Status 302 keeps the URL bar showing the docs origin briefly,
 * then routes the consumer to the live spec. Caching disabled so
 * docs visitors always pull a fresh spec.
 */

import { NextResponse } from 'next/server';

import { resolvePublicOrigin } from '@sendero/seo';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

const APP_ORIGIN = resolvePublicOrigin(
  process.env.NEXT_PUBLIC_APP_URL,
  'https://app.sendero.travel'
);

export function GET(): Response {
  return NextResponse.redirect(`${APP_ORIGIN.replace(/\/$/, '')}/api/openapi.json`, {
    status: 302,
    headers: { 'cache-control': 'no-store' },
  });
}
