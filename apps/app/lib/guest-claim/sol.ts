/**
 * Server-side Solana claim submission.
 *
 * Mirrors `./arc.ts` for Sol-primary tenants. Differences:
 *   - The on-chain handler is `claim_trip` on the
 *     `sendero_guest_escrow` Anchor program (not an EVM contract).
 *   - The claim "signature" is Ed25519 over a deterministic message,
 *     verified inside an Ed25519Program sibling instruction at index 0.
 *   - The `relayer` field on the ix can be ANY signer that pays SOL
 *     gas — we use the Sendero platform Sol wallet
 *     (`SENDERO_SOLANA_PLATFORM_PRIVATE_KEY`, already used for
 *     JIT-drips elsewhere). The `guestClaimant` argument is the
 *     pubkey that actually receives the USDC — that's the user's
 *     newly-provisioned Sol DCW.
 *
 * Why the platform wallet as relayer instead of the user's Sol DCW:
 * submitting an arbitrary Anchor ix from a Circle DCW requires Circle's
 * `signTransaction` API plus our own RPC broadcast, and the DCW lacks
 * SOL gas until JIT-drip fires. The platform wallet always has SOL
 * (low-balance alerts wired in `instrumentation.ts`), can sign locally
 * with web3.js, and finishes the claim in one round-trip. The
 * `guestClaimant` field is what binds the trip USDC to the user; the
 * relayer is just plumbing.
 *
 * The on-chain handler:
 *   - Verifies the Ed25519 sibling ix at index 0 was signed over the
 *     canonical message (tripId + guestClaimant pubkey) by the trip's
 *     stored `claim_pubkey` (set at prefund time).
 *   - If 2FA is on, recomputes `claim_code_hash` from the supplied
 *     preimage and compares against the stored hash.
 *   - Transfers escrowed USDC to `guestClaimant`.
 */

import { env } from '@sendero/env';
import { ensureSolanaGas } from '@sendero/circle/unified-gateway';
import { buildClaimTripIxs, claimMessageSolana, signClaimSolana } from '@sendero/guest/solana';
import bs58 from 'bs58';

export interface SubmitSolClaimArgs {
  /** Base58 pubkey of the traveler Sol DCW (where USDC lands). */
  dcwSolanaAddress: string;
  /** On-chain trip id — 32 bytes from the guest link fragment. */
  tripId: Uint8Array;
  /** Base58 ephemeral claim secret from the link fragment. 32-byte
   *  Ed25519 seed (matches what `prefundTripSolana` generated). */
  claimSecretKeyBase58: string;
  /** Optional: trip's stored claim pubkey, base58. When supplied, we
   *  compare against the locally-derived pubkey before broadcasting
   *  (defense-in-depth: catches a malformed fragment before burning
   *  Sol gas). The on-chain handler verifies the signature against
   *  the stored pubkey regardless, so missing this arg only loses
   *  the early-exit. */
  claimPubkeyBase58?: string;
  /** 6-digit code from the invite email when 2FA is on. */
  claimCode?: string;
  /** Random per-trip salt from the link fragment (`&n=`). Required
   *  when the trip was prefunded with 2FA. */
  claimCodeNonceHex?: string;
}

export interface SubmitSolClaimResult {
  txSignature: string;
  guestClaimant: string;
}

export async function submitSolClaim(args: SubmitSolClaimArgs): Promise<SubmitSolClaimResult> {
  // Lazy import — keeps web3.js out of the cold-path bundle for routes
  // that never touch Sol.
  const { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction } = await import(
    '@solana/web3.js'
  );

  const platformKey = env.senderoSolanaPlatformPrivateKey?.();
  if (!platformKey) {
    throw new Error(
      'submitSolClaim: SENDERO_SOLANA_PLATFORM_PRIVATE_KEY not configured — required as the Sol claim relayer.'
    );
  }
  const platformKeypair = Keypair.fromSecretKey(bs58.decode(platformKey));

  const claimSecret = bs58.decode(args.claimSecretKeyBase58);
  if (claimSecret.length !== 32 && claimSecret.length !== 64) {
    throw new Error(
      `submitSolClaim: claim secret must be 32 (seed) or 64 (Keypair) bytes; got ${claimSecret.length}`
    );
  }
  const claimKeypair = Keypair.fromSeed(
    claimSecret.length === 64 ? claimSecret.slice(0, 32) : claimSecret
  );
  if (args.claimPubkeyBase58 && claimKeypair.publicKey.toBase58() !== args.claimPubkeyBase58) {
    throw new Error(
      `submitSolClaim: claim secret does not match stored claim pubkey ` +
        `(expected ${args.claimPubkeyBase58}, derived ${claimKeypair.publicKey.toBase58()})`
    );
  }

  const guestClaimant = new PublicKey(args.dcwSolanaAddress);

  // Canonical claim message: domain separator + tripId + guestClaimant
  // pubkey. The Anchor program rebuilds this identically before
  // verifying the Ed25519 sibling signature.
  const message = claimMessageSolana({
    tripId: args.tripId,
    guestClaimant,
  });
  const recipientSignature = signClaimSolana({
    message,
    secretKey: claimSecret,
  });

  // OTP preimage matches the EVM rule: empty bytes when 2FA is off,
  // `${code}|${nonceHex}` UTF-8 bytes when 2FA is on. The program
  // recomputes keccak256 over it and compares to `trip.claim_code_hash`.
  let otpPreimage = new Uint8Array(0);
  if (args.claimCodeNonceHex) {
    if (!args.claimCode || !/^\d{6}$/.test(args.claimCode)) {
      throw new Error(
        'submitSolClaim: trip requires a 6-digit code; check the invite email for the value.'
      );
    }
    const cleanedNonce = args.claimCodeNonceHex.replace(/^0x/, '');
    otpPreimage = new TextEncoder().encode(`${args.claimCode}|${cleanedNonce}`);
  }

  const [siblingIx, claimIx] = buildClaimTripIxs({
    tripId: args.tripId,
    relayer: platformKeypair.publicKey,
    claimPubkey: claimKeypair.publicKey,
    claimMessage: message,
    recipientSignature,
    otpPreimage,
    guestClaimant,
  });

  // Ensure the user DCW has lamports — the Anchor program may credit
  // a brand-new associated-token-account for the guest, and creating
  // an ATA pays rent. JIT-drip is fail-soft so we don't block the
  // claim on alert delivery.
  await ensureSolanaGas({ address: args.dcwSolanaAddress }).catch(err => {
    console.warn('[submitSolClaim] JIT gas top-up failed (non-fatal)', {
      address: args.dcwSolanaAddress,
      error: err instanceof Error ? err.message : String(err),
    });
  });

  const rpcUrl = env.senderoSolanaRpcUrl?.() ?? 'https://api.devnet.solana.com';
  const conn = new Connection(rpcUrl, 'confirmed');

  const tx = new Transaction().add(siblingIx, claimIx);
  const signature = await sendAndConfirmTransaction(conn, tx, [platformKeypair], {
    commitment: 'confirmed',
    skipPreflight: false,
  });

  return {
    txSignature: signature,
    guestClaimant: guestClaimant.toBase58(),
  };
}
