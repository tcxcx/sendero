#!/usr/bin/env node
/**
 * Copy the SenderoGuestEscrow ABI from Forge's out/ into subgraph/abis/.
 * Run after `forge build` whenever the contract changes.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const contractArtifactPath = resolve(
  __dirname,
  '..',
  '..',
  'contracts',
  'out',
  'SenderoGuestEscrow.sol',
  'SenderoGuestEscrow.json'
);

const subgraphAbiPath = resolve(__dirname, '..', 'abis', 'SenderoGuestEscrow.json');

if (!existsSync(contractArtifactPath)) {
  console.error(`✗ Contract artifact not found at ${contractArtifactPath}`);
  console.error('  Run `cd ../contracts && forge build` first.');
  process.exit(1);
}

const artifact = JSON.parse(readFileSync(contractArtifactPath, 'utf-8'));
if (!artifact.abi) {
  console.error('✗ Artifact missing ABI field');
  process.exit(1);
}

mkdirSync(dirname(subgraphAbiPath), { recursive: true });
writeFileSync(subgraphAbiPath, JSON.stringify(artifact.abi, null, 2));

console.log(`✓ Synced ABI (${artifact.abi.length} entries) → abis/SenderoGuestEscrow.json`);
