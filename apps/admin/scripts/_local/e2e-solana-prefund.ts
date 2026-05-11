/**
 * e2e roundtrip: deployed sendero_guest_escrow on devnet ←→ TS adapter.
 *
 * One-shot script that proves the wiring works end-to-end against the
 * live program at 9NHw47GifDKsPDggQeQd53sNrAsBWeSayzvvSr2tjUL8:
 *
 *   1. (Idempotent) create a test SPL mint, 6 decimals, platform-owned
 *      authority. Devnet has no Circle USDC faucet API — using a
 *      custom mint is the practical alternative. The program's
 *      payment_mint is locked at initialize time so this also fixes
 *      the devnet program to this test mint forever; mainnet redeploy
 *      will re-init with real Circle USDC.
 *   2. (Idempotent) mint 100 test-USDC to the platform keypair's ATA.
 *   3. (Idempotent) initialize the program if config PDA is missing.
 *   4. Build a fresh prefund_trip ix via @sendero/guest/solana, sign +
 *      send with the platform keypair as buyer.
 *   5. Read back the Trip PDA and print state, amount, claim_pubkey,
 *      expiry. Read the vault SPL account, print balance.
 *
 * Run: bun apps/app/scripts/_local/e2e-solana-prefund.ts
 */

import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
} from '@solana/web3.js';
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  createInitializeMint2Instruction,
  createMintToInstruction,
  getAssociatedTokenAddressSync,
  getMinimumBalanceForRentExemptMint,
  MINT_SIZE,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import bs58 from 'bs58';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildPreFundTripIx,
  deriveConfigPda,
  deriveTripPda,
  deriveVaultPda,
  SENDERO_GUEST_ESCROW_PROGRAM_ID,
} from '../../../../packages/guest/src/solana';

const RPC = process.env.SENDERO_SOLANA_RPC_URL ?? 'https://api.devnet.solana.com';
const __dirname = dirname(fileURLToPath(import.meta.url));
const TEST_MINT_PATH = resolve(__dirname, '.solana-test-usdc-mint.json');

function loadPlatformKeypair(): Keypair {
  let sk = process.env.SENDERO_SOLANA_PLATFORM_PRIVATE_KEY;
  if (!sk) {
    // Walk upward from CWD — works whether the script is run from the
    // repo root or from apps/admin.
    const candidates = [
      resolve('.env.local'),
      resolve('../.env.local'),
      resolve('../../.env.local'),
      resolve('../../../.env.local'),
    ];
    for (const path of candidates) {
      if (!existsSync(path)) continue;
      const env = readFileSync(path, 'utf8');
      const m = env.match(/SENDERO_SOLANA_PLATFORM_PRIVATE_KEY="?([^"\n]+)"?/);
      if (m) {
        sk = m[1];
        break;
      }
    }
    if (!sk) throw new Error('SENDERO_SOLANA_PLATFORM_PRIVATE_KEY not in env or .env.local');
  }
  return Keypair.fromSecretKey(bs58.decode(sk));
}

function loadOrCreateTestMint(): Keypair {
  if (existsSync(TEST_MINT_PATH)) {
    const raw = JSON.parse(readFileSync(TEST_MINT_PATH, 'utf8')) as number[];
    return Keypair.fromSecretKey(Uint8Array.from(raw));
  }
  const kp = Keypair.generate();
  writeFileSync(TEST_MINT_PATH, JSON.stringify(Array.from(kp.secretKey)));
  console.log(`[mint] generated new test mint kp -> ${TEST_MINT_PATH}`);
  return kp;
}

async function ensureMintCreated(conn: Connection, payer: Keypair, mintKp: Keypair): Promise<void> {
  const info = await conn.getAccountInfo(mintKp.publicKey);
  if (info) {
    console.log(`[mint] exists: ${mintKp.publicKey.toBase58()}`);
    return;
  }
  const lamports = await getMinimumBalanceForRentExemptMint(conn);
  const tx = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: mintKp.publicKey,
      space: MINT_SIZE,
      lamports,
      programId: TOKEN_PROGRAM_ID,
    }),
    createInitializeMint2Instruction(mintKp.publicKey, 6, payer.publicKey, null, TOKEN_PROGRAM_ID)
  );
  const sig = await conn.sendTransaction(tx, [payer, mintKp]);
  await conn.confirmTransaction(sig, 'confirmed');
  console.log(`[mint] created ${mintKp.publicKey.toBase58()} sig=${sig}`);
}

