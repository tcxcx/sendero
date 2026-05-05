import { describe, expect, test } from 'bun:test';
import { signQrToken, verifyQrToken } from './qr';

describe('signQrToken / verifyQrToken — round-trip', () => {
  test('valid token round-trips esimId', () => {
    const t = signQrToken('esim_abc_123', 'sekret');
    const v = verifyQrToken(t, 'sekret');
    expect(v).toEqual({ esimId: 'esim_abc_123' });
  });

  test('wrong secret rejects', () => {
    const t = signQrToken('esim_abc_123', 'sekret');
    expect(verifyQrToken(t, 'other')).toBeNull();
  });

  test('tampered payload rejects', () => {
    const t = signQrToken('esim_abc_123', 'sekret');
    const dot = t.lastIndexOf('.');
    const tampered = `${t.slice(0, dot - 1)}X${t.slice(dot)}`;
    expect(verifyQrToken(tampered, 'sekret')).toBeNull();
  });

  test('tampered signature rejects', () => {
    const t = signQrToken('esim_abc_123', 'sekret');
    const tampered = t.slice(0, -1) + 'a';
    expect(verifyQrToken(tampered, 'sekret')).toBeNull();
  });

  test('malformed token (no dot) rejects', () => {
    expect(verifyQrToken('not-a-token', 'sekret')).toBeNull();
  });

  test('empty secret rejects (defensive — never sign or verify with empty)', () => {
    expect(() => signQrToken('id', '')).toThrow();
    expect(verifyQrToken('payload.sig', '')).toBeNull();
  });
});
