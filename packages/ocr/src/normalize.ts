/**
 * Post-processing for invoice/receipt extractions.
 *
 * Ported from desk-v1 `packages/documents/src/utils/validation.ts` and
 * `utils.ts` (Fantasmita LLC, internal reuse). Adapted: shrunk to the
 * narrow set of fixes that actually matter in v0 — currency-code upcase,
 * date parsing, numeric coercion. desk-v1's cross-field consistency +
 * mathematical re-extraction passes can be ported later.
 */

import type { InvoiceExtraction } from './schemas/invoice';
import type { ReceiptExtraction } from './schemas/receipt';

// ─── helpers ──────────────────────────────────────────────────────────

export function isValidCurrencyCode(code: string | null | undefined): boolean {
  if (!code) return false;
  return /^[A-Z]{3}$/.test(code);
}

export function isValidIsoDate(value: string | null | undefined): boolean {
  if (!value) return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value);
  return !Number.isNaN(date.getTime());
}

export function coerceNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  // Strip currency symbols + thousands separators. European 1.234,56 → 1234.56.
  const cleaned = value.replace(/[^\d,.\-]/g, '');
  if (!cleaned) return null;
  const lastComma = cleaned.lastIndexOf(',');
  const lastDot = cleaned.lastIndexOf('.');
  let normalized = cleaned;
  if (lastComma > lastDot) {
    normalized = cleaned.replace(/\./g, '').replace(',', '.');
  } else {
    normalized = cleaned.replace(/,/g, '');
  }
  const n = Number.parseFloat(normalized);
  return Number.isFinite(n) ? n : null;
}

/** Strip protocol + www + path to a bare root domain, lowercased. */
export function normalizeWebsite(value: string | null | undefined): string | null {
  if (!value) return null;
  let cleaned = value
    .trim()
    .toLowerCase()
    .replace(/^(https?:\/\/)?(www\.)?/i, '');
  cleaned = (cleaned.split('/')[0] ?? cleaned).replace(/[?#].*$/, '');
  if (!cleaned || !cleaned.includes('.')) return null;
  return cleaned;
}

/** Upcase currency code if it's three letters; drop otherwise. */
function normalizeCurrency(value: string | null | undefined): string | null {
  if (!value) return null;
  const upper = value.trim().toUpperCase();
  return isValidCurrencyCode(upper) ? upper : null;
}

/** Accepts YYYY-MM-DD, DD/MM/YYYY, DD-MM-YYYY, etc. Returns ISO or null. */
function normalizeDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (isValidIsoDate(trimmed)) return trimmed;
  // Try DD/MM/YYYY and DD-MM-YYYY forms.
  const euMatch = trimmed.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})$/);
  if (euMatch) {
    const [, d, m, y] = euMatch;
    const iso = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    return isValidIsoDate(iso) ? iso : null;
  }
  // Try YYYY/MM/DD form.
  const jpMatch = trimmed.match(/^(\d{4})[\/\.](\d{1,2})[\/\.](\d{1,2})$/);
  if (jpMatch) {
    const [, y, m, d] = jpMatch;
    const iso = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    return isValidIsoDate(iso) ? iso : null;
  }
  return null;
}

// ─── public normalizers ───────────────────────────────────────────────

export function normalizeInvoice(input: InvoiceExtraction): InvoiceExtraction {
  return {
    ...input,
    currency: normalizeCurrency(input.currency),
    invoice_date: normalizeDate(input.invoice_date),
    due_date: normalizeDate(input.due_date),
    total_amount: coerceNumber(input.total_amount as number | null),
    tax_amount: coerceNumber(input.tax_amount as number | null),
    tax_rate: coerceNumber(input.tax_rate as number | null),
    website: normalizeWebsite(input.website),
    line_items: input.line_items.map(item => ({
      ...item,
      quantity: coerceNumber(item.quantity as number | null),
      unit_price: coerceNumber(item.unit_price as number | null),
      total_price: coerceNumber(item.total_price as number | null),
    })),
  };
}

export function normalizeReceipt(input: ReceiptExtraction): ReceiptExtraction {
  return {
    ...input,
    currency: normalizeCurrency(input.currency),
    date: normalizeDate(input.date),
    total_amount: coerceNumber(input.total_amount as number | null),
    subtotal_amount: coerceNumber(input.subtotal_amount as number | null),
    tax_amount: coerceNumber(input.tax_amount as number | null),
    tax_rate: coerceNumber(input.tax_rate as number | null),
    website: normalizeWebsite(input.website),
    items: input.items.map(item => ({
      ...item,
      quantity: coerceNumber(item.quantity as number | null),
      unit_price: coerceNumber(item.unit_price as number | null),
      total_price: coerceNumber(item.total_price as number | null),
      discount: coerceNumber(item.discount as number | null),
    })),
  };
}
