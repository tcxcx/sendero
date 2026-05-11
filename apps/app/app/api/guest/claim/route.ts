/**
 * POST /api/guest/claim
 *
 * Server-side guest claim — the /me-style replacement for the
 * passkey-controlled MSCA flow that used to live in /g/page.tsx.
 *
 * Flow:
 *   1. Parse the link fragment (chain-aware: `&c=sol` marker switches
 *      to base58 fields).
 *   2. Verify the email the guest typed matches the trip's stored
 *      `guestVerifiedContacts.email` (or the legacy
 *      `metadata.invite.guestEmail` shape). Mismatch → 403.
 *   3. Verify the 6-digit claim code if the trip was prefunded with 2FA.
 *   4. Upsert a User row keyed on email, source='invite' (no Clerk).
 *   5. Provision a Circle DCW via `ensureTravelerWallet` — same code
 *      path WhatsApp travelers go through.
 *   6. Dispatch to chain-specific submitter:
 *        - Arc:  submitArcClaim (Circle contractExecution from DCW)
 *        - Sol:  submitSolClaim (Anchor claim_trip via platform relayer,
 *                guestClaimant = the user's Sol DCW)
 *   7. Bind Trip.travelerId, mark invite claimed.
 *   8. Return { ok, redirectTo: '/me?welcome=1', txHash }.
 *
 * Custody change vs the old passkey flow: Sendero now custodies the
 * DCW that owns the trip. The guest never holds a key. This matches
 * the WhatsApp pattern and lets the guest land in /me immediately.
 */

import { type NextRequest, NextResponse } from 'next/server';

import { ensureTravelerWallet } from '@sendero/tools/ensure-traveler-wallet';
import { prisma, type Prisma } from '@sendero/database';
import type { Address, Hex } from 'viem';
import { z } from 'zod';

import { submitArcClaim } from '@/lib/guest-claim/arc';
import { submitSolClaim } from '@/lib/guest-claim/sol';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 90;

const BodySchema = z.object({
  /** Raw URL fragment string from window.location.hash (after `#`). */
  fragment: z.string().min(1),
  /** Guest-typed email — must match the trip's stored email. */
  email: z.string().email(),
  /** Display name shown in /me + future bookings. Optional. */
  displayName: z.string().min(1).max(80).optional(),
  /** E.164 phone for future WhatsApp/SMS. Optional. */
  phone: z
    .string()
    .regex(/^\+[1-9]\d{6,14}$/, 'phone must be E.164 (+15551234567)')
    .optional(),
  /** 6-digit OTP from the invite email. Required when the trip has
   *  2FA enabled (link fragment carries `&n=`). */
  claimCode: z
    .string()
    .regex(/^\d{6}$/)
    .optional(),
});

interface ParsedFragment {
  chain: 'arc' | 'sol';
  tripIdHex?: Hex;
  tripIdBytes?: Uint8Array;
  /** Arc: 0x… private key. Sol: base58 secret seed. */
  claimSecretHex?: Hex;
  claimSecretBase58?: string;
  claimPubkeyBase58?: string;
  claimCodeNonceHex?: Hex;
}

function parseFragment(fragment: string): ParsedFragment | null {
  // Accept either `#t=…&k=…` or already-stripped `t=…&k=…`.
  const params = new URLSearchParams(fragment.startsWith('#') ? fragment.slice(1) : fragment);
  const t = params.get('t');
  const k = params.get('k');
  const n = params.get('n') ?? undefined;
  const c = params.get('c') ?? undefined;
  const p = params.get('p') ?? undefined;
  if (!t || !k) return null;

  const isSol = c === 'sol';
  if (isSol) {
    // Sol fields are base58. Decode happens in the chain submitter.
    if (!p) {
      // Future-proofing: Sol links should also carry the claim pubkey
      // for verification before broadcast. Until prefundTripSolana
      // adds `&p=`, derive client-side.
    }
    return {
      chain: 'sol',
      claimSecretBase58: k,
      ...(p ? { claimPubkeyBase58: p } : {}),
      ...(n && /^0x[0-9a-fA-F]{64}$/.test(n) ? { claimCodeNonceHex: n as Hex } : {}),
      tripIdBytes: base58ToBytes(t),
    };
  }
  // Arc: enforce 32-byte hex.
  if (!/^0x[0-9a-fA-F]{64}$/.test(t) || !/^0x[0-9a-fA-F]{64}$/.test(k)) {
    return null;
  }
  return {
    chain: 'arc',
    tripIdHex: t as Hex,
    claimSecretHex: k as Hex,
    ...(n && /^0x[0-9a-fA-F]{64}$/.test(n) ? { claimCodeNonceHex: n as Hex } : {}),
  };
}

