/**
 * Short-lived random tokens that let a web-signed-in user prove ownership of
 * a WhatsApp number by pasting the token into their first WA message.
 *
 * No DB here — the consuming app persists the `{token, userId, tenantId,
 * expiresAt}` tuple wherever is convenient (Prisma table, Redis, Postgres).
 */

import crypto from 'node:crypto';

export const LINK_TOKEN_TTL_MS = 15 * 60 * 1000; // 15 minutes
export const LINK_TOKEN_LENGTH = 8;

/** URL-safe base32 alphabet minus visually-ambiguous chars. */
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';

export function generateLinkToken(): string {
  const bytes = crypto.randomBytes(LINK_TOKEN_LENGTH);
  let out = '';
  for (let i = 0; i < LINK_TOKEN_LENGTH; i++) {
    out += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return out;
}

export function getTokenExpiry(ttlMs: number = LINK_TOKEN_TTL_MS): Date {
  return new Date(Date.now() + ttlMs);
}

export function isTokenExpired(expiresAt: Date | string): boolean {
  const t = typeof expiresAt === 'string' ? new Date(expiresAt) : expiresAt;
  return Date.now() >= t.getTime();
}

/**
 * Match-patterns for finding a link token in a WhatsApp message body.
 * We look for both "Sendero: XXXX" (branded invite) and raw tokens so
 * users can reply either way.
 */
export function extractLinkTokenFromMessage(text: string): string | null {
  if (!text) return null;
  const trimmed = text.trim();

  const branded = /\bsendero\s*[:#-]?\s*([A-Z0-9]{6,12})/i.exec(trimmed);
  if (branded?.[1]) return branded[1].toUpperCase();

  // Standalone short alphanum token
  if (trimmed.length <= 20 && /^[A-Z0-9]+$/i.test(trimmed)) {
    return trimmed.toUpperCase();
  }

  return null;
}
