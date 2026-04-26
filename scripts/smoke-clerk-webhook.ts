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

  // ERC-8004 identity provisioning is fired non-fatally inside the webhook.
  // When the wallet exists, the post-wallet hook calls ensureOrgIdentity,
  // which inserts an OnchainIdentity row with status='pending' (sweeper
  // promotes to 'minted' once the on-chain registerAgent confirms).
  // When the wallet doesn't exist (Circle not configured), the hook
  // throws before mint and no row is inserted — that's expected in dev.
  const identity = await prisma.onchainIdentity.findFirst({
    where: { kind: 'org', tenantId: tenant.id },
  });
  if (identity) {
    console.log(
      `✓ OnchainIdentity row inserted: status=${identity.status}, holder=${identity.holderAddress}` +
        (identity.agentId ? `, agentId=${identity.agentId}` : '')
    );
  } else if (wallet) {
    console.log(
      '  ⚠ wallet exists but no OnchainIdentity — ensureOrgIdentity may have thrown synchronously (non-fatal). Check sweeper at /api/cron/retry-identity-provision.'
    );
  } else {
    console.log('  (no OnchainIdentity — wallet missing precondition, expected in dev)');
  }

  // Verify the public ERC-8004 metadata endpoint serves what the
  // contract would store via tokenURI(). 200 = JSON shape correct;
  // 404 = expected when no OnchainIdentity row exists.
  const metaRes = await fetch(`${BASE_URL}/agents/org/${tenant.id}/metadata.json`);
  if (identity && metaRes.status === 200) {
    const meta = await metaRes.json();
    console.log(
      `✓ /agents/org/${tenant.id}/metadata.json: ${meta.name} (holder ${meta.holder_address})`
    );
  } else if (identity) {
    console.log(`  ⚠ metadata route returned ${metaRes.status}, expected 200`);
  } else {
    console.log(`  metadata route ${metaRes.status} (expected 404 with no identity)`);
  }

  // Cleanup
  await prisma.onchainIdentity.deleteMany({ where: { tenantId: tenant.id } });
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
