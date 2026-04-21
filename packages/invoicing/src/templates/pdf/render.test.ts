// packages/invoicing/src/templates/pdf/render.test.ts
import { test, expect } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { renderInvoicePdfBuffer } from './index';

test('renders sample invoice to a non-empty PDF buffer with %PDF magic', async () => {
  const url = new URL('../../../__fixtures__/sample-invoice.json', import.meta.url);
  const fixture = JSON.parse(await readFile(url, 'utf8'));
  fixture.invoice.issuedAt = new Date(fixture.invoice.issuedAt);
  if (fixture.invoice.dueAt) fixture.invoice.dueAt = new Date(fixture.invoice.dueAt);

  const buf = await renderInvoicePdfBuffer(fixture);
  expect(buf.length).toBeGreaterThan(1000);
  expect(buf.subarray(0, 4).toString('ascii')).toBe('%PDF');
}, 60_000);
