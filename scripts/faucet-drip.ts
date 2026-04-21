#!/usr/bin/env bun
/**
 * Local CLI for the Circle testnet faucet. Wraps @sendero/tools/faucet.
 *
 * Usage:
 *   bun run scripts/faucet-drip.ts <address>
 *   bun run scripts/faucet-drip.ts <address> --chain ARC-TESTNET --token USDC
 *
 * Defaults: ARC-TESTNET + USDC. Reads CIRCLE_API_KEY from .env.local
 * (loaded automatically by bun when run from repo root).
 *
 * Idempotent only in the "repeated call -> repeated drips" sense —
 * Circle's faucet is rate-limited per-address per-day.
 */

import {
  requestFaucetDrip,
  type FaucetChain,
  type FaucetToken,
} from '../packages/tools/src/faucet';

function parseArgs() {
  const args = process.argv.slice(2);
  const out: { address?: string; chain?: FaucetChain; token?: FaucetToken } = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--chain') out.chain = args[++i] as FaucetChain;
    else if (a === '--token') out.token = args[++i] as FaucetToken;
    else if (!out.address) out.address = a;
  }
  return out;
}

async function main() {
  const { address, chain, token } = parseArgs();
  if (!address) {
    console.error(
      'Usage: bun run scripts/faucet-drip.ts <address> [--chain ARC-TESTNET] [--token USDC]'
    );
    process.exit(2);
  }
  const result = await requestFaucetDrip({
    address,
    blockchain: chain,
    token,
  });
  if (result.ok) {
    console.log(`✓ dripped 20 ${result.token} to ${result.address} on ${result.blockchain}`);
  } else {
    console.error(`✗ faucet drip failed (${result.status}): ${result.message}`);
    process.exit(1);
  }
}

main().catch(err => {
  console.error('faucet drip error:', err);
  process.exit(1);
});
