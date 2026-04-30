/**
 * Gateway Solana mint — EVM source, Solana destination self-mint path.
 *
 * Phase 4. The companion to `transferViaGateway` for Solana destinations.
 * Solana doesn't have Circle's EVM forwarding service; Sendero runs its
 * own SOL relayer that pays gas + submits the gatewayMint program
 * instruction after Gateway attests to the burn.
 *
 * ── Why Solana is special ────────────────────────────────────────────
 *
 *   - Different signing curve: Ed25519, not secp256k1. The tenant's
 *     EVM Gateway EOA cannot sign Solana transactions.
 *   - Different program model: Circle Gateway on Solana is an Anchor
 *     program with a custom 2-byte discriminator (not the standard
 *     8-byte Anchor discriminator).
 *   - Different recipient model: Gateway requires a USDC token account
 *     (ATA) as `destinationRecipient`, NEVER a raw wallet address.
 *     Passing a wallet causes permanent fund loss.
 *   - Different gas model: no Circle Gas Station equivalent on Solana.
 *     Sendero runs a relayer keypair that holds SOL for gas.
 *
 * ── Phase 4 scope ────────────────────────────────────────────────────
 *
 *   - DESTINATION only. Tenants can transfer USDC FROM EVM chains TO
 *     Solana addresses. The burn intent is still EVM-signed (the
 *     tenant Gateway EOA on the source chain).
 *   - Source-side Solana (depositing FROM Solana into Gateway, then
 *     transferring to an EVM chain) is Phase 4.5 — different program
 *     flow, different recorded depositor, requires a tenant-side
 *     Solana keypair.
 *
 * ── Reference ────────────────────────────────────────────────────────
 *
 * Ported from desk-v1 apps/shiva/src/services/gateway-solana.ts
 * (verified live 2026-04-18). Circle's Gateway minter IDL is documented
 * at https://github.com/circlefin/skills/blob/master/plugins/circle/skills/use-gateway/references/evm-to-solana.md
 */

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
} from '@solana/web3.js';
import {
  getAccount,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountIdempotentInstruction,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import bs58 from 'bs58';
import type { GatewaySolanaChain } from './gateway';

// ── Address encoding ─────────────────────────────────────────────────

/**
 * Encode a Solana base58 address as a 32-byte hex string for the
 * EIP-712 BurnIntent fields. Solana PublicKeys are 32 bytes by design;
 * unlike EVM addresses (20 bytes left-padded to 32), there's no padding.
 */
export function solAddressToBytes32(addr: string): `0x${string}` {
  const pk = new PublicKey(addr);
  return `0x${Buffer.from(pk.toBytes()).toString('hex')}` as const;
}

// ── Recipient resolution ─────────────────────────────────────────────

/**
 * Resolve the USDC token account that should receive minted USDC. Per
 * Circle Gateway rules, `destinationRecipient` MUST be a USDC token
 * account — passing a raw wallet address causes permanent fund loss.
 *
 * Logic:
 *   1. If `recipient` is already a USDC token account (matching the
 *      mint), use it directly.
 *   2. If `recipient` is a wallet, derive its ATA. If the ATA doesn't
 *      exist on-chain yet, mark `needsAtaCreate=true` so the mint tx
 *      prepends a create-ATA instruction.
 *   3. If `recipient` is a token account for a DIFFERENT mint (e.g.
 *      USDT), throw — this would silently lose the user's USDC.
 */
export async function resolveSolanaUsdcRecipient(params: {
  recipient: string;
  usdcMint: string;
  rpcUrl: string;
}): Promise<{
  recipientAta: PublicKey;
  recipientOwner: PublicKey;
  needsAtaCreate: boolean;
}> {
  const connection = new Connection(params.rpcUrl, 'confirmed');
  const provided = new PublicKey(params.recipient);
  const mint = new PublicKey(params.usdcMint);

  try {
    const account = await getAccount(connection, provided);
    if (account.mint.equals(mint)) {
      return {
        recipientAta: provided,
        recipientOwner: account.owner,
        needsAtaCreate: false,
      };
    }
    throw new Error(
      `Recipient ${params.recipient} is a token account for mint ` +
        `${account.mint.toBase58()}, expected USDC (${params.usdcMint}).`
    );
  } catch (err) {
    if (err instanceof Error && err.message.includes('expected USDC')) throw err;
    // Falls through — recipient is a wallet, derive the ATA below.
  }

  const ata = await getAssociatedTokenAddress(mint, provided);
  const ataInfo = await connection.getAccountInfo(ata);
  return {
    recipientAta: ata,
    recipientOwner: provided,
    needsAtaCreate: ataInfo === null,
  };
}

// ── Relayer keypair loading ──────────────────────────────────────────

/**
 * Load Sendero's Solana relayer keypair from env. The relayer:
 *   - Pays SOL gas for `gatewayMint` calls
 *   - Signs as both `payer` and `destinationCaller` (valid because
 *     burn intents use the zero-address destinationCaller — anyone may
 *     claim the mint)
 *   - Holds zero USDC; receives no funds
 *   - Single platform-level keypair, not per-tenant. Tenant attribution
 *     is in the burn intent's `sourceDepositor` field.
 *
 * Env: SENDERO_GATEWAY_SOLANA_RELAYER_SECRET_KEY
 *   - Base58-encoded secret key (Phantom export format), OR
 *   - JSON array of bytes (Solana CLI keypair file format)
 *
 * Throws with an actionable message if unset — Solana minting fails
 * loudly rather than silently mis-routing transfers.
 */
export function loadSolanaRelayerKeypair(): Keypair {
  const secret = process.env.SENDERO_GATEWAY_SOLANA_RELAYER_SECRET_KEY;
  if (!secret) {
    throw new Error(
      'SENDERO_GATEWAY_SOLANA_RELAYER_SECRET_KEY is not set. Solana minting is disabled. ' +
        'Generate a fresh keypair (`solana-keygen new --outfile relayer.json`), fund it ' +
        'with SOL on the target cluster, and set the base58-encoded secret as a Vercel env.'
    );
  }
  let bytes: Uint8Array;
  try {
    bytes = bs58.decode(secret);
  } catch {
    try {
      const arr = JSON.parse(secret) as number[];
      bytes = Uint8Array.from(arr);
    } catch {
      throw new Error(
        'SENDERO_GATEWAY_SOLANA_RELAYER_SECRET_KEY must be base58 (Phantom export) ' +
          'or a JSON array of bytes (Solana CLI keypair).'
      );
    }
  }
  return Keypair.fromSecretKey(bytes);
}

// ── Attestation decoding ─────────────────────────────────────────────

/**
 * Circle's Gateway returns a binary attestation that we must decode to
 * derive the `remainingAccounts` for the gatewayMint instruction. The
 * format is a fixed header followed by N attestations:
 *
 *   header: magic u32 | version u32 | destinationDomain u32 |
 *           destinationContract 32b | destinationCaller 32b |
 *           maxBlockHeight u64 | numAttestations u32
 *   per-attestation: destinationToken 32b | destinationRecipient 32b |
 *                    value u64 | transferSpecHash 32b |
 *                    hookDataLen u32 | hookData ...
 *
 * All multi-byte numbers are big-endian.
 */
interface DecodedAttestation {
  destinationToken: PublicKey;
  destinationRecipient: PublicKey;
  transferSpecHash: Buffer;
}

function decodeAttestationSet(attestation: string): DecodedAttestation[] {
  const buf = Buffer.from(attestation.replace(/^0x/, ''), 'hex');
  // Skip header: magic(4) + version(4) + dstDomain(4) + dstContract(32)
  // + dstCaller(32) + maxBlockHeight(8) = 84 bytes
  let off = 4 + 4 + 4 + 32 + 32 + 8;
  const numAttestations = buf.readUInt32BE(off);
  off += 4;

  const out: DecodedAttestation[] = [];
  for (let i = 0; i < numAttestations; i++) {
    const destinationToken = new PublicKey(buf.subarray(off, off + 32));
    off += 32;
    const destinationRecipient = new PublicKey(buf.subarray(off, off + 32));
    off += 32;
    off += 8; // value u64 — not needed for account derivation
    const transferSpecHash = Buffer.from(buf.subarray(off, off + 32));
    off += 32;
    const hookDataLen = buf.readUInt32BE(off);
    off += 4 + hookDataLen;
    out.push({ destinationToken, destinationRecipient, transferSpecHash });
  }
  return out;
}

// ── PDA derivation ───────────────────────────────────────────────────

function findMinterPda(programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from('gateway_minter')], programId)[0];
}

