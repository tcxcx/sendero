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

import { getRedis } from '@/lib/redis';
import { ShareCard, SHARE_CARD_SIZE } from '@/lib/og/share-card';
import { verifySharePayload } from '@/lib/og/share-url';

export const runtime = 'edge';
export const contentType = 'image/png';
export const size = SHARE_CARD_SIZE;
export const alt = 'Sendero share card';

/**
 * Per-IP soft cap. Each unfurl bot fans out a single fetch when a URL
 * is shared, so 120/min/IP is well above the legitimate ceiling and
 * still tight enough that a hostile probe with a billion random
 * tokens hits the wall fast. Edge runtime + Upstash REST = no extra
 * latency on the hot path.
 */
const RATE_WINDOW_S = 60;
const RATE_LIMIT = 120;

export async function GET(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const token = url.searchParams.get('token');
    // Bound the token length to stop a 1MB ?token=... probe from
    // burning edge CPU on base64 decode + JSON.parse before the HMAC
    // failure. Real tokens are well under 4kb.
    if (!token || token.length > 4096) return fallbackCard();

    const limited = await checkRateLimit(request);
    if (limited) {
      return new Response('rate limited', {
        status: 429,
        headers: {
          'retry-after': String(RATE_WINDOW_S),
          'cache-control': 'no-store',
        },
      });
    }

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

/**
 * Edge-safe envTag that mirrors apps/app/lib/api-key-auth.ts (can't
 * import from there because that module pulls Clerk + crypto).
 */
function envTag(): string {
  const v = process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? 'development';
  return v.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

/**
 * Returns true when the caller is over the per-IP cap. Fail-open if
 * Redis is unavailable — better to render a card than to 429 every
 * unfurl bot during an Upstash outage.
 */
async function checkRateLimit(request: Request): Promise<boolean> {
  const redis = getRedis();
  if (!redis) return false;
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown';
  const bucket = Math.floor(Date.now() / 1000 / RATE_WINDOW_S);
  const key = `${envTag()}:og:share:rl:${ip}:${bucket}`;
  try {
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, RATE_WINDOW_S * 2);
    return count > RATE_LIMIT;
  } catch (err) {
    console.warn('[og/share] rate-limit redis error (failing open)', err);
    return false;
  }
}

function fallbackCard(): Response {
  // Don't let an unfurl bot's CDN cache the fallback under a bad-token
  // URL; a re-share with a fresh, valid token must render the new card,
  // not the cached generic. Same reasoning applies for ImageResponse's
  // default headers — explicit no-store wins.
  return new ImageResponse(
    <ShareCard
      title="Sendero"
      body="AI travel agents that book, settle, and stamp your trip."
      footer="sendero.travel"
    />,
    {
      ...SHARE_CARD_SIZE,
      headers: { 'cache-control': 'no-store' },
    }
  );
}
