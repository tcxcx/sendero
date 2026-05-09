/**
 * @sendero/guest/solana — Solana parity for the SenderoGuestEscrow flow.
 *
 * Mirrors the Arc/EVM helpers in `./index.ts` so callers (the agent
 * runtime + the prefund/confirm/cancel tools) can switch on
 * `tenant.primaryChain` and emit chain-correct on-chain calls without
 * branching their own code.
 *
 * Wraps the deployed Anchor program at `9NHw47G…tjUL8` (devnet, see
 * `Anchor.toml`). Vendor copy of the IDL lives at `./_idl/` so this
 * package doesn't depend on the contracts workspace at runtime.
 *
 * Public surface (mirrors the Arc shape):
 *
 *   ── PDAs ──────────────────────────────────────────────────────
 *   deriveConfigPda(programId) → [pda, bump]
 *   deriveTripPda(programId, tripId) → [pda, bump]
 *   deriveBookingPda(programId, bookingId) → [pda, bump]
 *   deriveVaultPda(programId, tripId) → [pda, bump]
 *
 *   ── Identifiers ───────────────────────────────────────────────
 *   generateTripIdSolana() → Uint8Array(32)
 *   generateBookingIdSolana() → Uint8Array(32)
 *
 *   ── Claim signatures (Ed25519, sibling-instruction model) ────
 *   generateClaimKeypairSolana() → { publicKey, secretKey }
 *   claimMessageSolana(args) → Uint8Array (the bytes to sign)
 *   buildEd25519SiblingIx(args) → TransactionInstruction
 *
 *   ── Instruction builders (return TransactionInstruction[]) ──
 *   buildPreFundTripIx(args)
 *   buildClaimTripIxs(args) → [siblingIx, programIx]
 *   buildReserveBookingIx(args)
 *   buildCommitBookingIx(args)
 *   buildSettleBookingIx(args)
 *   buildRefundBookingIx(args)
 *
 * The instruction builders DO NOT submit. The caller (Sendero relayer
 * or a Circle DCW signer) is responsible for assembling the
 * Transaction and signing. This matches the Arc shape where
 * `encodeCreateTrip` returns calldata and the caller submits.
 */

import {
  Ed25519Program,
  PublicKey,
  SystemProgram,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  SYSVAR_RENT_PUBKEY,
  Keypair,
  type TransactionInstruction,
} from '@solana/web3.js';
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import { ed25519 } from '@noble/curves/ed25519';

import IDL_JSON from './_idl/sendero_guest_escrow.json' with { type: 'json' };

/** Anchor program id. Same on devnet + localnet. */
export const SENDERO_GUEST_ESCROW_PROGRAM_ID = new PublicKey(
  '9NHw47GifDKsPDggQeQd53sNrAsBWeSayzvvSr2tjUL8'
);

/** Domain separator the program checks inside `claim_trip`. Mirrors
 *  `SENDERO_V1_GUEST_CLAIM` from the Arc reference contract. */
const SENDERO_DOMAIN = new TextEncoder().encode('SENDERO_V1_GUEST_CLAIM');

/** USDC SPL mint on Solana devnet. Production overrides via env. */
export const SOLANA_USDC_MINT_DEVNET = new PublicKey(
  '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU'
);

const CONFIG_SEED = new TextEncoder().encode('config');
const TRIP_SEED = new TextEncoder().encode('trip');
const BOOKING_SEED = new TextEncoder().encode('booking');
const VAULT_SEED = new TextEncoder().encode('vault');

// ────────────────── PDAs ──────────────────

export function deriveConfigPda(
  programId: PublicKey = SENDERO_GUEST_ESCROW_PROGRAM_ID
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([CONFIG_SEED], programId);
}

export function deriveTripPda(
  tripId: Uint8Array,
  programId: PublicKey = SENDERO_GUEST_ESCROW_PROGRAM_ID
): [PublicKey, number] {
  if (tripId.length !== 32) throw new Error('tripId must be 32 bytes');
  return PublicKey.findProgramAddressSync([TRIP_SEED, tripId], programId);
}

