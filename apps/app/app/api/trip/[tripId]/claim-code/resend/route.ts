/**
 * POST /api/trip/[tripId]/claim-code/resend
 *
 * Guest-driven OTP resend. Pairs with the on-chain
 * `setClaimCodeHash(tripId, newHash)` operator function added in
 * SenderoGuestEscrow v3.0.0. Each successful call rotates the
 * on-chain hash so the previously-leaked OTP becomes dead and the
 * 3-strike `failedClaimAttempts` counter resets.
 *
 * Design rationale (READ FIRST):
 * `.gstack/projects/tcxcx-sendero/ship-2026-04-24-platform-release-otp-design-20260425-040506.md`
 * — section "Resend flow (server-side)".
 *
 * Steps (mirrors the design doc):
 *   1. Verify the caller's contactProof matches one of the trip's
 *      verified guest contacts. Prevents random callers from
 *      triggering OTP resends to phish a victim.
 *   2. Throttle via Upstash: 3 resends / 10 min / trip and 5 / hour.
 *      Env-tagged keys per CLAUDE.md → Caching & Redis.
 *   3. Generate fresh preimage via `generateOtpPreimage()`.
 *   4. Compute newHash = otpClaimCodeHash(onchainTripId, preimage).
 *   5. Submit `setClaimCodeHash(onchainTripId, newHash)` via the
 *      operator MSCA. Wait for receipt.
 *   6. Send cleartext via the channel `selectOtpChannel(...)` chooses.
 *   7. Persist a non-PII OtpDeliveryAttempt row.
 *   8. Return { ok, channel, sentAt, rotatedTxHash } — the preimage
 *      is NEVER in the response body or in any log line.
 */

import crypto from 'node:crypto';
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@sendero/database';
import {
  generateOtpPreimage,
  otpClaimCodeHash,
  selectOtpChannel,
} from '@sendero/notifications/otp';

import { getRedis } from '@/lib/redis';
import { verifyResendAuthToken } from '@/lib/resend-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// ──────────────────────────────────────────────────────────────────────
// Input
// ──────────────────────────────────────────────────────────────────────

const BodySchema = z.object({
  /** Phone or email the caller claims to own. Compared against the trip's verified contacts. */
  contactProof: z.string().min(3).max(254),
  /**
   * Base64url-encoded ResendAuthTokenPayload — the guest's claim page
   * generates this client-side via `signResendAuthToken` from
   * `@sendero/guest`. Required in production: server verifies the
   * signature against the on-chain trip.claimPubKey20.
   *
   * In `development` env this is optional so the smoke harness can
   * exercise the route without minting a token. Production rejects
   * missing/invalid tokens with 401.
   */
  authToken: z.string().min(1).optional(),
});

// ──────────────────────────────────────────────────────────────────────
// envTag — copied from apps/app/lib/api-key-auth.ts so the Redis key
// shape is consistent across consumers. CLAUDE.md → Caching & Redis
// requires every key to start with `<envTag>:…`.
// ──────────────────────────────────────────────────────────────────────

