/**
 * Direct DCW → external address USDC transfers via Circle's
 * developer-controlled-wallets REST API. Distinct from Gateway
 * `spend()` (which is the cross-chain burn-mint primitive) — this
 * is a plain SPL transfer on a single chain, signed by Circle.
 *
 * Why this exists alongside `unifiedGateway.spend`:
 *
 *   - `spend()` is for cross-chain `burn-and-mint` via CCTP. Its
 *     destination signer model (Anchor `gateway.v1.gatewayMint`)
 *     REQUIRES the signing DCW context to own the recipient's
 *     destination ATA — external recipients (multisig vault PDAs,
 *     approver wallets, anything not a tenant DCW) trip
 *     `AnchorError 6027: InvalidDestinationTokenAccount`.
 *
 *   - `transferUsdcFromCircleWallet` is for the second-leg sweep:
 *     after `spend()` lands funds in a tenant DCW, this function
 *     moves them onward to the configured platform treasury, Squads
 *     multisig vault PDA, approver wallet, anywhere on the same
 *     chain. Circle signs as the DCW; the destination is unconstrained.
 *
 * Used by `book_flight.ts::settleTravelerUsdcToTreasury`'s Sol
 * primaryChain branch for the post-Gateway sweep.
 */

import { getCircle } from './wallets';

/**
 * Token-id resolver for Circle's developer-controlled-wallets API.
 * Circle's token catalog UUIDs are env-bound (per-network) because
 * the same product code (USDC) has distinct ids per mainnet/devnet
 * and per chain. Source: Circle dashboard → Wallets → Token IDs, or
 * `GET /v1/w3s/tokens` against the REST API.
 *
 * Env vars are the same ones `apps/app/lib/nanopay-settle.ts` reads.
 */
export function resolveUsdcTokenId(network: 'sol-devnet' | 'sol-mainnet'): string {
  const envName =
    network === 'sol-mainnet' ? 'CIRCLE_USDC_SOL_TOKEN_ID' : 'CIRCLE_USDC_SOL_DEVNET_TOKEN_ID';
  const value = process.env[envName];
  if (!value) {
    throw new Error(
      `[dcw-transfer] ${envName} is not set. Look up the Circle catalog UUID at ` +
        `https://developers.circle.com/w3s/reference/listtokens and add it to .env.local.`
    );
  }
  return value;
}

export interface DcwTransferParams {
  /** Circle's internal walletId (UUID) — not the on-chain address. */
  walletId: string;
  /** On-chain recipient address (base58 for Sol, 0x for EVM). */
  destinationAddress: string;
  /** Decimal token amount as a string ("63.42" not micro). */
  amount: string;
  /** Circle token id — pick from `USDC_TOKEN_IDS`. */
  tokenId: string;
  /** Idempotency reference — Circle scoping; not on-chain. */
  refId?: string;
}

export interface DcwTransferResult {
  transactionId: string;
  state: string;
}

/**
 * Initiate a USDC transfer from a Circle-managed DCW to any address.
 * Returns the Circle transaction id; the actual on-chain tx hash
 * appears once Circle's relayer broadcasts (poll via
 * `getCircle().getTransaction({ id })` or the webhook event monitor).
 */
export async function transferUsdcFromCircleWallet(
  params: DcwTransferParams
): Promise<DcwTransferResult> {
  const circle = getCircle();
  const response = await circle.createTransaction({
    walletId: params.walletId,
    tokenId: params.tokenId,
    destinationAddress: params.destinationAddress,
    amount: [params.amount],
    fee: {
      type: 'level',
      // MEDIUM matches the operations-DCW outbound fee shape used by
      // the existing `transferUSDC` in `./wallets.ts` — Circle picks a
      // priority fee from current network conditions.
      config: { feeLevel: 'MEDIUM' as never },
    },
    ...(params.refId ? { refId: params.refId } : {}),
  } as Parameters<typeof circle.createTransaction>[0]);

  return {
    transactionId: (response.data as { id?: string } | undefined)?.id ?? '',
    state: (response.data as { state?: string } | undefined)?.state ?? 'INITIATED',
  };
}
