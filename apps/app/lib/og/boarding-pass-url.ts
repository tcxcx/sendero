/**
 * Signed boarding-pass image URL builder.
 *
 * Mirrors `share-url.ts` exactly — HMAC-SHA256 over base64url JSON,
 * keyed by `OG_SHARE_SIGNING_SECRET`. Same secret because both routes
 * are public-readable PNGs that need to survive Meta's unfurl bot
 * cache; rotating one rotates the other (acceptable since we never
 * persist the URLs anywhere — they're one-shot fetched by Meta).
 *
 * Used by the post-ticketing fan-out in `book_flight`: the flight
 * ticktes → BOOKING_CONFIRMED template fires → boarding-pass image
 * card sent via `send_image_message` with the URL this returns.
 */

import type { BoardingPassCardProps } from './boarding-pass-card';

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
    throw new Error('boarding-pass signing secret must be at least 16 characters');
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

export async function signBoardingPassPayload(
  payload: BoardingPassCardProps,
  secret: string
): Promise<string> {
  const json = JSON.stringify(payload);
  const body = toBase64Url(ENCODER.encode(json));
  const sig = await hmac(secret, body);
  return `${body}.${sig}`;
}

export async function verifyBoardingPassPayload(
  token: string,
  secret: string
): Promise<BoardingPassCardProps> {
  const dot = token.indexOf('.');
  if (dot < 0) throw new Error('invalid boarding-pass token format');
  const body = token.slice(0, dot);
  const provided = token.slice(dot + 1);
  const expected = await hmac(secret, body);
  if (!timingSafeEqual(provided, expected)) {
    throw new Error('boarding-pass token signature mismatch');
  }
  const json = DECODER.decode(fromBase64Url(body));
  const parsed = JSON.parse(json) as Record<string, unknown>;
  const required = [
    'origin',
    'destination',
    'departureDate',
    'departureTime',
    'passengerName',
    'pnr',
    'totalUsdc',
    'carrier',
  ] as const;
  for (const k of required) {
    if (typeof parsed[k] !== 'string') {
      throw new Error(`invalid boarding-pass token payload: ${k}`);
    }
  }
  return {
    origin: parsed.origin as string,
    destination: parsed.destination as string,
    departureDate: parsed.departureDate as string,
    departureTime: parsed.departureTime as string,
    arrivalTime: typeof parsed.arrivalTime === 'string' ? parsed.arrivalTime : undefined,
    passengerName: parsed.passengerName as string,
    pnr: parsed.pnr as string,
    cabin: typeof parsed.cabin === 'string' ? parsed.cabin : undefined,
    totalUsdc: parsed.totalUsdc as string,
    settlementTxHash:
      typeof parsed.settlementTxHash === 'string' ? parsed.settlementTxHash : undefined,
    carrier: parsed.carrier as string,
    kicker: typeof parsed.kicker === 'string' ? parsed.kicker : undefined,
  };
}

/**
 * Build a signed `/api/og/boarding-pass` URL. Returns null when the
 * signing secret isn't configured — callers fall back to skipping the
 * image attachment (the BOOKING_CONFIRMED template alone still ships).
 */
export async function buildBoardingPassImageUrl(
  payload: BoardingPassCardProps,
  baseUrl?: string
): Promise<string | null> {
  const secret = getSecret();
  if (!secret) return null;
  const origin = baseUrl ?? process.env.NEXT_PUBLIC_APP_URL ?? '';
  const token = await signBoardingPassPayload(payload, secret);
  const path = `/api/og/boarding-pass?token=${encodeURIComponent(token)}`;
  return origin ? `${origin}${path}` : path;
}
