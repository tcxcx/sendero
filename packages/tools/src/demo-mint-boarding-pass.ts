/**
 * demo_mint_boarding_pass — agent-callable demo tool that mints a
 * BoardingPass NFT for the autonomous /demo trip flow.
 *
 * Why this exists separately from `mint_stamp`: the canonical mint_stamp
 * tool is `internal: true` (workflow-only) and expects the recipient to be
 * the user's per-passkey wallet. /demo trip runs against a Clerk session
 * that doesn't have a passkey bound, so we route the mint to the org
 * treasury / Circle treasury address instead. Treasury wallet signs via
 * Circle Modular Wallets (gas sponsored by Circle Gas Station), so no
 * user signature is required.
 *
 * **Production gate:** the handler refuses to run unless
 * `NEXT_PUBLIC_DEMO_TRIP_ENABLED === 'true'`. This is the same flag the
 * console UI uses to surface the /demo trip pill, so flipping it off
 * disables the demo end-to-end.
 *
 * Real users mint via the production `mint_stamp` workflow path; this
 * tool is exclusively a demo aide.
 */

import { z } from 'zod';

import { mintStamp, STAMP_NEW_TOKEN_ID } from '@sendero/arc/identity';

import type { ToolDef } from './types';

const demoMintInput = z.object({
  /** Real Duffel PNR or order id from the prior book_flight call. */
  pnr: z.string().min(3).max(64),
  /** Plain-text route, e.g. "EZE → MDZ". Stored on the manifest caption. */
  route: z.string().min(3).max(120),
  /** Optional one-line caption rendered on the OG card. */
  caption: z.string().max(200).optional(),
});

interface DemoMintResult {
  status: 'minted' | 'demo_mode_disabled' | 'misconfigured';
  tokenId?: string;
  txHash?: string;
  explorerUrl?: string;
  contract?: string;
  recipient?: string;
  reason?: string;
}

const PLACEHOLDER_IPFS =
  'ipfs://bafkreigp4i5cjz5fhhk7m4ksuc4s7olqbofmybhnlxkk3ev4qcrr5xkfeu';

function resolveTreasuryRecipient(): `0x${string}` | null {
  const candidates = [
    process.env.SENDERO_TREASURY_ADDRESS,
    process.env.CIRCLE_TREASURY_ADDRESS,
    process.env.SENDERO_PROVIDER_ADDRESS,
  ];
  for (const addr of candidates) {
    if (typeof addr === 'string' && /^0x[0-9a-fA-F]{40}$/.test(addr)) {
      return addr.toLowerCase() as `0x${string}`;
    }
  }
  return null;
}

export const demoMintBoardingPassTool: ToolDef<z.infer<typeof demoMintInput>, DemoMintResult> = {
  name: 'demo_mint_boarding_pass',
  description:
    'Demo-only tool used by the /demo trip slash command in the operator console. Mints a real Sendero BoardingPass NFT (ERC-1155) on Arc-Testnet to the org treasury address. Returns the on-chain tokenId, txHash, and explorer URL so the agent can surface the proof to the user. Gated to environments where NEXT_PUBLIC_DEMO_TRIP_ENABLED is true. Do NOT call this for real bookings; the real path is the workflow-driven `mint_stamp` after settlement completes.',
  inputSchema: demoMintInput,
  jsonSchema: {
    type: 'object',
    required: ['pnr', 'route'],
    properties: {
      pnr: { type: 'string', description: 'Duffel PNR / order id from book_flight.' },
      route: { type: 'string', description: 'Origin → destination, e.g. "EZE → MDZ".' },
      caption: { type: 'string' },
    },
  },
  async handler(input) {
    if (process.env.NEXT_PUBLIC_DEMO_TRIP_ENABLED !== 'true') {
      return {
        status: 'demo_mode_disabled',
        reason:
          'NEXT_PUBLIC_DEMO_TRIP_ENABLED is not "true" in this environment. This tool is only available when the /demo trip console feature is enabled.',
      };
    }

    const treasuryWalletId = process.env.CIRCLE_TREASURY_WALLET_ID;
    const contractAddress = process.env.SENDERO_STAMPS_ADDRESS as `0x${string}` | undefined;
    const recipient = resolveTreasuryRecipient();
    const explorerBase = process.env.ARC_EXPLORER_URL || 'https://testnet.arcscan.app';

    if (!treasuryWalletId || !contractAddress || !recipient) {
      return {
        status: 'misconfigured',
        reason: `Missing one of: CIRCLE_TREASURY_WALLET_ID (${treasuryWalletId ? 'ok' : 'unset'}), SENDERO_STAMPS_ADDRESS (${contractAddress ? 'ok' : 'unset'}), treasury recipient address (${recipient ? 'ok' : 'unset'}).`,
      };
    }

    const result = await mintStamp({
      treasuryWalletId,
      contractAddress,
      to: recipient,
      tokenId: STAMP_NEW_TOKEN_ID,
      uri: PLACEHOLDER_IPFS,
      amount: 1n,
    });

    return {
      status: 'minted',
      tokenId: result.tokenId.toString(),
      txHash: result.txHash,
      explorerUrl: `${explorerBase}/tx/${result.txHash}`,
      contract: contractAddress,
      recipient,
    };
  },
};
