/**
 * SenderoGuestEscrow tools.
 *
 * These expose the prefund-then-share flow over MCP. The corporate
 * buyer calls `prefund_trip` to fund a trip on-chain and get a
 * shareable WhatsApp link; the guest (employee, contractor, family
 * member) opens the link and calls `guest_claim_link` to bind the
 * trip to their Modular Wallet. The booking agent then uses
 * `reserve_booking` / `commit_booking` to draw down from escrow as
 * each leg is confirmed with Duffel.
 *
 * MCP is the single source of truth — every surface (LLM chat route,
 * WhatsApp agent, Slack approvals, and other AI agents calling
 * Sendero) reaches these via the shared @sendero/tools catalog.
 *
 * Note: These tools return the *encoded userOp calls* to submit via
 * Circle Modular Wallets. Actual on-chain submission is the caller's
 * responsibility (so the same tool works from a server route, a
 * passkey userOp in the browser, or a scheduled Trigger.dev task).
 */

import {
  buildClaimCodePreimage,
  buildClaimTripCalls,
  buildCreateTripCalls,
  buildGuestLink,
  computeClaimCodeHash,
  type EncodedCall,
  encodeCommitBooking,
  encodeReserveForBooking,
  fromUsdcMicro,
  generateBookingId,
  generateClaimCode,
  generateClaimKeypair,
  generateNonce32,
  generateTripId,
  NO_CLAIM_CODE,
  parseGuestLink,
  SENDERO_GUEST_ESCROW_ABI,
  signClaim,
  toUsdcMicro,
} from '@sendero/guest';
import { prisma } from '@sendero/database';
import { createNotifier, notificationsConfigured } from '@sendero/notifications';
import type { Address, Hex } from 'viem';
import { z } from 'zod';

import type { ToolDef, ToolContext } from './types';

// ─── Shared input helpers ───────────────────────────────────────────

const hex32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/, 'hex32 (0x + 64 hex chars)');
const hex20 = z.string().regex(/^0x[0-9a-fA-F]{40}$/, 'ethereum address');

function resolveEscrow(override?: string | null): Address {
  // Canonical: ARC_ESCROW_ADDRESS (Foundry deploy script). Legacy fallbacks
  // retained so older .env files keep working.
  const addr =
    override ??
    process.env.ARC_ESCROW_ADDRESS ??
    process.env.NEXT_PUBLIC_ARC_ESCROW_ADDRESS ??
    process.env.NEXT_PUBLIC_SENDERO_GUEST_ESCROW ??
    process.env.SENDERO_GUEST_ESCROW;
  if (!addr) {
    throw new Error(
      'ARC_ESCROW_ADDRESS env var not set — cannot build on-chain calls. Set to the deployed SenderoGuestEscrow address.'
    );
  }
  return addr as Address;
}

function resolveAgentTokenId(override?: string): bigint {
  const raw = override ?? process.env.SENDERO_AGENT_TOKEN_ID ?? process.env.SENDERO_AGENT_ID ?? '0';
  return BigInt(raw);
}

function resolveLinkOrigin(override?: string): string {
  return override ?? process.env.NEXT_PUBLIC_SENDERO_GUEST_LINK_ORIGIN ?? 'https://sendero.travel';
}

/** Read `Tenant.primaryChain` from ToolContext. Defaults to 'arc' when
 *  the context doesn't carry a tenantId (e.g. unauthenticated / sandbox
 *  test bench) — preserves Arc-as-default behavior. */
async function resolveTenantPrimaryChain(
  ctx: ToolContext | undefined
): Promise<'arc' | 'sol'> {
  const tenantId = ctx?.traveler?.tenantId;
  if (!tenantId) return 'arc';
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { primaryChain: true },
  });
  return tenant?.primaryChain === 'sol' ? 'sol' : 'arc';
}

/** JSON-serializable shape of a Solana TransactionInstruction so the
 *  Sendero relayer / Circle DCW signer can rebuild + sign it client-
 *  side. Mirrors the EncodedCall pattern on Arc. */
interface SerializedSolanaIx {
  programId: string;
  accounts: Array<{ pubkey: string; isSigner: boolean; isWritable: boolean }>;
  /** Base64-encoded data buffer. */
  data: string;
}

// ─── prefund_trip ───────────────────────────────────────────────────