export function deriveBookingPda(
  bookingId: Uint8Array,
  programId: PublicKey = SENDERO_GUEST_ESCROW_PROGRAM_ID
): [PublicKey, number] {
  if (bookingId.length !== 32) throw new Error('bookingId must be 32 bytes');
  return PublicKey.findProgramAddressSync([BOOKING_SEED, bookingId], programId);
}

export function deriveVaultPda(
  tripId: Uint8Array,
  programId: PublicKey = SENDERO_GUEST_ESCROW_PROGRAM_ID
): [PublicKey, number] {
  if (tripId.length !== 32) throw new Error('tripId must be 32 bytes');
  return PublicKey.findProgramAddressSync([VAULT_SEED, tripId], programId);
}

// ────────────────── Identifiers ──────────────────

/** Generate a fresh 32-byte trip id. Same shape as Arc but written to
 *  Anchor's `[u8; 32]` arg without hex encoding. */
export function generateTripIdSolana(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(32));
}

export function generateBookingIdSolana(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(32));
}

// ────────────────── Claim signatures (Ed25519) ──────────────────

export interface SolanaClaimKeypair {
  publicKey: PublicKey;
  /** 64-byte secretKey (Ed25519 expanded form) suitable for `nacl.sign.detached`. */
  secretKey: Uint8Array;
}

export function generateClaimKeypairSolana(): SolanaClaimKeypair {
  const kp = Keypair.generate();
  return { publicKey: kp.publicKey, secretKey: kp.secretKey };
}

/** Build the message that the claim-pubkey must Ed25519-sign.
 *
 *  Layout: `domain || program_id || trip_id || guest_claimant_pubkey`.
 *  Matches `verify_ed25519_sibling_ix` expectations in lib.rs. */
export function claimMessageSolana(args: {
  programId?: PublicKey;
  tripId: Uint8Array;
  guestClaimant: PublicKey;
}): Uint8Array {
  const programId = args.programId ?? SENDERO_GUEST_ESCROW_PROGRAM_ID;
  if (args.tripId.length !== 32) throw new Error('tripId must be 32 bytes');
  const out = new Uint8Array(SENDERO_DOMAIN.length + 32 + 32 + 32);
  let offset = 0;
  out.set(SENDERO_DOMAIN, offset);
  offset += SENDERO_DOMAIN.length;
  out.set(programId.toBytes(), offset);
  offset += 32;
  out.set(args.tripId, offset);
  offset += 32;
  out.set(args.guestClaimant.toBytes(), offset);
  return out;
}

export function signClaimSolana(args: {
  message: Uint8Array;
  /** Either the 64-byte Solana expanded secretKey (Keypair.secretKey)
   *  or the 32-byte Ed25519 seed. */
  secretKey: Uint8Array;
}): Uint8Array {
  // @solana/web3.js Keypair stores 64 bytes (32 seed + 32 pubkey);
  // @noble/curves/ed25519 expects the 32-byte seed. Slice when needed.
  const seed = args.secretKey.length === 64 ? args.secretKey.slice(0, 32) : args.secretKey;
  if (seed.length !== 32) {
    throw new Error('signClaimSolana: secretKey must be 32 (seed) or 64 (Keypair) bytes');
  }
  return ed25519.sign(args.message, seed);
}

/** Build the Ed25519Program sibling instruction the program expects at
 *  index 0 of the `claim_trip` transaction. */
export function buildEd25519SiblingIx(args: {
  publicKey: PublicKey;
  message: Uint8Array;
  signature: Uint8Array;
}): TransactionInstruction {
  return Ed25519Program.createInstructionWithPublicKey({
    publicKey: args.publicKey.toBytes(),
    message: args.message,
    signature: args.signature,
  });
}

// ────────────────── Instruction encoding ──────────────────
//
// We encode instructions manually rather than instantiating an Anchor
// `Program` (which requires a Provider/Connection). The wire format is
// stable: 8-byte sighash discriminator + Borsh-serialized args.
//
// Discriminators come from the IDL. We pin them as constants so this
// file doesn't take a JSON-import runtime dependency at the Hot path.
//
// Arg encoding for v1 is simple: only fixed-size primitives + 32-byte
// arrays + Pubkeys + i64. We hand-roll a tiny Borsh writer instead of
// pulling in the full @coral-xyz/borsh package.