function findEventAuthorityPda(programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from('__event_authority')], programId)[0];
}

function findCustodyPda(mint: PublicKey, programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('gateway_minter_custody'), mint.toBuffer()],
    programId
  )[0];
}

function findTransferSpecHashPda(hash: Buffer, programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('used_transfer_spec_hash'), hash],
    programId
  )[0];
}

// ── Instruction encoding ─────────────────────────────────────────────

/**
 * Encode the `gatewayMint` instruction data. The Gateway minter program
 * uses a custom 2-byte discriminator (`[12, 0]`), not the standard
 * 8-byte Anchor hash. The args are two `bytes` fields (Anchor format:
 * u32 LE length prefix + raw bytes).
 */
function encodeGatewayMintData(attestation: Buffer, signature: Buffer): Buffer {
  const atLen = Buffer.alloc(4);
  atLen.writeUInt32LE(attestation.length, 0);
  const sigLen = Buffer.alloc(4);
  sigLen.writeUInt32LE(signature.length, 0);
  return Buffer.concat([Buffer.from([12, 0]), atLen, attestation, sigLen, signature]);
}

// ── Mint ─────────────────────────────────────────────────────────────

/**
 * Submit the Gateway Minter `gatewayMint` instruction on Solana.
 *
 * The relayer keypair pays gas and signs as both `payer` and
 * `destinationCaller`. Valid when the burn intent uses the zero-address
 * destinationCaller (anyone may claim the mint). Switching to
 * permissioned mints means passing a separate `destinationCaller`
 * signer here.
 *
 * Logs a confirmation entry on success. Rethrows on simulation /
 * confirmation failure with the underlying RPC error.
 */
