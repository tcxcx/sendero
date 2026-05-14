import { describe, expect, it } from 'bun:test';

import { parseSig, signRequest, verifyRequest } from '../auth/hmac';

const SECRET = 'super-secret-test-only';

describe('signRequest', () => {
  it('produces a t=<ts>,v1=<hex> header', () => {
    const out = signRequest('{"hello":"world"}', SECRET, 1700000000);
    expect(out.ts).toBe('1700000000');
    expect(out.header).toMatch(/^t=1700000000,v1=[0-9a-f]{64}$/);
  });

  it('golden vector — deterministic for known body + secret + ts', () => {
    const { header } = signRequest('canonical-body', 'key', 1700000000);
    // Computed from node:crypto HMAC-SHA256("1700000000.canonical-body", "key").
    // Pin so any drift in the signing pipeline (env locale, encoding, etc.)
    // surfaces here. Verified once via roundtrip test below.
    expect(header).toBe(
      't=1700000000,v1=86cf36b1a29ce51ffab652046ecaffae130271226b53d777d39c131963e467b1'
    );
  });
});

describe('parseSig', () => {
  it('parses a well-formed header', () => {
    const out = parseSig('t=1700000000,v1=deadbeef');
    expect(out).toEqual({ t: '1700000000', v1: 'deadbeef' });
  });

  it('returns null on missing field', () => {
    expect(parseSig('t=1700000000')).toBeNull();
    expect(parseSig('v1=deadbeef')).toBeNull();
  });

  it('returns null on non-hex v1', () => {
    expect(parseSig('t=1700000000,v1=not-hex')).toBeNull();
  });
});

describe('verifyRequest roundtrip', () => {
  it('accepts a freshly-signed body within the replay window', () => {
    const now = 1700000000;
    const { header } = signRequest('hello', SECRET, now);
    const verdict = verifyRequest({
      body: 'hello',
      header,
      secret: SECRET,
      nowSec: now + 10,
    });
    expect(verdict.ok).toBe(true);
  });

  it('rejects a stale timestamp (>5min)', () => {
    const now = 1700000000;
    const { header } = signRequest('hello', SECRET, now);
    const verdict = verifyRequest({
      body: 'hello',
      header,
      secret: SECRET,
      nowSec: now + 301,
    });
    expect(verdict).toEqual({ ok: false, reason: 'timestamp_out_of_window' });
  });

  it('rejects a timestamp too far in the future', () => {
    const now = 1700000000;
    const { header } = signRequest('hello', SECRET, now + 1000);
    const verdict = verifyRequest({
      body: 'hello',
      header,
      secret: SECRET,
      nowSec: now,
    });
    expect(verdict).toEqual({ ok: false, reason: 'timestamp_out_of_window' });
  });

  it('rejects a body tampered after signing', () => {
    const now = 1700000000;
    const { header } = signRequest('original-body', SECRET, now);
    const verdict = verifyRequest({
      body: 'TAMPERED-body',
      header,
      secret: SECRET,
      nowSec: now,
    });
    expect(verdict).toEqual({ ok: false, reason: 'hmac_mismatch' });
  });

  it('rejects a wrong secret', () => {
    const now = 1700000000;
    const { header } = signRequest('hello', SECRET, now);
    const verdict = verifyRequest({
      body: 'hello',
      header,
      secret: 'wrong-secret',
      nowSec: now,
    });
    expect(verdict).toEqual({ ok: false, reason: 'hmac_mismatch' });
  });

  it('accepts the prevSecret during rotation overlap', () => {
    const now = 1700000000;
    const { header } = signRequest('hello', 'old-secret', now);
    const verdict = verifyRequest({
      body: 'hello',
      header,
      secret: 'new-secret',
      prevSecret: 'old-secret',
      nowSec: now,
    });
    expect(verdict.ok).toBe(true);
  });

  it('rejects when neither secret matches', () => {
    const now = 1700000000;
    const { header } = signRequest('hello', 'mystery-secret', now);
    const verdict = verifyRequest({
      body: 'hello',
      header,
      secret: 'new-secret',
      prevSecret: 'old-secret',
      nowSec: now,
    });
    expect(verdict).toEqual({ ok: false, reason: 'hmac_mismatch' });
  });

  it('rejects malformed sig header', () => {
    const verdict = verifyRequest({
      body: 'hello',
      header: 'garbage',
      secret: SECRET,
      nowSec: 1700000000,
    });
    expect(verdict).toEqual({ ok: false, reason: 'malformed_sig_header' });
  });
});
