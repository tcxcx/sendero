#!/usr/bin/env bun
/**
 * register-reputation-event-monitors — register Circle Event Monitors on
 * the three ERC-8004 contracts on Arc-Testnet so every identity mint,
 * reputation feedback, and validation request/response pushes a
 * notification to /api/webhooks/circle/events.
 *
 * Sibling to scripts/register-stamps-event-monitor.ts; same Circle SDK,
 * same idempotency semantics.
 *
 * Contracts (Arc-Testnet, well-known):
 *   IdentityRegistry   0x8004A818BFB912233c491871b3d84c89A494BD9e
 *   ReputationRegistry 0x8004B663056A597Dffe9eCcC1965A193B7388713
 *   ValidationRegistry 0x8004Cb1BF31DAf7788923b405b754f57acEB4272
 *
 * Prereq:
 *   Webhook URL ${WEBHOOK_BASE_URL}/api/webhooks/circle/events must be
 *   registered in Circle Console (Console → Webhooks). Event Monitors
 *   only fire to webhooks that exist; this script does not register
 *   the webhook itself.
 *
 * Env: CIRCLE_API_KEY + CIRCLE_ENTITY_SECRET.
 *
 * Usage:
 *   bun scripts/register-reputation-event-monitors.ts
 *   bun scripts/register-reputation-event-monitors.ts --list
 */

/* eslint-disable no-console */

import { initiateSmartContractPlatformClient } from '@circle-fin/smart-contract-platform';

const IDENTITY_REGISTRY = '0x8004A818BFB912233c491871b3d84c89A494BD9e';
const REPUTATION_REGISTRY = '0x8004B663056A597Dffe9eCcC1965A193B7388713';
const VALIDATION_REGISTRY = '0x8004Cb1BF31DAf7788923b405b754f57acEB4272';

const MONITORS: ReadonlyArray<{ address: string; signatures: string[] }> = [
  {
    address: IDENTITY_REGISTRY,
    signatures: [
      // ERC-721 Transfer — used to backfill agentId on pending OnchainIdentity rows.
      'Transfer(address,address,uint256)',
    ],
  },
  {
    address: REPUTATION_REGISTRY,
    signatures: ['FeedbackGiven(uint256,address,int128,uint8,string,bytes32)'],
  },
  {
    address: VALIDATION_REGISTRY,
    signatures: [
      'ValidationRequested(address,address,uint256,string,bytes32)',
      'ValidationResponseSubmitted(address,bytes32,uint8,string,bytes32,string)',
    ],
  },
];

interface Args {
  list?: boolean;
}

function parseArgs(argv: string[]): Args {
  const out: Args = {};
  for (const a of argv) {
    if (a === '--list') out.list = true;
  }
  return out;
}

async function main() {
  const apiKey = process.env.CIRCLE_API_KEY;
  const entitySecret = process.env.CIRCLE_ENTITY_SECRET;
  if (!apiKey) bail('CIRCLE_API_KEY is required.');
  if (!entitySecret) bail('CIRCLE_ENTITY_SECRET is required.');

  const args = parseArgs(process.argv.slice(2));
  const webhookBase = process.env.KAPSO_WEBHOOK_BASE_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? null;
  const webhookUrl = webhookBase
    ? `${webhookBase.replace(/\/$/, '')}/api/webhooks/circle/events`
    : '<configure NEXT_PUBLIC_APP_URL>';

  const client = initiateSmartContractPlatformClient({
    apiKey: apiKey!,
    entitySecret: entitySecret!,
  });

  if (args.list) {
    for (const { address } of MONITORS) {
      const list = await client.listEventMonitors({
        blockchain: 'ARC-TESTNET',
        contractAddress: address as `0x${string}`,
      } as Parameters<typeof client.listEventMonitors>[0]);
      const monitors =
        (list.data as { eventMonitors?: unknown[] } | undefined)?.eventMonitors ?? [];
      console.log(`\nMonitors for ${address}:`);
      console.log(JSON.stringify(monitors, null, 2));
    }
    return;
  }

  console.log('────────────────────────────────────────');
  console.log('Register ERC-8004 event monitors');
  console.log('────────────────────────────────────────');
  console.log(`  Blockchain     : ARC-TESTNET`);
  console.log(`  Webhook target : ${webhookUrl}`);
  console.log('  (webhook URL must already be registered in Circle Console)');
  console.log('');

  const created: Array<{
    address: string;
    event: string;
    status: string;
    id?: string;
    error?: string;
  }> = [];

  for (const { address, signatures } of MONITORS) {
    for (const eventSignature of signatures) {
      try {
        const res = await client.createEventMonitor({
          blockchain: 'ARC-TESTNET',
          contractAddress: address as `0x${string}`,
          eventSignature,
        } as Parameters<typeof client.createEventMonitor>[0]);
        const monitor = (res.data as { eventMonitor?: { id?: string } } | undefined)?.eventMonitor;
        created.push({ address, event: eventSignature, status: 'ok', id: monitor?.id });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        created.push({ address, event: eventSignature, status: 'failed', error: message });
      }
    }
  }

  console.log('Results:');
  for (const r of created) {
    if (r.status === 'ok') {
      console.log(`  ✓ ${r.address}  ${r.event}  →  ${r.id}`);
    } else {
      console.log(`  ✗ ${r.address}  ${r.event}  →  ${r.error}`);
    }
  }
  console.log('');
  console.log('Verify in Console: https://console.circle.com → Contracts → Monitoring');
}

function bail(msg: string): never {
  console.error(msg);
  process.exit(1);
}

main().catch(err => {
  console.error('register failed:', err);
  process.exit(1);
});
