#!/usr/bin/env bun
/**
 * check-stamps-deploy — poll the Circle DCW transactions API for the
 * SenderoStamps deployment status. Run after `deploy-stamps-template.ts`.
 *
 * Status progresses PENDING → CONFIRMING → COMPLETE (or FAILED). Once
 * COMPLETE, the response includes `contractAddress`, `txHash`,
 * `blockHeight` — `blockHeight` is what the Circle Event Monitor needs
 * (well, the contract address; the start block is informational since
 * Circle backfills automatically).
 *
 * Env:
 *   CIRCLE_API_KEY        — set
 *   CIRCLE_ENTITY_SECRET  — set
 *   CIRCLE_TX_ID          — paste from deploy-stamps-template.ts output
 *
 * Usage:
 *   CIRCLE_TX_ID=<id> bun scripts/check-stamps-deploy.ts
 *   bun scripts/check-stamps-deploy.ts --tx <id>
 *   bun scripts/check-stamps-deploy.ts --watch    # poll every 5s until terminal
 */

/* eslint-disable no-console */

import { initiateDeveloperControlledWalletsClient } from '@circle-fin/developer-controlled-wallets';

interface Args {
  txId?: string;
  watch?: boolean;
}

function parseArgs(argv: string[]): Args {
  const out: Args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--tx') out.txId = argv[++i];
    else if (a === '--watch') out.watch = true;
  }
  return out;
}

async function main() {
  const apiKey = process.env.CIRCLE_API_KEY;
  const entitySecret = process.env.CIRCLE_ENTITY_SECRET;
  if (!apiKey) bail('CIRCLE_API_KEY is required.');
  if (!entitySecret) bail('CIRCLE_ENTITY_SECRET is required.');

  const args = parseArgs(process.argv.slice(2));
  const txId = args.txId ?? process.env.CIRCLE_TX_ID ?? null;
  if (!txId) bail('Missing transaction id. Pass --tx <id> or set CIRCLE_TX_ID.');

  const client = initiateDeveloperControlledWalletsClient({
    apiKey: apiKey!,
    entitySecret: entitySecret!,
  });

  const fetchOnce = async () => {
    const res = await client.getTransaction({ id: txId });
    const tx = (res.data as { transaction?: Record<string, unknown> } | undefined)?.transaction;
    if (!tx) {
      console.error('No transaction in response:', JSON.stringify(res.data, null, 2));
      return null;
    }
    return tx;
  };

  if (args.watch) {
    let lastState: string | null = null;
    for (;;) {
      const tx = await fetchOnce();
      if (!tx) return;
      const state = String(tx.state);
      if (state !== lastState) {
        console.log(`[${new Date().toISOString()}] state=${state}`);
        lastState = state;
      }
      if (state === 'COMPLETE' || state === 'FAILED' || state === 'CANCELED') {
        console.log('');
        console.log(JSON.stringify(tx, null, 2));
        if (state === 'COMPLETE') {
          console.log('');
          console.log(
            `Next:  CIRCLE_CONTRACT_ID=<id-from-deploy> bun scripts/get-stamps-contract.ts`
          );
        }
        return;
      }
      await new Promise(r => setTimeout(r, 5000));
    }
  } else {
    const tx = await fetchOnce();
    if (!tx) return;
    console.log(JSON.stringify(tx, null, 2));
  }
}

function bail(msg: string): never {
  console.error(msg);
  process.exit(1);
}

main().catch(err => {
  console.error('check failed:', err);
  process.exit(1);
});
