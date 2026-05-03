/**
 * Satori boarding-pass image route.
 *
 * Renders the post-ticketing boarding pass as a 1200×630 PNG. Sent to
 * the traveler via `send_image_message` immediately after
 * BOOKING_CONFIRMED lands. Meta downloads + re-hosts the PNG so the
 * URL is one-shot per booking — public-readable but signed so an
 * attacker can't craft a phishing card with a Sendero-branded URL.
 *
 * Same trust model as `/api/og/share`: signed token via
 * `OG_SHARE_SIGNING_SECRET`, fallback to a generic Sendero card on
 * verification failure (so unfurl bots never see a 4xx that would
 * suppress the WhatsApp preview).
 *
 * Edge runtime: no DB read, no Prisma — the payload comes from the
 * signed token. Sub-50ms cold starts keep the post-booking fan-out
 * fast.
 */

import { ImageResponse } from 'next/og';

import {
  BoardingPassCard,
  BOARDING_PASS_CARD_SIZE,
  type BoardingPassCardProps,
} from '@/lib/og/boarding-pass-card';
import { verifyBoardingPassPayload } from '@/lib/og/boarding-pass-url';

export const runtime = 'edge';
export const contentType = 'image/png';
export const size = BOARDING_PASS_CARD_SIZE;
export const alt = 'Sendero boarding pass';

export async function GET(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const token = url.searchParams.get('token');
    if (!token || token.length > 4096) return fallbackCard();

    const secret = process.env.OG_SHARE_SIGNING_SECRET;
    if (!secret) return fallbackCard();

    const payload = await verifyBoardingPassPayload(token, secret);
    return new ImageResponse(<BoardingPassCard {...payload} />, {
      ...BOARDING_PASS_CARD_SIZE,
      headers: {
        // 1-day cache. Boarding-pass URLs are one-shot per booking;
        // Meta downloads + re-hosts so the cache only protects against
        // accidental re-fetches.
        'cache-control': 'public, max-age=86400, immutable',
      },
    });
  } catch (err) {
    console.error('[og/boarding-pass] render failed', err);
    return fallbackCard();
  }
}

function fallbackCard(): Response {
  const fallback: BoardingPassCardProps = {
    origin: '✈️',
    destination: 'Sendero',
    departureDate: 'Travel agent',
    departureTime: '',
    passengerName: 'sendero.travel',
    pnr: '—',
    totalUsdc: '—',
    carrier: '—',
  };
  return new ImageResponse(<BoardingPassCard {...fallback} />, {
    ...BOARDING_PASS_CARD_SIZE,
    headers: { 'cache-control': 'public, max-age=300' },
  });
}