type ArgValue =
  | { kind: 'u64'; value: bigint }
  | { kind: 'i64'; value: bigint }
  | { kind: 'bytes32'; value: Uint8Array }
  | { kind: 'pubkey'; value: PublicKey }
  | { kind: 'bytes'; value: Uint8Array };

function encodeArgs(values: ArgValue[]): Uint8Array {
  const buffers: Uint8Array[] = [];
  for (const arg of values) {
    switch (arg.kind) {
      case 'u64': {
        const buf = new Uint8Array(8);
        new DataView(buf.buffer).setBigUint64(0, arg.value, true);
        buffers.push(buf);
        break;
      }
      case 'i64': {
        const buf = new Uint8Array(8);
        new DataView(buf.buffer).setBigInt64(0, arg.value, true);
        buffers.push(buf);
        break;
      }
      case 'bytes32': {
        if (arg.value.length !== 32) throw new Error('bytes32 value must be 32 bytes');
        buffers.push(arg.value);
        break;
      }
      case 'pubkey': {
        buffers.push(arg.value.toBytes());
        break;
      }
      case 'bytes': {
        const len = new Uint8Array(4);
        new DataView(len.buffer).setUint32(0, arg.value.length, true);
        buffers.push(len);
        buffers.push(arg.value);
        break;
      }
    }
  }
  const total = buffers.reduce((sum, b) => sum + b.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const b of buffers) {
    out.set(b, offset);
    offset += b.length;
  }
  return out;
}

/** Anchor sighash discriminators (from IDL). */
const DISCRIMINATORS = {
  preFundTrip: new Uint8Array(
    IDL_JSON.instructions.find(i => i.name === 'pre_fund_trip')!.discriminator
  ),
  claimTrip: new Uint8Array(
    IDL_JSON.instructions.find(i => i.name === 'claim_trip')!.discriminator
  ),
  reserveBooking: new Uint8Array(
    IDL_JSON.instructions.find(i => i.name === 'reserve_booking')!.discriminator
  ),
  commitBooking: new Uint8Array(
    IDL_JSON.instructions.find(i => i.name === 'commit_booking')!.discriminator
  ),
  settleBooking: new Uint8Array(
    IDL_JSON.instructions.find(i => i.name === 'settle_booking')!.discriminator
  ),
  refundBooking: new Uint8Array(
    IDL_JSON.instructions.find(i => i.name === 'refund_booking')!.discriminator
  ),
};

function joinIxData(disc: Uint8Array, args: Uint8Array): Buffer {
  const out = new Uint8Array(disc.length + args.length);
  out.set(disc, 0);
  out.set(args, disc.length);
  return Buffer.from(out);
}

// ────────────────── Instruction builders ──────────────────

export interface BuildPreFundTripArgs {
  buyer: PublicKey;
  tripId: Uint8Array;
  /** USDC amount in micro-USDC (6 decimals). e.g. `1_000_000n` = 1 USDC. */
  amount: bigint;
  claimPubkey: PublicKey;
  /** Unix-seconds expiry. */
  expiry: bigint;
  /** keccak256/sha256 of the OTP — caller's choice, just consistent. */
  expectedOtpHash: Uint8Array;
  /** Defaults to devnet USDC mint. */
  paymentMint?: PublicKey;
  programId?: PublicKey;
}

/** Build the `pre_fund_trip` instruction. Caller wraps in a
 *  Transaction signed by `args.buyer`. */
