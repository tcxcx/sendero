/**
 * Track C3 — InvoiceHtml renderer (single vs itemized, mobile-first).
 *
 * Asserts:
 *   - Itemized HTML contains all 3 line item descriptions.
 *   - Single mode HTML hides the breakdown stack (only the hero shows
 *     the customer total).
 *   - The hero "Amount paid" anchor renders for paid invoices.
 *   - No `<table>` markup leaks into the rendered output (mobile-first
 *     property — tables in HTML emails ignore CSS media queries and
 *     trigger unreadable horizontal scroll on <320px viewports).
 */

import { describe, expect, test } from 'bun:test';
import { renderInvoiceHtml } from './index';
import type { TemplateProps } from '../types';
import { defaultTemplate } from '../../utils/default';

function makeProps(args: {
  lineItems: Array<{
    position: number;
    description: string;
    quantity: number;
    unitPrice: string;
    amount: string;
  }>;
  total: string;
  status?: string;
}): TemplateProps {
  return {
    invoice: {
      id: 'inv_test_001',
      number: 'INV-2026-0001',
      status: args.status ?? 'paid',
      issuedAt: new Date('2026-04-25T00:00:00Z'),
      dueAt: null,
      from: {
        name: 'Acme Travel Co',
        address: null,
        taxId: null,
        logoUrl: '',
      },
      to: {
        name: 'Jane Traveler',
        email: 'jane@example.com',
        address: null,
        taxId: null,
      },
      currency: 'USD',
      lineItems: args.lineItems,
      subtotal: args.total,
      discount: '0',
      taxRate: 0,
      taxAmount: '0',
      vatRate: 0,
      vatAmount: '0',
      total: args.total,
    },
    template: defaultTemplate({ include_qr: false }),
    publicUrl: 'https://app.sendero.travel/invoice/abc',
  };
}

describe('renderInvoiceHtml — itemized mode', () => {
  test('contains all 3 line item descriptions', async () => {
    const props = makeProps({
      total: '1115.22',
      lineItems: [
        {
          position: 1,
          description: 'Trip · hotel · PNR XYZ',
          quantity: 1,
          unitPrice: '1000',
          amount: '1000',
        },
        {
          position: 2,
          description: 'Booking management fee',
          quantity: 1,
          unitPrice: '110',
          amount: '110',
        },
        {
          position: 3,
          description: 'Service fee',
          quantity: 1,
          unitPrice: '5.22',
          amount: '5.22',
        },
      ],
    });
    const html = await renderInvoiceHtml(props);
    expect(html).toContain('Trip · hotel · PNR XYZ');
    expect(html).toContain('Booking management fee');
    expect(html).toContain('Service fee');
    // Customer never sees Sendero branding on the line.
    expect(html.toLowerCase()).not.toContain('sendero take');
  });

  test('renders the Breakdown section header', async () => {
    const props = makeProps({
      total: '1110',
      lineItems: [
        { position: 1, description: 'Cost', quantity: 1, unitPrice: '1000', amount: '1000' },
        { position: 2, description: 'Markup', quantity: 1, unitPrice: '110', amount: '110' },
      ],
    });
    const html = await renderInvoiceHtml(props);
    expect(html).toContain('Breakdown');
  });
});

describe('renderInvoiceHtml — single mode', () => {
  test('single line → hero shows total but breakdown stack is suppressed', async () => {
    const props = makeProps({
      total: '1115.22',
      lineItems: [
        {
          position: 1,
          description: 'Trip · hotel · PNR XYZ',
          quantity: 1,
          unitPrice: '1115.22',
          amount: '1115.22',
        },
      ],
    });
    const html = await renderInvoiceHtml(props);
    // Hero anchors the total at the top. Format: $1,115.22.
    expect(html).toContain('$1,115.22');
    expect(html).toContain('Amount paid');
    // The "Breakdown" section header is only emitted when there's
    // more than one line item.
    expect(html).not.toContain('Breakdown');
  });
});

describe('renderInvoiceHtml — mobile-first layout', () => {
  test('does not emit <table> markup for line items (would break <320px viewports)', async () => {
    const props = makeProps({
      total: '1115.22',
      lineItems: [
        { position: 1, description: 'Cost', quantity: 1, unitPrice: '1000', amount: '1000' },
        { position: 2, description: 'Markup', quantity: 1, unitPrice: '110', amount: '110' },
        { position: 3, description: 'Fee', quantity: 1, unitPrice: '5.22', amount: '5.22' },
      ],
    });
    const html = await renderInvoiceHtml(props);
    expect(html).not.toContain('<table');
    expect(html).not.toContain('<thead');
    expect(html).not.toContain('<tbody');
  });

  test('hero total uses display-size type at the top of the body', async () => {
    const props = makeProps({
      total: '1115.22',
      lineItems: [
        {
          position: 1,
          description: 'Trip',
          quantity: 1,
          unitPrice: '1115.22',
          amount: '1115.22',
        },
      ],
    });
    const html = await renderInvoiceHtml(props);
    // 36px hero amount. We assert the size literal so a future tweak
    // surfaces a deliberate test update rather than a quiet regression.
    expect(html).toMatch(/font-size:\s*36px/);
  });
});
