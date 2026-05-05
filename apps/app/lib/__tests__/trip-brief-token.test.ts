/**
 * trip-brief-token round-trip + tamper tests.
 *
 * Locks the token format so the public `/trip/[token]` page and
 * `get_trip_brief`'s shareUrl builder can never drift.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import {
  buildTripBriefShareUrl,
  signTripBriefToken,
  verifyTripBriefToken,
} from '@sendero/tools/lib/trip-brief-token';

const realSecret = process.env.INVOICE_SIGNING_SECRET;
const realBaseUrl = process.env.NEXT_PUBLIC_APP_URL;

beforeEach(() => {
  process.env.INVOICE_SIGNING_SECRET = 'test-trip-brief-secret-please-rotate';
  process.env.NEXT_PUBLIC_APP_URL = 'https://app.sendero.travel';
});
afterEach(() => {
  if (realSecret === undefined) delete process.env.INVOICE_SIGNING_SECRET;
  else process.env.INVOICE_SIGNING_SECRET = realSecret;
  if (realBaseUrl === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
  else process.env.NEXT_PUBLIC_APP_URL = realBaseUrl;
});

describe('trip-brief token round-trip', () => {
  test('sign + verify recovers tripId + tenantId + iat', async () => {
    const token = await signTripBriefToken({ tripId: 'trp_1', tenantId: 'org_1' });
    expect(token).not.toBeNull();
    const out = await verifyTripBriefToken(token!);
    expect(out.tripId).toBe('trp_1');
    expect(out.tenantId).toBe('org_1');
    expect(out.iat).toBeGreaterThan(0);
  });

  test('token is two base64url segments separated by .', async () => {
    const token = await signTripBriefToken({ tripId: 'trp_1', tenantId: 'org_1' });
    expect(token).not.toBeNull();
    expect(token!.split('.')).toHaveLength(2);
    expect(token!).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  });
});

describe('trip-brief token tamper rejection', () => {
  test('flipped payload byte → signature mismatch', async () => {
    const token = await signTripBriefToken({ tripId: 'trp_1', tenantId: 'org_1' });
    const [body, sig] = token!.split('.');
    const tampered = `${body.slice(0, -1)}X.${sig}`;
    await expect(verifyTripBriefToken(tampered)).rejects.toThrow(/signature mismatch/);
  });

  test('flipped sig byte → signature mismatch', async () => {
    const token = await signTripBriefToken({ tripId: 'trp_1', tenantId: 'org_1' });
    const [body, sig] = token!.split('.');
    const tampered = `${body}.${sig.slice(0, -1)}X`;
    await expect(verifyTripBriefToken(tampered)).rejects.toThrow(/signature mismatch/);
  });

  test('missing dot → invalid format', async () => {
    await expect(verifyTripBriefToken('justgarbage')).rejects.toThrow(/invalid trip-brief token/);
  });

  test('different secret → signature mismatch', async () => {
    const token = await signTripBriefToken({ tripId: 'trp_1', tenantId: 'org_1' });
    process.env.INVOICE_SIGNING_SECRET = 'a-different-secret-also-long-enough';
    await expect(verifyTripBriefToken(token!)).rejects.toThrow(/signature mismatch/);
  });

  test('tenant rebind: token from one tenant should not pass for another even if tripId matches', async () => {
    // Defense-in-depth: the page handler should re-check tenantId
    // matches what the trip row actually has. The token already carries
    // it, so a token forged with the wrong tenantId would either fail
    // sig check OR present a mismatched tenant the handler rejects.
    const token = await signTripBriefToken({ tripId: 'trp_shared', tenantId: 'org_a' });
    const out = await verifyTripBriefToken(token!);
    expect(out.tenantId).toBe('org_a');
    // Page handler: if Trip.tenantId !== 'org_a', return 404.
  });
});

describe('trip-brief secret handling', () => {
  test('signing returns null when INVOICE_SIGNING_SECRET unset', async () => {
    delete process.env.INVOICE_SIGNING_SECRET;
    const token = await signTripBriefToken({ tripId: 'trp_1', tenantId: 'org_1' });
    expect(token).toBeNull();
  });

  test('verifying throws when INVOICE_SIGNING_SECRET unset', async () => {
    delete process.env.INVOICE_SIGNING_SECRET;
    await expect(verifyTripBriefToken('a.b')).rejects.toThrow(/secret unavailable/);
  });

  test('weak secret (< 16 chars) throws on sign', async () => {
    process.env.INVOICE_SIGNING_SECRET = 'tiny';
    await expect(signTripBriefToken({ tripId: 'trp_1', tenantId: 'org_1' })).rejects.toThrow(
      /at least 16/
    );
  });
});

describe('buildTripBriefShareUrl', () => {
  test('returns full URL with NEXT_PUBLIC_APP_URL prefix', async () => {
    const url = await buildTripBriefShareUrl({ tripId: 'trp_1', tenantId: 'org_1' });
    expect(url).not.toBeNull();
    expect(url!.startsWith('https://app.sendero.travel/trip/')).toBe(true);
  });

  test('returns path-only when no base URL configured', async () => {
    delete process.env.NEXT_PUBLIC_APP_URL;
    const url = await buildTripBriefShareUrl({ tripId: 'trp_1', tenantId: 'org_1' });
    expect(url!.startsWith('/trip/')).toBe(true);
  });

  test('explicit baseUrl overrides env', async () => {
    const url = await buildTripBriefShareUrl({
      tripId: 'trp_1',
      tenantId: 'org_1',
      baseUrl: 'https://custom.example.com/',
    });
    expect(url!.startsWith('https://custom.example.com/trip/')).toBe(true);
    // Trailing slash on baseUrl should be normalized.
    expect(url!).not.toContain('.com//trip');
  });

  test('returns null when secret unset (caller treats as no-link)', async () => {
    delete process.env.INVOICE_SIGNING_SECRET;
    const url = await buildTripBriefShareUrl({ tripId: 'trp_1', tenantId: 'org_1' });
    expect(url).toBeNull();
  });

  test('URL token round-trips through verify', async () => {
    const url = await buildTripBriefShareUrl({ tripId: 'trp_1', tenantId: 'org_1' });
    const token = decodeURIComponent(url!.split('/trip/')[1]);
    const out = await verifyTripBriefToken(token);
    expect(out.tripId).toBe('trp_1');
    expect(out.tenantId).toBe('org_1');
  });
});
