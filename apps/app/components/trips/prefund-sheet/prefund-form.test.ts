import { expect, test } from 'bun:test';
import { prefundFormSchema } from './prefund-form';

test('prefund form accepts decimal USDC and valid email', () => {
  const parsed = prefundFormSchema.safeParse({
    budgetUsdc: '100.123456',
    guestEmail: 'traveler@example.com',
    expiresInDays: 30,
    require2fa: true,
  });
  expect(parsed.success).toBe(true);
});

test('prefund form rejects invalid budget and email', () => {
  const parsed = prefundFormSchema.safeParse({
    budgetUsdc: '100.1234567',
    guestEmail: 'not-email',
    expiresInDays: 30,
    require2fa: true,
  });
  expect(parsed.success).toBe(false);
});