const prefundInput = z.object({
  budgetUsdc: z.string().regex(/^\d+(\.\d{1,6})?$/, 'decimal USDC with up to 6 decimals'),
  expiresInDays: z.number().int().min(1).max(365).default(30),
  metadataCID: z
    .string()
    .default('')
    .describe('IPFS CID with the trip intent JSON. Empty string is acceptable for demo.'),
  metadataHash: hex32
    .optional()
    .describe('keccak256 of the plaintext trip intent. Auto-generated when omitted.'),
  agentTokenId: z.string().optional(),
  escrowAddress: hex20.optional(),
  linkOrigin: z.string().url().optional(),
  require2fa: z
    .boolean()
    .default(false)
    .describe('When true, mint a 6-digit OTP + nonce that the guest must present at claim time.'),
  guestEmail: z
    .string()
    .email()
    .optional()
    .describe('When provided, emails the guest the claim link + OTP via @sendero/notifications.'),
  guestName: z.string().min(1).max(80).optional().describe('Display name for the guest greeting.'),
  buyerName: z
    .string()
    .min(1)
    .max(120)
    .default('Sendero')
    .describe('Display name rendered in the email subject & greeting (e.g. "Acme Travel Desk").'),
  tripSummary: z
    .string()
    .max(200)
    .optional()
    .describe(
      'Short route summary for the subject line, e.g. "SFO → LHR" or "Mexico City holiday".'
    ),
});

export const prefundTripTool: ToolDef = {
  name: 'prefund_trip',
  description:
    'Corporate buyer path: fund a trip budget in USDC on SenderoGuestEscrow and return a WhatsApp-shareable guest link (Peanut-style — the claim key lives in the URL fragment). Returns the on-chain calls (approve + createTrip) to submit via Circle Modular Wallets plus the link to DM the traveler. Front-running safe because the claim signature binds to the guest wallet at claim time.',
  inputSchema: prefundInput,
  jsonSchema: {
    type: 'object',
    required: ['budgetUsdc'],
    properties: {
      budgetUsdc: { type: 'string', description: 'Trip budget in decimal USDC.' },
      expiresInDays: { type: 'integer', default: 30, minimum: 1, maximum: 365 },
      metadataCID: { type: 'string', description: 'Optional IPFS CID for trip intent JSON.' },
      metadataHash: { type: 'string', description: 'keccak256 of the trip intent.' },
      agentTokenId: { type: 'string', description: 'ERC-8004 agent token id.' },
      escrowAddress: { type: 'string', description: 'Override the default escrow address.' },
      linkOrigin: { type: 'string', description: 'Override the guest link origin.' },
      require2fa: {
        type: 'boolean',
        default: false,
        description: 'Require a 6-digit OTP at claim time (out-of-band share).',
      },
      guestEmail: { type: 'string', description: 'Email the guest directly when provided.' },
      guestName: { type: 'string', description: 'Display name for the email greeting.' },
      buyerName: { type: 'string', description: 'Buyer display name in subject + greeting.' },
      tripSummary: { type: 'string', description: 'Short route summary for email copy.' },
    },
  },
  async handler(input, ctx) {
    const parsed = prefundInput.parse(input);
    const primaryChain = await resolveTenantPrimaryChain(ctx);

    // Solana branch — build a `pre_fund_trip` Anchor instruction
    // against the deployed sendero_guest_escrow program. Returns a
    // JSON-serialized ix the buyer's Solana DCW signs + submits.
    if (primaryChain === 'sol') {
      return prefundTripSolana(parsed, ctx);
    }

    const escrow = resolveEscrow(parsed.escrowAddress);
    const budget = toUsdcMicro(parsed.budgetUsdc);
    const expiresAt = BigInt(Math.floor(Date.now() / 1000)) + BigInt(parsed.expiresInDays * 86400);
    const agentTokenId = resolveAgentTokenId(parsed.agentTokenId);
    const origin = resolveLinkOrigin(parsed.linkOrigin);

    const tripId = generateTripId();
    const { privateKey, pubKey20 } = generateClaimKeypair();

    // Use zeroed hash when the caller skips metadata; never fabricate.
    const metadataHash =
      (parsed.metadataHash as Hex | undefined) ??
      ('0x0000000000000000000000000000000000000000000000000000000000000000' as Hex);

    let claimCode: string | null = null;
    let codeNonce: Hex | null = null;
    let claimCodeHash: Hex = NO_CLAIM_CODE;
    if (parsed.require2fa) {
      claimCode = generateClaimCode();
      codeNonce = generateNonce32();
      claimCodeHash = computeClaimCodeHash(claimCode, codeNonce);
    }

    const calls: EncodedCall[] = buildCreateTripCalls({
      escrow,
      trip: {
        tripId,
        claimPubKey20: pubKey20,
        budget,
        expiresAt,
        metadataHash,
        metadataCID: parsed.metadataCID,
        agentTokenId,
        claimCodeHash,
      },
    });

    // Nonce rides in the URL fragment when 2FA is on — same privacy
    // envelope as the claim key. The 6-digit code goes out-of-band.
    const link = buildGuestLink({
      origin,
      tripId,
      claimPrivateKey: privateKey,
      ...(codeNonce ? { claimCodeNonce: codeNonce } : {}),
    });

    // Fire the email invite when the caller supplied a guest email AND
    // the notifier is configured. Failures never block the on-chain flow —
    // we return the send result so the caller can log + retry.
    let emailResult: { ok: boolean; id?: string; error?: string; skipped?: boolean } | null = null;
    if (parsed.guestEmail) {
      if (!notificationsConfigured()) {
        emailResult = {
          ok: false,
          skipped: true,
          error: 'RESEND_API_KEY / SENDERO_EMAIL_FROM not set',
        };
      } else {
        const notifier = createNotifier();
        const expiresIso = new Date(Number(expiresAt) * 1000).toISOString();
        const budgetHuman = `$${fromUsdcMicro(budget).replace(/\.?0+$/, '')} USDC`;
        emailResult = await notifier.sendGuestInvite(parsed.guestEmail, {
          buyerName: parsed.buyerName,
          guestName: parsed.guestName,
          guestLink: link,
          claimCode,
          budget: budgetHuman,
          expiresAtIso: expiresIso,
          tripSummary: parsed.tripSummary,
        });
      }
    }

    return {
      tripId,
      budgetUsdc: parsed.budgetUsdc,
      budgetMicro: budget.toString(),
      expiresAt: expiresAt.toString(),
      escrowAddress: escrow,
      guestLink: link,
      claimPubKey20: pubKey20,
      require2fa: parsed.require2fa,
      claimCode,
      codeNonce,
      invite: parsed.guestEmail
        ? {
            channel: 'email' as const,
            to: parsed.guestEmail,
            ...emailResult,
          }
        : null,
      onchainCalls: calls.map(c => ({ to: c.to, data: c.data, value: c.value.toString() })),
      note: parsed.require2fa
        ? parsed.guestEmail && emailResult?.ok
          ? 'Submit the calls via the buyer MSCA userOp. The guest was emailed their claim link (with the nonce embedded) and their 6-digit code separately in the email body.'
          : 'Submit the calls via the buyer MSCA userOp. Deliver the guestLink AND the 6-digit claimCode to the traveler (email/SMS) — both are required at claim time.'
        : parsed.guestEmail && emailResult?.ok
          ? 'Submit the calls via the buyer MSCA userOp. The guest was emailed their claim link. The URL fragment never hits any server.'
          : 'Submit the calls via the buyer MSCA userOp. DM the guestLink to the traveler. The URL fragment never hits the server.',
    };
  },
};

