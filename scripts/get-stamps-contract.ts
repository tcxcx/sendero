#!/usr/bin/env bun
/**
 * get-stamps-contract — fetch the deployed SenderoStamps contract
 * details (address, ABI, status) from Circle SCP. Run after
 * `check-stamps-deploy.ts` reports COMPLETE.
 *
 * Prints the env line you need to add to .env.local + Vercel:
 *
 *   SENDERO_STAMPS_ADDRESS=0x…
 *
 * Env:
 *   CIRCLE_API_KEY        — set
 *   CIRCLE_ENTITY_SECRET  — set
 *   CIRCLE_CONTRACT_ID    — paste from deploy-stamps-template.ts output
 *
 * Usage:
 *   CIRCLE_CONTRACT_ID=<id> bun scripts/get-stamps-contract.ts
 *   bun scripts/get-stamps-contract.ts --contract <id>
 *   bun scripts/get-stamps-contract.ts --contract <id> --abi   # also dumps ABI
 */

/* eslint-disable no-console */

import { initiateSmartContractPlatformClient } from '@circle-fin/smart-contract-platform';

interface Args {
  contractId?: string;
  printAbi?: boolean;
}

function parseArgs(argv: string[]): Args {
  const out: Args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--contract') out.contractId = argv[++i];
    else if (a === '--abi') out.printAbi = true;
  }
  return out;
}

async function main() {
  const apiKey = process.env.CIRCLE_API_KEY;
  const entitySecret = process.env.CIRCLE_ENTITY_SECRET;
  if (!apiKey) bail('CIRCLE_API_KEY is required.');
  if (!entitySecret) bail('CIRCLE_ENTITY_SECRET is required.');

  const args = parseArgs(process.argv.slice(2));
  const contractId = args.contractId ?? process.env.CIRCLE_CONTRACT_ID ?? null;
  if (!contractId) bail('Missing contract id. Pass --contract <id> or set CIRCLE_CONTRACT_ID.');

  const client = initiateSmartContractPlatformClient({
    apiKey: apiKey!,
    entitySecret: entitySecret!,
  });

  const res = await client.getContract({ id: contractId });
  const contract = (res.data as { contract?: Record<string, unknown> } | undefined)?.contract;
  if (!contract) bail(`No contract in response: ${JSON.stringify(res.data, null, 2)}`);

  console.log('────────────────────────────────────────');
  console.log(`SenderoStamps contract details`);
  console.log('────────────────────────────────────────');
  console.log(`  id              : ${contract.id}`);
  console.log(`  status          : ${contract.status}`);
  console.log(`  blockchain      : ${contract.blockchain}`);
  console.log(`  address         : ${contract.contractAddress}`);
  console.log(`  txHash          : ${contract.transactionHash ?? '(n/a)'}`);
  console.log(`  deployer        : ${contract.deployerAddress ?? '(n/a)'}`);
  console.log(`  deployedAt      : ${contract.deployedAt ?? '(n/a)'}`);
  console.log(`  verification    : ${contract.verificationStatus ?? '(n/a)'}`);
  console.log('');
  console.log('Add to env (root + apps/app/.env.local + Vercel Production/Preview/Development):');
  console.log('');
  console.log(`  SENDERO_STAMPS_ADDRESS=${contract.contractAddress}`);
  console.log(`  SENDERO_STAMPS_CONTRACT_ID=${contract.id}`);
  console.log('');
  console.log('Then:  bun scripts/register-stamps-event-monitor.ts');

  if (args.printAbi && contract.abiJson) {
    console.log('');
    console.log('────────────────────────────────────────');
    console.log('ABI:');
    console.log(
      typeof contract.abiJson === 'string'
        ? contract.abiJson
        : JSON.stringify(contract.abiJson, null, 2)
    );
  }
}

function bail(msg: string): never {
  console.error(msg);
  process.exit(1);
}

main().catch(err => {
  console.error('get failed:', err);
  process.exit(1);
});
