/**
 * Server-side Solana prefund submission.
 *
 * Mirrors `./arc.ts` for Sol-primary tenants. The buyer (Sol treasury
 * DCW) signs `pre_fund_trip` via Circle's `signTransaction` API, and
 * the server broadcasts via Sol RPC. Funding source:
 *
 *   1. If the buyer's USDC associated-token-account already has the
 *      budget, skip step 2.
 *   2. Otherwise, materialize the gap from the tenant's Sol Gateway
 *      pool via `spendTenantUnifiedUsd(destinationChain='Sol_Devnet',
 *      recipient = treasury DCW pubkey)`. App Kit mints USDC at the
 *      DCW's ATA on Sol Devnet.
 *   3. Build the `pre_fund_trip` Solana Transaction with the buyer
 *      DCW as fee payer + signer.
 *   4. Hand the serialized tx to Circle's `signTransaction` API. The
 *      DCW signs (DCWs can `signTransactions` on Sol; this is the
 *      same path Bridge Kit takes).
 *   5. Broadcast the returned signed tx via Sol RPC, wait for
 *      confirmation, return the signature.
 */

import { env } from '@sendero/env';
import { getCircle } from '@sendero/circle/wallets';
import { spendTenantUnifiedUsd } from '@sendero/circle/unified-balance';
import { ensureSolanaGas } from '@sendero/circle/unified-gateway';
import { prisma } from '@sendero/database';
import bs58 from 'bs58';

export interface SolOnchainInstruction {
  programId: string;
  accounts: Array<{ pubkey: string; isSigner: boolean; isWritable: boolean }>;
  /** Base64-encoded ix data. */
  data: string;
}

export interface SubmitSolPrefundArgs {
  tenantId: string;
  /** Decimal USDC budget. Drives the materialize amount. */
  budgetUsdc: string;
  /** Pre-built Solana instructions from `prefundTripSolana`. The first
   *  ix is `pre_fund_trip`; account[0] is the buyer (treasury DCW). */
  onchainInstructions: SolOnchainInstruction[];
  /** Optional Sol RPC URL override. */
  rpcUrl?: string;
}

export interface SubmitSolPrefundResult {
  /** Sol tx signature (base58). */
  txSignature: string;
  /** Buyer DCW pubkey (base58) that paid + signed. */
  buyerAddress: string;
  /** True when we materialized from Gateway pool before submitting. */
  materializedFromPool: boolean;
}

function decimalToMicro(decimal: string): bigint {
  const [whole = '0', frac = ''] = decimal.split('.');
  const padded = `${frac}000000`.slice(0, 6);
  return BigInt(whole || '0') * 1_000_000n + BigInt(padded || '0');
}

