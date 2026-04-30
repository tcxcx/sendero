/**
 * Shared enums + primitives for every document schema.
 *
 * Ported from desk-v1 `packages/documents/src/schema.ts` (Fantasmita LLC,
 * internal reuse for Sendero). Adapted: zod v4 → zod v3 and tightened
 * nullable→optional semantics where it makes downstream normalization
 * cheaper.
 */

import { z } from 'zod';

/** Kinds @sendero/ocr can extract. Used as the union tag on `DocumentResult`. */
export const documentKindSchema = z.enum(['invoice', 'receipt', 'boarding_pass', 'id_document']);
export type DocumentKind = z.infer<typeof documentKindSchema>;

export const taxTypeSchema = z.enum([
  'vat',
  'sales_tax',
  'gst',
  'withholding_tax',
  'service_tax',
  'excise_tax',
  'reverse_charge',
  'custom_tax',
]);

export const documentTypeSchema = z.enum(['invoice', 'receipt', 'other']);

/** Common numeric + date rules reused across invoice/receipt. */
export const isoDateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected ISO-8601 date (YYYY-MM-DD)');

export const iso4217Currency = z
  .string()
  .regex(/^[A-Z]{3}$/, 'Expected ISO 4217 currency code (e.g. USD, EUR)');
