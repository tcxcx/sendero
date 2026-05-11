/**
 * Shared Umi context for Sendero's Metaplex helpers.
 *
 * One `Umi` instance lives per Sendero process. Construction is lazy:
 * the first call to `getUmi()` builds the bundle (default RPC +
 * eddsa + signer plugins), every subsequent call returns it. Tests
 * can call `resetUmi()` to force a fresh context with a different
 * payer keypair.
 *
 * Why centralize:
 * - The umi bundle is heavy — instantiating it per mint inflates
 *   cold-boot on the booking confirmation hot path.
 * - The same payer signs every Sendero-paid mint (trip stamps, agent
 *   registrations). Single instance = single secret read from env.
 *
 * Env:
 *   SENDERO_SOLANA_RPC_URL — defaults to api.devnet.solana.com.
 *   SENDERO_SOLANA_PLATFORM_PRIVATE_KEY — base58-encoded keypair
 *     bytes. Same key the Solana gas-station sponsor uses (already
 *     documented in CLAUDE.md). Required for any mint or registry
 *     submit; absent → `getUmi` throws so callers fail loud.
 */

import { createSignerFromKeypair, signerIdentity, type Umi } from '@metaplex-foundation/umi';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { mplCore } from '@metaplex-foundation/mpl-core';
import {
  mplAgentIdentity,
  mplAgentTools,
} from '@metaplex-foundation/mpl-agent-registry';
import bs58 from 'bs58';

const DEFAULT_RPC = 'https://api.devnet.solana.com';

let cachedUmi: Umi | null = null;

export function getUmi(): Umi {
  if (cachedUmi) return cachedUmi;

  const rpcUrl = process.env.SENDERO_SOLANA_RPC_URL ?? DEFAULT_RPC;
  const secret = process.env.SENDERO_SOLANA_PLATFORM_PRIVATE_KEY;
  if (!secret) {
    throw new Error(
      '[@sendero/metaplex] SENDERO_SOLANA_PLATFORM_PRIVATE_KEY is required for any Metaplex submit'
    );
  }

  const umi = createUmi(rpcUrl)
    .use(mplCore())
    .use(mplAgentIdentity())
    .use(mplAgentTools());

  const keyBytes = bs58.decode(secret);
  const kp = umi.eddsa.createKeypairFromSecretKey(keyBytes);
  umi.use(signerIdentity(createSignerFromKeypair(umi, kp)));

  cachedUmi = umi;
  return umi;
}

/** Test-only: drop the cached Umi so the next call rebuilds. */
export function resetUmi(): void {
  cachedUmi = null;
}
