/**
 * Locale-aware Intl formatters. Built on the ICU `Intl` API so they work
 * across Node, Bun, and browser. Prefer these over inline `Intl.NumberFormat`
 * calls so currency / date / time / list formatting is consistent.
 */

export function formatMoney(
  amount: number,
  currency: string,
  locale: string,
  opts: Intl.NumberFormatOptions = {}
): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
    ...opts,
  }).format(amount);
}

export function formatDate(
  date: Date | string | number,
  locale: string,
  opts: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }
): string {
  return new Intl.DateTimeFormat(locale, opts).format(new Date(date));
}

export function formatDateTime(date: Date | string | number, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(date));
}

export function formatRelativeTime(date: Date | string | number, locale: string): string {
  const then = new Date(date).getTime();
  const now = Date.now();
  const diffSec = Math.round((then - now) / 1000);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  const absSec = Math.abs(diffSec);
  if (absSec < 60) return rtf.format(diffSec, 'second');
  if (absSec < 3_600) return rtf.format(Math.round(diffSec / 60), 'minute');
  if (absSec < 86_400) return rtf.format(Math.round(diffSec / 3_600), 'hour');
  return rtf.format(Math.round(diffSec / 86_400), 'day');
}

export function formatList(items: string[], locale: string, type: 'conjunction' | 'disjunction' = 'conjunction'): string {
  return new Intl.ListFormat(locale, { style: 'long', type }).format(items);
}

/** Hours + minutes from a raw minute count. */
export function formatDurationHoursMinutes(totalMinutes: number, locale: string): string {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0 || hours === 0) parts.push(`${minutes}m`);
  return formatList(parts, locale);
}