// ─── prefund_trip · Solana branch ───────────────────────────────────

/**
 * Solana port of the prefund flow. Builds a `pre_fund_trip` Anchor ix
 * for the deployed `sendero_guest_escrow` program. The buyer's Solana
 * DCW signs + submits via Circle's `createTransaction` API.
 *
 * Differences from the Arc shape:
 *   - claim keypair is Ed25519 (32-byte secret) instead of secp256k1 EOA
 *   - tripId is a 32-byte array, never hex-encoded on the wire
 *   - on-chain calls are a single Anchor ix; no separate USDC approve
 *     (SPL Token uses `transfer_checked` from the buyer's ATA inside
 *     the program's CPI, not approve+transferFrom)
 *
 * For now, OTP / email / 2FA pieces stay disabled on the Solana branch —
 * v1 ships the core happy path. v2 ports the OTP brute-force lockout
 * pattern matching the Arc v3.0.0 contract.
 */
async function prefundTripSolana(
  parsed: z.infer<typeof prefundInput>,
  ctx: ToolContext | undefined
): Promise<Record<string, unknown>> {
  const [
    { PublicKey },
    {
      buildPreFundTripIx,
      generateClaimKeypairSolana,
      generateTripIdSolana,
      SENDERO_GUEST_ESCROW_PROGRAM_ID,
      SOLANA_USDC_MINT_DEVNET,
    },
    bs58Mod,
  ] = await Promise.all([
    import('@solana/web3.js'),
    import('@sendero/guest/solana'),
    import('bs58'),
  ]);
  const bs58 = bs58Mod.default;

  const tenantId = ctx?.traveler?.tenantId;
  if (!tenantId) {
    throw new Error('prefund_trip(sol): tenant context required to resolve buyer wallet');
  }

  // Resolve buyer's Solana DCW. For corporate buyer flow this is the
  // tenant treasury wallet; v2 will branch on a `buyerKind` arg to
  // support traveler-paid prefund.
  const buyerWallet = await prisma.circleWallet.findFirst({
    where: { tenantId, kind: 'treasury', chain: { in: ['SOL-DEVNET', 'SOL'] } },
    orderBy: { createdAt: 'desc' },
    select: { address: true },
  });
  if (!buyerWallet?.address) {
    throw new Error(
      `prefund_trip(sol): tenant ${tenantId} has no Solana treasury CircleWallet — provision via /onboarding/corporate first.`
    );
  }
  const buyer = new PublicKey(buyerWallet.address);

  const tripIdBytes = generateTripIdSolana();
  const claimKeypair = generateClaimKeypairSolana();
  const budgetMicro = toUsdcMicro(parsed.budgetUsdc);
  const expiresAt =
    BigInt(Math.floor(Date.now() / 1000)) + BigInt(parsed.expiresInDays * 86400);

  // 32-byte zero hash when 2FA is off (parity with Arc behavior).
  const expectedOtpHash = parsed.require2fa
    ? new Uint8Array(32) // v1 placeholder; v2 wires real OTP digest
    : new Uint8Array(32);

  const ix = buildPreFundTripIx({
    buyer,
    tripId: tripIdBytes,
    amount: budgetMicro,
    claimPubkey: claimKeypair.publicKey,
    expiry: expiresAt,
    expectedOtpHash,
    paymentMint: SOLANA_USDC_MINT_DEVNET,
  });

  const origin = resolveLinkOrigin(parsed.linkOrigin);
  const tripIdB58 = bs58.encode(tripIdBytes);
  // Solana guest links carry the base58 trip id + claim secret-key
  // seed in the URL fragment. Same privacy envelope as the Arc link
  // (fragment never hits any server).
  const guestLink = `${origin}/g#t=${tripIdB58}&k=${bs58.encode(
    claimKeypair.secretKey.slice(0, 32)
  )}&c=sol`;

  return {
    chain: 'sol' as const,
    tripId: tripIdB58,
    tripIdBytes: bs58.encode(tripIdBytes),
    budgetUsdc: parsed.budgetUsdc,
    budgetMicro: budgetMicro.toString(),
    expiresAt: expiresAt.toString(),
    programId: SENDERO_GUEST_ESCROW_PROGRAM_ID.toBase58(),
    guestLink,
    claimPubKey: claimKeypair.publicKey.toBase58(),
    require2fa: parsed.require2fa,
    claimCode: null,
    codeNonce: null,
    invite: null,
    onchainInstructions: [
      {
        programId: ix.programId.toBase58(),
        accounts: ix.keys.map(k => ({
          pubkey: k.pubkey.toBase58(),
          isSigner: k.isSigner,
          isWritable: k.isWritable,
        })),
        data: Buffer.from(ix.data).toString('base64'),
      } satisfies SerializedSolanaIx,
    ],
    note: 'Sign + submit the ix via the buyer Solana DCW (Circle createTransaction). DM the guestLink to the traveler.',
  };
}