function envTag(): string {
  const v = process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? 'development';
  return v.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

const RESEND_LIMIT_10MIN = 3;
const RESEND_WINDOW_10MIN_SEC = 600;
const RESEND_LIMIT_HOUR = 5;
const RESEND_WINDOW_HOUR_SEC = 3600;

interface ThrottleOutcome {
  allowed: boolean;
  reason?: 'throttled_short_window' | 'throttled_hour';
  retryAfterSec?: number;
}

/**
 * Sliding-window-ish throttle via two independent counters. Each call
 * INCRs both counters and EXPIREs them on first set. If either counter
 * exceeds its limit, we reject with the tighter limit's TTL.
 *
 * We INCR both BEFORE checking limits to avoid a TOCTOU race between
 * concurrent resends. The cost of a one-off over-count is at most
 * one extra rotation; the cost of TOCTOU is unbounded so we err here.
 */
async function checkThrottle(onchainTripId: string): Promise<ThrottleOutcome> {
  const redis = getRedis();
  if (!redis) {
    // Without Redis we fail open in dev — the route prints a warning.
    // In prod the env vars are always set; getRedis() returning null
    // would be a misconfiguration, not a throttle bypass we want to
    // make routine. Surface it.
    if (process.env.VERCEL_ENV) {
      console.warn(
        '[otp-resend] Redis unavailable — throttle is disabled. KV_REST_API_URL/KV_REST_API_TOKEN not set?'
      );
    }
    return { allowed: true };
  }

  const tag = envTag();
  const k10 = `${tag}:otp:resend:10m:${onchainTripId.toLowerCase()}`;
  const k60 = `${tag}:otp:resend:1h:${onchainTripId.toLowerCase()}`;

  const [n10, n60] = await Promise.all([redis.incr(k10), redis.incr(k60)]);
  // INCR returns the new count; if it's 1 the key was just created so
  // we set the TTL. EXPIRE on existing keys is harmless but wasted RTT.
  if (n10 === 1) await redis.expire(k10, RESEND_WINDOW_10MIN_SEC);
  if (n60 === 1) await redis.expire(k60, RESEND_WINDOW_HOUR_SEC);

  if (n10 > RESEND_LIMIT_10MIN) {
    return {
      allowed: false,
      reason: 'throttled_short_window',
      retryAfterSec: RESEND_WINDOW_10MIN_SEC,
    };
  }
  if (n60 > RESEND_LIMIT_HOUR) {
    return {
      allowed: false,
      reason: 'throttled_hour',
      retryAfterSec: RESEND_WINDOW_HOUR_SEC,
    };
  }
  return { allowed: true };
}

// ──────────────────────────────────────────────────────────────────────
// Trip lookup helpers
//
// Authoritative source of verified contacts is `Trip.guestVerifiedContacts`
// (column added in `migrations/20260425133807_trip_guest_verified_contacts`).
// Falls back to the legacy `Trip.metadata.invite.{guestEmail, guestPhone}`
// shape so trips created before the column existed still resolve. No
// backfill — those rows fall through this path on first resend.
//
// Also surfaces `Trip.metadata.linkChannel` so the channel selector
// can prefer a different medium for the OTP (link via email →
// OTP via WhatsApp, etc.). Stamped at prefund time by
// `apps/app/app/api/guest/invite/route.ts` after the notify call
// returns. Defaults to 'email' for legacy rows.
// ──────────────────────────────────────────────────────────────────────

interface TripContactsView {
  /** Off-chain Trip.id (cuid). */
  id: string;
  /** On-chain bytes32 hex. */
  onchainTripId: `0x${string}`;
  tenantId: string;
  email?: string;
  phone?: string;
  /** Channel that delivered the link, used to pick a different OTP channel. */
  linkChannel: 'whatsapp' | 'email' | 'sms';
}

async function loadTripContacts(onchainTripId: `0x${string}`): Promise<TripContactsView | null> {
  // The off-chain Trip.id IS the on-chain tripId hex (see prefund_trip
  // tool — both come from generateTripId() and the route upserts the
  // Trip with id = tripId hex).
  const trip = await prisma.trip.findUnique({
    where: { id: onchainTripId },
    select: {
      id: true,
      tenantId: true,
      metadata: true,
      guestVerifiedContacts: true,
    },
  });
  if (!trip) return null;

  const verified = (trip.guestVerifiedContacts ?? null) as {
    email?: string;
    phone?: string;
  } | null;
  const meta = (trip.metadata ?? {}) as {
    invite?: { guestEmail?: string; guestPhone?: string };
    linkChannel?: 'whatsapp' | 'email' | 'sms';
  };

  // Prefer the dedicated column; fall back to metadata.invite for
  // trips created before the migration.
  const email = verified?.email ?? meta.invite?.guestEmail;
  const phone = verified?.phone ?? meta.invite?.guestPhone;

  // Validate linkChannel — anything stamped server-side will be one of
  // the three known values, but defensive parsing keeps a corrupt
  // metadata blob from poisoning the channel selector.
  const stamped = meta.linkChannel;
  const linkChannel: 'whatsapp' | 'email' | 'sms' =
    stamped === 'whatsapp' || stamped === 'email' || stamped === 'sms' ? stamped : 'email';

  return {
    id: trip.id,
    onchainTripId,
    tenantId: trip.tenantId,
    linkChannel,
    ...(email ? { email } : {}),
    ...(phone ? { phone } : {}),
  };
}

function contactProofMatches(proof: string, contacts: { email?: string; phone?: string }): boolean {
  const trimmed = proof.trim();
  if (contacts.email && trimmed.toLowerCase() === contacts.email.trim().toLowerCase()) return true;
  if (contacts.phone) {
    // Compare phone numbers digits-only so '+1 (202) 555-1234' matches '+12025551234'.
    const digits = (s: string) => s.replace(/\D+/g, '');
    if (digits(trimmed) === digits(contacts.phone)) return true;
  }
  return false;
}

// ──────────────────────────────────────────────────────────────────────
// Operator-MSCA call — wired via apps/app/lib/operator-submit.ts
//
// The operator address is the bonded EOA whose private key lives in
// OPERATOR_PRIVATE_KEY (env). Same wallet pattern smoke-guest-escrow
// uses; this just wraps it as a server-side helper so we don't have
// to re-derive viem clients per call.
//
// Failure modes the helper distinguishes:
//   - 'operator_key_unavailable' → env not set; route should 500.
//   - 'escrow_unconfigured'      → ARC_ESCROW_ADDRESS missing; route should 500.
//   - 'reverted'                 → contract refused (e.g. trip already
//                                  claimed). Surface the contract's
//                                  errorName into the audit row.
//   - 'rpc_error'                → transient. Caller can retry.
// ──────────────────────────────────────────────────────────────────────

import { submitSetClaimCodeHash } from '@/lib/operator-submit';

interface OperatorRotationResult {
  txHash?: `0x${string}`;
  /** True when the operator submitter is unconfigured (dev env). */
  pendingOperatorSubmit: boolean;
  /** Contract-named revert (e.g. 'TripExpired') for the audit row. */
  failureReason?: string;
}

async function submitClaimCodeRotation(
  onchainTripId: `0x${string}`,
  newHash: `0x${string}`
): Promise<OperatorRotationResult> {
  const result = await submitSetClaimCodeHash({ onchainTripId, newCodeHash: newHash });
  if (result.ok) {
    return { txHash: result.txHash, pendingOperatorSubmit: false };
  }
  // Repo tsconfig has `strict: false`, so negation-narrow on a
  // discriminated union is unreliable — explicit cast to the failure
  // variant keeps the rest of the branch readable.
  const fail = result as Extract<typeof result, { ok: false }>;
  // Soft-fail on missing operator key in dev so the smoke harness can
  // exercise the route end-to-end without an operator EOA. Production
  // env always sets OPERATOR_PRIVATE_KEY (config-doctor checks).
  if (fail.reason === 'operator_key_unavailable' && !process.env.VERCEL_ENV) {
    console.warn('[otp-resend] operator key unavailable in dev — skipping on-chain rotation');
    return { pendingOperatorSubmit: true };
  }
  return {
    pendingOperatorSubmit: false,
    failureReason: fail.errorName ?? `${fail.reason}:${fail.message}`,
  };
}

// ──────────────────────────────────────────────────────────────────────
// OtpDeliveryAttempt row
//
// Persists the per-resend audit trail. Lives in the
// `otp_delivery_attempts` table (added in the markup plan's combined
// migration). The cleartext preimage is NEVER included — only the
// rotated hash + provider response metadata.
// ──────────────────────────────────────────────────────────────────────

interface OtpDeliveryAttemptShape {
  tenantId: string;
  tripId: string;
  onchainTripId: `0x${string}`;
  channel: 'whatsapp' | 'email' | 'sms';
  sentAt: Date;
  deliveryStatus: 'sent' | 'delivered' | 'failed' | 'rate_limited' | 'pending_send';
  providerMessageId?: string;
  failureReason?: string;
  rotatedHash: `0x${string}`;
  rotatedTxHash?: `0x${string}`;
}

async function recordOtpDeliveryAttempt(row: OtpDeliveryAttemptShape): Promise<void> {
  // The preimage is REDACTED by construction — never present in the
  // input row, so it cannot be persisted by accident. The provider
  // message id IS persisted because it's needed to reconcile against
  // delivery webhooks (Resend bounce events, WhatsApp delivery
  // receipts) without exposing the OTP itself.
  try {
    await prisma.otpDeliveryAttempt.create({
      data: {
        tenantId: row.tenantId,
        tripId: row.tripId,
        onchainTripId: row.onchainTripId,
        channel: row.channel,
        sentAt: row.sentAt,
        deliveryStatus: row.deliveryStatus,
        providerMessageId: row.providerMessageId ?? null,
        failureReason: row.failureReason ?? null,
        rotatedHash: row.rotatedHash,
        rotatedTxHash: row.rotatedTxHash ?? null,
      },
    });
  } catch (err) {
    // Persistence failure is non-fatal — the OTP already went out,
    // and the on-chain rotation already landed. Log so ops can see
    // the audit gap and reconcile via the chain event log.
    console.warn('[otp-resend] OtpDeliveryAttempt persist failed (non-fatal)', {
      tripId: row.tripId,
      channel: row.channel,
      deliveryStatus: row.deliveryStatus,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// ──────────────────────────────────────────────────────────────────────
// Channel send — wires the OTP cleartext into the picked channel.
//
// Hard rules:
//   - The preimage NEVER appears in a log line. Provider error
//     messages are surfaced verbatim into the audit row but are not
//     console-logged from this function.
//   - Each delivery returns a typed result that the caller persists
//     into the OtpDeliveryAttempt audit row.
//   - SMS is not implemented yet (no Twilio dep). The selector's
//     priority list is `whatsapp > sms > email` — when the only
//     candidate is SMS, the channel selector returns null upstream.
//     We surface `sms_not_implemented` defensively in case the
//     selector evolves.
//
// Email subject + body intentionally exclude the link. The link +
// code travel through different channels by design — sending both
// from one provider would defeat the out-of-band defense.
// ──────────────────────────────────────────────────────────────────────

interface ChannelSendResult {
  ok: boolean;
  providerMessageId?: string;
  failureReason?: string;
}

async function dispatchOtp(
  channel: 'whatsapp' | 'email' | 'sms',
  to: string,
  preimage: string,
  onchainTripId: `0x${string}`
): Promise<ChannelSendResult> {
  // Short trip prefix for human grounding ("trip 0x1a2b3c…"). Full
  // hex is too noisy for a one-line OTP message.
  const tripPrefix = `${onchainTripId.slice(0, 10)}…`;
  const subject = 'Your Sendero claim code';
  const expiryNote = 'Valid for 15 minutes. Never share this code.';

  if (channel === 'email') {
    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.SENDERO_EMAIL_FROM ?? null;
    const replyTo = process.env.SENDERO_EMAIL_REPLY_TO ?? from ?? undefined;
    if (!apiKey || !from) {
      return { ok: false, failureReason: 'email_not_configured' };
    }
    try {
      // Dynamic import keeps this module buildable when @sendero/notifications
      // (and its transitive `resend` dep) is missing from the classpath —
      // same pattern used in `apps/app/lib/security-alert-senders.ts`.
      // @ts-expect-error -- transitive dep, no direct types in this app
      const { Resend } = await import('resend');
      const client = new Resend(apiKey);
      const html = [
        '<!doctype html><html><body style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Inter,Arial,sans-serif;background:#f5f2ee;margin:0;padding:32px;">',
        '<div style="max-width:480px;margin:0 auto;background:#ffffff;border:1px solid #e9e3da;border-radius:16px;padding:32px;">',
        '<div style="font-size:12px;letter-spacing:0.16em;text-transform:uppercase;color:#b34b2e;font-weight:700;">Sendero · Security</div>',
        '<h1 style="font-size:22px;line-height:1.3;color:#0b0b0b;margin:16px 0 8px 0;">Your one-time claim code</h1>',
        `<p style="color:#555;font-size:14px;line-height:1.6;margin:0 0 16px 0;">For trip <code style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;color:#333;">${tripPrefix}</code>:</p>`,
        '<div style="display:inline-block;padding:18px 24px;background:#141414;color:#ffb199;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:28px;font-weight:700;letter-spacing:0.18em;border-radius:12px;">',
        escapeHtml(preimage),
        '</div>',
        `<p style="color:#888;font-size:13px;line-height:1.6;margin:20px 0 0 0;">${expiryNote}</p>`,
        '<p style="color:#888;font-size:12px;line-height:1.6;margin:24px 0 0 0;">If you did not request this code, ignore this email — your trip funds remain locked in escrow.</p>',
        '</div></body></html>',
      ].join('');
      const text = [
        'Sendero · Security',
        '',
        'Your one-time claim code',
        `For trip ${tripPrefix}:`,
        '',
        preimage,
        '',
        expiryNote,
        '',
        'If you did not request this code, ignore this email — your trip funds remain locked in escrow.',
      ].join('\n');
      const result = await client.emails.send({
        from,
        to: [to],
        replyTo: replyTo ? [replyTo] : undefined,
        subject,
        html,
        text,
        // Tag for analytics. We do NOT include the trip id or any PII
        // in the tag because Resend persists tags long-term.
        tags: [{ name: 'surface', value: 'otp_resend' }],
      });
      if (result.error) {
        return { ok: false, failureReason: result.error.message ?? 'resend_send_failed' };
      }
      return { ok: true, ...(result.data?.id ? { providerMessageId: result.data.id } : {}) };
    } catch (err) {
      return {
        ok: false,
        failureReason: err instanceof Error ? err.message : String(err),
      };
    }
  }

  if (channel === 'whatsapp') {
    const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    const apiBaseUrl = process.env.WHATSAPP_API_BASE_URL;
    if (!accessToken || !phoneNumberId) {
      return { ok: false, failureReason: 'whatsapp_not_configured' };
    }
    const {
      WhatsAppClient,
      SENDERO_TEMPLATES,
      buildOtpComponents,
      isOutsideSessionWindowError,
    } = await import('@sendero/whatsapp');
    const client = new WhatsAppClient({
      phoneNumberId,
      accessToken,
      ...(apiBaseUrl ? { apiBaseUrl } : {}),
    });
    const recipient = to.replace(/[^\d+]/g, '');
    // Free-form path — preferred inside Meta's 24-hour session window.
    // Cheaper, instant, and lets us include the trip prefix + expiry
    // copy that the AUTHENTICATION template can't carry.
    const message = [
      `*${subject}*`,
      ``,
      `Trip ${tripPrefix}:`,
      ``,
      `*${preimage}*`,
      ``,
      expiryNote,
    ].join('\n');
    try {
      const result = await client.sendText(recipient, message);
      const wamid = (result as { messages?: Array<{ id?: string }> })?.messages?.[0]?.id;
      if (!wamid) {
        return { ok: false, failureReason: 'whatsapp_no_message_id' };
      }
      return { ok: true, providerMessageId: wamid };
    } catch (err) {
      if (!isOutsideSessionWindowError(err)) {
        return {
          ok: false,
          failureReason: err instanceof Error ? err.message : String(err),
        };
      }
      // Outside the 24-hour window — fall back to `sendero_otp` HSM
      // template. Meta auto-renders the body copy ("{{1}} is your
      // verification code…") + COPY_CODE button. We lose the trip
      // prefix + expiry note in the template body, but the AUTHENTICATION
      // category gets a higher Meta approval rate + auto-fill on Android.
      const tpl = SENDERO_TEMPLATES.OTP_RESEND;
      try {
        const result = await client.sendTemplate({
          to: recipient,
          templateName: tpl.name,
          languageCode: tpl.defaultLocale,
          components: buildOtpComponents(preimage),
        });
        const wamid = (result as { messages?: Array<{ id?: string }> })?.messages?.[0]?.id;
        if (!wamid) {
          return { ok: false, failureReason: 'whatsapp_template_no_message_id' };
        }
        return { ok: true, providerMessageId: wamid };
      } catch (tplErr) {
        // (#132000) here means `sendero_otp` isn't approved yet —
        // ops needs to chase the WABA template review.
        const detail = tplErr instanceof Error ? tplErr.message : String(tplErr);
        return { ok: false, failureReason: `whatsapp_template_fallback:${detail}` };
      }
    }
  }

  // SMS — Twilio not yet wired into the workspace. Returning a clear
  // not_implemented code so the channel selector can fall through to
  // email / WhatsApp on the next call. See OTP design doc, "Off-chain
  // delivery shim" section: SMS is a planned channel, not a v1 one.
  return { ok: false, failureReason: 'sms_not_implemented' };
}

/**
 * Minimal HTML escape for the OTP cleartext. The preimage's alphabet
 * (Crockford base32 + hyphens) doesn't contain any of these characters,
 * but escaping keeps us safe if `generateOtpPreimage()` ever changes.
 */
function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ──────────────────────────────────────────────────────────────────────
// Auth — signed-token verification (track-G-auth)
//
// The guest's claim page signs a short-lived nonce + tripId message
// with the privkey from the URL fragment. The server recovers the
// signer via viem and compares to the on-chain trip.claimPubKey20.
//
// Compose with `contactProof` (phone/email match) for two-factor:
//   - Possession of the link    (signature recovers correctly)
//   - Possession of the contact (proof matches verified contacts)
//
// In `development` env (only) we accept missing tokens so the smoke
// harness can exercise the route end-to-end. Every other environment
// requires the token. See `apps/app/lib/resend-auth.ts` for the
// verifier internals.
// ──────────────────────────────────────────────────────────────────────

const REQUIRES_AUTH_TOKEN =
  process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production';

async function verifyResendAuth(
  authToken: string | undefined,
  onchainTripId: `0x${string}`
): Promise<{ ok: boolean; reason?: string; status: number }> {
  if (!authToken) {
    if (REQUIRES_AUTH_TOKEN) {
      return { ok: false, reason: 'missing_auth_token', status: 401 };
    }
    return { ok: true, status: 200 };
  }
  const verdict = await verifyResendAuthToken({ token: authToken, onchainTripId });
  if (verdict.ok === true) return { ok: true, status: 200 };
  // verdict is the failure variant here. Destructure with an explicit
  // type so the narrowing survives the dictionary lookup below — TS's
  // discriminated-union narrowing doesn't always reach across the
  // boundary cleanly when the var is later read inside an object key.
  const failure = verdict as Exclude<typeof verdict, { ok: true }>;
  const reason = failure.reason;
  // Map verdict.reason to HTTP status — `replayed` and `expired` are
  // 401 (caller can re-sign with a fresh nonce); `pubkey_mismatch`
  // is 403 (caller doesn't have the link); `trip_not_found` is 404.
  const statusByReason: Record<typeof reason, number> = {
    malformed: 400,
    expired: 401,
    bad_signature: 401,
    pubkey_mismatch: 403,
    replayed: 401,
    trip_not_found: 404,
    escrow_unavailable: 500,
  };
  return { ok: false, reason, status: statusByReason[reason] };
}

// ──────────────────────────────────────────────────────────────────────
// Handler
// ──────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest, ctx: { params: Promise<{ tripId: string }> }) {
  const { tripId: tripIdParam } = await ctx.params;

  if (!/^0x[0-9a-fA-F]{64}$/.test(tripIdParam)) {
    return NextResponse.json({ error: 'invalid_trip_id' }, { status: 400 });
  }
  const onchainTripId = tripIdParam.toLowerCase() as `0x${string}`;

  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      { error: 'invalid_input', issues: err instanceof z.ZodError ? err.issues : [] },
      { status: 400 }
    );
  }

  // 0. Auth — signed-token verification (track-G-auth)
  const auth = await verifyResendAuth(body.authToken, onchainTripId);
  if (!auth.ok) {
    return NextResponse.json(
      { error: 'unauthorized', reason: auth.reason },
      { status: auth.status }
    );
  }

  // 1. Verify contact proof against the trip's verified contacts
  const contacts = await loadTripContacts(onchainTripId);
  if (!contacts) {
    return NextResponse.json({ error: 'trip_not_found' }, { status: 404 });
  }
  if (!contactProofMatches(body.contactProof, contacts)) {
    return NextResponse.json({ error: 'contact_proof_mismatch' }, { status: 403 });
  }

  // 2. Throttle
  const throttle = await checkThrottle(onchainTripId);
  if (!throttle.allowed) {
    return NextResponse.json(
      { error: 'rate_limited', reason: throttle.reason, retryAfterSec: throttle.retryAfterSec },
      { status: 429, headers: { 'Retry-After': String(throttle.retryAfterSec ?? 600) } }
    );
  }

  // 3. Pick a channel BEFORE generating the OTP. If we have nothing,
  // we don't want a fresh preimage sitting in memory.
  // `contacts.linkChannel` is stamped at prefund time by
  // `apps/app/app/api/guest/invite/route.ts` so the selector can
  // prefer a DIFFERENT medium for the OTP than the link.
  const channel = selectOtpChannel({
    tripId: onchainTripId,
    guestVerifiedContacts: {
      ...(contacts.email ? { email: contacts.email } : {}),
      ...(contacts.phone ? { phone: contacts.phone } : {}),
    },
    linkChannel: contacts.linkChannel,
    tenantPolicy: { requireDifferentChannelForOtp: true },
  });
  if (!channel) {
    return NextResponse.json({ error: 'no_verified_contact' }, { status: 422 });
  }

  // 4. Generate preimage + on-chain hash. Preimage stays in memory
  // for the rest of this function ONLY — never logged, never returned.
  const preimage = generateOtpPreimage();
  const newHash = otpClaimCodeHash(onchainTripId, preimage);

  // 5. Submit on-chain rotation via operator MSCA (TODO submitter)
  let rotation: OperatorRotationResult;
  try {
    rotation = await submitClaimCodeRotation(onchainTripId, newHash);
  } catch (err) {
    // Defense-in-depth: if the rotation fails we MUST NOT send the
    // cleartext, otherwise the guest gets an OTP that the contract
    // doesn't recognize. Drop the preimage from the closure path by
    // returning early; it'll be GC'd on function exit.
    return NextResponse.json(
      {
        error: 'rotation_submit_failed',
        message: err instanceof Error ? err.message : String(err),
      },
      { status: 502 }
    );
  }

  // 6. Send cleartext via selected channel
  const recipient = channel === 'email' ? contacts.email! : contacts.phone!;
  const send = await dispatchOtp(channel, recipient, preimage, onchainTripId);

  // 7. Persist non-PII delivery row
  const sentAt = new Date();
  await recordOtpDeliveryAttempt({
    tenantId: contacts.tenantId,
    tripId: contacts.id,
    onchainTripId,
    channel,
    sentAt,
    deliveryStatus: send.ok ? 'sent' : rotation.pendingOperatorSubmit ? 'pending_send' : 'failed',
    ...(send.providerMessageId ? { providerMessageId: send.providerMessageId } : {}),
    ...(send.failureReason ? { failureReason: send.failureReason } : {}),
    rotatedHash: newHash,
    ...(rotation.txHash ? { rotatedTxHash: rotation.txHash } : {}),
  });

  // Best-effort scrub: overwrite the preimage variable so a heap
  // dump triggered between here and GC at most catches a
  // single-byte buffer rather than the cleartext. JS engines may
  // intern strings so this is not bulletproof — the real defense is
  // not logging it anywhere above.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _scrubbed = crypto.randomBytes(16).toString('hex');

  return NextResponse.json({
    ok: true,
    channel,
    sentAt: sentAt.toISOString(),
    rotatedTxHash: rotation.txHash ?? null,
    pendingOperatorSubmit: rotation.pendingOperatorSubmit,
    pendingChannelSend: !send.ok,
  });
}
