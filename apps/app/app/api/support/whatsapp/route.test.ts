import { beforeEach, describe, expect, mock, test } from 'bun:test';

let plan: 'free' | 'basic' | 'pro' | 'enterprise';
let locale: string;
let tenant: {
  billingTier: string;
  clerkOrgId: string;
  displayName: string;
  id: string;
  slug: string;
};
let supportSessions: Array<{
  code: string;
  tenantId: string;
  context: Record<string, unknown>;
}>;

mock.module('@sendero/database', () => ({
  prisma: {
    $executeRaw: (_strings: TemplateStringsArray, ...values: unknown[]) => {
      supportSessions.push({
        code: String(values[0]),
        tenantId: String(values[1]),
        context: values[2] as Record<string, unknown>,
      });
      return Promise.resolve(1);
    },
  },
}));

mock.module('@/lib/billing-plan', () => ({
  currentOrgPlanTier: async () => plan,
}));

mock.module('@/lib/request-locale', () => ({
  getRequestLocale: async () => locale,
}));

mock.module('@/lib/tenant-context', () => ({
  requireCurrentTenant: async () => ({ tenant }),
}));

const { GET } = await import('./route');

const originalEnv = {
  SENDERO_SUPPORT_WA_NUMBER: process.env.SENDERO_SUPPORT_WA_NUMBER,
  SENDERO_SUPPORT_WA_URL: process.env.SENDERO_SUPPORT_WA_URL,
  NEXT_PUBLIC_SENDERO_SUPPORT_WA_NUMBER: process.env.NEXT_PUBLIC_SENDERO_SUPPORT_WA_NUMBER,
  NEXT_PUBLIC_SENDERO_SUPPORT_WA_URL: process.env.NEXT_PUBLIC_SENDERO_SUPPORT_WA_URL,
  NEXT_PUBLIC_SENDERO_WA_URL: process.env.NEXT_PUBLIC_SENDERO_WA_URL,
};

function restoreEnv() {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

beforeEach(() => {
  restoreEnv();
  plan = 'basic';
  locale = 'en-US';
  tenant = {
    billingTier: 'basic',
    clerkOrgId: 'org_123',
    displayName: 'QA Corporate Travel',
    id: 'ten_123',
    slug: 'qa-corporate-travel',
  };
  supportSessions = [];
});

describe('GET /api/support/whatsapp', () => {
  test('redirects paid workspaces to the canonical Sendero support number with support context', async () => {
    process.env.SENDERO_SUPPORT_WA_NUMBER = '12014716388';
    delete process.env.SENDERO_SUPPORT_WA_URL;
    delete process.env.NEXT_PUBLIC_SENDERO_SUPPORT_WA_URL;
    delete process.env.NEXT_PUBLIC_SENDERO_WA_URL;

    const response = await GET(new Request('https://app.sendero.test/api/support/whatsapp'));

    expect(response.status).toBe(307);
    const location = response.headers.get('location');
    expect(location).toStartWith('https://wa.me/12014716388?');

    const redirectUrl = new URL(location ?? '');
    const text = redirectUrl.searchParams.get('text') ?? '';
    expect(text).toContain('Hi Sendero support, I need help from my dashboard.');
    expect(text).toContain('Support ref: SR-');
    expect(text).toContain('Locale: en-US');
    expect(supportSessions).toHaveLength(1);
    expect(supportSessions[0]).toMatchObject({
      tenantId: 'ten_123',
      context: {
        billingTier: 'basic',
        clerkOrgId: 'org_123',
        displayName: 'QA Corporate Travel',
        locale: 'en-US',
        plan: 'basic',
        tenantSlug: 'qa-corporate-travel',
      },
    });
  });

  test('redirects free workspaces to upgrade before support WhatsApp', async () => {
    plan = 'free';
    process.env.SENDERO_SUPPORT_WA_NUMBER = '12014716388';

    const response = await GET(new Request('https://app.sendero.test/api/support/whatsapp'));

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe(
      'https://app.sendero.test/dashboard/billing/plans?upgrade=basic&feature=whatsapp-support'
    );
    expect(supportSessions).toHaveLength(0);
  });
});
