import type { Prisma } from '@sendero/database';

export function formatDate(value: Date | string | null | undefined): string {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' }).format(date);
}

export function formatDateTime(value: Date | string | null | undefined): string {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

export function formatMicroUsd(value: bigint | number | null | undefined): string {
  const numeric = typeof value === 'bigint' ? Number(value) / 1_000_000 : (value ?? 0);
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(numeric);
}

/**
 * Same as formatMicroUsd but with up to `maxDecimals` fraction digits
 * for sub-cent precision. Nanopayments routinely settle at $0.001 or
 * less per call — Intl's default 2-decimal currency rounds those to
 * `$0.00`, which makes the Spend dashboard read like nothing happened.
 *
 * Defaults to 6 decimals (micro-USDC granularity) so even the
 * cheapest per-call price renders distinctly. Caller can dial down
 * (e.g. 4) when the surface is space-constrained.
 */
export function formatMicroUsdPrecise(
  value: bigint | number | null | undefined,
  maxDecimals = 6
): string {
  const numeric = typeof value === 'bigint' ? Number(value) / 1_000_000 : (value ?? 0);
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: Math.max(2, Math.min(8, maxDecimals)),
  }).format(numeric);
}

export function formatDecimalUsd(
  value: Prisma.Decimal | string | number | null | undefined
): string {
  const numeric = value == null ? 0 : Number(value);
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(numeric);
}

export function objectFromJson(
  value: Prisma.JsonValue | null | undefined
): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

export function stringFromJson(
  value: Prisma.JsonValue | null | undefined,
  key: string,
  fallback = '—'
): string {
  const object = objectFromJson(value);
  const raw = object[key];
  return typeof raw === 'string' && raw.length > 0 ? raw : fallback;
}
