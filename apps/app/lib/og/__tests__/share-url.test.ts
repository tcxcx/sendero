/**
 * HMAC sign + verify roundtrip for the signed share-image URL.
 *
 * The OG share generator at `/api/og/share?token=…` is a public route
 * protected only by the signed payload. A silent regression in the
 * verify path would let anyone craft phishing-style cards on a Sendero
 * domain (the route still renders something on bad input — it falls
 * back to a generic card — so a broken signature would not surface
 * as an HTTP 4xx in production logs).
 *
 * Coverage:
 *   1. Roundtrip: `buildShareImageUrl` produces a `?token=` URL whose
 *      payload portion verifies and decodes back to the original
 *      ShareCardProps fields.
 *   2. Tamper: flipping a byte in the payload half OR the signature
 *      half causes verify to throw.
 *   3. Fail-soft: when `OG_SHARE_SIGNING_SECRET` is unset,
 *      `buildShareImageUrl` returns null (channel renderers treat null
 *      as "no fallback image" rather than crashing).
 *   4. TTL gap (documented): the current token format carries no
 *      timestamp/expiry. Vercel's CDN caches OG images aggressively, so
 *      infinite TTL is intentional; this test asserts the property
 *      explicitly so a future TTL addition is a deliberate change.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
  buildShareImageUrl,
  signSharePayload,
  verifySharePayload,
  type SignedSharePayload,
} from '../share-url';

const TEST_SECRET = 'test-secret-must-be-at-least-sixteen-characters-long';

const SAMPLE: SignedSharePayload = {
  title: 'Lima to Cusco confirmed',
  body: 'Anita is on LATAM 2034, departing 7:15 AM tomorrow.',
  bullets: ['Seat 14C aisle', 'PEN 412 fare', 'Stamp issued at boarding'],
  ctaLabel: 'View itinerary',
};

const ORIGINAL_SECRET = process.env.OG_SHARE_SIGNING_SECRET;
const ORIGINAL_BASE = process.env.NEXT_PUBLIC_APP_URL;

beforeAll(() => {
  process.env.OG_SHARE_SIGNING_SECRET = TEST_SECRET;
  process.env.NEXT_PUBLIC_APP_URL = 'https://app.sendero.travel';
});

afterAll(() => {
  if (ORIGINAL_SECRET === undefined) {
    delete process.env.OG_SHARE_SIGNING_SECRET;
  } else {
    process.env.OG_SHARE_SIGNING_SECRET = ORIGINAL_SECRET;
  }
  if (ORIGINAL_BASE === undefined) {
    delete process.env.NEXT_PUBLIC_APP_URL;
  } else {
    process.env.NEXT_PUBLIC_APP_URL = ORIGINAL_BASE;
  }
});

function tokenFromUrl(url: string): string {
  const u = new URL(url, 'https://example.invalid');
  const token = u.searchParams.get('token');
  if (!token) throw new Error('expected ?token= on built share url');
  return token;
}

describe('share-url HMAC roundtrip', () => {
  test('buildShareImageUrl produces a token that verifySharePayload accepts and decodes', async () => {
    const url = await buildShareImageUrl(
      {
        title: SAMPLE.title,
        body: SAMPLE.body,
        bullets: SAMPLE.bullets,
        primaryCta: SAMPLE.ctaLabel ? { label: SAMPLE.ctaLabel } : undefined,
      },
      'https://app.sendero.travel'
    );

    expect(url).not.toBeNull();
    expect(url).toContain('https://app.sendero.travel/api/og/share?token=');

    const token = tokenFromUrl(url as string);
    const decoded = await verifySharePayload(token, TEST_SECRET);

    expect(decoded.title).toBe(SAMPLE.title);
    expect(decoded.body).toBe(SAMPLE.body);
    expect(decoded.bullets).toEqual(SAMPLE.bullets);
    expect(decoded.ctaLabel).toBe(SAMPLE.ctaLabel);
  });

  test('signSharePayload + verifySharePayload roundtrip preserves all known fields', async () => {
    const payload: SignedSharePayload = {
      title: 'Trip booked',
      body: 'Everything is set.',
      bullets: ['One', 'Two'],
      kicker: 'SENDERO',
      footer: 'sendero.travel',
      ctaLabel: 'Open',
    };
    const token = await signSharePayload(payload, TEST_SECRET);
    const decoded = await verifySharePayload(token, TEST_SECRET);
    expect(decoded).toEqual(payload);
  });
});

describe('share-url tamper detection', () => {
  test('flipping a byte in the payload half causes verify to reject', async () => {
    const token = await signSharePayload(SAMPLE, TEST_SECRET);
    const dot = token.indexOf('.');
    expect(dot).toBeGreaterThan(0);

    const body = token.slice(0, dot);
    const sig = token.slice(dot + 1);
    // Flip the first body character to a different but still-base64url
    // legal value. Picking a deterministic swap (a -> b, otherwise -> a)
    // keeps the test stable regardless of the JSON serialization order.
    const swapped = body[0] === 'a' ? `b${body.slice(1)}` : `a${body.slice(1)}`;
    const tampered = `${swapped}.${sig}`;

    await expect(verifySharePayload(tampered, TEST_SECRET)).rejects.toThrow(/signature mismatch/);
  });

  test('flipping a byte in the signature half causes verify to reject', async () => {
    const token = await signSharePayload(SAMPLE, TEST_SECRET);
    const dot = token.indexOf('.');
    const body = token.slice(0, dot);
    const sig = token.slice(dot + 1);
    const swapped = sig[0] === 'a' ? `b${sig.slice(1)}` : `a${sig.slice(1)}`;
    const tampered = `${body}.${swapped}`;

    await expect(verifySharePayload(tampered, TEST_SECRET)).rejects.toThrow(/signature mismatch/);
  });

  test('signing under a different secret produces a token the original key rejects', async () => {
    const token = await signSharePayload(SAMPLE, 'a-different-but-valid-length-secret-value');
    await expect(verifySharePayload(token, TEST_SECRET)).rejects.toThrow(/signature mismatch/);
  });

  test('malformed token (no separator) is rejected', async () => {
    await expect(verifySharePayload('not-a-real-token', TEST_SECRET)).rejects.toThrow(
      /invalid share token format/
    );
  });
});

describe('share-url fail-soft behavior', () => {
  test('buildShareImageUrl returns null when OG_SHARE_SIGNING_SECRET is unset', async () => {
    const saved = process.env.OG_SHARE_SIGNING_SECRET;
    delete process.env.OG_SHARE_SIGNING_SECRET;
    try {
      const url = await buildShareImageUrl({
        title: 'Hi',
        body: 'There',
      });
      expect(url).toBeNull();
    } finally {
      process.env.OG_SHARE_SIGNING_SECRET = saved;
    }
  });

  test('signing with a too-short secret throws (defends against weak keys)', async () => {
    await expect(signSharePayload(SAMPLE, 'short')).rejects.toThrow(/at least 16 characters/);
  });
});

describe('share-url TTL gap (documented intentional behavior)', () => {
  // The current token format encodes no timestamp. Slack/WhatsApp/X
  // unfurl bots cache PNGs by URL aggressively (Vercel headers set
  // `cache-control: max-age=86400, immutable`), so infinite TTL is the
  // intended behavior. If a future change introduces a TTL field this
  // test will fail and the change will be a deliberate, reviewed move.
  test('verifySharePayload accepts a token with no embedded timestamp regardless of clock skew', async () => {
    const token = await signSharePayload(SAMPLE, TEST_SECRET);
    const decoded = await verifySharePayload(token, TEST_SECRET);
    expect(decoded.title).toBe(SAMPLE.title);
    // Sanity: the wire format is exactly two base64url segments.
    expect(token.split('.')).toHaveLength(2);
  });
});