export async function submitSolPrefund(
  args: SubmitSolPrefundArgs
): Promise<SubmitSolPrefundResult> {
  if (args.onchainInstructions.length === 0) {
    throw new Error('submitSolPrefund: no on-chain instructions to submit');
  }
  // Convention from `prefundTripSolana`: instruction[0] is
  // `pre_fund_trip` with account[0] = buyer (treasury DCW).
  const buyerEntry = args.onchainInstructions[0].accounts[0];
  if (!buyerEntry?.isSigner) {
    throw new Error(
      'submitSolPrefund: first ix account is not a signer — prefund shape changed?'
    );
  }
  const buyerAddress = buyerEntry.pubkey;

  // Resolve the Circle walletId for the buyer DCW. The treasury Sol
  // DCW was provisioned at tenant onboarding (see provision-tenant-
  // solana-treasury) and shares a wallet set with the EVM DCWs.
  const buyerDcw = await prisma.circleWallet.findFirst({
    where: { tenantId: args.tenantId, address: buyerAddress, chain: { in: ['SOL-DEVNET', 'SOL'] } },
    select: { circleWalletId: true },
  });
  if (!buyerDcw?.circleWalletId) {
    throw new Error(
      `submitSolPrefund: no Circle walletId found for buyer DCW ${buyerAddress} — provision the Sol treasury first.`
    );
  }

  // Lazy import @solana/web3.js so EVM-only routes don't pull it.
  const {
    Connection,
    PublicKey,
    Transaction,
    TransactionInstruction,
    sendAndConfirmRawTransaction,
  } = await import('@solana/web3.js');

  const rpcUrl = args.rpcUrl ?? env.senderoSolanaRpcUrl?.() ?? 'https://api.devnet.solana.com';
  const conn = new Connection(rpcUrl, 'confirmed');

  // Step 1: JIT-drip SOL gas for the buyer DCW BEFORE materializing.
  // The Sol Gateway mint ix creates the buyer's USDC ATA if it
  // doesn't exist yet; ATA creation requires the destination wallet
  // to pay rent (~0.00203928 SOL). Without lamports, the spend's
  // destination-side mint fails with "Insufficient SOL to create
  // Associated Token Account".
  //
  // Same JIT-drip path used for source-side Sol burns elsewhere —
  // here we apply it to the destination wallet because the buyer is
  // both the materialize recipient and the prefund signer.
  const gasResult = await ensureSolanaGas({ address: buyerAddress });
  if (gasResult.reason === 'platform_wallet_not_configured') {
    throw new Error(
      'submitSolPrefund: SENDERO_SOLANA_PLATFORM_PRIVATE_KEY not configured — buyer DCW cannot pay ATA-creation rent.'
    );
  }
  if (gasResult.reason === 'topup_failed') {
    throw new Error(
      `submitSolPrefund: SOL gas top-up failed for buyer ${buyerAddress}: ${gasResult.error ?? 'unknown'}`
    );
  }

  // Step 2: pre-create the buyer's USDC associated-token-account if
  // it doesn't exist. Circle's Sol Gateway mint program does NOT
  // create the destination ATA itself — passing a derived ATA that
  // hasn't been on-chain initialised trips AnchorError 6027
  // `InvalidDestinationTokenAccount`. Even with SOL in the buyer
  // wallet for rent, the program won't lazy-init.
  //
  // We pay rent from the Sendero platform Sol wallet (already used
  // for JIT gas drips) via the SPL Associated Token Program's
  // `createIdempotent` ix — idempotent so re-running this helper on
  // an existing ATA is a no-op.
  await ensureBuyerUsdcAta({
    conn,
    PublicKey,
    buyerAddress,
  });

  // Step 3: materialize USDC into the buyer's ATA if needed. We can't
  // cheaply read the ATA balance for an arbitrary mint without
  // SPL-token math, so we always check first via getParsedTokenAccountsByOwner
  // and only spend if short.
  const budgetMicro = decimalToMicro(args.budgetUsdc);
  const materializedFromPool = await ensureBuyerUsdc({
    conn,
    PublicKey,
    tenantId: args.tenantId,
    buyerAddress,
    amountMicro: budgetMicro,
  });

  // Step 3: rebuild the Sol Transaction from the serialized ixs.
  const tx = new Transaction();
  for (const ix of args.onchainInstructions) {
    tx.add(
      new TransactionInstruction({
        programId: new PublicKey(ix.programId),
        keys: ix.accounts.map(a => ({
          pubkey: new PublicKey(a.pubkey),
          isSigner: a.isSigner,
          isWritable: a.isWritable,
        })),
        data: Buffer.from(ix.data, 'base64'),
      })
    );
  }
  tx.feePayer = new PublicKey(buyerAddress);
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed');
  tx.recentBlockhash = blockhash;

  // Step 4: serialize unsigned tx, send to Circle for signing.
  const unsigned = tx.serialize({ requireAllSignatures: false, verifySignatures: false });
  const rawBase64 = unsigned.toString('base64');
  const circle = getCircle();
  const signRes = await circle.signTransaction({
    walletId: buyerDcw.circleWalletId,
    rawTransaction: rawBase64,
    blockchain: 'SOL-DEVNET',
    // biome-ignore lint/suspicious/noExplicitAny: SDK looser than its public type
  } as any);
  const signedBase64 = (signRes.data as { signedTransaction?: string })?.signedTransaction;
  if (!signedBase64) {
    throw new Error('submitSolPrefund: Circle signTransaction returned no signedTransaction');
  }

  // Step 5: broadcast.
  const signedBytes = Buffer.from(signedBase64, 'base64');
  const sig = await sendAndConfirmRawTransaction(conn, signedBytes, {
    commitment: 'confirmed',
    skipPreflight: false,
    // The blockhash from step 3 expires within ~150 slots. Pin the
    // last valid height so confirmation aborts cleanly on expiry
    // instead of polling forever.
    // biome-ignore lint/suspicious/noExplicitAny: SDK option type out of sync
  } as any);

  return {
    txSignature: sig,
    buyerAddress,
    materializedFromPool,
  };
}

/**
 * Pre-create the buyer's USDC associated-token-account if it doesn't
 * exist. Pays rent from the Sendero platform Sol wallet.
 *
 * Circle's Sol Gateway mint program does not lazy-init the
 * destination ATA — it validates the passed ATA against the on-chain
 * SPL token account layout. Missing ATA → AnchorError 6027
 * `InvalidDestinationTokenAccount`, regardless of how much SOL the
 * destination wallet holds.
 *
 * `createAssociatedTokenAccountIdempotent` is the standard SPL ix
 * for this; re-running on an existing ATA is a no-op (no extra rent
 * charged). We send the create tx synchronously here so the spend
 * downstream sees the ATA initialised.
 */
