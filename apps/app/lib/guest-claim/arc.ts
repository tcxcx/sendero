/**
 * Server-side Arc claim submission.
 *
 * After the guest authenticates via email match on /g, the server
 * provisions a Circle DCW for them (`ensureTravelerWallet`) and uses
 * it to call `escrow.claimTrip(...)` on Arc. The DCW is the
 * msg.sender; Circle Gas Station sponsors gas; the escrow recovers
 * the EIP-191 signer from the Peanut-style proof and verifies it
 * matches `trip.claimPubKey20`.
 *
 * Why server-side: aligns with the WhatsApp traveler onboarding
 * (server-side DCW provisioning) and lets the new traveler land on
 * /me without a passkey detour.
 */

import { executeContractCallFromDcw } from '@sendero/circle/contract-execution';
import {
  buildClaimCodePreimage,
  encodeClaimTrip,
  signClaim,
} from '@sendero/guest';
import type { Address, Hex } from 'viem';

const ARC_TESTNET_CHAIN_ID = 5042002;

export interface SubmitArcClaimArgs {
  /** Circle wallet id of the traveler DCW (the new trip owner). */
  dcwWalletId: string;
  /** 0x-address of the traveler DCW. Used as `guestWallet` in the
   *  EIP-191 signature so the escrow recovers it as the new owner. */
  dcwAddress: Address;
  /** SenderoGuestEscrow contract address. */
  escrow: Address;
  /** EIP-155 chainId. Defaults to Arc Testnet. */
  chainId?: number;
  /** On-chain bytes32 trip id from the guest link fragment. */
  tripId: Hex;
  /** Peanut-style ephemeral claim key from the link fragment. Never
   *  persisted; consumed here and discarded after the call. */
  claimPrivateKey: Hex;
  /** When the trip was prefunded with 2FA, the 32-byte nonce from the
   *  link AND the 6-digit code from the invite email combine into the
   *  preimage the contract checks. */
  claimCodeNonce?: Hex;
  /** 6-digit code from the original invite email. Required when 2FA
   *  is on; ignored otherwise. */
  claimCode?: string;
  /** Idempotency key for Circle. Required UUID v4. */
  idempotencyKey: string;
}

export interface SubmitArcClaimResult {
  txHash: string;
  state: string;
  guestWallet: Address;
}

export async function submitArcClaim(
  args: SubmitArcClaimArgs
): Promise<SubmitArcClaimResult> {
  const chainId = args.chainId ?? ARC_TESTNET_CHAIN_ID;

  const signature = await signClaim({
    claimPrivateKey: args.claimPrivateKey,
    chainId,
    escrow: args.escrow,
    tripId: args.tripId,
    guestWallet: args.dcwAddress,
  });

  const claimCodePreimage: Hex = args.claimCodeNonce
    ? (() => {
        if (!args.claimCode || !/^\d{6}$/.test(args.claimCode)) {
          throw new Error(
            'submitArcClaim: trip requires a 6-digit code; check the invite email for the value.'
          );
        }
        return buildClaimCodePreimage(args.claimCode, args.claimCodeNonce);
      })()
    : ('0x' as Hex);

  const callData = encodeClaimTrip({
    escrow: args.escrow,
    tripId: args.tripId,
    guestWallet: args.dcwAddress,
    signature,
    claimCodePreimage,
  }).data as Hex;

  const result = await executeContractCallFromDcw({
    walletId: args.dcwWalletId,
    contractAddress: args.escrow,
    callData,
    idempotencyKey: args.idempotencyKey,
  });

  return {
    txHash: result.txHash,
    state: result.state,
    guestWallet: args.dcwAddress,
  };
}
