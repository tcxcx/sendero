#!/usr/bin/env bun
/**
 * register-stamps-event-monitor — register Circle Event Monitors on
 * the SenderoStamps contract so every mint / transfer / URI update
 * pushes a notification to /api/webhooks/circle/events.
 *
 * One monitor per event signature. ERC-1155 emits:
 *   - TransferSingle(address operator, address from, address to,
 *                    uint256 id, uint256 value)
 *   - TransferBatch(address operator, address from, address to,
 *                   uint256[] ids, uint256[] values)
 *   - URI(string value, uint256 indexed id)   -- emitted by setTokenURI
 *
 * Plus thirdweb-style template events worth watching (best-effort —
 * skipped if the template doesn't emit them):
 *   - TokensMinted(address minter, address to, uint256 tokenIdMinted, string uri, uint256 quantityMinted)
 *
 * Prereq:
 *   - The webhook URL must be REGISTERED in Circle Console first
 *     (Console → Webhooks → Add a webhook → URL = ${WEBHOOK_BASE_URL}/api/webhooks/circle/events).
 *     Event Monitors only fire to webhooks that exist; this script
 *     does not register the webhook itself (Circle exposes it only
 *     via the Console UI).
 *
 * Env:
 *   CIRCLE_API_KEY                 — set
 *   CIRCLE_ENTITY_SECRET           — set
 *   SENDERO_STAMPS_ADDRESS         — paste from get-stamps-contract.ts
 *   KAPSO_WEBHOOK_BASE_URL or NEXT_PUBLIC_APP_URL — public URL Circle posts to (informational; the webhook itself is registered in Console)
 *
 * Usage:
 *   bun scripts/register-stamps-event-monitor.ts
 *   bun scripts/register-stamps-event-monitor.ts --address 0x…
 *   bun scripts/register-stamps-event-monitor.ts --list
 *
 * Idempotency:
 *   Re-registering the same (contract, signature) combo returns the
 *   existing monitor; no duplicate is created.
 */

/* eslint-disable no-console */

import { initiateSmartContractPlatformClient } from '@circle-fin/smart-contract-platform';

// Verified against the deployed TokenERC1155 implementation at
// 0xCCf28A443e35F8bD982b8E8651bE9f6caFEd4672 on Arc-Testnet
// (impl behind the SenderoStamps proxy).
const SENDERO_EVENT_SIGNATURES: ReadonlyArray<string> = [
  'TransferSingle(address,address,address,uint256,uint256)',
  'TransferBatch(address,address,address,uint256[],uint256[])',
  'URI(string,uint256)',
  'TokensMinted(address,uint256,string,uint256)',
];

interface Args {
  address?: string;
  list?: boolean;
}

function parseArgs(argv: string[]): Args {
  const out: Args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--address') out.address = argv[++i];
    else if (a === '--list') out.list = true;
  }
  return out;
}

async function main() {
  const apiKey = process.env.CIRCLE_API_KEY;
  const entitySecret = process.env.CIRCLE_ENTITY_SECRET;
  if (!apiKey) bail('CIRCLE_API_KEY is required.');
  if (!entitySecret) bail('CIRCLE_ENTITY_SECRET is required.');

  const args = parseArgs(process.argv.slice(2));
  const contractAddress = args.address ?? process.env.SENDERO_STAMPS_ADDRESS ?? null;
  if (!contractAddress) bail('Missing --address or SENDERO_STAMPS_ADDRESS.');

  const webhookBase = process.env.KAPSO_WEBHOOK_BASE_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? null;
  const webhookUrl = webhookBase
    ? `${webhookBase.replace(/\/$/, '')}/api/webhooks/circle/events`
    : '<configure KAPSO_WEBHOOK_BASE_URL>';

  const client = initiateSmartContractPlatformClient({
    apiKey: apiKey!,
    entitySecret: entitySecret!,
  });

  if (args.list) {
    const list = await client.listEventMonitors({
      blockchain: 'ARC-TESTNET',
      contractAddress: contractAddress as `0x${string}`,
    } as Parameters<typeof client.listEventMonitors>[0]);
    const monitors = (list.data as { eventMonitors?: unknown[] } | undefined)?.eventMonitors ?? [];
    console.log(`Existing monitors for ${contractAddress}:`);
    console.log(JSON.stringify(monitors, null, 2));
    return;
  }

  console.log('────────────────────────────────────────');
  console.log('Register SenderoStamps event monitors');
  console.log('────────────────────────────────────────');
  console.log(`  Blockchain     : ARC-TESTNET`);
  console.log(`  Contract       : ${contractAddress}`);
  console.log(`  Webhook target : ${webhookUrl}`);
  console.log('  (webhook URL must already be registered in Circle Console)');
  console.log('');

  const created: Array<{ event: string; status: string; id?: string; error?: string }> = [];
  for (const eventSignature of SENDERO_EVENT_SIGNATURES) {
    try {
      const res = await client.createEventMonitor({
        blockchain: 'ARC-TESTNET',
        contractAddress: contractAddress as `0x${string}`,
        eventSignature,
      } as Parameters<typeof client.createEventMonitor>[0]);
      const monitor = (res.data as { eventMonitor?: { id?: string } } | undefined)?.eventMonitor;
      created.push({ event: eventSignature, status: 'ok', id: monitor?.id });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      created.push({ event: eventSignature, status: 'failed', error: message });
    }
  }

  console.log('Results:');
  for (const r of created) {
    if (r.status === 'ok') {
      console.log(`  ✓ ${r.event}  →  ${r.id}`);
    } else {
      console.log(`  ✗ ${r.event}  →  ${r.error}`);
    }
  }
  console.log('');
  console.log('Verify in Console: https://console.circle.com → Contracts → Monitoring');
  console.log('');
  console.log('Next:');
  console.log('  1. Implement /api/webhooks/circle/events handler (see plan §11.v4)');
  console.log(
    '  2. Persist TransferSingle/TransferBatch/URI events to NftStamp + NftStampOwnership Postgres rows'
  );
  console.log('  3. Build /stamps/[tokenId] public page + /dashboard/stamps collection page');
}

function bail(msg: string): never {
  console.error(msg);
  process.exit(1);
}

main().catch(err => {
  console.error('register failed:', err);
  process.exit(1);
});