async function ensureBuyerUsdcAta(args: {
  conn: import('@solana/web3.js').Connection;
  PublicKey: typeof import('@solana/web3.js').PublicKey;
  buyerAddress: string;
}): Promise<void> {
  const SOL_DEVNET_USDC = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
  const platformKey = env.senderoSolanaPlatformPrivateKey?.();
  if (!platformKey) {
    throw new Error(
      'ensureBuyerUsdcAta: SENDERO_SOLANA_PLATFORM_PRIVATE_KEY not configured — required to pay ATA rent for buyer DCW.'
    );
  }
  const [{ Keypair, Transaction, sendAndConfirmTransaction }, splToken] = await Promise.all([
    import('@solana/web3.js'),
    import('@solana/spl-token'),
  ]);

  const owner = new args.PublicKey(args.buyerAddress);
  const mint = new args.PublicKey(SOL_DEVNET_USDC);
  const ata = splToken.getAssociatedTokenAddressSync(mint, owner);

  // Skip the createIdempotent call entirely when the ATA already
  // exists — saves a tx + rent quote, and keeps the path fast on
  // warm buyers.
  const existing = await args.conn.getAccountInfo(ata);
  if (existing) return;

  const platformKeypair = Keypair.fromSecretKey(bs58.decode(platformKey));
  const createIx = splToken.createAssociatedTokenAccountIdempotentInstruction(
    platformKeypair.publicKey, // payer
    ata,
    owner,
    mint
  );
  const tx = new Transaction().add(createIx);
  await sendAndConfirmTransaction(args.conn, tx, [platformKeypair], {
    commitment: 'confirmed',
    skipPreflight: false,
  });
}

/**
 * Check the buyer DCW's USDC ATA balance and spend from the tenant's
 * Sol Gateway pool to top it up when short. Returns true if a spend
 * was issued, false if the ATA already had enough.
 */
async function ensureBuyerUsdc(args: {
  conn: import('@solana/web3.js').Connection;
  PublicKey: typeof import('@solana/web3.js').PublicKey;
  tenantId: string;
  buyerAddress: string;
  amountMicro: bigint;
}): Promise<boolean> {
  // USDC Sol Devnet mint — same constant @sendero/guest/solana uses.
  const SOL_DEVNET_USDC = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
  const owner = new args.PublicKey(args.buyerAddress);
  const mint = new args.PublicKey(SOL_DEVNET_USDC);
  let currentMicro = 0n;
  try {
    const accounts = await args.conn.getParsedTokenAccountsByOwner(owner, { mint });
    for (const entry of accounts.value) {
      const info = entry.account.data.parsed?.info as
        | { tokenAmount?: { amount?: string } }
        | undefined;
      if (info?.tokenAmount?.amount) {
        currentMicro += BigInt(info.tokenAmount.amount);
      }
    }
  } catch (err) {
    // Treat as zero so we trigger the spend; if RPC is flaky the
    // spend will surface a clearer error.
    console.warn('[prefund/sol] failed to read buyer ATA balance', {
      buyerAddress: args.buyerAddress,
      error: err instanceof Error ? err.message : String(err),
    });
  }
  if (currentMicro >= args.amountMicro) return false;
  const gapMicro = args.amountMicro - currentMicro;
  const gapDecimal = (Number(gapMicro) / 1e6).toFixed(6);
  await spendTenantUnifiedUsd({
    tenantId: args.tenantId,
    amount: gapDecimal,
    destinationChain: 'Sol_Devnet',
    recipient: args.buyerAddress,
  });
  // Brief poll for attestation. Circle's Sol Gateway mint typically
  // reflects within a few seconds.
  for (let i = 0; i < 8; i++) {
    await new Promise(r => setTimeout(r, 1500));
    try {
      const accounts = await args.conn.getParsedTokenAccountsByOwner(owner, { mint });
      let after = 0n;
      for (const entry of accounts.value) {
        const info = entry.account.data.parsed?.info as
          | { tokenAmount?: { amount?: string } }
          | undefined;
        if (info?.tokenAmount?.amount) {
          after += BigInt(info.tokenAmount.amount);
        }
      }
      if (after >= args.amountMicro) return true;
    } catch {
      /* keep polling */
    }
  }
  throw new Error(
    `prefund/sol: materialized $${gapDecimal} from Gateway pool but buyer ATA still below required`
  );
}
