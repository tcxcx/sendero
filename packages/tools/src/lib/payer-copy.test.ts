import { describe, expect, test } from 'bun:test';
import { payerCopy } from './payer-copy';

describe('payerCopy — tenant-paid', () => {
  test('renders tenant name when provided', () => {
    const c = payerCopy({ payer: 'tenant', amount: '$1,820', tenantName: 'Sendero Travel' });
    expect(c.lineItem).toBe('$1,820 · on Sendero Travel');
    expect(c.footnote).toContain('Sendero Travel');
  });

  test('falls back to generic phrase when tenant name missing', () => {
    const c = payerCopy({ payer: 'tenant', amount: '$1,820' });
    expect(c.lineItem).toBe('$1,820 · on your travel program');
  });

  test('trims whitespace-only tenant name', () => {
    const c = payerCopy({ payer: 'tenant', amount: '$1,820', tenantName: '   ' });
    expect(c.lineItem).toBe('$1,820 · on your travel program');
  });
});

describe('payerCopy — traveler-paid', () => {
  test('renders consumer wallet copy regardless of tenant name', () => {
    const c = payerCopy({ payer: 'traveler', amount: '$19.00', tenantName: 'Acme Corp' });
    expect(c.lineItem).toBe('$19.00 · charged to your wallet');
    expect(c.footnote).toContain('Sendero wallet');
  });

  test('does not leak tenant name into traveler copy', () => {
    const c = payerCopy({ payer: 'traveler', amount: '$19.00', tenantName: 'Acme Corp' });
    expect(c.footnote).not.toContain('Acme Corp');
    expect(c.lineItem).not.toContain('Acme Corp');
  });
});
