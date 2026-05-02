import { describe, expect, mock, test } from 'bun:test';

mock.module('@sendero/database', () => ({
  prisma: {},
}));

mock.module('@sendero/env', () => ({
  env: {
    kapsoApiKey: () => 'kapso_test_key',
    kapsoApiBaseUrl: () => 'https://api.kapso.test',
  },
}));

const { ensureTenantWhatsAppFlows } = await import('./whatsapp-flow-registry');

describe('ensureTenantWhatsAppFlows', () => {
  test('does not block tenant provisioning when Prisma flow registrations are unavailable', async () => {
    const result = await ensureTenantWhatsAppFlows({
      tenantId: 'tenant_123',
      tenantDisplayName: 'QA Travel',
      phoneNumberId: '1125870723936815',
      businessAccountId: '942292748683446',
    });

    expect(result).toEqual({
      ok: false,
      registered: 0,
      skipped: 0,
      errors: [],
      reason: 'missing_prisma_flow_registration_delegate',
    });
  });
});
