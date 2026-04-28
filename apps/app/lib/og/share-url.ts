/**
 * Signed share-image URL builder.
 *
 * Channels (Slack, WhatsApp, web) and email helpers call this when a
 * tool's `share` payload has no explicit `imageUrl`. The returned URL
 * points at `/api/og/share?token=<signed>` and the route renders a
 * brand-frame Satori card from the decoded payload.
 *
 * Signing scheme: HMAC-SHA256 over `base64url(JSON(payload))`. Wire format
 * is `<payload>.<signature>`. Keyed by `OG_SHARE_SIGNING_SECRET` — a
 * deliberately separate secret from `INVOICE_SIGNING_SECRET` so the
 * two surfaces can rotate independently. Invoice URLs need to verify
 * for the lifetime of the receipt; share-image URLs can rotate freely
 * because unfurl bots cache PNGs by URL and we never persist tokens.
 *
 * Web Crypto rather than `jose` to keep the helper edge-runtime-friendly
 * with zero new dependencies in `apps/app`. The same primitive is used
 * by `slack-oauth-state.ts` for the install-CSRF token.
 */

import type { ShareCardProps } from './share-card';

export type SignedSharePayload = ShareCardProps;

const ENCODER = new TextEncoder();
const DECODER = new TextDecoder();

function getSecret(): string | null {
  return process.env.OG_SHARE_SIGNING_SECRET ?? null;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(input: string): Uint8Array {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/');
  const pad = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4));
  const binary = atob(padded + pad);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function hmac(secret: string, data: string): Promise<string> {
  if (!secret || secret.length < 16) {
    throw new Error('share signing secret must be at least 16 characters');
  }
  const key = await crypto.subtle.importKey(
    'raw',
    ENCODER.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
  const sig = await crypto.subtle.sign('HMAC', key, ENCODER.encode(data));
  return toBase64Url(new Uint8Array(sig));
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let acc = 0;
  for (let i = 0; i < a.length; i += 1) acc |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return acc === 0;
}

/**
 * Sign a share payload as `<payload>.<sig>` (both base64url). Verifier
 * mirrors the encoding so the wire format is symmetric.
 */
export async function signSharePayload(
  payload: SignedSharePayload,
  secret: string
): Promise<string> {
  const json = JSON.stringify(payload);
  const body = toBase64Url(ENCODER.encode(json));
  const sig = await hmac(secret, body);
  return `${body}.${sig}`;
}

export async function verifySharePayload(
  token: string,
  secret: string
): Promise<SignedSharePayload> {
  const dot = token.indexOf('.');
  if (dot < 0) throw new Error('invalid share token format');
  const body = token.slice(0, dot);
  const provided = token.slice(dot + 1);
  const expected = await hmac(secret, body);
  if (!timingSafeEqual(provided, expected)) {
    throw new Error('share token signature mismatch');
  }
  const json = DECODER.decode(fromBase64Url(body));
  const parsed = JSON.parse(json) as Record<string, unknown>;
  if (typeof parsed.title !== 'string' || typeof parsed.body !== 'string') {
    throw new Error('invalid share token payload');
  }
  const bullets = Array.isArray(parsed.bullets)
    ? parsed.bullets.filter((b): b is string => typeof b === 'string')
    : undefined;
  return {
    title: parsed.title,
    body: parsed.body,
    bullets,
    kicker: typeof parsed.kicker === 'string' ? parsed.kicker : undefined,
    footer: typeof parsed.footer === 'string' ? parsed.footer : undefined,
    ctaLabel: typeof parsed.ctaLabel === 'string' ? parsed.ctaLabel : undefined,
  };
}

export interface ShareInput {
  title: string;
  body: string;
  bullets?: string[];
  /** Optional CTA, used for the footer pill label. */
  primaryCta?: { label: string };
}

/**
 * Build a signed `/api/og/share` URL for a share payload. Returns null
 * when `OG_SHARE_SIGNING_SECRET` is unset; channel renderers treat null
 * as "no fallback image" and emit the card without a top image.
 */
export async function buildShareImageUrl(
  share: ShareInput,
  baseUrl?: string
): Promise<string | null> {
  const secret = getSecret();
  if (!secret) return null;

  const origin = baseUrl ?? process.env.NEXT_PUBLIC_APP_URL ?? '';
  const payload: SignedSharePayload = {
    title: share.title,
    body: share.body,
    bullets: share.bullets,
    ctaLabel: share.primaryCta?.label,
  };
  const token = await signSharePayload(payload, secret);
  const path = `/api/og/share?token=${encodeURIComponent(token)}`;
  return origin ? `${origin}${path}` : path;
}