async function ensureBuyerAtaFunded(
  conn: Connection,
  payer: Keypair,
  mint: PublicKey,
  buyer: PublicKey,
  microAmount: bigint
): Promise<PublicKey> {
  const ata = getAssociatedTokenAddressSync(mint, buyer);
  const ataInfo = await conn.getAccountInfo(ata);
  const ixs = [];
  if (!ataInfo) {
    ixs.push(createAssociatedTokenAccountInstruction(payer.publicKey, ata, buyer, mint));
  } else {
    const balance = ataInfo.data.readBigUInt64LE(64);
    if (balance >= microAmount) {
      console.log(
        `[ata] ${ata.toBase58()} already has ${balance} micro (>= ${microAmount}); skipping mint`
      );
      return ata;
    }
  }
  ixs.push(createMintToInstruction(mint, ata, payer.publicKey, microAmount, [], TOKEN_PROGRAM_ID));
  const tx = new Transaction().add(...ixs);
  const sig = await conn.sendTransaction(tx, [payer]);
  await conn.confirmTransaction(sig, 'confirmed');
  console.log(`[ata] funded ${ata.toBase58()} with ${microAmount} micro sig=${sig}`);
  return ata;
}

async function ensureProgramInitialized(
  conn: Connection,
  admin: Keypair,
  paymentMint: PublicKey,
  operator: PublicKey
): Promise<void> {
  const [config] = deriveConfigPda();
  const info = await conn.getAccountInfo(config);
  if (info) {
    console.log(`[init] config already exists at ${config.toBase58()} (${info.data.length} bytes)`);
    return;
  }
  // Discriminator from IDL: [175, 175, 109, 31, 13, 152, 155, 237]
  const disc = Buffer.from([175, 175, 109, 31, 13, 152, 155, 237]);
  const data = Buffer.concat([disc, operator.toBuffer()]);
  // Account order matches `pub struct Initialize<'info>` in
  // contracts/programs-solana/programs/sendero-guest-escrow/src/lib.rs:
  // [admin, payment_mint, config, system_program].
  const ix = {
    programId: SENDERO_GUEST_ESCROW_PROGRAM_ID,
    keys: [
      { pubkey: admin.publicKey, isSigner: true, isWritable: true },
      { pubkey: paymentMint, isSigner: false, isWritable: false },
      { pubkey: config, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  };
  const tx = new Transaction()
    .add(ComputeBudgetProgram.setComputeUnitLimit({ units: 250_000 }))
    .add(ix);
  const sig = await conn.sendTransaction(tx, [admin]);
  await conn.confirmTransaction(sig, 'confirmed');
  console.log(`[init] initialized program; config=${config.toBase58()} sig=${sig}`);
  console.log(`         https://explorer.solana.com/tx/${sig}?cluster=devnet`);
}

function rand32(): Uint8Array {
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) out[i] = Math.floor(Math.random() * 256);
  return out;
}

async function main() {
  const conn = new Connection(RPC, 'confirmed');
  const platform = loadPlatformKeypair();
  const buyer = platform; // single role for the e2e — admin = operator = buyer
  console.log(`[setup] platform pubkey: ${platform.publicKey.toBase58()}`);
  console.log(`[setup] program id     : ${SENDERO_GUEST_ESCROW_PROGRAM_ID.toBase58()}`);
  const lamports = await conn.getBalance(platform.publicKey);
  console.log(`[setup] SOL balance    : ${lamports / 1e9}`);
  if (lamports < 50_000_000) throw new Error('need >= 0.05 SOL on the platform key');

  // Step 1+2: test mint + buyer ATA funded
  const mintKp = loadOrCreateTestMint();
  await ensureMintCreated(conn, platform, mintKp);
  await ensureBuyerAtaFunded(conn, platform, mintKp.publicKey, buyer.publicKey, 100_000_000n);

  // Step 3: initialize program (idempotent)
  await ensureProgramInitialized(conn, platform, mintKp.publicKey, platform.publicKey);

  // Step 4: prefund_trip
  const tripId = rand32();
  const claimKp = Keypair.generate();
  const expiry = BigInt(Math.floor(Date.now() / 1000) + 60 * 60 * 24); // +24h
  const otpHash = rand32();
  const amount = 1_000_000n; // 1 test-USDC

  const ix = buildPreFundTripIx({
    buyer: buyer.publicKey,
    tripId,
    amount,
    claimPubkey: claimKp.publicKey,
    expiry,
    expectedOtpHash: otpHash,
    paymentMint: mintKp.publicKey,
  });

  const tx = new Transaction()
    .add(ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }))
    .add(ix);
  const sig = await conn.sendTransaction(tx, [buyer]);
  await conn.confirmTransaction(sig, 'confirmed');
  const tripIdHex = Buffer.from(tripId).toString('hex');
  const [tripPda] = deriveTripPda(tripId);
  const [vaultPda] = deriveVaultPda(tripId);
  console.log(`\n[prefund] OK`);
  console.log(`         trip_id (hex)    : 0x${tripIdHex}`);
  console.log(`         trip PDA         : ${tripPda.toBase58()}`);
  console.log(`         vault PDA        : ${vaultPda.toBase58()}`);
  console.log(`         claim_pubkey     : ${claimKp.publicKey.toBase58()}`);
  console.log(`         amount (micro)   : ${amount}`);
  console.log(`         expiry (unix)    : ${expiry}`);
  console.log(`         tx               : ${sig}`);
  console.log(`         https://explorer.solana.com/tx/${sig}?cluster=devnet`);

  // Step 5: read back
  const tripInfo = await conn.getAccountInfo(tripPda);
  if (!tripInfo) throw new Error('trip PDA missing after prefund — should be fatal');
  console.log(`\n[verify] trip PDA size  : ${tripInfo.data.length}`);
  // Trip layout per IDL types/Trip (after 8-byte discriminator):
  //   trip_id:[u8;32]  8..40
  //   buyer:Pubkey    40..72
  //   claim_pubkey    72..104
  //   guest_claimant  104..136
  //   funded_amount:u64    136..144
  //   reserved_amount:u64  144..152
  //   spent_amount:u64     152..160
  //   expiry:i64           160..168
  //   status:enum(1)       168
  //   expected_otp_hash    169..201
  //   swept:bool           201
  //   bump:u8              202
  const d = tripInfo.data;
  const onChainTripId = Buffer.from(d.slice(8, 40)).toString('hex');
  const onChainBuyer = new PublicKey(d.slice(40, 72)).toBase58();
  const onChainClaim = new PublicKey(d.slice(72, 104)).toBase58();
  const onChainFunded = d.readBigUInt64LE(136);
  const onChainStatus = d[168];
  console.log(`         on-chain trip_id : 0x${onChainTripId}`);
  console.log(`         on-chain buyer   : ${onChainBuyer}`);
  console.log(`         on-chain claim   : ${onChainClaim}`);
  console.log(`         on-chain funded  : ${onChainFunded}`);
  console.log(`         on-chain status  : ${onChainStatus} (0=PreFunded, 1=Claimed, ...)`);

  if (onChainTripId !== tripIdHex) throw new Error('trip_id mismatch on-chain vs encoded');
  if (onChainBuyer !== buyer.publicKey.toBase58()) throw new Error('buyer mismatch');
  if (onChainClaim !== claimKp.publicKey.toBase58()) throw new Error('claim_pubkey mismatch');
  if (onChainFunded !== amount)
    throw new Error(`funded_amount ${onChainFunded} !== amount ${amount}`);

  const vaultInfo = await conn.getAccountInfo(vaultPda);
  if (!vaultInfo) throw new Error('vault PDA missing');
  const vaultBalance = vaultInfo.data.readBigUInt64LE(64);
  console.log(`         vault balance    : ${vaultBalance}`);
  if (vaultBalance !== amount)
    throw new Error(`vault balance ${vaultBalance} !== amount ${amount}`);

  console.log(`\n✅ e2e roundtrip green`);
}

main().catch(err => {
  console.error('e2e failed:', err);
  process.exit(1);
});
