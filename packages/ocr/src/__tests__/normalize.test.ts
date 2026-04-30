import { describe, expect, it } from 'bun:test';

import {
  coerceNumber,
  isValidCurrencyCode,
  isValidIsoDate,
  normalizeInvoice,
  normalizeReceipt,
  normalizeWebsite,
} from '../normalize';
import type { InvoiceExtraction } from '../schemas/invoice';
import type { ReceiptExtraction } from '../schemas/receipt';

const baseInvoice = (): InvoiceExtraction => ({
  document_type: 'invoice',
  invoice_number: 'INV-123',
  invoice_date: '2026-04-01',
  due_date: '2026-04-30',
  currency: 'usd',
  total_amount: 1234.56,
  tax_amount: 200,
  tax_rate: 20,
  tax_type: 'vat',
  vendor_name: 'Acme Corp',
  vendor_address: null,
  customer_name: null,
  customer_address: null,
  website: 'https://www.Acme.com/invoices',
  email: null,
  line_items: [],
  payment_instructions: null,
  notes: null,
  language: null,
});

describe('primitives', () => {
  it('accepts ISO 4217 codes and rejects others', () => {
    expect(isValidCurrencyCode('USD')).toBe(true);
    expect(isValidCurrencyCode('usd')).toBe(false);
    expect(isValidCurrencyCode(null)).toBe(false);
    expect(isValidCurrencyCode('US')).toBe(false);
    expect(isValidCurrencyCode('USDC')).toBe(false);
  });

  it('validates ISO 8601 dates', () => {
    expect(isValidIsoDate('2026-04-23')).toBe(true);
    expect(isValidIsoDate('23/04/2026')).toBe(false);
    expect(isValidIsoDate(null)).toBe(false);
    expect(isValidIsoDate('2026-13-40')).toBe(false);
  });

  it('coerces mixed numeric inputs', () => {
    expect(coerceNumber(1234)).toBe(1234);
    expect(coerceNumber('$1,234.56')).toBe(1234.56);
    expect(coerceNumber('1.234,56')).toBe(1234.56);
    expect(coerceNumber('—')).toBe(null);
    expect(coerceNumber(null)).toBe(null);
    expect(coerceNumber(Number.NaN)).toBe(null);
  });

  it('strips protocol + www from websites', () => {
    expect(normalizeWebsite('https://www.example.com/path?q=1')).toBe('example.com');
    expect(normalizeWebsite('EXAMPLE.com')).toBe('example.com');
    expect(normalizeWebsite('not-a-domain')).toBe(null);
    expect(normalizeWebsite(null)).toBe(null);
  });
});

describe('normalizeInvoice', () => {
  it('upcases currency and cleans website', () => {
    const out = normalizeInvoice(baseInvoice());
    expect(out.currency).toBe('USD');
    expect(out.website).toBe('acme.com');
    expect(out.total_amount).toBe(1234.56);
  });

  it('parses DD/MM/YYYY into ISO', () => {
    const invoice = baseInvoice();
    invoice.invoice_date = '01/04/2026';
    invoice.due_date = '30-04-2026';
    const out = normalizeInvoice(invoice);
    expect(out.invoice_date).toBe('2026-04-01');
    expect(out.due_date).toBe('2026-04-30');
  });

  it('drops garbage currency codes', () => {
    const invoice = baseInvoice();
    invoice.currency = '$';
    expect(normalizeInvoice(invoice).currency).toBe(null);
  });
});

describe('normalizeReceipt', () => {
  const baseReceipt = (): ReceiptExtraction => ({
    document_type: 'receipt',
    date: '15/03/2026',
    currency: 'eur',
    total_amount: 42.5,
    subtotal_amount: 40,
    tax_amount: 2.5,
    tax_rate: 6.25,
    tax_type: null,
    store_name: 'Café Pampa',
    website: null,
    payment_method: 'credit card',
    items: [
      {
        description: 'Latte',
        quantity: 1,
        unit_price: 4.5,
        total_price: 4.5,
        discount: null,
      },
    ],
    cashier_name: null,
    email: null,
    register_number: null,
    language: null,
  });

  it('normalizes date + currency for European receipt', () => {
    const out = normalizeReceipt(baseReceipt());
    expect(out.currency).toBe('EUR');
    expect(out.date).toBe('2026-03-15');
  });
});