export async function mintOnSolana(params: {
  attestation: `0x${string}`;
  operatorSignature: `0x${string}`;
  destinationChain: GatewaySolanaChain;
  recipientAta: PublicKey;
  recipientOwner: PublicKey;
  needsAtaCreate: boolean;
}): Promise<{ txSignature: string }> {
  const {
    attestation,
    operatorSignature,
    destinationChain,
    recipientAta,
    recipientOwner,
    needsAtaCreate,
  } = params;

  const minterProgramId = new PublicKey(destinationChain.gatewayMinterProgram);
  const usdcMint = new PublicKey(destinationChain.usdcMint);

  const connection = new Connection(destinationChain.rpcUrl, 'confirmed');
  const relayer = loadSolanaRelayerKeypair();

  const instructions: TransactionInstruction[] = [];

  if (needsAtaCreate) {
    instructions.push(
      createAssociatedTokenAccountIdempotentInstruction(
        relayer.publicKey,
        recipientAta,
        recipientOwner,
        usdcMint
      )
    );
  }

  // Decode attestation → derive per-transfer remaining accounts.
  const decoded = decodeAttestationSet(attestation);
  const remainingAccounts = decoded.flatMap(e => [
    {
      pubkey: findCustodyPda(e.destinationToken, minterProgramId),
      isSigner: false,
      isWritable: true,
    },
    { pubkey: e.destinationRecipient, isSigner: false, isWritable: true },
    {
      pubkey: findTransferSpecHashPda(e.transferSpecHash, minterProgramId),
      isSigner: false,
      isWritable: true,
    },
  ]);

  const attestationBytes = Buffer.from(attestation.replace(/^0x/, ''), 'hex');
  const operatorSigBytes = Buffer.from(operatorSignature.replace(/^0x/, ''), 'hex');
  const data = encodeGatewayMintData(attestationBytes, operatorSigBytes);

  const minterPda = findMinterPda(minterProgramId);
  const eventAuthority = findEventAuthorityPda(minterProgramId);

  const keys = [
    { pubkey: relayer.publicKey, isSigner: true, isWritable: true }, // payer
    { pubkey: relayer.publicKey, isSigner: true, isWritable: false }, // destinationCaller (same signer)
    { pubkey: minterPda, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: eventAuthority, isSigner: false, isWritable: false },
    { pubkey: minterProgramId, isSigner: false, isWritable: false }, // self-ref for Anchor events
    ...remainingAccounts,
  ];

  instructions.push(new TransactionInstruction({ programId: minterProgramId, keys, data }));

  const tx = new Transaction().add(...instructions);
  tx.feePayer = relayer.publicKey;
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
  tx.recentBlockhash = blockhash;
  tx.sign(relayer);

  const raw = tx.serialize();
  const signature = await connection.sendRawTransaction(raw, { skipPreflight: false });
  await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed');

  return { txSignature: signature };
}
