/**
 * Pasillo × Arc — one-time bootstrap.
 *
 * Creates provider + demo-client + 2 aux-validator wallets via Circle DCW on
 * Arc Testnet, funds them from the treasury, mints the agent identity NFT,
 * and seeds ~50 diverse reputation events so the demo starts at a plausible
 * ★4.8 rating.
 *
 * Run: `bun run scripts/bootstrap-agent.ts`
 *
 * Idempotent: reads .env.local first, skips any step already completed.
 * Resumable: writes seed-progress.json between feedback calls.
 *
 * Prerequisites:
 *   - CIRCLE_API_KEY, CIRCLE_ENTITY_SECRET_CIPHERTEXT set
 *   - CIRCLE_WALLET_SET_ID (optional — will create one if missing)
 *   - CIRCLE_TREASURY_WALLET_ID funded with ≥30 USDC on Arc Testnet
 *     (Faucet: https://console.circle.com/faucet)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initiateDeveloperControlledWalletsClient } from '@circle-fin/developer-controlled-wallets';
import {
  registerAgent,
  giveFeedback,
  getReputation,
  IDENTITY_REGISTRY,
  REPUTATION_REGISTRY,
} from '../lib/arc-identity.js';
import { toUsdcUnits } from '../lib/arc-jobs.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const APP_ROOT = path.resolve(__dirname, '..');
const ENV_LOCAL = path.join(APP_ROOT, '.env.local');
const SEED_PROGRESS = path.join(APP_ROOT, '.bootstrap-seed-progress.json');

// Hackathon default: Arc docs example metadata URI. Swap for a pinned
// web3.storage URL if you want agent-specific metadata.
const METADATA_URI_DEFAULT = 'https://pasillo-arc.vercel.app/agent-metadata.json';

const SLEEP_MS = 2000; // dodge Circle DCW rate limit

// ─── Env loader (no dotenv dep) ─────────────────────────────────────────────

function loadEnv(): Record<string, string> {
  const env: Record<string, string> = { ...process.env } as any;
  if (!fs.existsSync(ENV_LOCAL)) return env;
  const text = fs.readFileSync(ENV_LOCAL, 'utf8');
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!env[key]) env[key] = value;
  }
  return env;
}

function saveEnvUpdates(updates: Record<string, string>): void {
  const existing: Record<string, string> = {};
  if (fs.existsSync(ENV_LOCAL)) {
    const text = fs.readFileSync(ENV_LOCAL, 'utf8');
    for (const line of text.split('\n')) {
      const eq = line.indexOf('=');
      if (eq < 0) continue;
      const key = line.slice(0, eq).trim();
      const value = line.slice(eq + 1);
      if (key) existing[key] = value;
    }
  }
  const merged = { ...existing, ...updates };
  const out = Object.entries(merged)
    .filter(([k]) => k)
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  fs.writeFileSync(ENV_LOCAL, out + '\n', 'utf8');
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ─── Progress tracking ──────────────────────────────────────────────────────

interface SeedProgress {
  completedValidators: Record<string, number>; // validatorAddress -> count
  totalCompleted: number;
}

function loadSeedProgress(): SeedProgress {
  if (!fs.existsSync(SEED_PROGRESS)) {
    return { completedValidators: {}, totalCompleted: 0 };
  }
  return JSON.parse(fs.readFileSync(SEED_PROGRESS, 'utf8'));
}

function saveSeedProgress(p: SeedProgress): void {
  fs.writeFileSync(SEED_PROGRESS, JSON.stringify(p, null, 2), 'utf8');
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const env = loadEnv();

  const apiKey = env.CIRCLE_API_KEY;
  const entitySecret = env.CIRCLE_ENTITY_SECRET || env.CIRCLE_ENTITY_SECRET_CIPHERTEXT;
  if (!apiKey || !entitySecret) {
    throw new Error(
      'CIRCLE_API_KEY and CIRCLE_ENTITY_SECRET must be set in .env.local',
    );
  }

  const circle = initiateDeveloperControlledWalletsClient({ apiKey, entitySecret });

  // ─── Ensure wallet set exists ───────────────────────────────────────────
  let walletSetId = env.CIRCLE_WALLET_SET_ID;
  if (!walletSetId) {
    console.log('── Creating wallet set ──');
    const ws = await circle.createWalletSet({ name: 'Pasillo Arc Agent' });
    walletSetId = (ws.data as any)?.walletSet?.id;
    if (!walletSetId) throw new Error('Failed to create wallet set');
    saveEnvUpdates({ CIRCLE_WALLET_SET_ID: walletSetId });
    console.log(`  ✓ wallet set: ${walletSetId}`);
  } else {
    console.log(`── Wallet set exists: ${walletSetId}`);
  }

  // ─── Ensure treasury wallet exists ──────────────────────────────────────
  let treasuryWalletId = env.CIRCLE_TREASURY_WALLET_ID;
  let treasuryAddress = env.CIRCLE_TREASURY_ADDRESS;
  if (!treasuryWalletId || !treasuryAddress) {
    console.log('\n── Creating treasury wallet ──');
    const resp = await circle.createWallets({
      blockchains: ['ARC-TESTNET' as any],
      count: 1,
      walletSetId,
      accountType: 'SCA' as any,
    } as any);
    const created = ((resp.data as any)?.wallets ?? []) as any[];
    if (!created[0]) throw new Error('Failed to create treasury wallet');
    treasuryWalletId = created[0].id;
    treasuryAddress = created[0].address;
    saveEnvUpdates({
      CIRCLE_TREASURY_WALLET_ID: treasuryWalletId!,
      CIRCLE_TREASURY_ADDRESS: treasuryAddress!,
    });
    console.log(`  ✓ treasury: ${treasuryAddress}`);
  }

  // Pre-flight: check treasury balance
  console.log('\n── Pre-flight: treasury balance ──');
  console.log(`  Treasury wallet: ${treasuryAddress}`);
  const balances = await circle.getWalletTokenBalance({ id: treasuryWalletId! });
  const usdc = (balances.data as any)?.tokenBalances?.find(
    (b: any) => b.token?.symbol === 'USDC',
  );
  const usdcAmount = parseFloat(usdc?.amount ?? '0');
  console.log(`  Treasury USDC: ${usdcAmount}`);
  if (usdcAmount < 30) {
    console.error(
      `\n✗ Treasury needs ≥30 USDC to proceed. Currently has ${usdcAmount}.

  FUND THIS ADDRESS:
    ${treasuryAddress}

  Via Circle Faucet:
    https://faucet.circle.com  (select "Arc Testnet" + "USDC")

  After funding, re-run this script (it will pick up where it left off).
`,
    );
    process.exit(1);
  }

  // ─── Create provider + demo-client + 2 aux validators ───────────────────
  const wallets: Record<
    'provider' | 'demoClient' | 'aux1' | 'aux2',
    { id: string; address: string }
  > = {} as any;

  const haveProvider =
    env.PASILLO_PROVIDER_WALLET_ID && env.PASILLO_PROVIDER_ADDRESS;
  const haveClient =
    env.DEMO_CLIENT_WALLET_ID && env.DEMO_CLIENT_ADDRESS;
  const haveAux1 = env.AUX_VALIDATOR_1_WALLET_ID && env.AUX_VALIDATOR_1_ADDRESS;
  const haveAux2 = env.AUX_VALIDATOR_2_WALLET_ID && env.AUX_VALIDATOR_2_ADDRESS;

  if (haveProvider && haveClient && haveAux1 && haveAux2) {
    console.log('\n── Wallets exist, skipping creation ──');
    wallets.provider = {
      id: env.PASILLO_PROVIDER_WALLET_ID!,
      address: env.PASILLO_PROVIDER_ADDRESS!,
    };
    wallets.demoClient = {
      id: env.DEMO_CLIENT_WALLET_ID!,
      address: env.DEMO_CLIENT_ADDRESS!,
    };
    wallets.aux1 = {
      id: env.AUX_VALIDATOR_1_WALLET_ID!,
      address: env.AUX_VALIDATOR_1_ADDRESS!,
    };
    wallets.aux2 = {
      id: env.AUX_VALIDATOR_2_WALLET_ID!,
      address: env.AUX_VALIDATOR_2_ADDRESS!,
    };
  } else {
    console.log('\n── Creating 4 SCA wallets on ARC-TESTNET ──');
    const resp = await circle.createWallets({
      blockchains: ['ARC-TESTNET' as any],
      count: 4,
      walletSetId,
      accountType: 'SCA' as any,
    } as any);
    const created = ((resp.data as any)?.wallets ?? []) as any[];
    if (created.length < 4) throw new Error(`Expected 4 wallets, got ${created.length}`);
    wallets.provider = { id: created[0].id, address: created[0].address };
    wallets.demoClient = { id: created[1].id, address: created[1].address };
    wallets.aux1 = { id: created[2].id, address: created[2].address };
    wallets.aux2 = { id: created[3].id, address: created[3].address };

    saveEnvUpdates({
      PASILLO_PROVIDER_WALLET_ID: wallets.provider.id,
      PASILLO_PROVIDER_ADDRESS: wallets.provider.address,
      DEMO_CLIENT_WALLET_ID: wallets.demoClient.id,
      DEMO_CLIENT_ADDRESS: wallets.demoClient.address,
      AUX_VALIDATOR_1_WALLET_ID: wallets.aux1.id,
      AUX_VALIDATOR_1_ADDRESS: wallets.aux1.address,
      AUX_VALIDATOR_2_WALLET_ID: wallets.aux2.id,
      AUX_VALIDATOR_2_ADDRESS: wallets.aux2.address,
    });
    console.log(`  ✓ provider:    ${wallets.provider.address}`);
    console.log(`  ✓ demo-client: ${wallets.demoClient.address}`);
    console.log(`  ✓ aux-1:       ${wallets.aux1.address}`);
    console.log(`  ✓ aux-2:       ${wallets.aux2.address}`);
  }

  // ─── 3. Fund wallets from treasury ───────────────────────────────────────
  const USDC_TOKEN_ADDR = '0x3600000000000000000000000000000000000000';
  const funding: { from: string; to: string; amount: string; label: string }[] = [
    { from: treasuryAddress, to: wallets.provider.address, amount: '2', label: 'provider gas' },
    { from: treasuryAddress, to: wallets.demoClient.address, amount: '20', label: 'demo-client escrow' },
    { from: treasuryAddress, to: wallets.aux1.address, amount: '0.5', label: 'aux-1 gas' },
    { from: treasuryAddress, to: wallets.aux2.address, amount: '0.5', label: 'aux-2 gas' },
  ];

  for (const t of funding) {
    // Skip if destination already has ≥ target
    const dstBalances = await circle.getWalletTokenBalance({
      id: t === funding[0] ? wallets.provider.id : t === funding[1] ? wallets.demoClient.id : t === funding[2] ? wallets.aux1.id : wallets.aux2.id,
    });
    const dstUsdc = (dstBalances.data as any)?.tokenBalances?.find(
      (b: any) => b.token?.symbol === 'USDC',
    );
    if (parseFloat(dstUsdc?.amount ?? '0') >= parseFloat(t.amount)) {
      console.log(`  ⏭  ${t.label} already funded (${dstUsdc.amount} USDC)`);
      continue;
    }

    console.log(`  → ${t.label}: ${t.amount} USDC → ${t.to}`);
    let xfer: any;
    try {
      xfer = await circle.createTransaction({
        walletAddress: t.from,
        blockchain: 'ARC-TESTNET' as any,
        tokenAddress: USDC_TOKEN_ADDR,
        destinationAddress: t.to,
        amount: [t.amount],
        fee: { type: 'level', config: { feeLevel: 'MEDIUM' as any } },
      } as any);
    } catch (err: any) {
      const body = err?.response?.data ?? err?.data ?? err?.message ?? err;
      console.error(`  ✗ transfer failed:`, JSON.stringify(body, null, 2));
      throw err;
    }
    const txId = (xfer.data as any)?.id;
    // Wait for the transfer to complete so subsequent steps have balance
    let state = '';
    for (let i = 0; i < 60; i++) {
      await sleep(2000);
      const tx = await circle.getTransaction({ id: txId });
      state = (tx.data as any)?.transaction?.state;
      if (state === 'COMPLETE') break;
      if (state === 'FAILED') throw new Error(`Transfer failed: ${t.label}`);
    }
    if (state !== 'COMPLETE') throw new Error(`Transfer timed out: ${t.label}`);
    console.log(`    ✓ ${t.label} funded`);
  }

  // ─── 4. Mint agent identity NFT ──────────────────────────────────────────
  let agentId = env.PASILLO_AGENT_ID;
  if (agentId) {
    console.log(`\n── Agent already registered: #${agentId} — skipping mint`);
  } else {
    console.log('\n── Minting agent identity NFT ──');
    const metadataURI = env.PASILLO_METADATA_URI || METADATA_URI_DEFAULT;
    console.log(`  metadata: ${metadataURI}`);
    const { agentId: newAgentId, txHash } = await registerAgent({
      ownerWalletAddress: wallets.provider.address,
      ownerAddress: wallets.provider.address as any,
      metadataURI,
    });
    agentId = newAgentId.toString();
    saveEnvUpdates({ PASILLO_AGENT_ID: agentId });
    console.log(`  ✓ agent #${agentId} minted — tx ${txHash}`);
  }

  // ─── 5. Seed reputation (50 feedback events, 3 validators) ───────────────
  console.log('\n── Seeding reputation (~50 events, ~3 min) ──');
  const progress = loadSeedProgress();
  const validators: { address: string; walletAddress: string; label: string }[] = [
    { address: wallets.demoClient.address, walletAddress: wallets.demoClient.address, label: 'demo-client' },
    { address: wallets.aux1.address, walletAddress: wallets.aux1.address, label: 'aux-1' },
    { address: wallets.aux2.address, walletAddress: wallets.aux2.address, label: 'aux-2' },
  ];
  const tags = ['on_time', 'clean_pnr', 'responsive', 'accurate', 'professional'];
  const targetPerValidator = [17, 17, 16]; // ~50 total, spread

  for (let vi = 0; vi < validators.length; vi++) {
    const validator = validators[vi];
    const target = targetPerValidator[vi];
    const done = progress.completedValidators[validator.address] ?? 0;
    if (done >= target) {
      console.log(`  ⏭  ${validator.label}: ${done}/${target} done`);
      continue;
    }
    for (let i = done; i < target; i++) {
      const score = 90 + Math.floor(Math.random() * 11); // 90-100
      const tag = tags[i % tags.length];
      try {
        await giveFeedback({
          validatorWalletAddress: validator.walletAddress,
          agentId: BigInt(agentId!),
          score,
          tag,
        });
        progress.completedValidators[validator.address] = i + 1;
        progress.totalCompleted++;
        saveSeedProgress(progress);
        process.stdout.write(
          `\r  ${validator.label} ${i + 1}/${target}  score=${score} tag=${tag}   `,
        );
      } catch (e) {
        console.error(`\n  ✗ ${validator.label} #${i}: ${(e as Error).message}`);
        throw e;
      }
      await sleep(SLEEP_MS);
    }
    console.log('');
  }
  console.log(`  ✓ seeded ${progress.totalCompleted} feedback events`);

  // ─── 6. Summary ──────────────────────────────────────────────────────────
  console.log('\n── Reading final reputation ──');
  const summary = await getReputation(BigInt(agentId!));
  console.log(`  stars:      ${summary.stars.toFixed(2)}`);
  console.log(`  mean score: ${summary.meanScore.toFixed(2)}`);
  console.log(`  events:     ${summary.count}`);
  console.log(`  validators: ${summary.validators}`);

  console.log('\n✓ Bootstrap complete. .env.local populated:');
  console.log(`    PASILLO_AGENT_ID=${agentId}`);
  console.log(`    PASILLO_PROVIDER_ADDRESS=${wallets.provider.address}`);
  console.log(`    DEMO_CLIENT_ADDRESS=${wallets.demoClient.address}`);
  console.log(
    `    Arcscan: https://testnet.arcscan.app/address/${IDENTITY_REGISTRY}`,
  );
}

main().catch((err) => {
  console.error('\n✗ bootstrap failed:', err?.message ?? err);
  process.exit(1);
});
