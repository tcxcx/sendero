#!/usr/bin/env bun
/**
 * Clerk webhook smoke:
 *   1. Signs a fabricated organization.created event with svix + our signing secret
 *   2. POSTs to /api/webhooks/clerk
 *   3. Asserts Tenant row upsert + (optionally) CircleWallet row created
 *
 * Requires: dev server on :3010 (or SMOKE_BASE_URL), CLERK_WEBHOOK_SECRET, DATABASE_URL.
 * Optional: CIRCLE_API_KEY + BLOB_READ_WRITE_TOKEN for full provisioning path.
 *
 * Usage:
 *   bun run dev &
 *   sleep 6
 *   bun run smoke:clerk-webhook
 */

import { Webhook } from 'svix';
import { prisma } from '../packages/database/src';

const BASE_URL = process.env.SMOKE_BASE_URL ?? 'http://localhost:3010';
const SECRET = process.env.CLERK_WEBHOOK_SECRET;

const TEST_CLERK_ORG_ID = `org_smoke_${Date.now()}`;

async function main() {
  if (!SECRET) {
    console.error('✗ CLERK_WEBHOOK_SECRET not set');
    process.exit(1);
  }

  console.log('--- Phase-11c1 Clerk webhook smoke ---');
  console.log(`testing org ${TEST_CLERK_ORG_ID}`);

  const payload = {
    type: 'organization.created',
    data: {
      id: TEST_CLERK_ORG_ID,
      name: 'Smoke Test Org',
      slug: `smoke-test-${Date.now()}`,
      public_metadata: {},
    },
  };
  const body = JSON.stringify(payload);

  const wh = new Webhook(SECRET);
  const msgId = 'msg_' + Date.now();
  const timestamp = new Date();
  const signature = wh.sign(msgId, timestamp, body);

  const res = await fetch(`${BASE_URL}/api/webhooks/clerk`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'svix-id': msgId,
      'svix-timestamp': Math.floor(timestamp.getTime() / 1000).toString(),
      'svix-signature': signature,
    },
    body,
  });

  console.log(`webhook POST: ${res.status}`);
  const resBody = await res.json().catch(() => ({}));
  console.log('response:', resBody);

  // Non-200 could be because Circle provisioning failed — this is allowed
  // in dev where Circle API keys may not be valid. Check Tenant row regardless.
  const tenant = await prisma.tenant.findUnique({ where: { clerkOrgId: TEST_CLERK_ORG_ID } });
  if (!tenant) {
    console.error('✗ Tenant not upserted');
    process.exit(1);
  }
  console.log(`✓ Tenant upserted: ${tenant.id} (${tenant.displayName})`);

  const wallet = await prisma.circleWallet.findFirst({ where: { tenantId: tenant.id } });
  if (wallet) {
    console.log(`✓ CircleWallet provisioned: ${wallet.address}`);
  } else {
    console.log('  (no CircleWallet — Circle API likely not configured, expected in dev)');
  }

  // Cleanup
  await prisma.circleWallet.deleteMany({ where: { tenantId: tenant.id } });
  await prisma.tenant.delete({ where: { id: tenant.id } }).catch(() => void 0);
  console.log('--- SMOKE PASSED ---');
}

main()
  .catch(err => {
    console.error('✗ smoke failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
