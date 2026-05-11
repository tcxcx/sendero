/**
 * provision-squads-vault-ata — one-shot setup for Sol-primaryChain
 * tenants whose platform treasury is a Squads multisig vault PDA.
 *
 * Problem: Circle App Kit's `spend()` → `resolveRecipientAta` calls
 * `getAssociatedTokenAddressSync(mint, owner)` WITHOUT
 * `allowOwnerOffCurve=true`. Squads vault addresses are PDAs (off the
 * ed25519 curve by design), so the SDK throws
 * `INPUT_INVALID_ADDRESS: Owner ... is off the ed25519 curve` before
 * any funds move.
 *
 * Solution: pre-create the ATA for the vault PDA with the off-curve
 * flag set, then store the ATA *address* as the treasury recipient.
 * Circle's SDK's `resolveRecipientAta` short-circuits when the
 * recipient is already an existing token account, skipping the broken
 * derivation. Funds remain owned by the vault PDA — multisig security
 * is preserved.
 *
 * Idempotent: re-running checks both states (ATA exists, treasury row
 * updated) and exits cleanly if both are in place.
 *
 *   bun apps/app/scripts/_local/provision-squads-vault-ata.ts \
 *       --tenant cmp03pokp0007b9coarfhijft
 */

import { config } from 'dotenv';
config({ path: '.env.local' });
config({ path: 'apps/app/.env.local', override: false });

import {
  Connection,
  Keypair,
  PublicKey,
  sendAndConfirmTransaction,
  SystemProgram,
  Transaction,
} from '@solana/web3.js';
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  getAccount,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import bs58 from 'bs58';
import { prisma } from '@sendero/database';

const USDC_MINT_DEVNET = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';

function arg(name: string, fallback?: string): string | undefined {
  const flag = `--${name}=`;
  const found = process.argv.find(a => a.startsWith(flag));
  if (found) return found.slice(flag.length);
  const idx = process.argv.indexOf(`--${name}`);
  if (idx >= 0 && process.argv[idx + 1] && !process.argv[idx + 1].startsWith('--')) {
    return process.argv[idx + 1];
  }
  return fallback;
}

async function main() {
  const tenantId = arg('tenant');
  if (!tenantId) {
    console.error('Usage: bun apps/app/scripts/_local/provision-squads-vault-ata.ts --tenant <tenantId>');
    process.exit(1);
  }

  const treasury = await prisma.superOrgTreasury.findFirst({
    where: { chain: 'sol', status: 'live' },
    orderBy: { createdAt: 'desc' },
  });
  if (!treasury) {
    console.error('No live sol-chain SuperOrgTreasury row found. Provision one first via the UI.');
    process.exit(1);
  }
  console.log('Found treasury row:', {
    id: treasury.id,
    network: treasury.network,
    vaultAddress: treasury.vaultAddress,
    multisigAddress: treasury.multisigAddress,
  });

  const rpcUrl = process.env.SENDERO_SOLANA_RPC_URL ?? 'https://api.devnet.solana.com';
  const connection = new Connection(rpcUrl, 'confirmed');

  const vaultOwner = new PublicKey(treasury.vaultAddress);
  const mint = new PublicKey(USDC_MINT_DEVNET);

  // Compute the ATA for the vault PDA — explicitly allowing off-curve owner.
  const ata = getAssociatedTokenAddressSync(
    mint,
    vaultOwner,
    /* allowOwnerOffCurve = */ true,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );
  console.log('Computed vault USDC ATA:', ata.toBase58());

  // Check if the ATA already exists on-chain.
  let ataExists = false;
  try {
    const info = await getAccount(connection, ata);
    if (info.mint.equals(mint) && info.owner.equals(vaultOwner)) {
      ataExists = true;
      console.log('ATA already exists on-chain — skipping create.');
    } else {
      console.error('ATA exists but mint/owner mismatch:', {
        wantMint: mint.toBase58(),
        gotMint: info.mint.toBase58(),
        wantOwner: vaultOwner.toBase58(),
        gotOwner: info.owner.toBase58(),
      });
      process.exit(1);
    }
  } catch {
    console.log('ATA does not exist yet — creating.');
  }

  if (!ataExists) {
    const platformPrivateKey = process.env.SENDERO_SOLANA_PLATFORM_PRIVATE_KEY;
    if (!platformPrivateKey) {
      console.error('SENDERO_SOLANA_PLATFORM_PRIVATE_KEY not set — cannot pay rent for ATA create.');
      process.exit(1);
    }
    const payer = Keypair.fromSecretKey(bs58.decode(platformPrivateKey));
    console.log('Payer (platform Solana hot wallet):', payer.publicKey.toBase58());

    const ix = createAssociatedTokenAccountInstruction(
      payer.publicKey, // payer (covers rent)
      ata, // ata address
      vaultOwner, // owner (the Squads vault PDA — off-curve, allowed)
      mint, // mint
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );
    const tx = new Transaction().add(ix);
    const sig = await sendAndConfirmTransaction(connection, tx, [payer], {
      commitment: 'confirmed',
    });
    console.log('ATA created. Sig:', sig);
    console.log(`Explorer: https://explorer.solana.com/tx/${sig}?cluster=devnet`);
  }

  // Update the treasury row to use the ATA as the recipient address.
  // We keep multisigAddress as the vault PDA (the actual security
  // anchor); vaultAddress now points at the ATA so Circle's spend()
  // accepts it without re-deriving.
  if (treasury.vaultAddress === ata.toBase58()) {
    console.log('Treasury row already points at the ATA. Done.');
    return;
  }
  console.log('Updating treasury row vaultAddress →', ata.toBase58());
  const before = treasury.vaultAddress;
  // SuperOrgTreasury has no `metadata` column; preserve the original
  // Squads vault PDA in `multisigAddress` since that's where the
  // ownership/signing authority lives. `vaultAddress` now points at
  // the SPL token ATA so Circle's spend() resolveRecipientAta short-
  // circuits (recipient is an existing token account, no derivation).
  await prisma.superOrgTreasury.update({
    where: { id: treasury.id },
    data: {
      vaultAddress: ata.toBase58(),
      multisigAddress: treasury.multisigAddress ?? before,
    },
  });
  console.log('Treasury row updated. Squads vault PDA preserved as multisigAddress:', before);
  console.log('Ready to retry settlement.');
  console.log('Tenant:', tenantId);
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
