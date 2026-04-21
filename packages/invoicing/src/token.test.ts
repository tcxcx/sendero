import { test, expect } from 'bun:test';
import { signInvoiceToken, verifyInvoiceToken } from './token';

const SECRET = 'test_secret_at_least_32_bytes_long_for_hs256';

test('signInvoiceToken + verifyInvoiceToken round-trip', async () => {
  const token = await signInvoiceToken({ iid: 'inv_123', tenantId: 't_abc' }, SECRET);
  const payload = await verifyInvoiceToken(token, SECRET);
  expect(payload.iid).toBe('inv_123');
  expect(payload.tenantId).toBe('t_abc');
});

test('verifyInvoiceToken rejects tampered token', async () => {
  const token = await signInvoiceToken({ iid: 'inv_123', tenantId: 't_abc' }, SECRET);
  const tampered = token.slice(0, -4) + 'XXXX';
  await expect(verifyInvoiceToken(tampered, SECRET)).rejects.toThrow();
});

test('verifyInvoiceToken rejects wrong secret', async () => {
  const token = await signInvoiceToken({ iid: 'inv_123', tenantId: 't_abc' }, SECRET);
  await expect(verifyInvoiceToken(token, 'different_secret_at_least_32_bytes_x')).rejects.toThrow();
});

test('signInvoiceToken throws when secret too short', async () => {
  await expect(signInvoiceToken({ iid: 'x', tenantId: 'y' }, '')).rejects.toThrow();
  await expect(signInvoiceToken({ iid: 'x', tenantId: 'y' }, 'short')).rejects.toThrow();
});
