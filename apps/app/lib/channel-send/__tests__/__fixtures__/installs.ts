/**
 * Prisma row fixtures for the channel-send orchestrator tests.
 *
 * Hand-typed against `SlackInstall` + `WhatsAppInstall` in
 * `packages/database/prisma/schema.prisma`. Keeping these here rather
 * than spinning a real Prisma client lets the tests run with no DB
 * dependency: the orchestrators only read a handful of fields off the
 * row (botToken / phoneNumberId / accessToken).
 */

import type { SlackInstall, WhatsAppInstall } from '@prisma/client';

const FROZEN_AT = new Date('2026-04-25T10:00:00.000Z');

export function slackInstallFixture(overrides: Partial<SlackInstall> = {}): SlackInstall {
  return {
    id: 'si_test_123',
    tenantId: 'tnt_test',
    enterpriseId: null,
    enterpriseName: null,
    teamId: 'T0123456',
    teamName: 'Test Workspace',
    appId: 'A0123456',
    botUserId: 'U0BOTUSER',
    botToken: 'xoxb-test-token',
    scope: 'chat:write,im:write,users:read,users:read.email',
    isEnterpriseInstall: false,
    authedUserId: 'U0AUTHED',
    installedAt: FROZEN_AT,
    updatedAt: FROZEN_AT,
    revokedAt: null,
    raw: null,
    routing: null,
    kind: 'tmc_internal',
    customerAccountId: null,
    ...overrides,
  };
}

export function whatsAppInstallFixture(overrides: Partial<WhatsAppInstall> = {}): WhatsAppInstall {
  return {
    id: 'wai_test_456',
    tenantId: 'tnt_test',
    kapsoCustomerId: 'kapso_cust_test',
    kapsoConnectionId: 'kapso_conn_test',
    businessDisplayName: 'Sendero Test',
    phoneNumberId: '17035552345',
    businessAccountId: '987654321',
    displayPhoneNumber: '+1 703 555 2345',
    webhookSecret: 'wa-test-webhook-secret',
    status: 'active',
    lastErrorMessage: null,
    connectedByUserId: 'usr_test',
    lastHealthyAt: FROZEN_AT,
    metadata: null,
    createdAt: FROZEN_AT,
    updatedAt: FROZEN_AT,
    ...overrides,
  };
}
