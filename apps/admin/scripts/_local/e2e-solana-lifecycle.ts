/**
 * Full-lifecycle e2e against the live sendero_guest_escrow program on
 * devnet (9NHw47GifDKsPDggQeQd53sNrAsBWeSayzvvSr2tjUL8). Walks every
 * state transition the agent depends on:
 *
 *   1. (idempotent) ensure test mint, buyer ATA funded, program init'd.
 *   2. PREFUND          PreFunded  ─ vault locks `funded_amount` USDC
 *   3. CLAIM            Active     ─ guest binds via Ed25519 sibling
 *   4. RESERVE #1       Active+Reserved booking #1
 *   5. COMMIT #1        Active+Committed booking #1 (vendor + fee fixed)
 *   6. SETTLE #1        Active+Settled — vault → vendor ATA + operator ATA
 *   7. RESERVE #2       Active+Reserved booking #2
 *   8. REFUND #2        Active+Refunded — reserved leg returned to trip
 *
 * Each ix is encoded INLINE (not via @sendero/guest/solana) because the
 * checked-in adapter has stale arg lists for several ixs (claim_trip,
 * commit_booking, refund_booking) that don't match the deployed program.
 * Once this script is green we fold the corrected encoding back into
 * packages/guest/src/solana.ts.
 *
 * Run: bun apps/admin/scripts/_local/e2e-solana-lifecycle.ts
 */

import {
  ComputeBudgetProgram,
  Connection,
  Ed25519Program,
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  Transaction,
  TransactionInstruction,
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
import { ed25519 } from '@noble/curves/ed25519';
import { sha256 } from '@noble/hashes/sha2';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PROGRAM_ID = new PublicKey('9NHw47GifDKsPDggQeQd53sNrAsBWeSayzvvSr2tjUL8');
const SYSVAR_INSTRUCTIONS_PUBKEY = new PublicKey('Sysvar1nstructions1111111111111111111111111');
const RPC = process.env.SENDERO_SOLANA_RPC_URL ?? 'https://api.devnet.solana.com';
const __dirname = dirname(fileURLToPath(import.meta.url));
const TEST_MINT_PATH = resolve(__dirname, '.solana-test-usdc-mint.json');

const TE = new TextEncoder();
const CONFIG_SEED = TE.encode('config');
const TRIP_SEED = TE.encode('trip');
const BOOKING_SEED = TE.encode('booking');
const VAULT_SEED = TE.encode('vault');
const SENDERO_DOMAIN = TE.encode('SENDERO_V1_GUEST_CLAIM');

// ── Anchor sighash discriminators (from IDL) ──────────────────────────
const DISC = {
  initialize: Buffer.from([175, 175, 109, 31, 13, 152, 155, 237]),
  preFundTrip: Buffer.from([30, 248, 158, 27, 52, 173, 114, 82]),
  claimTrip: Buffer.from(getDisc('claim_trip')),
  reserveBooking: Buffer.from(getDisc('reserve_booking')),
  commitBooking: Buffer.from(getDisc('commit_booking')),
  settleBooking: Buffer.from(getDisc('settle_booking')),
  refundBooking: Buffer.from(getDisc('refund_booking')),
};

function getDisc(name: string): number[] {
  const idl = JSON.parse(
    readFileSync(
      resolve(__dirname, '../../../../packages/guest/src/_idl/sendero_guest_escrow.json'),
      'utf8'
    )
  );
  const ix = idl.instructions.find((i: { name: string }) => i.name === name);
  if (!ix) throw new Error(`disc missing for ${name}`);
  return ix.discriminator;
}

// ── PDA derivation ────────────────────────────────────────────────────
function configPda(): PublicKey {
  return PublicKey.findProgramAddressSync([CONFIG_SEED], PROGRAM_ID)[0];
}
function tripPda(tripId: Uint8Array): PublicKey {
  return PublicKey.findProgramAddressSync([TRIP_SEED, tripId], PROGRAM_ID)[0];
}
function bookingPda(bookingId: Uint8Array): PublicKey {
  return PublicKey.findProgramAddressSync([BOOKING_SEED, bookingId], PROGRAM_ID)[0];
}
function vaultPda(tripId: Uint8Array): PublicKey {
  return PublicKey.findProgramAddressSync([VAULT_SEED, tripId], PROGRAM_ID)[0];
}

// ── borsh-ish arg encoders (only the kinds we actually need) ──────────
function u64LE(v: bigint): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(v, 0);
  return b;
}
function i64LE(v: bigint): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigInt64LE(v, 0);
  return b;
}
function vecU8(bytes: Uint8Array): Buffer {
  // Borsh Vec<u8> = u32 LE length + raw bytes.
  const len = Buffer.alloc(4);
  len.writeUInt32LE(bytes.length, 0);
  return Buffer.concat([len, Buffer.from(bytes)]);
}

