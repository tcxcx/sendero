/**
 * Dynamic OG image for the public agent profile pages.
 *
 * Built with Next.js's `ImageResponse` (which IS Satori under the
 * hood — HTML+CSS → SVG → PNG, edge-runtime-ready, no headless
 * Chromium needed). Renders a brand-frame around the agent's stars,
 * trip count, and on-chain identity so when the URL is shared in
 * Slack / WhatsApp / X, the unfurl preview tells the trust story
 * at a glance.
 *
 * Per Next.js convention, this file IS the OG image route — Next
 * registers it at `/agents/[kind]/[id]/opengraph-image` automatically.
 * `metadata.json/route.ts` already points `image:` at this URL, so
 * minted ERC-8004 NFTs render the brand-framed Satori card in NFT
 * galleries that respect the metadata.image field.
 *
 * Edge runtime so cold starts are sub-50ms — Slackbot fetches OG
 * synchronously when a link is posted; anything slower than ~3s
 * gets a fallback unfurl.
 */

import { ImageResponse } from 'next/og';

import { loadAgentProfile, loadSenderoAgentProfile } from '@/lib/agent-profile';

// Node runtime (not edge) because loadAgentProfile pulls in @sendero/database
// → Prisma → not edge-compatible. Sub-200ms cold start on Fluid Compute is
// still well within the 3s unfurl-bot budget.
export const runtime = 'nodejs';

export const alt = 'Sendero on-chain agent profile';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

interface RouteParams {
  kind: string;
  id: string;
}

// Sendero brand palette — pulled from DESIGN.md §6 verbatim. Inline
// so this route stays edge-friendly (no @sendero/ui peer pulled in).
const BRAND = {
  vermillion: '#D65438',
  midnight: '#1F2A44',
  sea: '#0F7C82',
  sand: '#B6844E',
  parchment: '#EEDCC7',
  parchmentLight: '#F7EFE4',
  warmWhite: '#FDFBF7',
  hairline: '#D8C1A7',
  midnightSoft: 'rgba(31, 42, 68, 0.08)',
  midnightMedium: 'rgba(31, 42, 68, 0.18)',
} as const;

export default async function OgImage({ params }: { params: Promise<RouteParams> }) {
  try {
    return await renderOg(await params);
  } catch (err) {
    // Never surface a 500 to an unfurl bot — return the brand
    // fallback card and log so dev can see the underlying error.
    console.error('[og/agent] render failed', err);
    return notFoundCard();
  }
}

async function renderOg(params: RouteParams) {
  const { kind, id } = params;
  if (kind !== 'sendero' && kind !== 'org' && kind !== 'user') {
    return notFoundCard();
  }
  const profile =
    kind === 'sendero'
      ? await loadSenderoAgentProfile()
      : await loadAgentProfile({ kind, subjectId: id });
  if (kind === 'sendero' && profile?.agentId !== id) {
    return notFoundCard();
  }
  if (!profile) {
    return notFoundCard();
  }

  const starsLine = profile.stars ? `${profile.stars.toFixed(1)}★` : 'Newcomer';
  const subtitle =
    profile.feedbackCount > 0
      ? `${profile.feedbackCount} ${profile.feedbackCount === 1 ? 'rating' : 'ratings'} from ${profile.validatorCount} ${profile.validatorCount === 1 ? 'counterparty' : 'counterparties'}`
      : 'On-chain identity provisioned via Sendero × Circle';
  const validations = profile.validationCount;

  return new ImageResponse(
    <div
      style={{
        height: '100%',
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: BRAND.parchment,
        fontFamily: 'sans-serif',
        position: 'relative',
        padding: 64,
      }}
    >
      {/* Subtle parchment grain via radial gradient ↔ translates well in Satori */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: `radial-gradient(circle at 30% 20%, ${BRAND.parchmentLight}, transparent 60%), radial-gradient(circle at 80% 80%, rgba(214, 84, 56, 0.06), transparent 50%)`,
          display: 'flex',
        }}
      />

      {/* Eyebrow */}
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
        <span
          style={{
            width: 26,
            height: 2,
            background: BRAND.vermillion,
            display: 'flex',
          }}
        />
        Sendero ·{' '}
        {kind === 'sendero' ? 'Primary Agent' : kind === 'org' ? 'Travel Agency' : 'Traveler'}
      </div>

      {/* Display name */}
      <div
        style={{
          fontSize: 72,
          fontWeight: 600,
          color: BRAND.midnight,
          marginTop: 28,
          lineHeight: 1.05,
          letterSpacing: -1,
          maxWidth: 900,
          display: 'flex',
        }}
      >
        {profile.displayName}
      </div>

      {/* Subtitle */}
      <div
        style={{
          fontSize: 26,
          color: BRAND.midnight,
          opacity: 0.7,
          marginTop: 16,
          maxWidth: 900,
          display: 'flex',
        }}
      >
        {subtitle}
      </div>

      {/* Stat row */}
      <div
        style={{
          display: 'flex',
          marginTop: 'auto',
          gap: 28,
          alignItems: 'flex-end',
        }}
      >
        <Stat label="Reputation" value={starsLine} accent={BRAND.vermillion} />
        <Stat label="Ratings" value={String(profile.feedbackCount)} accent={BRAND.midnight} />
        <Stat label="Validations" value={String(validations)} accent={BRAND.sea} />
        {profile.agentId ? (
          <Stat
            label="Agent NFT"
            value={`#${profile.agentId}`}
            accent={BRAND.sand}
            valueSize={48}
          />
        ) : null}
      </div>

      {/* Hairline rule + holder address */}
      <div
        style={{
          display: 'flex',
          marginTop: 40,
          paddingTop: 22,
          borderTop: `1px solid ${BRAND.hairline}`,
          fontSize: 18,
          color: BRAND.midnight,
          opacity: 0.55,
          letterSpacing: 0.4,
          fontFamily: 'monospace',
        }}
      >
        {profile.holderAddress.slice(0, 10)}…{profile.holderAddress.slice(-8)} · arc-testnet ·
        ERC-8004
      </div>

      {/* Vermillion accent bar — the brand "loose linework" tell */}
      <div
        style={{
          position: 'absolute',
          right: 0,
          top: 0,
          bottom: 0,
          width: 12,
          background: BRAND.vermillion,
          display: 'flex',
        }}
      />
    </div>,
    {
      ...size,
      // Cache-Control headers come from generateImageMetadata when present;
      // edge runtime + ImageResponse defaults already set immutable max-age
      // on the rendered PNG.
    }
  );
}

function Stat({
  label,
  value,
  accent,
  valueSize = 64,
}: {
  label: string;
  value: string;
  accent: string;
  valueSize?: number;
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      <div
        style={{
          fontSize: 14,
          letterSpacing: 3,
          textTransform: 'uppercase',
          color: BRAND.midnight,
          opacity: 0.5,
          display: 'flex',
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: valueSize,
          fontWeight: 600,
          color: accent,
          lineHeight: 1,
          display: 'flex',
        }}
      >
        {value}
      </div>
    </div>
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
        gap: 16,
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
          fontSize: 56,
          fontWeight: 600,
          color: BRAND.midnight,
          letterSpacing: -1,
          display: 'flex',
        }}
      >
        Agent not found
      </div>
    </div>,
    size
  );
}
