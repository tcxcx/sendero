/**
 * Canonical Satori share-image route.
 *
 * Renders a brand-framed 1200x630 PNG from a signed share payload. Every
 * channel renderer (Slack block_image, WhatsApp image header, web card,
 * email <img>) falls back to this route when its source `share` block
 * has no explicit `imageUrl`. So a single tool result lands as the same
 * card across every surface.
 *
 * Trust model:
 *   1. The route accepts ONLY a JWT-signed payload via `?token=`. We
 *      never read the title/body/bullets from query params directly.
 *      Without the signature, an attacker could craft phishing-style
 *      cards and pass them through Sendero-branded URLs.
 *   2. The signing key is `INVOICE_SIGNING_SECRET` (re-used from the
 *      invoice flow; same operator/env footprint). Failures (bad sig,
 *      malformed token, unset secret) return a generic Sendero card so
 *      unfurl bots never see a 4xx that would suppress the preview.
 *
 * Edge runtime: this route reads no DB and pulls in no Prisma, so it
 * stays edge-eligible. Sub-50ms cold starts keep us well inside the
 * ~3s unfurl-bot budget on Slack / WhatsApp / X.
 */

import { ImageResponse } from 'next/og';

import { ShareCard, SHARE_CARD_SIZE } from '@/lib/og/share-card';
import { verifySharePayload } from '@/lib/og/share-url';

export const runtime = 'edge';
export const contentType = 'image/png';
export const size = SHARE_CARD_SIZE;
export const alt = 'Sendero share card';

export async function GET(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const token = url.searchParams.get('token');
    if (!token) return fallbackCard();

    const secret = process.env.INVOICE_SIGNING_SECRET;
    if (!secret) return fallbackCard();

    const payload = await verifySharePayload(token, secret);
    return new ImageResponse(<ShareCard {...payload} />, {
      ...SHARE_CARD_SIZE,
      headers: {
        'cache-control': 'public, max-age=86400, immutable',
      },
    });
  } catch (err) {
    console.error('[og/share] render failed', err);
    return fallbackCard();
  }
}

function fallbackCard(): Response {
  return new ImageResponse(
    <ShareCard
      title="Sendero"
      body="AI travel agents that book, settle, and stamp your trip."
      footer="sendero.travel"
    />,
    SHARE_CARD_SIZE
  );
}