export function buildPreFundTripIx(args: BuildPreFundTripArgs): TransactionInstruction {
  const programId = args.programId ?? SENDERO_GUEST_ESCROW_PROGRAM_ID;
  const paymentMint = args.paymentMint ?? SOLANA_USDC_MINT_DEVNET;
  const [config] = deriveConfigPda(programId);
  const [trip] = deriveTripPda(args.tripId, programId);
  const [vault] = deriveVaultPda(args.tripId, programId);
  const buyerAta = getAssociatedTokenAddressSync(paymentMint, args.buyer);

  const data = joinIxData(
    DISCRIMINATORS.preFundTrip,
    encodeArgs([
      { kind: 'bytes32', value: args.tripId },
      { kind: 'u64', value: args.amount },
      { kind: 'pubkey', value: args.claimPubkey },
      { kind: 'i64', value: args.expiry },
      { kind: 'bytes32', value: args.expectedOtpHash },
    ])
  );

  return {
    programId,
    keys: [
      { pubkey: args.buyer, isSigner: true, isWritable: true },
      { pubkey: config, isSigner: false, isWritable: false },
      { pubkey: trip, isSigner: false, isWritable: true },
      { pubkey: paymentMint, isSigner: false, isWritable: false },
      { pubkey: vault, isSigner: false, isWritable: true },
      { pubkey: buyerAta, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
    ],
    data,
  };
}

export interface BuildClaimTripIxsArgs {
  relayer: PublicKey;
  tripId: Uint8Array;
  /** sha256 of the OTP — must match what the buyer pre-funded with. */
  otpHash: Uint8Array;
  /** Already-signed Ed25519 signature of `claimMessageSolana(...)`. */
  recipientSignature: Uint8Array;
  /** Public key of the claim keypair (matches `Trip.claim_pubkey`). */
  claimPubkey: PublicKey;
  /** The same message bytes that produced `recipientSignature`. */
  claimMessage: Uint8Array;
  programId?: PublicKey;
}

/** Build [Ed25519 sibling ix, claim_trip ix]. Both go in the same tx,
 *  in order; the program reads the sibling at index 0. */
export function buildClaimTripIxs(
  args: BuildClaimTripIxsArgs
): [TransactionInstruction, TransactionInstruction] {
  const programId = args.programId ?? SENDERO_GUEST_ESCROW_PROGRAM_ID;
  const [config] = deriveConfigPda(programId);
  const [trip] = deriveTripPda(args.tripId, programId);

  const sibling = buildEd25519SiblingIx({
    publicKey: args.claimPubkey,
    message: args.claimMessage,
    signature: args.recipientSignature,
  });

  const data = joinIxData(
    DISCRIMINATORS.claimTrip,
    encodeArgs([
      { kind: 'bytes32', value: args.tripId },
      { kind: 'bytes32', value: args.otpHash },
      { kind: 'bytes', value: args.recipientSignature },
    ])
  );

  const claimIx: TransactionInstruction = {
    programId,
    keys: [
      { pubkey: args.relayer, isSigner: true, isWritable: true },
      { pubkey: config, isSigner: false, isWritable: false },
      { pubkey: trip, isSigner: false, isWritable: true },
      { pubkey: SYSVAR_INSTRUCTIONS_PUBKEY, isSigner: false, isWritable: false },
    ],
    data,
  };

  return [sibling, claimIx];
}

export interface BuildReserveBookingArgs {
  operator: PublicKey;
  tripId: Uint8Array;
  bookingId: Uint8Array;
  /** Upper-bound USDC reserve, in micro-USDC. */
  upperBound: bigint;
  programId?: PublicKey;
}

export function buildReserveBookingIx(args: BuildReserveBookingArgs): TransactionInstruction {
  const programId = args.programId ?? SENDERO_GUEST_ESCROW_PROGRAM_ID;
  const [config] = deriveConfigPda(programId);
  const [trip] = deriveTripPda(args.tripId, programId);
  const [booking] = deriveBookingPda(args.bookingId, programId);

  const data = joinIxData(
    DISCRIMINATORS.reserveBooking,
    encodeArgs([
      { kind: 'bytes32', value: args.tripId },
      { kind: 'bytes32', value: args.bookingId },
      { kind: 'u64', value: args.upperBound },
    ])
  );

  return {
    programId,
    keys: [
      { pubkey: args.operator, isSigner: true, isWritable: true },
      { pubkey: config, isSigner: false, isWritable: false },
      { pubkey: trip, isSigner: false, isWritable: true },
      { pubkey: booking, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  };
}

export interface BuildCommitBookingArgs {
  operator: PublicKey;
  tripId: Uint8Array;
  bookingId: Uint8Array;
  /** Final quoted price (≤ upperBound), in micro-USDC. */
  quotedPrice: bigint;
  programId?: PublicKey;
}

export function buildCommitBookingIx(args: BuildCommitBookingArgs): TransactionInstruction {
  const programId = args.programId ?? SENDERO_GUEST_ESCROW_PROGRAM_ID;
  const [config] = deriveConfigPda(programId);
  const [trip] = deriveTripPda(args.tripId, programId);
  const [booking] = deriveBookingPda(args.bookingId, programId);

  const data = joinIxData(
    DISCRIMINATORS.commitBooking,
    encodeArgs([
      { kind: 'bytes32', value: args.bookingId },
      { kind: 'u64', value: args.quotedPrice },
    ])
  );

  return {
    programId,
    keys: [
      { pubkey: args.operator, isSigner: true, isWritable: false },
      { pubkey: config, isSigner: false, isWritable: false },
      { pubkey: trip, isSigner: false, isWritable: true },
      { pubkey: booking, isSigner: false, isWritable: true },
    ],
    data,
  };
}

export interface BuildSettleBookingArgs {
  operator: PublicKey;
  tripId: Uint8Array;
  bookingId: Uint8Array;
  /** Vendor (supplier) USDC ATA — destination of the booking value. */
  vendorTokenAccount: PublicKey;
  /** Operator's USDC ATA — destination of the operator's take/refund. */
  operatorTokenAccount: PublicKey;
  /** Duffel order id (or any 32-byte external ref). */
  duffelOrderRef: Uint8Array;
  programId?: PublicKey;
}

export function buildSettleBookingIx(args: BuildSettleBookingArgs): TransactionInstruction {
  const programId = args.programId ?? SENDERO_GUEST_ESCROW_PROGRAM_ID;
  const [config] = deriveConfigPda(programId);
  const [trip] = deriveTripPda(args.tripId, programId);
  const [booking] = deriveBookingPda(args.bookingId, programId);
  const [vault] = deriveVaultPda(args.tripId, programId);

  const data = joinIxData(
    DISCRIMINATORS.settleBooking,
    encodeArgs([
      { kind: 'bytes32', value: args.bookingId },
      { kind: 'bytes32', value: args.duffelOrderRef },
    ])
  );

  return {
    programId,
    keys: [
      { pubkey: args.operator, isSigner: true, isWritable: false },
      { pubkey: config, isSigner: false, isWritable: false },
      { pubkey: trip, isSigner: false, isWritable: true },
      { pubkey: booking, isSigner: false, isWritable: true },
      { pubkey: vault, isSigner: false, isWritable: true },
      { pubkey: args.vendorTokenAccount, isSigner: false, isWritable: true },
      { pubkey: args.operatorTokenAccount, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data,
  };
}

export interface BuildRefundBookingArgs {
  caller: PublicKey;
  tripId: Uint8Array;
  bookingId: Uint8Array;
  programId?: PublicKey;
}

export function buildRefundBookingIx(args: BuildRefundBookingArgs): TransactionInstruction {
  const programId = args.programId ?? SENDERO_GUEST_ESCROW_PROGRAM_ID;
  const [config] = deriveConfigPda(programId);
  const [trip] = deriveTripPda(args.tripId, programId);
  const [booking] = deriveBookingPda(args.bookingId, programId);

  const data = joinIxData(
    DISCRIMINATORS.refundBooking,
    encodeArgs([{ kind: 'bytes32', value: args.bookingId }])
  );

  return {
    programId,
    keys: [
      { pubkey: args.caller, isSigner: true, isWritable: false },
      { pubkey: config, isSigner: false, isWritable: false },
      { pubkey: trip, isSigner: false, isWritable: true },
      { pubkey: booking, isSigner: false, isWritable: true },
    ],
    data,
  };
}
