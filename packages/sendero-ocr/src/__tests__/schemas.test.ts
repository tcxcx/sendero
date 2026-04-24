import { describe, expect, it } from 'bun:test';

import {
  boardingPassSchema,
  idDocumentSchema,
  invoiceSchema,
  receiptSchema,
} from '../schemas';

describe('invoiceSchema', () => {
  it('accepts a fully populated invoice', () => {
    const parsed = invoiceSchema.parse({
      document_type: 'invoice',
      invoice_number: 'INV-1',
      invoice_date: '2026-04-01',
      due_date: '2026-04-30',
      currency: 'USD',
      total_amount: 100,
      tax_amount: 20,
      tax_rate: 20,
      tax_type: 'vat',
      vendor_name: 'Acme',
      vendor_address: null,
      customer_name: null,
      customer_address: null,
      website: null,
      email: null,
      line_items: [],
      payment_instructions: null,
      notes: null,
      language: null,
    });
    expect(parsed.document_type).toBe('invoice');
  });

  it("accepts 'other' with nulled financial fields", () => {
    const parsed = invoiceSchema.parse({
      document_type: 'other',
      invoice_number: null,
      invoice_date: null,
      due_date: null,
      currency: null,
      total_amount: null,
      tax_amount: null,
      tax_rate: null,
      tax_type: null,
      vendor_name: null,
      vendor_address: null,
      customer_name: null,
      customer_address: null,
      website: null,
      email: null,
      line_items: [],
      payment_instructions: null,
      notes: null,
      language: null,
    });
    expect(parsed.document_type).toBe('other');
  });
});

describe('receiptSchema', () => {
  it('accepts an image-source receipt with items', () => {
    const parsed = receiptSchema.parse({
      document_type: 'receipt',
      date: '2026-03-15',
      currency: 'EUR',
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
    expect(parsed.items).toHaveLength(1);
  });
});

describe('boardingPassSchema', () => {
  it('accepts a complete boarding-pass extraction', () => {
    const parsed = boardingPassSchema.parse({
      document_kind: 'boarding_pass',
      passenger_name: 'DOE/JOHN',
      pnr: 'ABC123',
      ticket_number: '0012345678901',
      carrier_code: 'AA',
      carrier_name: 'American Airlines',
      flight_number: '100',
      origin_iata: 'JFK',
      destination_iata: 'LHR',
      departure_at: '2026-05-04T18:30',
      boarding_at: '2026-05-04T17:45',
      cabin_class: 'economy',
      seat: '14A',
      gate: 'B22',
      sequence_number: '042',
      frequent_flyer: null,
      language: null,
    });
    expect(parsed.pnr).toBe('ABC123');
  });
});

describe('idDocumentSchema', () => {
  it('accepts a passport-style extraction with MRZ', () => {
    const parsed = idDocumentSchema.parse({
      document_variant: 'passport',
      issuing_country: 'USA',
      document_number: 'X12345678',
      surname: 'DOE',
      given_names: 'JOHN',
      date_of_birth: '1990-01-01',
      sex: 'M',
      nationality: 'USA',
      date_of_issue: '2020-01-01',
      date_of_expiry: '2030-01-01',
      place_of_birth: 'New York',
      mrz_line1: 'P<USADOE<<JOHN<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<',
      mrz_line2: 'X123456780USA9001019M3001019<<<<<<<<<<<<<<04',
      mrz_line3: null,
    });
    expect(parsed.document_variant).toBe('passport');
    expect(parsed.mrz_line3).toBeNull();
  });
});
