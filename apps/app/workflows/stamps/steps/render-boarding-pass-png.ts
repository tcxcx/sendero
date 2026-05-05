/**
 * Render the redacted Satori boarding-pass PNG for the BoardingPass NFT.
 *
 * Replaces the Gemini-generated stamp art for `kind === 'BoardingPass'`.
 * Why: the Satori boarding pass is a real, factual depiction of the
 * actual flight (route, date, carrier, cabin, total). Pinning it to
 * IPFS as the NFT image means the on-chain proof matches the WhatsApp
 * card the traveler already received — one canonical artifact instead
 * of two unrelated ones (a card + an unrelated AI illustration).
 *
 * Privacy: this PNG ends up on a public IPFS gateway, indexed by NFT
 * marketplaces and resolvable by anyone with the contract address +
 * tokenId. Strip every field that identifies the individual traveler
 * before signing the Satori payload:
 *
 *   - `passengerName`     → "Sendero traveler" (no real name)
 *   - `pnr`               → first 2 + last 2 chars, middle masked
 *   - `settlementTxHash`  → dropped (the on-chain tx is already public,
 *                            but we don't link it directly to the
 *                            traveler's NFT image)
 *
 * Public itinerary fields (origin, destination, date, carrier, cabin,
 * total) stay — they're not PII and the same data is already in the
 * NFT manifest's `attributes` array via OpenSea metadata.
 */

import { signBoardingPassPayload } from '@/lib/og/boarding-pass-url';
import type { BoardingPassCardProps } from '@/lib/og/boarding-pass-card';

import type { StampContext } from '../shared/types';

function redactPnr(pnr: string | null | undefined): string {
  if (!pnr || pnr.length < 4) return '——————';
  if (pnr.length <= 6) return `${pnr.slice(0, 2)}••${pnr.slice(-2)}`;
  return `${pnr.slice(0, 2)}••••${pnr.slice(-2)}`;
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatTime(iso: string | null | undefined): string | undefined {
  if (!iso) return undefined;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
}

/**
 * Build redacted BoardingPassCardProps from the StampContext. The
 * fields here are what Satori draws on the NFT image — anything
 * traveler-identifying must be redacted or omitted.
 */
function buildRedactedProps(ctx: StampContext): BoardingPassCardProps {
  const intent = (ctx.trip as unknown as Record<string, unknown>);
  // Trip-level destination/origin fall through to booking when intent is sparse
  const originCode = ctx.trip.origin ?? '✈️';
  const destinationCode = ctx.trip.destination ?? '—';

  const carrier = ctx.booking?.carrier ?? 'Sendero · Travel Agent';
  const cabin = ctx.booking?.cabin ?? 'Economy';

  // Best-effort departure date/time — pull from booking metadata when
  // available, fall back to trip.startDate.
  const departureIso = ctx.trip.startDate ?? null;
  const departureDate = departureIso ? formatDate(departureIso) : 'Sendero × travel';
  const departureTime = formatTime(departureIso) ?? '——:——';
  const arrivalTime = formatTime(ctx.trip.endDate ?? null);

  const totalUsdc =
    typeof ctx.booking?.totalUsd === 'number' && Number.isFinite(ctx.booking.totalUsd)
      ? ctx.booking.totalUsd.toFixed(2)
      : '—';

  void intent;

  return {
    origin: originCode,
    destination: destinationCode,
    departureDate,
    departureTime,
    ...(arrivalTime ? { arrivalTime } : {}),
    // Privacy: do NOT put the real passenger name on a public NFT image.
    passengerName: 'Sendero traveler',
    // Privacy: redact PNR — keep enough character to feel "boarding-pass-y"
    // without revealing the locator that would let anyone look up the order.
    pnr: redactPnr(ctx.booking?.ref ?? null),
    cabin,
    totalUsdc,
    // Privacy: drop settlementTxHash from the NFT image. The full tx
    // exists in the manifest's `attributes` for collectors who want it,
    // but we don't visually pin the address-to-trip link on the public
    // PNG indexed by marketplaces.
    carrier,
    kicker: 'Sendero × Boarding pass',
  };
}

/**
 * Render the redacted boarding pass and return it as a `data:image/png;base64,…`
 * URL — same shape as `generateStampImage` so `pin-to-ipfs` doesn't
 * have to branch on the source.
 *
 * Implementation: Satori runs in Next's edge ImageResponse runtime,
 * not in the workflow's node runtime. We fetch the public OG endpoint
 * (which we already use for WhatsApp card delivery) with a freshly-
 * signed token containing the redacted props. The endpoint always
 * returns `image/png` so we read the bytes and base64-encode.
 */
export const renderBoardingPassPng = async (args: {
  ctx: StampContext;
}): Promise<string> => {
  'use step';

  const secret = process.env.OG_SHARE_SIGNING_SECRET;
  if (!secret) {
    throw new Error(
      'render-boarding-pass-png: OG_SHARE_SIGNING_SECRET unset. The Satori boarding-pass image cannot be signed without it; falling back to the AI-generated stamp would expose private fields.'
    );
  }

  const baseUrl =
    process.env.OG_INTERNAL_BASE_URL ??
    process.env.NEXT_PUBLIC_APP_URL ??
    'http://localhost:3010';

  const props = buildRedactedProps(args.ctx);
  const token = await signBoardingPassPayload(props, secret);
  const url = `${baseUrl.replace(/\/$/, '')}/api/og/boarding-pass?token=${encodeURIComponent(token)}`;

  const res = await fetch(url, { method: 'GET' });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(
      `render-boarding-pass-png: og endpoint returned ${res.status} ${res.statusText} — ${body.slice(0, 200)}`
    );
  }

  const arrayBuffer = await res.arrayBuffer();
  const base64 = Buffer.from(arrayBuffer).toString('base64');
  return `data:image/png;base64,${base64}`;
};
