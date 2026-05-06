import { test, expect, beforeAll } from 'bun:test';

import {
  GroupClaimTokenError,
  buildGroupClaimUrl,
  signGroupClaimToken,
  verifyGroupClaimToken,
} from './group-claim-token';

const TEST_SECRET = 'test_invoice_signing_secret_at_least_16_chars';

beforeAll(() => {
  process.env.INVOICE_SIGNING_SECRET = TEST_SECRET;
});

test('sign+verify roundtrip preserves payload fields', async () => {
  const token = await signGroupClaimToken({
    groupTripId: 'gtr_abc',
    tenantId: 'ten_xyz',
    passengerSeatId: 'gps_seat_1',
    role: 'lead',
  });
  const payload = await verifyGroupClaimToken(token);
  expect(payload.groupTripId).toBe('gtr_abc');
  expect(payload.tenantId).toBe('ten_xyz');
  expect(payload.passengerSeatId).toBe('gps_seat_1');
  expect(payload.role).toBe('lead');
  expect(typeof payload.iat).toBe('number');
  expect(typeof payload.exp).toBe('number');
  expect(payload.exp).toBeGreaterThan(payload.iat);
});

test('open-seat token defaults passengerSeatId=null and role=attendee', async () => {
  const token = await signGroupClaimToken({
    groupTripId: 'gtr_abc',
    tenantId: 'ten_xyz',
  });
  const payload = await verifyGroupClaimToken(token);
  expect(payload.passengerSeatId).toBeNull();
  expect(payload.role).toBe('attendee');
});

test('verifier strips a leading "claim:" prefix (WhatsApp inbound shape)', async () => {
  const token = await signGroupClaimToken({ groupTripId: 'gtr_a', tenantId: 'ten_x' });
  const payload = await verifyGroupClaimToken(`claim:${token}`);
  expect(payload.groupTripId).toBe('gtr_a');
});

test('tampered signature fails with bad_signature', async () => {
  const token = await signGroupClaimToken({ groupTripId: 'gtr_a', tenantId: 'ten_x' });
  const [body, sig] = token.split('.');
  // flip one char in the signature
  const tampered = `${body}.${sig.slice(0, -1)}${sig.slice(-1) === 'a' ? 'b' : 'a'}`;
  await expect(verifyGroupClaimToken(tampered)).rejects.toThrow(/signature/);
  try {
    await verifyGroupClaimToken(tampered);
  } catch (err) {
    expect((err as GroupClaimTokenError).code).toBe('bad_signature');
  }
});

test('tampered payload (different tenantId) fails — body change invalidates sig', async () => {
  const token = await signGroupClaimToken({ groupTripId: 'gtr_a', tenantId: 'ten_x' });
  // Forge a body with a different tenantId, keep the original sig.
  const forgedBody = btoa(
    JSON.stringify({ groupTripId: 'gtr_a', tenantId: 'ten_OTHER', iat: 1, exp: 99999999999 })
  )
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  const sig = token.split('.')[1];
  await expect(verifyGroupClaimToken(`${forgedBody}.${sig}`)).rejects.toThrow();
});

test('expired token fails with expired', async () => {
  const token = await signGroupClaimToken({
    groupTripId: 'gtr_a',
    tenantId: 'ten_x',
    ttlSeconds: -10, // already expired
  });
  try {
    await verifyGroupClaimToken(token);
    throw new Error('should have thrown');
  } catch (err) {
    expect((err as GroupClaimTokenError).code).toBe('expired');
  }
});

test('malformed token (no dot) fails with malformed', async () => {
  try {
    await verifyGroupClaimToken('not_a_token');
    throw new Error('should have thrown');
  } catch (err) {
    expect((err as GroupClaimTokenError).code).toBe('malformed');
  }
});

test('missing signing secret throws no_secret on sign', async () => {
  const previous = process.env.INVOICE_SIGNING_SECRET;
  delete process.env.INVOICE_SIGNING_SECRET;
  try {
    await expect(signGroupClaimToken({ groupTripId: 'gtr_a', tenantId: 'ten_x' })).rejects.toThrow(
      /INVOICE_SIGNING_SECRET/
    );
  } finally {
    process.env.INVOICE_SIGNING_SECRET = previous;
  }
});

test('buildGroupClaimUrl encodes the token + uses NEXT_PUBLIC_APP_URL', async () => {
  process.env.NEXT_PUBLIC_APP_URL = 'https://app.sendero.travel';
  const token = await signGroupClaimToken({ groupTripId: 'gtr_a', tenantId: 'ten_x' });
  const url = buildGroupClaimUrl(token);
  expect(url.startsWith('https://app.sendero.travel/group/')).toBe(true);
  // Encoded — no dots/slashes in the path component would break Next routing.
  // Our base64url has no slashes; keep the test loose so the encoder choice
  // can change without breaking the contract.
  expect(url).toContain('/group/');
});
