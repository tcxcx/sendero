/**
 * Invoice schema — issuer, line items, totals, currency, due date.
 *
 * Ported from desk-v1 `packages/documents/src/schema.ts` (Fantasmita LLC,
 * internal reuse for Sendero). Adapted: zod v4 → zod v3, shortened field
 * descriptions, dropped the `document_type` discriminator (callers already
 * know the kind — it's part of the extract request).
 */

import { z } from 'zod';

import { documentTypeSchema, taxTypeSchema } from './common';

export const invoiceSchema = z.object({
  document_type: documentTypeSchema.describe(
    "Classify the document before extracting. 'other' if this is not actually an invoice (contract, receipt, confirmation, etc.). If 'other', leave financial fields null."
  ),
  invoice_number: z.string().nullable().describe('Unique invoice identifier'),
  invoice_date: z.string().nullable().describe('ISO 8601 invoice issue date (YYYY-MM-DD)'),
  due_date: z.string().nullable().describe('ISO 8601 payment due date (YYYY-MM-DD)'),
  currency: z.string().nullable().describe('ISO 4217 currency code, e.g. USD, EUR'),
  total_amount: z.number().nullable().describe('Grand total charged on the invoice'),
  tax_amount: z.number().nullable().describe('Total tax amount'),
  tax_rate: z.number().nullable().describe('Tax rate as a percentage (e.g. 20 for 20%)'),
  tax_type: taxTypeSchema.nullable().describe('Tax regime if visible (vat, sales_tax, gst, etc.)'),
  vendor_name: z
    .string()
    .nullable()
    .describe(
      'Legal name of the issuing vendor (look for Inc., Ltd, LLC, GmbH, etc. in letterhead)'
    ),
  vendor_address: z.string().nullable().describe('Full postal address of the vendor'),
  customer_name: z.string().nullable().describe('Name of the customer/payer'),
  customer_address: z.string().nullable().describe('Full postal address of the customer'),
  website: z
    .string()
    .nullable()
    .describe('Vendor root domain (e.g. example.com — not www. or shop.)'),
  email: z.string().nullable().describe('Vendor contact email'),
  line_items: z
    .array(
      z.object({
        description: z.string().nullable(),
        quantity: z.number().nullable(),
        unit_price: z.number().nullable(),
        total_price: z.number().nullable(),
      })
    )
    .describe('Ordered line items from the invoice body'),
  payment_instructions: z.string().nullable().describe('Payment terms, bank details, IBAN, etc.'),
  notes: z.string().nullable().describe('Additional notes / memo'),
  language: z.string().nullable().describe('Document language, BCP-47 or common English name'),
});

export type InvoiceExtraction = z.infer<typeof invoiceSchema>;
