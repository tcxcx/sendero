/**
 * Dry-run the full ERC-8183 settle flow with a fake PNR.
 *
 * Exercises all 7 on-chain txs (createJob → setBudget → approve → fund →
 * submit → complete → giveFeedback) end-to-end, without requiring Anthropic
 * credits or a real Duffel booking. Prints Arcscan links for each tx.
 *
 * Run: `bun run scripts/dry-run-settle.ts`
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  AGENTIC_COMMERCE_ADDRESS,
  approveUsdc,
  completeJob,
  createJob,
  fundJob,
  hashDeliverable,
  setBudget,
  submitDeliverable,
  toUsdcUnits,
} from '../lib/arc-jobs';
import { giveFeedback, invalidateReputationCache } from '../lib/arc-identity';

// Load .env.local
const envPath = path.join(import.meta.dir, '..', '.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const eq = line.indexOf('=');
    if (eq < 0 || line.trim().startsWith('#')) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    if (key && !process.env[key]) process.env[key] = value;
  }
}

const need = (k: string): string => {
  const v = process.env[k];
  if (!v) throw new Error(`${k} not set in .env.local`);
  return v;
};

const providerAddress = need('SENDERO_PROVIDER_ADDRESS');
const clientAddress = need('DEMO_CLIENT_ADDRESS');
const agentId = BigInt(need('SENDERO_AGENT_ID'));
const explorerBase =
  process.env.ARC_EXPLORER_URL || 'https://testnet.arcscan.app';

const pnr = `DRY${Date.now().toString(36).toUpperCase().slice(-5)}`;
const amountUsd = '1.80';
const amountUnits = toUsdcUnits(amountUsd);
const expiredAt = BigInt(Math.floor(Date.now() / 1000) + 3600);

const arcscan = (hash: string): string => `${explorerBase}/tx/${hash}`;

console.log(`\n── Dry-run settle_on_arc flow ──`);
console.log(`  Agent:     #${agentId} @ ${providerAddress}`);
console.log(`  Client:    ${clientAddress}`);
console.log(`  PNR:       ${pnr} (fake)`);
console.log(`  Amount:    ${amountUsd} USDC`);
console.log(`  Expires:   ${new Date(Number(expiredAt) * 1000).toISOString()}`);

console.log(`\n[1/7] createJob...`);
const created = await createJob({
  clientWalletAddress: clientAddress,
  providerAddress: providerAddress as any,
  evaluatorAddress: clientAddress as any,
  expiredAt,
  description: `PNR ${pnr}`,
});
console.log(`      job #${created.jobId} · ${arcscan(created.txHash)}`);

console.log(`[2/7] setBudget(${amountUsd} USDC)...`);
const budgetTx = await setBudget({
  providerWalletAddress: providerAddress,
  jobId: created.jobId,
  amount: amountUnits,
});
console.log(`      ${arcscan(budgetTx.txHash)}`);

console.log(`[3/7] approve USDC...`);
const approveTx = await approveUsdc({
  clientWalletAddress: clientAddress,
  amount: amountUnits,
});
console.log(`      ${arcscan(approveTx.txHash)}`);

console.log(`[4/7] fund (escrow locked)...`);
const fundTx = await fundJob({
  clientWalletAddress: clientAddress,
  jobId: created.jobId,
});
console.log(`      ${arcscan(fundTx.txHash)}`);

console.log(`[5/7] submit (deliverable = keccak256(PNR))...`);
const deliverableHash = hashDeliverable(pnr);
const submitTx = await submitDeliverable({
  providerWalletAddress: providerAddress,
  jobId: created.jobId,
  deliverableHash,
});
console.log(`      hash=${deliverableHash}`);
console.log(`      ${arcscan(submitTx.txHash)}`);

console.log(`[6/7] complete (escrow released)...`);
const reasonHash = hashDeliverable('ticket_issued');
const completeTx = await completeJob({
  evaluatorWalletAddress: clientAddress,
  jobId: created.jobId,
  reasonHash,
});
console.log(`      ${arcscan(completeTx.txHash)}`);

console.log(`[7/7] giveFeedback (reputation +1)...`);
const feedbackTx = await giveFeedback({
  validatorWalletAddress: clientAddress,
  agentId,
  score: 95,
  tag: 'ticket_delivered',
});
invalidateReputationCache(agentId);
console.log(`      ${arcscan(feedbackTx.txHash)}`);

console.log(`\n✓ All 7 txs landed on Arc Testnet.`);
console.log(`  Agent NFT: ${explorerBase}/token/0x8004A818BFB912233c491871b3d84c89A494BD9e/${agentId}`);
console.log(`  Escrow contract: ${explorerBase}/address/${AGENTIC_COMMERCE_ADDRESS}`);
