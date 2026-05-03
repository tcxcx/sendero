/**
 * MoonPay webhook signature verification.
 *
 * MoonPay signs every webhook delivery with HMAC-SHA256 keyed by the
 * dashboard-issued signing secret (env: `MOONPAY_WEBHOOK_SECRET`).
 *
 * Signature header: `Moonpay-Signature-V2: t=<unix-seconds>,s=<hex>`
 * Computation:      HMAC-SHA256(`${t}.${rawBody}`, signingSecret)
 *
 * Returns a discriminated result so callers can audit the failure mode
 * (bad signature vs replay window) without throwing.
 */

import crypto from 'node:crypto';

const REPLAY_WINDOW_SECONDS = 5 * 60;

export interface SignatureVerifyResult {
  signatureValid: boolean;
  /** null when the header doesn't carry a parseable timestamp. */
  replayWindowOk: boolean | null;
  timestamp: number | null;
  reason?: string;
}

interface ParsedHeader {
  timestamp: number;
  signature: string;
}

function parseSignatureHeader(raw: string | null): ParsedHeader | null {
  if (!raw) return null;
  const parts = raw.split(',').map(p => p.trim());
  let t: number | null = null;
  let s: string | null = null;
  for (const part of parts) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key === 't') t = Number(value);
    if (key === 's') s = value;
  }
  if (t === null || Number.isNaN(t) || !s) return null;
  return { timestamp: t, signature: s };
}

function safeEqualHex(a: string, b: string): boolean {
  // Hex strings have known-equal length when valid; reject divergent
  // lengths up front so timingSafeEqual isn't called with bad inputs.
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
  } catch {
    return false;
  }
}

export function verifyMoonPaySignature(
  rawBody: string,
  signatureHeader: string | null,
  signingSecret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000)
): SignatureVerifyResult {
  const parsed = parseSignatureHeader(signatureHeader);
  if (!parsed) {
    return {
      signatureValid: false,
      replayWindowOk: null,
      timestamp: null,
      reason: 'malformed_header',
    };
  }

  const expected = crypto
    .createHmac('sha256', signingSecret)
    .update(`${parsed.timestamp}.${rawBody}`)
    .digest('hex');

  const sigOk = safeEqualHex(parsed.signature, expected);
  const drift = Math.abs(nowSeconds - parsed.timestamp);
  const replayOk = drift <= REPLAY_WINDOW_SECONDS;

  return {
    signatureValid: sigOk,
    replayWindowOk: replayOk,
    timestamp: parsed.timestamp,
    reason: !sigOk
      ? 'signature_mismatch'
      : !replayOk
        ? `replay_window_exceeded (${drift}s)`
        : undefined,
  };
}