// ─── guest_claim_link ───────────────────────────────────────────────

const claimInput = z.object({
  guestLink: z
    .string()
    .describe('The full https://sendero.travel/g#t=…&k=… link the guest received.'),
  guestWallet: hex20.describe(
    'Wallet address that will receive the trip. For browser passkey claims, this is the MSCA. For DCW-signed claims, this is the traveler EOA.'
  ),
  chainId: z.number().int().default(5042002).describe('Arc Testnet chain id.'),
  escrowAddress: hex20.optional(),
  claimCode: z
    .string()
    .regex(/^\d{6}$/)
    .optional()
    .describe('6-digit OTP if the trip was created with require2fa=true.'),
  codeNonce: hex32.optional().describe('32-byte nonce returned by prefund_trip when 2FA is on.'),
  /**
   * Channel-bound traveler shortcut: when set, the tool ALSO submits the
   * claimTrip tx on-chain via Circle DCW using this wallet UUID as msg.sender.
   * The peanut signature still comes from the URL fragment privkey — the DCW
   * just acts as the gas/submitter wallet (Circle Paymaster sponsors gas, or
   * the DCW pays from its own balance).
   *
   * Omit this for the cold-guest browser path; the tool then returns calldata
   * only, and the guest's MSCA submits via passkey.
   */
  signerWalletId: z
    .string()
    .uuid()
    .optional()
    .describe(
      "Circle DCW wallet UUID for the traveler. When set, the tool submits the claim on-chain (DCW pays gas) instead of returning calldata. Use only when the traveler's DCW is bound to the channel."
    ),
});

