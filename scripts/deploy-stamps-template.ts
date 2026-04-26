#!/usr/bin/env bun
/**
 * deploy-stamps-template — one-shot deployment of the SenderoStamps
 * NFT collection on Arc Testnet using Circle's pre-audited
 * ERC-1155 contract template (no custom Solidity).
 *
 *   Template id: aea21da6-0aa2-4971-9a1a-5098842b1248
 *   Docs:        https://developers.circle.com/contracts/scp-templates-overview
 *
 * Why a template:
 *   - Pre-audited by Circle (no Sendero security surface).
 *   - Auto-routes through Circle Gas Station on the SCA treasury wallet
 *     (gas paid in fiat, not from the wallet's USDC balance).
 *   - One-call deploy + the contract becomes manageable from the
 *     Circle Console out of the box. The deployed proxy is an EIP-1167
 *     minimal clone of the verified TokenERC1155 impl — Arcscan
 *     recognizes it via `proxy_type: "eip1167"` and surfaces the
 *     impl's ABI on the proxy's "Read/Write Contract" tab. Run
 *     `bun scripts/verify-deployments.ts` after deploy to audit.
 *
 * Prereq:
 *   - CIRCLE_API_KEY        (set)
 *   - CIRCLE_ENTITY_SECRET  (set — registered in Console)
 *   - CIRCLE_TREASURY_WALLET_ID  (SCA-typed Dev-Controlled Wallet on Arc Testnet)
 *   - CIRCLE_TREASURY_ADDRESS    (treasury wallet address, used as
 *                                 defaultAdmin / primarySaleRecipient /
 *                                 royaltyRecipient)
 *
 * Output:
 *   - Prints { contractId, transactionId } from the deploy call
 *   - Saves SENDERO_STAMPS_CONTRACT_ID + SENDERO_STAMPS_TX_ID hint
 *     so the next two scripts can resolve them
 *
 * Next steps after success:
 *   1. bun scripts/check-stamps-deploy.ts        (poll for COMPLETE)
 *   2. bun scripts/get-stamps-contract.ts        (read deployed address)
 *   3. Add SENDERO_STAMPS_ADDRESS to env (root + apps/app + Vercel)
 *   4. bun scripts/register-stamps-event-monitor.ts  (Circle Event Monitors → /api/webhooks/circle/events)
 *
 * Idempotency:
 *   Pass --idempotency-key <uuid> to make the deploy idempotent across
 *   re-runs. By default a fresh key is generated each invocation.
 */

/* eslint-disable no-console */

import { randomUUID } from 'node:crypto';
import { initiateSmartContractPlatformClient } from '@circle-fin/smart-contract-platform';

const ERC1155_TEMPLATE_ID = 'aea21da6-0aa2-4971-9a1a-5098842b1248';

interface Args {
  idempotencyKey?: string;
  contractName?: string;
  symbol?: string;
  contractUri?: string;
}

function parseArgs(argv: string[]): Args {
  const out: Args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--idempotency-key') out.idempotencyKey = argv[++i];
    else if (a === '--name') out.contractName = argv[++i];
    else if (a === '--symbol') out.symbol = argv[++i];
    else if (a === '--contract-uri') out.contractUri = argv[++i];
  }
  return out;
}

async function main() {
  const apiKey = process.env.CIRCLE_API_KEY;
  const entitySecret = process.env.CIRCLE_ENTITY_SECRET;
  const walletId = process.env.CIRCLE_TREASURY_WALLET_ID;
  const treasuryAddress = process.env.CIRCLE_TREASURY_ADDRESS;

  if (!apiKey) bail('CIRCLE_API_KEY is required.');
  if (!entitySecret) bail('CIRCLE_ENTITY_SECRET is required.');
  if (!walletId) bail('CIRCLE_TREASURY_WALLET_ID is required.');
  if (!treasuryAddress) bail('CIRCLE_TREASURY_ADDRESS is required.');

  const args = parseArgs(process.argv.slice(2));
  const offchainName = args.contractName ?? 'SenderoStamps';
  const onchainName = 'SenderoStamps';
  const symbol = args.symbol ?? 'SDR';
  const idempotencyKey = args.idempotencyKey ?? randomUUID();
  const contractUri = args.contractUri ?? 'https://app.sendero.travel/api/stamps/contract.json';

  const client = initiateSmartContractPlatformClient({
    apiKey: apiKey!,
    entitySecret: entitySecret!,
  });

  console.log('────────────────────────────────────────');
  console.log('SenderoStamps deploy via Circle SCP template (ERC-1155)');
  console.log('────────────────────────────────────────');
  console.log('  Blockchain        : ARC-TESTNET');
  console.log(`  Template id       : ${ERC1155_TEMPLATE_ID}`);
  console.log(`  Off-chain name    : ${offchainName}  (Console only)`);
  console.log(`  On-chain name     : ${onchainName}`);
  console.log(`  Symbol            : ${symbol}`);
  console.log(`  Wallet id         : ${walletId}`);
  console.log(`  defaultAdmin      : ${treasuryAddress}`);
  console.log(`  primarySaleRecip. : ${treasuryAddress}`);
  console.log(`  royaltyRecipient  : ${treasuryAddress}`);
  console.log('  royaltyPercent    : 0  (no secondary-market royalty for souvenirs)');
  console.log(`  contractUri       : ${contractUri}`);
  console.log(`  idempotencyKey    : ${idempotencyKey}`);
  console.log('  Fee level         : MEDIUM  (USDC gas, sponsored by Gas Station)');
  console.log('');

  const response = await client.deployContractTemplate({
    id: ERC1155_TEMPLATE_ID,
    blockchain: 'ARC-TESTNET',
    name: offchainName,
    walletId,
    templateParameters: {
      name: onchainName,
      symbol,
      defaultAdmin: treasuryAddress,
      primarySaleRecipient: treasuryAddress,
      royaltyRecipient: treasuryAddress,
      royaltyPercent: 0,
      contractUri,
    },
    fee: { type: 'level', config: { feeLevel: 'MEDIUM' } },
    idempotencyKey,
  } as unknown as Parameters<typeof client.deployContractTemplate>[0]);

  const data = response.data as { contractIds?: string[]; transactionId?: string };
  const contractId = data.contractIds?.[0];
  const transactionId = data.transactionId;

  console.log('Deployment initiated.');
  console.log(`  contractId    : ${contractId ?? '(missing)'}`);
  console.log(`  transactionId : ${transactionId ?? '(missing)'}`);
  console.log('');
  console.log('Next:');
  console.log(`  CIRCLE_TX_ID=${transactionId} \\`);
  console.log(`  CIRCLE_CONTRACT_ID=${contractId} \\`);
  console.log(`  bun scripts/check-stamps-deploy.ts`);
  console.log('');
  console.log('Then:');
  console.log(`  CIRCLE_CONTRACT_ID=${contractId} bun scripts/get-stamps-contract.ts`);
}

function bail(msg: string): never {
  console.error(msg);
  process.exit(1);
}

main().catch(err => {
  console.error('Deploy failed:', err);
  if (err && typeof err === 'object' && 'response' in err) {
    const response = (err as { response?: { data?: unknown } }).response;
    if (response?.data) console.error('Response body:', JSON.stringify(response.data, null, 2));
  }
  process.exit(1);
});
