#!/usr/bin/env bun
/**
 * Renders the sample invoice fixture to a PDF buffer and writes to /tmp.
 * Fast sanity check — no DB, no blob, no email. Useful after template edits.
 *
 * Usage: bun run smoke:invoice-pdf
 */

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { renderInvoicePdfBuffer } from '../packages/invoicing/src/templates/pdf';

async function main() {
  const fixturePath = join(
    import.meta.dir,
    '..',
    'packages',
    'invoicing',
    '__fixtures__',
    'sample-invoice.json'
  );
  const fixture = JSON.parse(await readFile(fixturePath, 'utf8'));
  fixture.invoice.issuedAt = new Date(fixture.invoice.issuedAt);
  if (fixture.invoice.dueAt) fixture.invoice.dueAt = new Date(fixture.invoice.dueAt);

  const buf = await renderInvoicePdfBuffer(fixture);
  const outPath = '/tmp/sendero-sample-invoice.pdf';
  await writeFile(outPath, buf);

  console.log(`✓ rendered ${buf.length} bytes → ${outPath}`);
  console.log(`  magic bytes: ${buf.subarray(0, 4).toString('ascii')}`);
  console.log(`  open: open ${outPath}`);
}

main().catch(err => {
  console.error('✗ smoke failed:', err);
  process.exit(1);
});
