/**
 * eSIM Go webhook signature verification (v3 callbacks, HMAC enabled).
 *
 * Per https://docs.esim-go.com/api/v2_5/ → "HMAC Signature Validation":
 *
 *   const signature = crypto
 *     .createHmac('sha256', apiKey)        // ← API key, not a separate secret
 *     .update(body)                         // ← raw request body (string)
 *     .digest('base64');                    // ← base64, not hex
 *
 *   const matches = signature === signatureHeader;
 *
 * Two non-obvious points the docs surface:
 *
 *   1. The HMAC key IS the same `X-API-Key` value Sendero uses to call
 *      eSIM Go's REST API. There's no separate webhook secret. We
 *      previously tried generating a random `ESIM_GO_WEBHOOK_SECRET`
 *      and pushing it to Vercel — eSIM Go never used it. Dropped.
 *
 *   2. The encoding is base64, not hex. Most provider webhook docs use
 *      hex; eSIM Go's reference snippet uses `.digest('base64')`.
 *
 * V3 callbacks (with HMAC) must be enabled in the eSIM Go portal —
 * they default to V2 (no signature). One-time toggle.
 *
 * Sendero owns the eSIM Go org, so a single API key signs every
 * callback. The receiver reads `ESIM_GO_API_KEY` from env and passes
 * it here. Tenants resell our inventory but don't have their own
 * eSIM Go credentials.
 */

import crypto from 'node:crypto';

export interface EsimGoSignatureResult {
  signatureValid: boolean;
  reason?: string;
}

function safeEqualBase64(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a, 'base64'), Buffer.from(b, 'base64'));
  } catch {
    return false;
  }
}

export function verifyEsimGoSignature(
  rawBody: string,
  signatureHeader: string | null,
  apiKey: string
): EsimGoSignatureResult {
  if (!signatureHeader) {
    return { signatureValid: false, reason: 'missing_header' };
  }
  if (!apiKey) {
    return { signatureValid: false, reason: 'missing_api_key' };
  }

  const expected = crypto.createHmac('sha256', apiKey).update(rawBody).digest('base64');
  const ok = safeEqualBase64(signatureHeader.trim(), expected);
  return ok ? { signatureValid: true } : { signatureValid: false, reason: 'signature_mismatch' };
}