function base58ToBytes(value: string): Uint8Array {
  // Local decode to avoid an extra dep — alphabet matches Bitcoin/Sol.
  const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let bi = 0n;
  for (const ch of value) {
    const idx = ALPHABET.indexOf(ch);
    if (idx < 0) throw new Error(`invalid base58 char ${ch}`);
    bi = bi * 58n + BigInt(idx);
  }
  // Account for leading zeros (each '1' = leading zero byte).
  let leadingZeros = 0;
  for (const ch of value) {
    if (ch !== '1') break;
    leadingZeros += 1;
  }
  const bytes: number[] = [];
  while (bi > 0n) {
    bytes.unshift(Number(bi & 0xffn));
    bi >>= 8n;
  }
  return new Uint8Array([...new Array(leadingZeros).fill(0), ...bytes]);
}

function emailsMatch(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

interface TripContacts {
  email?: string;
  phone?: string;
}

function readTripEmail(trip: { guestVerifiedContacts: unknown; metadata: unknown }): string | null {
  const verified = (trip.guestVerifiedContacts ?? null) as TripContacts | null;
  if (verified?.email) return verified.email;
  const meta = trip.metadata as { invite?: { guestEmail?: string } } | null;
  return meta?.invite?.guestEmail ?? null;
}

export async function POST(req: NextRequest) {
  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      { error: 'invalid_input', issues: err instanceof z.ZodError ? err.issues : [] },
      { status: 400 }
    );
  }

  const parsed = parseFragment(body.fragment);
  if (!parsed) {
    return NextResponse.json(
      {
        error: 'invalid_fragment',
        message: 'Could not parse guest link. Make sure you opened the full URL.',
      },
      { status: 400 }
    );
  }

  // Resolve the trip. The off-chain Trip.id IS the on-chain tripId
  // (the prefund tool writes both equal). For Sol, we don't have an
  // off-chain mapping yet — fall back to scanning by metadata. For
  // now, only Arc lookups are wired; Sol claims must include the trip
  // metadata in the link or rely on the Trip row being present.
  const tripIdString = parsed.chain === 'arc' ? parsed.tripIdHex! : await solTripLookupKey(parsed);
  if (!tripIdString) {
    return NextResponse.json(
      { error: 'trip_not_found', message: 'No trip matches the link.' },
      { status: 404 }
    );
  }
  const trip = await prisma.trip.findUnique({
    where: { id: tripIdString },
    select: {
      id: true,
      tenantId: true,
      status: true,
      travelerId: true,
      metadata: true,
      guestVerifiedContacts: true,
      tenant: { select: { primaryChain: true } },
    },
  });
  if (!trip) {
    return NextResponse.json(
      { error: 'trip_not_found', message: 'No trip matches the link.' },
      { status: 404 }
    );
  }

  // Email gate — the most important auth boundary in this flow. The
  // ephemeral claim key in the URL fragment is bearer-equivalent, so
  // anyone who scrapes a forwarded email could grab it. Requiring the
  // guest to type the same email the buyer addressed the invite to
  // narrows the threat to people who control the inbox.
  const expectedEmail = readTripEmail(trip);
  if (!expectedEmail) {
    return NextResponse.json(
      {
        error: 'invite_missing_email',
        message:
          'This invite has no recorded recipient email — ask the sender to re-issue the invite.',
      },
      { status: 422 }
    );
  }
  if (!emailsMatch(expectedEmail, body.email)) {
    return NextResponse.json(
      {
        error: 'email_mismatch',
        message: 'That email does not match the invite recipient.',
      },
      { status: 403 }
    );
  }

  // 2FA gate — when the link carries &n=, the trip was prefunded with
  // require2fa=true. The matching 6-digit code is in the invite email
  // body, NOT in the URL. We don't store the code server-side; the
  // chain contract recomputes the preimage hash and compares to the
  // stored hash on-chain. The check below is a fast-fail UX so the
  // user gets a friendly error before we burn gas.
  if (parsed.claimCodeNonceHex && !body.claimCode) {
    return NextResponse.json(
      {
        error: 'claim_code_required',
        message: 'This invite requires the 6-digit code from your email.',
      },
      { status: 400 }
    );
  }

  // Upsert User by email. Travelers claiming via /g have no Clerk
  // identity. Mirror the WhatsApp pattern: source='invite', no
  // clerkUserId; if they later sign in via Clerk with the same email,
  // the webhook handler claims this row (`source` flips to 'native').
  const user = await prisma.user.upsert({
    where: { email: body.email },
    create: {
      email: body.email,
      displayName: body.displayName ?? null,
      phone: body.phone ?? null,
      // `guest` mirrors the prefund pattern (`source: 'invite'` was
      // never an enum value; the schema's UserSource only has
      // `native | slack | whatsapp | guest`). When the same email
      // later signs in via Clerk, the webhook flips the row to
      // `native` and writes the clerkUserId.
      source: 'guest',
    },
    update: {
      ...(body.displayName ? { displayName: body.displayName } : {}),
      ...(body.phone ? { phone: body.phone } : {}),
    },
    select: { id: true, email: true, displayName: true },
  });

  const wallet = await ensureTravelerWallet({ userId: user.id });
  if (!wallet?.address || !wallet.circleWalletId) {
    return NextResponse.json(
      {
        error: 'wallet_provision_failed',
        message:
          'Could not provision your Sendero wallet. Try again in a minute; if it persists, contact support.',
      },
      { status: 503 }
    );
  }

  // Chain dispatch.
  const isSolPrimary = trip.tenant.primaryChain === 'sol' || parsed.chain === 'sol';
  let txHash: string;
  let onchainState = 'CONFIRMED';
  let guestWalletForLog: string;
  try {
    if (isSolPrimary) {
      const solDcw = await prisma.wallet.findFirst({
        where: { userId: user.id, provisioner: 'dcw', chainId: 5 },
        select: { address: true },
      });
      if (!solDcw?.address) {
        return NextResponse.json(
          {
            error: 'sol_dcw_pending',
            message:
              'Your Solana wallet is still being created. Refresh in 5 seconds and try again.',
          },
          { status: 503 }
        );
      }
      if (!parsed.tripIdBytes || !parsed.claimSecretBase58) {
        return NextResponse.json(
          {
            error: 'invalid_fragment_sol',
            message: 'Solana invite link is missing claim metadata — ask the sender to re-issue.',
          },
          { status: 400 }
        );
      }
      // Defense-in-depth: if the trip row stored the claim pubkey at
      // prefund time, compare against the derived one. The on-chain
      // handler enforces match regardless; this just fails fast.
      const tripMetaForSol =
        trip.metadata && typeof trip.metadata === 'object' && !Array.isArray(trip.metadata)
          ? (trip.metadata as { escrow?: { claimPubKey?: string } })
          : null;
      const storedClaimPubkey = tripMetaForSol?.escrow?.claimPubKey;
      const r = await submitSolClaim({
        dcwSolanaAddress: solDcw.address,
        tripId: parsed.tripIdBytes,
        claimSecretKeyBase58: parsed.claimSecretBase58,
        ...(storedClaimPubkey ? { claimPubkeyBase58: storedClaimPubkey } : {}),
        ...(body.claimCode ? { claimCode: body.claimCode } : {}),
        ...(parsed.claimCodeNonceHex ? { claimCodeNonceHex: parsed.claimCodeNonceHex } : {}),
      });
      txHash = r.txSignature;
      guestWalletForLog = r.guestClaimant;
    } else {
      const escrow = (process.env.NEXT_PUBLIC_SENDERO_GUEST_ESCROW ??
        process.env.NEXT_PUBLIC_ARC_ESCROW_ADDRESS) as Address | undefined;
      if (!escrow) {
        return NextResponse.json(
          { error: 'escrow_not_configured', message: 'NEXT_PUBLIC_SENDERO_GUEST_ESCROW not set.' },
          { status: 500 }
        );
      }
      const r = await submitArcClaim({
        dcwWalletId: wallet.circleWalletId,
        dcwAddress: wallet.address as Address,
        escrow,
        tripId: parsed.tripIdHex!,
        claimPrivateKey: parsed.claimSecretHex!,
        ...(parsed.claimCodeNonceHex ? { claimCodeNonce: parsed.claimCodeNonceHex } : {}),
        ...(body.claimCode ? { claimCode: body.claimCode } : {}),
        idempotencyKey: crypto.randomUUID(),
      });
      txHash = r.txHash;
      onchainState = r.state;
      guestWalletForLog = r.guestWallet;
    }
  } catch (err) {
    console.error('[guest/claim] on-chain submission failed', {
      tripId: trip.id,
      chain: parsed.chain,
      err: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      {
        error: 'onchain_submission_failed',
        message: err instanceof Error ? err.message : String(err),
      },
      { status: 502 }
    );
  }

  // Bind trip → user + record the claim outcome on the trip row so
  // the operator dashboard reflects it. Status flips to 'claimed' —
  // downstream booking workflows wait on this transition.
  const metadata = (
    trip.metadata && typeof trip.metadata === 'object' && !Array.isArray(trip.metadata)
      ? (trip.metadata as Record<string, unknown>)
      : {}
  ) as Record<string, unknown>;
  // `TripStatus` enum has no `claimed`; leave status untouched and let
  // booking flows transition it from here. The `metadata.claim` stamp
  // is the canonical "trip is claimed by traveler X" signal.
  await prisma.trip.update({
    where: { id: trip.id },
    data: {
      travelerId: user.id,
      metadata: {
        ...metadata,
        claim: {
          guestWallet: guestWalletForLog,
          txHash,
          state: onchainState,
          claimedAt: new Date().toISOString(),
          chain: parsed.chain,
        },
      } as Prisma.InputJsonValue,
    },
  });

  return NextResponse.json({
    ok: true,
    txHash,
    state: onchainState,
    guestWallet: guestWalletForLog,
    redirectTo: '/me?welcome=1',
  });
}

/**
 * For Sol trips, the off-chain Trip.id was written using the same
 * base58 trip id as the on-chain ix. Until we add a dedicated lookup
 * column, scan Trips by metadata. For Arc trips this isn't needed
 * because the on-chain hex id IS the Trip.id.
 */
async function solTripLookupKey(parsed: ParsedFragment): Promise<string | null> {
  if (!parsed.tripIdBytes) return null;
  // Sol prefund writes the base58 tripId as the Trip.id directly
  // (verified live earlier: returned `tripId: "5FfUDCN6hJ85F5MpBZcc652RYRpzjjSndriiQbZdTiX"`).
  // Re-encode bytes → base58 to match the row id.
  return bytesToBase58(parsed.tripIdBytes);
}

function bytesToBase58(bytes: Uint8Array): string {
  const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let bi = 0n;
  for (const b of bytes) bi = (bi << 8n) | BigInt(b);
  let out = '';
  while (bi > 0n) {
    const idx = Number(bi % 58n);
    out = ALPHABET[idx] + out;
    bi /= 58n;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    out = '1' + out;
  }
  return out || '1';
}
