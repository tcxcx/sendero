/**
 * Phone-number + text normalization helpers.
 *
 * desk-v1 stored phones as raw Meta digits (e.g. `521234567890`) which means
 * `+52 123…` and `52123…` read as different identities. Sendero normalizes
 * to E.164 (`+52123…`) on ingest so `channel_identity.phone` is stable
 * across the UI, WhatsApp, and the agent memory.
 */

import parsePhoneNumberFromString, {
  type CountryCode,
  isValidPhoneNumber,
} from 'libphonenumber-js';

export function normalizeToE164(
  raw: string,
  defaultCountry?: string | CountryCode
): string | null {
  if (!raw) return null;
  const withPlus = raw.startsWith('+') ? raw : `+${raw}`;
  const parsed = parsePhoneNumberFromString(withPlus, defaultCountry as CountryCode | undefined);
  return parsed?.isValid() ? parsed.number : null;
}

export function isValidE164(candidate: string): boolean {
  return isValidPhoneNumber(candidate);
}

/**
 * Strip Markdown + cap emoji budget for WhatsApp display.
 * Meta's chat renderer supports a subset of Markdown (*bold*, _italic_,
 * ~strike~, ```code```) that differs from standard — we flatten to plain
 * text and optionally split to stay under the 4096-char body limit.
 */
export function formatForWhatsApp(text: string, opts: { maxChars?: number } = {}): string[] {
  const maxChars = opts.maxChars ?? 4096;
  const stripped = text
    .replace(/\*\*([^*]+)\*\*/g, '*$1*') // Markdown **bold** → WA *bold*
    .replace(/__([^_]+)__/g, '_$1_')
    .replace(/`([^`]+)`/g, '$1')
    .trim();
  if (stripped.length <= maxChars) return [stripped];

  const chunks: string[] = [];
  let remaining = stripped;
  while (remaining.length > maxChars) {
    let cut = remaining.lastIndexOf('\n', maxChars);
    if (cut < maxChars * 0.5) cut = remaining.lastIndexOf(' ', maxChars);
    if (cut < maxChars * 0.5) cut = maxChars;
    chunks.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}