export const guestClaimLinkTool: ToolDef = {
  name: 'guest_claim_link',
  description:
    "Guest path: parse a Sendero guest link, sign the EIP-191 claim message with the embedded private key. Two modes — (a) cold guest: returns calldata for the guest MSCA to submit via passkey (the /g browser flow); (b) channel-bound: when signerWalletId is set, submits the claim on-chain via the traveler's Circle DCW and returns the tx hash. After this completes, the booking agent can call reserve_booking / commit_booking against the claimed trip.",
  inputSchema: claimInput,
  jsonSchema: {
    type: 'object',
    required: ['guestLink', 'guestWallet'],
    properties: {
      guestLink: { type: 'string' },
      guestWallet: { type: 'string' },
      chainId: { type: 'integer', default: 5042002 },
      escrowAddress: { type: 'string' },
      claimCode: { type: 'string', description: '6-digit OTP if 2FA is on.' },
      codeNonce: { type: 'string', description: '32-byte nonce returned by prefund_trip.' },
      signerWalletId: {
        type: 'string',
        description:
          "Circle DCW wallet UUID for the traveler. When set, submits the claim on-chain (DCW pays gas via Paymaster) instead of returning calldata. Use only when the traveler's DCW is bound to the channel.",
      },
    },
  },
  async handler(input) {
    const parsed = claimInput.parse(input);
    const parts = parseGuestLink(parsed.guestLink);
    if (!parts) {
      throw new Error('invalid_guest_link: expected /g#t=0x…&k=0x… fragment');
    }
    const escrow = resolveEscrow(parsed.escrowAddress);
    const signature = await signClaim({
      claimPrivateKey: parts.claimPrivateKey,
      chainId: parsed.chainId,
      escrow,
      tripId: parts.tripId,
      guestWallet: parsed.guestWallet as Address,
    });

    // If the buyer set require2fa at prefund time, the trip has a non-zero
    // claimCodeHash on-chain and claimTrip() will revert without a matching
    // preimage. The preimage is `${code}|${nonce}` encoded as UTF-8 bytes.
    const hasCode = Boolean(parsed.claimCode && parsed.codeNonce);
    if ((parsed.claimCode && !parsed.codeNonce) || (!parsed.claimCode && parsed.codeNonce)) {
      throw new Error('claim_code_pair: both claimCode and codeNonce are required together.');
    }
    const claimCodePreimage: Hex = hasCode
      ? buildClaimCodePreimage(parsed.claimCode!, parsed.codeNonce as Hex)
      : ('0x' as Hex);

    const calls = buildClaimTripCalls({
      escrow,
      tripId: parts.tripId,
      guestWallet: parsed.guestWallet as Address,
      signature,
      claimCodePreimage,
    });

    const baseResult = {
      tripId: parts.tripId,
      guestWallet: parsed.guestWallet,
      signature,
      escrowAddress: escrow,
      claimCodeProvided: hasCode,
      onchainCalls: calls.map(c => ({ to: c.to, data: c.data, value: c.value.toString() })),
    };

    // Cold-guest path: return calldata, MSCA submits via passkey (the /g page).
    if (!parsed.signerWalletId) {
      return {
        ...baseResult,
        submitted: false as const,
        note: 'Submit the call via the guest MSCA userOp (Circle Paymaster covers gas). MSCA may be uninitialized — include initCode in the userOp to deploy atomically.',
      };
    }

    // Channel-bound DCW path: submit on-chain right here. The peanut sig still
    // comes from the URL fragment privkey — the DCW only pays gas. We use the
    // raw `callData` form of Circle's API so we don't have to re-encode the
    // claimTrip ABI we already encoded above.
    const claimCall = calls[0];
    if (!claimCall) {
      throw new Error('buildClaimTripCalls returned no calls — claimTrip ABI changed?');
    }
    const { getCircle } = await import('@sendero/circle/wallets');
    const circle = getCircle();
    const submitResponse = await circle.createContractExecutionTransaction({
      walletId: parsed.signerWalletId,
      contractAddress: escrow,
      callData: claimCall.data,
      fee: { type: 'level', config: { feeLevel: 'MEDIUM' as const } },
    } as never);
    const txId = (submitResponse.data as { id?: string } | null)?.id;
    if (!txId) {
      throw new Error('Circle createContractExecutionTransaction returned no tx id');
    }

    // Poll until COMPLETE or FAILED. 120s ceiling matches what the identity
    // + stamps helpers use; Arc Testnet usually lands in <10s.
    const startedAt = Date.now();
    let txHash: string | null = null;
    while (Date.now() - startedAt < 120_000) {
      const tx = await circle.getTransaction({ id: txId });
      const data = (tx.data as { transaction?: { state?: string; txHash?: string } } | null)
        ?.transaction;
      if (data?.state === 'COMPLETE' && data.txHash) {
        txHash = data.txHash;
        break;
      }
      if (data?.state === 'FAILED') {
        throw new Error(`Circle claim tx failed on-chain (id=${txId})`);
      }
      await new Promise(r => setTimeout(r, 2000));
    }
    if (!txHash) {
      throw new Error(`Circle claim tx timed out after 120s (id=${txId})`);
    }

    return {
      ...baseResult,
      submitted: true as const,
      txId,
      txHash,
      signerWalletId: parsed.signerWalletId,
      note: 'Claim submitted via traveler DCW. The peanut signature came from the URL fragment privkey; the DCW signed only the userOp envelope.',
    };
  },
};

