/**
 * Receipt schema — vendor, total, date, category, line items.
 *
 * Ported from desk-v1 `packages/documents/src/schema.ts` (Fantasmita LLC,
 * internal reuse for Sendero). Adapted: zod v4 → zod v3.
 */

import { z } from 'zod';

import { documentTypeSchema, taxTypeSchema } from './common';

export const receiptSchema = z.object({
  document_type: documentTypeSchema.describe(
    "Classify the document. 'other' if this is not actually a receipt; leave financial fields null in that case."
  ),
  date: z.string().nullable().describe('ISO 8601 transaction date (YYYY-MM-DD)'),
  currency: z.string().nullable().describe('ISO 4217 currency code, e.g. USD, EUR'),
  total_amount: z.number().nullable().describe('Total amount paid, including tax'),
  subtotal_amount: z.number().nullable().describe('Subtotal before tax'),
  tax_amount: z.number().nullable().describe('Tax amount charged'),
  tax_rate: z.number().nullable().describe('Tax rate as a percentage'),
  tax_type: taxTypeSchema.nullable(),
  store_name: z.string().nullable().describe('Name of the merchant / store'),
  website: z.string().nullable().describe("Merchant root domain"),
  payment_method: z.string().nullable().describe('e.g. cash, credit card, debit card, apple pay'),
  items: z
    .array(
      z.object({
        description: z.string().nullable(),
        quantity: z.number().nullable(),
        unit_price: z.number().nullable(),
        total_price: z.number().nullable(),
        discount: z.number().nullable(),
      })
    )
    .describe('Ordered items from the receipt'),
  cashier_name: z.string().nullable(),
  email: z.string().nullable(),
  register_number: z.string().nullable(),
  language: z.string().nullable(),
});

export type ReceiptExtraction = z.infer<typeof receiptSchema>;
