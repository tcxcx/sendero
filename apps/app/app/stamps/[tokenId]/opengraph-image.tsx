/**
 * Dynamic OG image for the public stamp page.
 *
 * Brand-frames the actual NFT art (loaded from the Pinata gateway URL
 * already in `NftStamp.blobUrl`) with a Sendero parchment border + the
 * caption + the route. Slack / WhatsApp / X get a much richer unfurl
 * than the bare PNG would give them.
 *
 * Built with Next.js's `ImageResponse` (Satori under the hood). Edge
 * runtime; sub-50ms cold start so unfurl bots stay inside their ~3s
 * fetch budget.
 */

import { ImageResponse } from 'next/og';

import { loadStampForOg } from '@/lib/stamp-og';

// Node runtime (not edge) because loadStampForOg pulls in @sendero/database
// → Prisma → not edge-compatible. Sub-200ms cold on Fluid Compute, still
// inside the 3s unfurl-bot budget.
export const runtime = 'nodejs';

export const alt = 'Sendero NFT trip stamp';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

const BRAND = {
  vermillion: '#D65438',
  midnight: '#1F2A44',
  sea: '#0F7C82',
  parchment: '#EEDCC7',
  parchmentLight: '#F7EFE4',
  hairline: '#D8C1A7',
} as const;

const KIND_LABEL: Record<string, string> = {
  BoardingPass: 'Boarding Pass',
  SettlementReceipt: 'Settlement Receipt',
  ItineraryMap: 'Itinerary Map',
  TripPassport: 'Trip Passport',
};

interface RouteParams {
  tokenId: string;
}

export default async function StampOgImage({ params }: { params: Promise<RouteParams> }) {
  try {
    return await renderStampOg(await params);
  } catch (err) {
    console.error('[og/stamp] render failed', err);
    return notFoundCard();
  }
}

async function renderStampOg(params: RouteParams) {
  const { tokenId } = params;
  const stamp = await loadStampForOg(tokenId);
  if (!stamp) return notFoundCard();

  return new ImageResponse(
    <div
      style={{
        height: '100%',
        width: '100%',
        display: 'flex',
        background: BRAND.parchment,
        fontFamily: 'sans-serif',
        padding: 56,
        gap: 40,
      }}
    >
      {/* Left: the actual NFT art on a parchment-framed plate */}
      <div
        style={{
          width: 518,
          height: 518,
          display: 'flex',
          background: BRAND.parchmentLight,
          padding: 16,
          borderRadius: 16,
          boxShadow: '0 24px 48px -20px rgba(31, 42, 68, 0.25)',
        }}
      >
        {stamp.blobUrl ? (
          <img
            src={stamp.blobUrl}
            width={486}
            height={486}
            style={{ borderRadius: 8, objectFit: 'cover' }}
            alt=""
          />
        ) : null}
      </div>

      {/* Right: brand-anchored copy */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          gap: 18,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            fontSize: 18,
            letterSpacing: 4,
            textTransform: 'uppercase',
            color: BRAND.midnight,
            opacity: 0.6,
          }}
        >
          <span style={{ width: 26, height: 2, background: BRAND.vermillion, display: 'flex' }} />
          Sendero · {KIND_LABEL[stamp.kind] ?? stamp.kind}
        </div>

        <div
          style={{
            fontSize: 54,
            fontWeight: 600,
            color: BRAND.midnight,
            lineHeight: 1.05,
            letterSpacing: -0.6,
            display: 'flex',
          }}
        >
          {stamp.name}
        </div>

        <div
          style={{
            fontSize: 24,
            color: BRAND.midnight,
            opacity: 0.75,
            lineHeight: 1.35,
            display: 'flex',
          }}
        >
          {stamp.caption.length > 160 ? `${stamp.caption.slice(0, 157)}…` : stamp.caption}
        </div>

        <div
          style={{
            display: 'flex',
            marginTop: 'auto',
            paddingTop: 18,
            borderTop: `1px solid ${BRAND.hairline}`,
            fontSize: 18,
            color: BRAND.midnight,
            opacity: 0.55,
            fontFamily: 'monospace',
          }}
        >
          token #{stamp.tokenId} · arc-testnet · {stamp.tenantDisplayName ?? 'Sendero'}
        </div>
      </div>

      {/* Vermillion accent bar */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          width: 10,
          background: BRAND.vermillion,
          display: 'flex',
        }}
      />
    </div>,
    size
  );
}

function notFoundCard() {
  return new ImageResponse(
    <div
      style={{
        height: '100%',
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: BRAND.parchment,
        fontFamily: 'sans-serif',
      }}
    >
      <div
        style={{
          fontSize: 24,
          letterSpacing: 4,
          textTransform: 'uppercase',
          color: BRAND.midnight,
          opacity: 0.6,
          display: 'flex',
        }}
      >
        Sendero
      </div>
      <div
        style={{
          marginTop: 16,
          fontSize: 56,
          fontWeight: 600,
          color: BRAND.midnight,
          letterSpacing: -1,
          display: 'flex',
        }}
      >
        Stamp not found
      </div>
    </div>,
    size
  );
}