// ─── reserve_booking ────────────────────────────────────────────────

const reserveInput = z.object({
  tripId: hex32,
  upperBoundUsdc: z.string().regex(/^\d+(\.\d{1,6})?$/),
  bookingId: hex32.optional().describe('Provide to stay idempotent across retries.'),
  escrowAddress: hex20.optional(),
});

export const reserveBookingTool: ToolDef = {
  name: 'reserve_booking',
  description:
    'Agent path: reserve an upper-bound USDC amount from a claimed trip for a specific booking attempt. Called before search_flights → book_flight so escrow can block any conflicting draws while Duffel is held. Returns the on-chain call to submit and the bookingId to thread through commit_booking + confirm_flight.',
  inputSchema: reserveInput,
  jsonSchema: {
    type: 'object',
    required: ['tripId', 'upperBoundUsdc'],
    properties: {
      tripId: { type: 'string' },
      upperBoundUsdc: { type: 'string' },
      bookingId: { type: 'string' },
      escrowAddress: { type: 'string' },
    },
  },
  async handler(input, ctx) {
    const parsed = reserveInput.parse(input);
    const primaryChain = await resolveTenantPrimaryChain(ctx);
    if (primaryChain === 'sol') {
      return reserveBookingSolana(parsed);
    }
    const escrow = resolveEscrow(parsed.escrowAddress);
    const bookingId = (parsed.bookingId as Hex | undefined) ?? generateBookingId();
    const upperBound = toUsdcMicro(parsed.upperBoundUsdc);
    const call = encodeReserveForBooking({
      escrow,
      tripId: parsed.tripId as Hex,
      bookingId,
      upperBound,
    });
    return {
      tripId: parsed.tripId,
      bookingId,
      upperBoundMicro: upperBound.toString(),
      escrowAddress: escrow,
      onchainCall: { to: call.to, data: call.data, value: call.value.toString() },
      note: 'Submit via agent MSCA userOp. The bookingId must round-trip through commit_booking → confirm_flight → settle_booking so the escrow lifecycle closes.',
    };
  },
};

