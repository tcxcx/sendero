/**
 * QR-token signing — the QR endpoint at `/api/esim/qr/<token>` reads
 * `lpaCode` for an Esim row only when the request carries a valid
 * HMAC token. Keeps activation codes off public URLs while still
 * letting unfurl bots / channel renderers fetch the image.
 *
 * Token shape: `<base64url(esimId)>.<hex(hmac-sha256)>`. The signing
 * secret matches `INVOICE_SIGNING_SECRET` so deployments only configure
 * one.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

function b64url(input: string): string {
  return Buffer.from(input, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function fromB64url(input: string): string {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/').padEnd(input.length + ((4 - (input.length % 4)) % 4), '=');
  return Buffer.from(padded, 'base64').toString('utf8');
}

export function signQrToken(esimId: string, secret: string): string {
  if (!secret) throw new Error('signQrToken: secret required');
  const payload = b64url(esimId);
  const sig = createHmac('sha256', secret).update(payload).digest('hex');
  return `${payload}.${sig}`;
}

export function verifyQrToken(token: string, secret: string): { esimId: string } | null {
  if (!secret) return null;
  const dot = token.lastIndexOf('.');
  if (dot < 1) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = createHmac('sha256', secret).update(payload).digest('hex');
  if (sig.length !== expected.length) return null;
  try {
    if (!timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'))) return null;
  } catch {
    return null;
  }
  try {
    return { esimId: fromB64url(payload) };
  } catch {
    return null;
  }
}