// ── platform key + test mint loaders (idempotent across runs) ─────────
function loadPlatformKeypair(): Keypair {
  let sk = process.env.SENDERO_SOLANA_PLATFORM_PRIVATE_KEY;
  if (!sk) {
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
  return kp;
}

// ── env-prep helpers ──────────────────────────────────────────────────

async function ensureMintCreated(conn: Connection, payer: Keypair, mintKp: Keypair): Promise<void> {
  if (await conn.getAccountInfo(mintKp.publicKey)) return;
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
}

async function ensureAtaFunded(
  conn: Connection,
  payer: Keypair,
  mint: PublicKey,
  owner: PublicKey,
  microAmount: bigint
): Promise<PublicKey> {
  const ata = getAssociatedTokenAddressSync(mint, owner);
  const ataInfo = await conn.getAccountInfo(ata);
  const ixs: TransactionInstruction[] = [];
  if (!ataInfo) {
    ixs.push(createAssociatedTokenAccountInstruction(payer.publicKey, ata, owner, mint));
  } else {
    const balance = ataInfo.data.readBigUInt64LE(64);
    if (balance >= microAmount) return ata;
  }
  if (microAmount > 0n) {
    ixs.push(
      createMintToInstruction(mint, ata, payer.publicKey, microAmount, [], TOKEN_PROGRAM_ID)
    );
  }
  if (ixs.length === 0) return ata;
  const tx = new Transaction().add(...ixs);
  const sig = await conn.sendTransaction(tx, [payer]);
  await conn.confirmTransaction(sig, 'confirmed');
  return ata;
}

async function ensureProgramInitialized(
  conn: Connection,
  admin: Keypair,
  paymentMint: PublicKey,
  operator: PublicKey
): Promise<void> {
  const config = configPda();
  if (await conn.getAccountInfo(config)) return;
  const data = Buffer.concat([DISC.initialize, operator.toBuffer()]);
  const ix: TransactionInstruction = {
    programId: PROGRAM_ID,
    keys: [
      { pubkey: admin.publicKey, isSigner: true, isWritable: true },
      { pubkey: paymentMint, isSigner: false, isWritable: false },
      { pubkey: config, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  };
  const tx = new Transaction().add(ix);
  const sig = await conn.sendTransaction(tx, [admin]);
  await conn.confirmTransaction(sig, 'confirmed');
  console.log(`[init] program initialized — config ${config.toBase58()} (${sig})`);
}

// ── ix builders for the lifecycle ─────────────────────────────────────

function buildPrefundIx(args: {
  buyer: PublicKey;
  tripId: Uint8Array;
  amount: bigint;
  claimPubkey: PublicKey;
  expiry: bigint;
  expectedOtpHash: Uint8Array;
  paymentMint: PublicKey;
}): TransactionInstruction {
  const buyerAta = getAssociatedTokenAddressSync(args.paymentMint, args.buyer);
  const data = Buffer.concat([
    DISC.preFundTrip,
    Buffer.from(args.tripId),
    u64LE(args.amount),
    args.claimPubkey.toBuffer(),
    i64LE(args.expiry),
    Buffer.from(args.expectedOtpHash),
  ]);
  return {
    programId: PROGRAM_ID,
    keys: [
      { pubkey: args.buyer, isSigner: true, isWritable: true },
      { pubkey: configPda(), isSigner: false, isWritable: false },
      { pubkey: tripPda(args.tripId), isSigner: false, isWritable: true },
      { pubkey: args.paymentMint, isSigner: false, isWritable: false },
      { pubkey: vaultPda(args.tripId), isSigner: false, isWritable: true },
      { pubkey: buyerAta, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
    ],
    data,
  };
}

function buildClaimMessage(tripId: Uint8Array, guestClaimant: PublicKey): Uint8Array {
  const out = new Uint8Array(SENDERO_DOMAIN.length + 32 + 32 + 32);
  let off = 0;
  out.set(SENDERO_DOMAIN, off);
  off += SENDERO_DOMAIN.length;
  out.set(PROGRAM_ID.toBytes(), off);
  off += 32;
  out.set(tripId, off);
  off += 32;
  out.set(guestClaimant.toBytes(), off);
  return out;
}

function buildClaimTripIxs(args: {
  relayer: PublicKey;
  tripId: Uint8Array;
  otpPreimage: Uint8Array;
  guestClaimant: PublicKey;
  claimPubkey: PublicKey;
  claimSignature: Uint8Array;
  claimMessage: Uint8Array;
}): [TransactionInstruction, TransactionInstruction] {
  const sibling = Ed25519Program.createInstructionWithPublicKey({
    publicKey: args.claimPubkey.toBytes(),
    message: args.claimMessage,
    signature: args.claimSignature,
  });
  const data = Buffer.concat([
    DISC.claimTrip,
    Buffer.from(args.tripId),
    vecU8(args.otpPreimage),
    args.guestClaimant.toBuffer(),
  ]);
  const claimIx: TransactionInstruction = {
    programId: PROGRAM_ID,
    keys: [
      { pubkey: args.relayer, isSigner: true, isWritable: true },
      { pubkey: configPda(), isSigner: false, isWritable: false },
      { pubkey: tripPda(args.tripId), isSigner: false, isWritable: true },
      { pubkey: SYSVAR_INSTRUCTIONS_PUBKEY, isSigner: false, isWritable: false },
    ],
    data,
  };
  return [sibling, claimIx];
}

function buildReserveBookingIx(args: {
  operator: PublicKey;
  tripId: Uint8Array;
  bookingId: Uint8Array;
  upperBound: bigint;
}): TransactionInstruction {
  const data = Buffer.concat([
    DISC.reserveBooking,
    Buffer.from(args.tripId),
    Buffer.from(args.bookingId),
    u64LE(args.upperBound),
  ]);
  return {
    programId: PROGRAM_ID,
    keys: [
      { pubkey: args.operator, isSigner: true, isWritable: true },
      { pubkey: configPda(), isSigner: false, isWritable: false },
      { pubkey: tripPda(args.tripId), isSigner: false, isWritable: true },
      { pubkey: bookingPda(args.bookingId), isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  };
}

function buildCommitBookingIx(args: {
  operator: PublicKey;
  tripId: Uint8Array;
  bookingId: Uint8Array;
  vendorAmount: bigint;
  feeAmount: bigint;
  vendor: PublicKey;
}): TransactionInstruction {
  const data = Buffer.concat([
    DISC.commitBooking,
    Buffer.from(args.tripId),
    Buffer.from(args.bookingId),
    u64LE(args.vendorAmount),
    u64LE(args.feeAmount),
    args.vendor.toBuffer(),
  ]);
  return {
    programId: PROGRAM_ID,
    keys: [
      { pubkey: args.operator, isSigner: true, isWritable: false },
      { pubkey: configPda(), isSigner: false, isWritable: false },
      { pubkey: tripPda(args.tripId), isSigner: false, isWritable: true },
      { pubkey: bookingPda(args.bookingId), isSigner: false, isWritable: true },
    ],
    data,
  };
}

function buildSettleBookingIx(args: {
  operator: PublicKey;
  tripId: Uint8Array;
  bookingId: Uint8Array;
  duffelOrderRef: Uint8Array;
  vendorTokenAccount: PublicKey;
  operatorTokenAccount: PublicKey;
}): TransactionInstruction {
  const data = Buffer.concat([
    DISC.settleBooking,
    Buffer.from(args.tripId),
    Buffer.from(args.bookingId),
    Buffer.from(args.duffelOrderRef),
  ]);
  return {
    programId: PROGRAM_ID,
    keys: [
      { pubkey: args.operator, isSigner: true, isWritable: false },
      { pubkey: configPda(), isSigner: false, isWritable: false },
      { pubkey: tripPda(args.tripId), isSigner: false, isWritable: true },
      { pubkey: bookingPda(args.bookingId), isSigner: false, isWritable: true },
      { pubkey: vaultPda(args.tripId), isSigner: false, isWritable: true },
      { pubkey: args.vendorTokenAccount, isSigner: false, isWritable: true },
      { pubkey: args.operatorTokenAccount, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data,
  };
}

function buildRefundBookingIx(args: {
  operator: PublicKey;
  tripId: Uint8Array;
  bookingId: Uint8Array;
}): TransactionInstruction {
  const data = Buffer.concat([
    DISC.refundBooking,
    Buffer.from(args.tripId),
    Buffer.from(args.bookingId),
  ]);
  return {
    programId: PROGRAM_ID,
    keys: [
      { pubkey: args.operator, isSigner: true, isWritable: false },
      { pubkey: configPda(), isSigner: false, isWritable: false },
      { pubkey: tripPda(args.tripId), isSigner: false, isWritable: true },
      { pubkey: bookingPda(args.bookingId), isSigner: false, isWritable: true },
    ],
    data,
  };
}

// ── helpers for reading state ─────────────────────────────────────────

interface TripState {
  tripId: string;
  buyer: string;
  claim: string;
  guestClaimant: string;
  funded: bigint;
  reserved: bigint;
  spent: bigint;
  status: number;
}

async function readTrip(conn: Connection, pda: PublicKey): Promise<TripState> {
  const info = await conn.getAccountInfo(pda);
  if (!info) throw new Error(`trip PDA missing: ${pda.toBase58()}`);
  const d = info.data;
  return {
    tripId: Buffer.from(d.slice(8, 40)).toString('hex'),
    buyer: new PublicKey(d.slice(40, 72)).toBase58(),
    claim: new PublicKey(d.slice(72, 104)).toBase58(),
    guestClaimant: new PublicKey(d.slice(104, 136)).toBase58(),
    funded: d.readBigUInt64LE(136),
    reserved: d.readBigUInt64LE(144),
    spent: d.readBigUInt64LE(152),
    status: d[168],
  };
}

interface BookingState {
  /** 0=Reserved, 1=Committed, 2=Settled, 3=Refunded. */
  status: number;
  /** `vendor_amount` arg from commit_booking is persisted here. */
  actualAmount: bigint;
  feeAmount: bigint;
  upperBound: bigint;
}

async function readBooking(conn: Connection, pda: PublicKey): Promise<BookingState> {
  const info = await conn.getAccountInfo(pda);
  if (!info) throw new Error(`booking PDA missing: ${pda.toBase58()}`);
  const d = info.data;
  // Booking layout per IDL types/Booking (after 8-byte discriminator):
  //   trip_id [u8;32]      8..40
  //   booking_id           40..72
  //   upper_bound u64      72..80
  //   actual_amount u64    80..88
  //   fee_amount u64       88..96
  //   vendor:Pubkey        96..128
  //   duffel_order_ref     128..160
  //   reserved_at i64      160..168
  //   committed_at i64     168..176
  //   status:enum(1)       176
  //   bump:u8              177
  return {
    upperBound: d.readBigUInt64LE(72),
    actualAmount: d.readBigUInt64LE(80),
    feeAmount: d.readBigUInt64LE(88),
    status: d[176],
  };
}

async function ataBalance(conn: Connection, ata: PublicKey): Promise<bigint> {
  const info = await conn.getAccountInfo(ata);
  if (!info) return 0n;
  return info.data.readBigUInt64LE(64);
}

function rand32(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(32));
}

async function send(
  conn: Connection,
  ixs: TransactionInstruction[],
  signers: Keypair[],
  opts?: { cuLimit?: number; prepend?: boolean }
): Promise<string> {
  // claim_trip's sibling must sit at instruction-index 0, so allow
  // suppressing the ComputeBudget prepend on transactions that read
  // their own neighbours via instructions_sysvar.
  const tx = new Transaction();
  if (opts?.prepend !== false) {
    tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: opts?.cuLimit ?? 400_000 }));
  }
  tx.add(...ixs);
  const sig = await conn.sendTransaction(tx, signers);
  await conn.confirmTransaction(sig, 'confirmed');
  return sig;
}

function explorer(sig: string): string {
  return `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
}

// ── main ──────────────────────────────────────────────────────────────

async function main() {
  const conn = new Connection(RPC, 'confirmed');
  const platform = loadPlatformKeypair();
  // Single-key e2e: platform = admin = operator = buyer = relayer.
  const admin = platform;
  const operator = platform;
  const buyer = platform;
  const relayer = platform;

  console.log(`[setup] platform pubkey: ${platform.publicKey.toBase58()}`);
  console.log(`[setup] program id     : ${PROGRAM_ID.toBase58()}`);
  const lamports = await conn.getBalance(platform.publicKey);
  console.log(`[setup] SOL balance    : ${(lamports / 1e9).toFixed(4)}`);
  if (lamports < 100_000_000) throw new Error('platform key needs >= 0.1 SOL');

  const mintKp = loadOrCreateTestMint();
  await ensureMintCreated(conn, platform, mintKp);
  await ensureAtaFunded(conn, platform, mintKp.publicKey, buyer.publicKey, 100_000_000n);
  await ensureProgramInitialized(conn, admin, mintKp.publicKey, operator.publicKey);
  // Operator's own ATA (settle deposits the fee leg here).
  const operatorAta = await ensureAtaFunded(
    conn,
    platform,
    mintKp.publicKey,
    operator.publicKey,
    0n
  );

  // ── PHASE 1: PREFUND ──────────────────────────────────────────────
  const tripId = rand32();
  const claimKp = Keypair.generate();
  const guestRecipient = Keypair.generate();
  const otpPreimage = rand32(); // 32 random bytes; could be any length
  const expectedOtpHash = sha256(otpPreimage);
  const expiry = BigInt(Math.floor(Date.now() / 1000) + 60 * 60 * 24);
  const fundedAmount = 2_000_000n; // 2 test-USDC

  const prefundSig = await send(
    conn,
    [
      buildPrefundIx({
        buyer: buyer.publicKey,
        tripId,
        amount: fundedAmount,
        claimPubkey: claimKp.publicKey,
        expiry,
        expectedOtpHash,
        paymentMint: mintKp.publicKey,
      }),
    ],
    [buyer]
  );
  const trip = tripPda(tripId);
  const vault = vaultPda(tripId);
  let tState = await readTrip(conn, trip);
  console.log(`\n[prefund] OK status=${tState.status} (PreFunded=0) funded=${tState.funded}`);
  console.log(`           trip ${trip.toBase58()}  tx ${prefundSig.slice(0, 12)}…`);
  console.log(`           ${explorer(prefundSig)}`);
  if (tState.status !== 0) throw new Error(`expected status PreFunded(0); got ${tState.status}`);
  if (tState.funded !== fundedAmount) throw new Error(`funded mismatch`);

  // ── PHASE 2: CLAIM ────────────────────────────────────────────────
  const claimMessage = buildClaimMessage(tripId, guestRecipient.publicKey);
  const claimSignature = ed25519.sign(claimMessage, claimKp.secretKey.slice(0, 32));
  const [siblingIx, claimIx] = buildClaimTripIxs({
    relayer: relayer.publicKey,
    tripId,
    otpPreimage,
    guestClaimant: guestRecipient.publicKey,
    claimPubkey: claimKp.publicKey,
    claimSignature,
    claimMessage,
  });
  // No ComputeBudget prepend: sibling MUST be tx instruction 0.
  const claimSig = await send(conn, [siblingIx, claimIx], [relayer], { prepend: false });
  tState = await readTrip(conn, trip);
  console.log(`\n[claim]   OK status=${tState.status} (Active=1) guest=${tState.guestClaimant}`);
  console.log(`           tx ${claimSig.slice(0, 12)}…`);
  console.log(`           ${explorer(claimSig)}`);
  if (tState.status !== 1) throw new Error(`expected status Active(1); got ${tState.status}`);
  if (tState.guestClaimant !== guestRecipient.publicKey.toBase58())
    throw new Error('guest_claimant mismatch on-chain');

  // ── PHASE 3: RESERVE booking #1 ───────────────────────────────────
  const booking1 = rand32();
  const upperBound1 = 1_500_000n;
  const reserveSig1 = await send(
    conn,
    [
      buildReserveBookingIx({
        operator: operator.publicKey,
        tripId,
        bookingId: booking1,
        upperBound: upperBound1,
      }),
    ],
    [operator]
  );
  let b1 = await readBooking(conn, bookingPda(booking1));
  tState = await readTrip(conn, trip);
  console.log(
    `\n[reserve#1] OK booking_status=${b1.status} (Reserved=0) upperBound=${b1.upperBound}`
  );
  console.log(`             trip.reserved=${tState.reserved}`);
  console.log(`             tx ${reserveSig1.slice(0, 12)}… ${explorer(reserveSig1)}`);
  if (b1.status !== 0) throw new Error(`booking#1 expected Reserved(0); got ${b1.status}`);
  if (b1.upperBound !== upperBound1) throw new Error('upperBound mismatch');
  if (tState.reserved !== upperBound1) throw new Error('trip.reserved should equal upperBound#1');

  // ── PHASE 4: COMMIT booking #1 ────────────────────────────────────
  const vendorKp = Keypair.generate();
  const vendor = vendorKp.publicKey;
  const vendorAta = await ensureAtaFunded(conn, platform, mintKp.publicKey, vendor, 0n);
  const vendorAmount = 1_000_000n;
  const feeAmount = 100_000n;
  const commitSig = await send(
    conn,
    [
      buildCommitBookingIx({
        operator: operator.publicKey,
        tripId,
        bookingId: booking1,
        vendorAmount,
        feeAmount,
        vendor,
      }),
    ],
    [operator]
  );
  b1 = await readBooking(conn, bookingPda(booking1));
  tState = await readTrip(conn, trip);
  console.log(
    `\n[commit#1] OK booking_status=${b1.status} (Committed=1) actual=${b1.actualAmount} fee=${b1.feeAmount}`
  );
  console.log(
    `             trip.reserved=${tState.reserved} (should drop to vendor+fee = ${vendorAmount + feeAmount})`
  );
  console.log(`             tx ${commitSig.slice(0, 12)}… ${explorer(commitSig)}`);
  if (b1.status !== 1) throw new Error(`booking#1 expected Committed(1); got ${b1.status}`);
  // Program stores actual_amount = vendor_amount + fee_amount (the
  // total outlay drawn from the trip). Slack returns to trip pool.
  if (b1.actualAmount !== vendorAmount + feeAmount || b1.feeAmount !== feeAmount)
    throw new Error('commit amounts not persisted');

  // ── PHASE 5: SETTLE booking #1 ────────────────────────────────────
  const duffelRef = rand32();
  const vendorBefore = await ataBalance(conn, vendorAta);
  const operatorBefore = await ataBalance(conn, operatorAta);
  const settleSig = await send(
    conn,
    [
      buildSettleBookingIx({
        operator: operator.publicKey,
        tripId,
        bookingId: booking1,
        duffelOrderRef: duffelRef,
        vendorTokenAccount: vendorAta,
        operatorTokenAccount: operatorAta,
      }),
    ],
    [operator]
  );
  b1 = await readBooking(conn, bookingPda(booking1));
  const vendorAfter = await ataBalance(conn, vendorAta);
  const operatorAfter = await ataBalance(conn, operatorAta);
  const vaultAfter = await ataBalance(conn, vault);
  console.log(`\n[settle#1] OK booking_status=${b1.status} (Settled=2)`);
  console.log(
    `             vendor ATA  ${vendorBefore} → ${vendorAfter}  (+${vendorAfter - vendorBefore})`
  );
  console.log(
    `             oper ATA    ${operatorBefore} → ${operatorAfter}  (+${operatorAfter - operatorBefore})`
  );
  console.log(`             vault       ${vaultAfter} (after vendor+fee debit)`);
  console.log(`             tx ${settleSig.slice(0, 12)}… ${explorer(settleSig)}`);
  if (b1.status !== 2) throw new Error(`booking#1 expected Settled(2); got ${b1.status}`);
  if (vendorAfter - vendorBefore !== vendorAmount)
    throw new Error("vendor ATA didn't receive vendor_amount");
  if (operatorAfter - operatorBefore !== feeAmount)
    throw new Error("operator ATA didn't receive fee_amount");

  // ── PHASE 6: RESERVE booking #2 (will be refunded) ────────────────
  const booking2 = rand32();
  const upperBound2 = 500_000n;
  const reserveSig2 = await send(
    conn,
    [
      buildReserveBookingIx({
        operator: operator.publicKey,
        tripId,
        bookingId: booking2,
        upperBound: upperBound2,
      }),
    ],
    [operator]
  );
  let b2 = await readBooking(conn, bookingPda(booking2));
  console.log(`\n[reserve#2] OK booking_status=${b2.status} upperBound=${b2.upperBound}`);
  console.log(`             tx ${reserveSig2.slice(0, 12)}… ${explorer(reserveSig2)}`);
  if (b2.status !== 0) throw new Error(`booking#2 expected Reserved(0); got ${b2.status}`);

  // ── PHASE 7: REFUND booking #2 ────────────────────────────────────
  const tripBeforeRefund = await readTrip(conn, trip);
  const refundSig = await send(
    conn,
    [
      buildRefundBookingIx({
        operator: operator.publicKey,
        tripId,
        bookingId: booking2,
      }),
    ],
    [operator]
  );
  b2 = await readBooking(conn, bookingPda(booking2));
  const tripAfterRefund = await readTrip(conn, trip);
  console.log(`\n[refund#2] OK booking_status=${b2.status} (Refunded=3)`);
  console.log(
    `             trip.reserved ${tripBeforeRefund.reserved} → ${tripAfterRefund.reserved} (-${tripBeforeRefund.reserved - tripAfterRefund.reserved})`
  );
  console.log(`             tx ${refundSig.slice(0, 12)}… ${explorer(refundSig)}`);
  if (b2.status !== 3) throw new Error(`booking#2 expected Refunded(3); got ${b2.status}`);
  if (tripBeforeRefund.reserved - tripAfterRefund.reserved !== upperBound2)
    throw new Error('refund did not decrement trip.reserved by upperBound#2');

  console.log(
    `\n✅ full lifecycle green — prefund → claim → reserve → commit → settle → reserve → refund`
  );
}

main().catch(err => {
  console.error('lifecycle failed:', err);
  process.exit(1);
});