async function reserveBookingSolana(
  parsed: z.infer<typeof reserveInput>
): Promise<Record<string, unknown>> {
  const [
    { PublicKey },
    { buildReserveBookingIx, generateBookingIdSolana, SENDERO_GUEST_ESCROW_PROGRAM_ID },
    bs58Mod,
  ] = await Promise.all([
    import('@solana/web3.js'),
    import('@sendero/guest/solana'),
    import('bs58'),
  ]);
  const bs58 = bs58Mod.default;

  const operatorEnv = process.env.SENDERO_SOLANA_OPERATOR_ADDRESS;
  if (!operatorEnv) {
    throw new Error('reserve_booking(sol): SENDERO_SOLANA_OPERATOR_ADDRESS env var not set');
  }
  const operator = new PublicKey(operatorEnv);

  // Solana tripId is base58 (32 bytes). Accept hex too for cross-chain
  // tooling (callers that mint a hex id and route through both chains).
  const tripIdBytes = parsed.tripId.startsWith('0x')
    ? new Uint8Array(Buffer.from(parsed.tripId.slice(2), 'hex'))
    : bs58.decode(parsed.tripId);
  if (tripIdBytes.length !== 32) {
    throw new Error('reserve_booking(sol): tripId must decode to 32 bytes');
  }

  const bookingIdBytes = parsed.bookingId
    ? parsed.bookingId.startsWith('0x')
      ? new Uint8Array(Buffer.from(parsed.bookingId.slice(2), 'hex'))
      : bs58.decode(parsed.bookingId)
    : generateBookingIdSolana();

  const upperBound = toUsdcMicro(parsed.upperBoundUsdc);

  const ix = buildReserveBookingIx({
    operator,
    tripId: tripIdBytes,
    bookingId: bookingIdBytes,
    upperBound,
  });

  return {
    chain: 'sol' as const,
    tripId: bs58.encode(tripIdBytes),
    bookingId: bs58.encode(bookingIdBytes),
    upperBoundMicro: upperBound.toString(),
    programId: SENDERO_GUEST_ESCROW_PROGRAM_ID.toBase58(),
    onchainInstructions: [
      {
        programId: ix.programId.toBase58(),
        accounts: ix.keys.map(k => ({
          pubkey: k.pubkey.toBase58(),
          isSigner: k.isSigner,
          isWritable: k.isWritable,
        })),
        data: Buffer.from(ix.data).toString('base64'),
      } satisfies SerializedSolanaIx,
    ],
    note: 'Submit via the Sendero Solana operator wallet. bookingId round-trips through commit_booking → settle_booking.',
  };
}

// ─── commit_booking ─────────────────────────────────────────────────

const commitInput = z.object({
  bookingId: hex32,
  vendorAmountUsdc: z.string().regex(/^\d+(\.\d{1,6})?$/),
  feeAmountUsdc: z
    .string()
    .regex(/^\d+(\.\d{1,6})?$/)
    .default('0'),
  vendorAddress: hex20,
  itineraryHash: hex32.describe('keccak256 of the confirmed itinerary JSON.'),
  itineraryCID: z.string().default(''),
  escrowAddress: hex20.optional(),
  /** Solana-only: the parent trip id to derive the trip PDA. The Arc
   *  contract reads it from the on-chain booking row; on Solana the
   *  ix needs both. Accepts hex32 or base58. */
  tripId: z
    .string()
    .optional()
    .describe(
      'Solana-only: parent tripId (hex32 or base58). The Arc contract reads it from the booking row.'
    ),
});

export const commitBookingTool: ToolDef = {
  name: 'commit_booking',
  description:
    'Agent path: commit the actual vendor amount for a reserved booking. Releases the slack back to the trip budget. Use after Duffel returns a priced offer and before the booking is ticketed. Pair with confirm_flight once the order hash is known and settle_booking after the PNR is ticketed.',
  inputSchema: commitInput,
  jsonSchema: {
    type: 'object',
    required: ['bookingId', 'vendorAmountUsdc', 'vendorAddress', 'itineraryHash'],
    properties: {
      bookingId: { type: 'string' },
      vendorAmountUsdc: { type: 'string' },
      feeAmountUsdc: { type: 'string', default: '0' },
      vendorAddress: { type: 'string' },
      itineraryHash: { type: 'string' },
      itineraryCID: { type: 'string' },
      escrowAddress: { type: 'string' },
    },
  },
  async handler(input, ctx) {
    const parsed = commitInput.parse(input);
    const primaryChain = await resolveTenantPrimaryChain(ctx);
    if (primaryChain === 'sol') {
      return commitBookingSolana(parsed);
    }
    const escrow = resolveEscrow(parsed.escrowAddress);
    const vendorAmount = toUsdcMicro(parsed.vendorAmountUsdc);
    const feeAmount = toUsdcMicro(parsed.feeAmountUsdc);
    const call = encodeCommitBooking({
      escrow,
      bookingId: parsed.bookingId as Hex,
      vendorAmount,
      feeAmount,
      vendor: parsed.vendorAddress as Address,
      itineraryHash: parsed.itineraryHash as Hex,
      itineraryCID: parsed.itineraryCID,
    });
    return {
      bookingId: parsed.bookingId,
      vendorAmountMicro: vendorAmount.toString(),
      feeAmountMicro: feeAmount.toString(),
      vendorAddress: parsed.vendorAddress,
      escrowAddress: escrow,
      onchainCall: { to: call.to, data: call.data, value: call.value.toString() },
      note: 'Commit can only be called by the trip.agent operator. Slack (upperBound - actual) is released back to trip.available for future bookings on the same trip.',
    };
  },
};

