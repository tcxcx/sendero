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
