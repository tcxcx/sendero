import { cookies } from 'next/headers';

import { createHmac, timingSafeEqual } from 'node:crypto';

const PRIVATE_BETA_COOKIE = 'SENDERO_PRIVATE_BETA_ACCESS';
const PRIVATE_BETA_COOKIE_TTL_SECONDS = 60 * 60 * 24 * 14;

const CLOSED_VALUES = new Set(['0', 'false', 'no', 'closed', 'off']);

export type PrivateBetaAccessState = {
  isBetaOpen: boolean;
  isWhitelisted: boolean;
  canUseClerk: boolean;
};

export function isBetaOpen(): boolean {
  const raw = process.env.IS_BETA_OPEN;
  if (!raw) return true;
  return !CLOSED_VALUES.has(raw.trim().toLowerCase());
}

export async function getPrivateBetaAccessState(): Promise<PrivateBetaAccessState> {
  const betaOpen = isBetaOpen();
  const whitelisted = betaOpen ? false : await hasPrivateBetaAccessCookie();

  return {
    isBetaOpen: betaOpen,
    isWhitelisted: whitelisted,
    canUseClerk: betaOpen || whitelisted,
  };
}

export function isPrivateBetaWhitelisted(identifier: string): boolean {
  const normalized = normalizePrivateBetaIdentifier(identifier);
  if (!normalized) return false;

  return getPrivateBetaWhitelist().has(normalized);
}

export function normalizePrivateBetaIdentifier(
  identifier: string | null | undefined
): string | null {
  if (!identifier) return null;
  const trimmed = identifier.trim();
  if (!trimmed) return null;

  return trimmed.replace(/^mailto:/i, '').toLowerCase();
}

export function isPrivateBetaEmailIdentifier(identifier: string | null | undefined): boolean {
  const normalized = normalizePrivateBetaIdentifier(identifier);
  if (!normalized) return false;

  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized);
}

export async function setPrivateBetaAccessCookie(identifier: string) {
  const normalized = normalizePrivateBetaIdentifier(identifier);
  if (!normalized) return;

  const expiresAt = Date.now() + PRIVATE_BETA_COOKIE_TTL_SECONDS * 1000;
  const payload = Buffer.from(JSON.stringify({ id: normalized, exp: expiresAt })).toString(
    'base64url'
  );
  const signature = signPrivateBetaPayload(payload);
  const cookieStore = await cookies();

  cookieStore.set(PRIVATE_BETA_COOKIE, `${payload}.${signature}`, {
    path: '/',
    maxAge: PRIVATE_BETA_COOKIE_TTL_SECONDS,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
  });
}

function getPrivateBetaWhitelist(): Set<string> {
  const raw =
    process.env.PRIVATE_BETA_WHITELIST ??
    process.env.PRIVATE_BETA_ALLOWLIST ??
    process.env.SENDERO_PRIVATE_BETA_WHITELIST ??
    '';

  return new Set(
    raw
      .split(/[\s,;]+/)
      .map(normalizePrivateBetaIdentifier)
      .filter((value): value is string => Boolean(value))
  );
}

async function hasPrivateBetaAccessCookie(): Promise<boolean> {
  const cookieStore = await cookies();
  const cookie = cookieStore.get(PRIVATE_BETA_COOKIE)?.value;
  if (!cookie) return false;

  return verifyPrivateBetaCookie(cookie);
}

function verifyPrivateBetaCookie(cookie: string): boolean {
  const [payload, signature] = cookie.split('.');
  if (!payload || !signature) return false;

  const expected = signPrivateBetaPayload(payload);
  if (!constantTimeEqual(signature, expected)) return false;

  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      exp?: unknown;
      id?: unknown;
    };
    if (typeof parsed.exp !== 'number' || parsed.exp <= Date.now()) return false;
    if (typeof parsed.id !== 'string') return false;
    return isPrivateBetaWhitelisted(parsed.id);
  } catch {
    return false;
  }
}

function signPrivateBetaPayload(payload: string): string {
  return createHmac('sha256', privateBetaCookieSecret()).update(payload).digest('base64url');
}

function privateBetaCookieSecret(): string {
  return (
    process.env.PRIVATE_BETA_COOKIE_SECRET ??
    process.env.CLERK_SECRET_KEY ??
    'sendero-private-beta-local-cookie-secret'
  );
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}