async function commitBookingSolana(
  parsed: z.infer<typeof commitInput>
): Promise<Record<string, unknown>> {
  const [
    { PublicKey },
    { buildCommitBookingIx, SENDERO_GUEST_ESCROW_PROGRAM_ID },
    bs58Mod,
  ] = await Promise.all([
    import('@solana/web3.js'),
    import('@sendero/guest/solana'),
    import('bs58'),
  ]);
  const bs58 = bs58Mod.default;

  if (!parsed.tripId) {
    throw new Error(
      'commit_booking(sol): tripId is required on Solana so the trip PDA can be derived'
    );
  }

  const operatorEnv = process.env.SENDERO_SOLANA_OPERATOR_ADDRESS;
  if (!operatorEnv) {
    throw new Error('commit_booking(sol): SENDERO_SOLANA_OPERATOR_ADDRESS env var not set');
  }
  const operator = new PublicKey(operatorEnv);

  const tripIdBytes = parsed.tripId.startsWith('0x')
    ? new Uint8Array(Buffer.from(parsed.tripId.slice(2), 'hex'))
    : bs58.decode(parsed.tripId);
  const bookingIdBytes = parsed.bookingId.startsWith('0x')
    ? new Uint8Array(Buffer.from(parsed.bookingId.slice(2), 'hex'))
    : bs58.decode(parsed.bookingId);
  if (tripIdBytes.length !== 32 || bookingIdBytes.length !== 32) {
    throw new Error('commit_booking(sol): tripId and bookingId must each decode to 32 bytes');
  }

  const quotedPrice = toUsdcMicro(parsed.vendorAmountUsdc) + toUsdcMicro(parsed.feeAmountUsdc);

  const ix = buildCommitBookingIx({
    operator,
    tripId: tripIdBytes,
    bookingId: bookingIdBytes,
    quotedPrice,
  });

  return {
    chain: 'sol' as const,
    tripId: bs58.encode(tripIdBytes),
    bookingId: bs58.encode(bookingIdBytes),
    quotedPriceMicro: quotedPrice.toString(),
    programId: SENDERO_GUEST_ESCROW_PROGRAM_ID.toBase58(),
    onchainInstructions: [
      {
        programId: ix.programId.toBase58(),
        accounts: ix.keys.map(k => ({
          pubkey: k.pubkey.toBase58(),
          isSigner: k.isSigner,
          isWritable: k.isWritable,
        })),
        data: Buffer.from(ix.data).toString('base64'),
      } satisfies SerializedSolanaIx,
    ],
    note: 'Submit via the Sendero Solana operator wallet. settle_booking finalizes after Duffel ticketing.',
  };
}

// ─── log_agent_action ──────────────────────────────────────────────

const logInput = z.object({
  tripId: hex32,
  actionType: z.enum(['search', 'chat', 'hold', 'commit', 'other']).default('other'),
  feeMicroUsdc: z.string().regex(/^\d+$/).default('0').describe('Micro-USDC (no decimal).'),
  escrowAddress: hex20.optional(),
});

export const logAgentActionTool: ToolDef = {
  name: 'log_agent_action',
  description:
    'Emit an on-chain breadcrumb for an agent action against a claimed trip. Used for x402 trace + ERC-8004 reputation aggregation. Optional — not required for a valid booking flow.',
  inputSchema: logInput,
  jsonSchema: {
    type: 'object',
    required: ['tripId'],
    properties: {
      tripId: { type: 'string' },
      actionType: {
        type: 'string',
        enum: ['search', 'chat', 'hold', 'commit', 'other'],
        default: 'other',
      },
      feeMicroUsdc: { type: 'string', default: '0' },
      escrowAddress: { type: 'string' },
    },
  },
  async handler(input) {
    const parsed = logInput.parse(input);
    const escrow = resolveEscrow(parsed.escrowAddress);
    const actionNum = ({ search: 0, chat: 1, hold: 2, commit: 3, other: 99 } as const)[
      parsed.actionType
    ];
    const { encodeFunctionData } = await import('viem');
    const data = encodeFunctionData({
      abi: SENDERO_GUEST_ESCROW_ABI,
      functionName: 'logAgentAction',
      args: [parsed.tripId as Hex, actionNum, BigInt(parsed.feeMicroUsdc)],
    });
    return {
      tripId: parsed.tripId,
      actionType: parsed.actionType,
      feeMicroUsdc: parsed.feeMicroUsdc,
      escrowAddress: escrow,
      onchainCall: { to: escrow, data, value: '0' },
    };
  },
};
