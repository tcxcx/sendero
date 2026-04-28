/**
 * Sendero canonical Open Graph card.
 *
 * Pure JSX-for-Satori — the same component renders the marketing
 * (sendero.travel), app (apps.sendero.travel), and docs
 * (docs.sendero.travel) share images. Caller chooses the surface label
 * via `site` and (optionally) the eyebrow word.
 *
 * Layout: full-bleed Sendero halftone postcard (binoculars + swallow +
 * compass + treeline horizon) as the background. Title + description
 * overlay on the upper-left parchment band where the bg image is
 * lightest. The bg image already carries the wordmark (binoculars in
 * the top-right corner) so the card does NOT add a separate logo —
 * one bear left, one binoculars right, one halftone landscape, one
 * eyebrow + title + description in the parchment band.
 *
 * Brand palette mirrors `apps/app/lib/og/share-card.tsx` and the
 * stamp/agent OG cards. Halftone hero shipped with the package as a
 * base64 data URL (see `assets.ts`) so consumer apps don't need to
 * mount static routes.
 */

import type { ReactElement } from 'react';

export const OG_IMAGE_SIZE = { width: 1200, height: 630 } as const;

export const OG_BRAND = {
  vermillion: '#D65438',
  midnight: '#1F2A44',
  sea: '#0F7C82',
  sand: '#B6844E',
  parchment: '#EEDCC7',
  parchmentLight: '#F7EFE4',
  warmWhite: '#FDFBF7',
  hairline: '#D8C1A7',
} as const;

const TITLE_HARD_CAP = 140;
const BODY_HARD_CAP = 240;

export interface SenderoOgCardProps {
  title: string;
  description?: string;
  /**
   * Eyebrow label shown above the title — uppercased automatically.
   * Defaults to the site domain (e.g. "sendero.travel").
   */
  eyebrow?: string;
  /**
   * Surface domain shown in the eyebrow + footer when no explicit
   * eyebrow is given. Defaults to `sendero.travel`.
   */
  site?: 'sendero.travel' | 'apps.sendero.travel' | 'docs.sendero.travel' | string;
  /**
   * Pre-encoded data URL for the halftone hero background. Required —
   * the route handler resolves it once at module load via
   * `loadHalftoneHeroDataUrl()` and threads it through.
   */
  heroSrc: string;
  /**
   * Bullets are intentionally NOT supported in the halftone layout —
   * the bg image is already busy and bullets would crowd the parchment
   * band. Use prose in `description` instead. Kept in the type for
   * call-site compatibility; ignored by the renderer.
   */
  bullets?: string[];
  ctaLabel?: string;
}

function clip(input: string, max: number): string {
  const trimmed = input.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1)}…`;
}

export function SenderoOgCard(props: SenderoOgCardProps): ReactElement {
  const site = props.site ?? 'sendero.travel';
  const eyebrow = (props.eyebrow ?? site).toUpperCase();
  const title = clip(props.title, TITLE_HARD_CAP);
  const description = props.description ? clip(props.description, BODY_HARD_CAP) : '';

  // Title scales for a 54% parchment panel (~590px content width
  // after 120px of padding). One-word titles get the editorial
  // display size; long architecture quotes drop to 36 so they
  // wrap to ~4 lines without overflowing.
  const titleSize = title.length > 110 ? 32 : title.length > 70 ? 40 : title.length > 36 ? 52 : 76;

  return (
    <div
      style={{
        height: '100%',
        width: '100%',
        display: 'flex',
        position: 'relative',
        background: OG_BRAND.parchment,
        fontFamily: 'Geist',
      }}
    >
      {/*
        Magazine-spread layout: solid parchment panel on the left holds
        the editorial copy; the halftone hero is cropped to the right
        side of the canvas so we keep the binoculars wordmark + treeline
        + compass star but lose the bear (top-left of source) and the
        swallow (bottom-left of source) which would have collided with
        the text overlay.
      */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: OG_BRAND.parchmentLight,
          display: 'flex',
        }}
      />

      {/* Halftone hero — cropped to the right ~46% via object-position */}
      <img
        src={props.heroSrc}
        width={OG_IMAGE_SIZE.width}
        height={OG_IMAGE_SIZE.height}
        style={{
          position: 'absolute',
          top: 0,
          right: 0,
          bottom: 0,
          width: '46%',
          height: '100%',
          objectFit: 'cover',
          objectPosition: 'right center',
        }}
      />

      {/* Soft vermillion tint into the parchment panel so the gutter doesn't read as a hard edge */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background:
            'linear-gradient(90deg, rgba(247, 239, 228, 0) 50%, rgba(214, 84, 56, 0.06) 60%, rgba(247, 239, 228, 0) 64%)',
          display: 'flex',
        }}
      />

      {/* Vertical hairline gutter separating the parchment panel from the hero */}
      <div
        style={{
          position: 'absolute',
          left: '54%',
          top: 56,
          bottom: 56,
          width: 1,
          background: OG_BRAND.hairline,
          opacity: 0.7,
          display: 'flex',
        }}
      />

      {/*
        Text well — anchored to the parchment panel (left 54%).
        Inset padding leaves room for the vermillion eyebrow rule and
        keeps the title/description from bleeding across the gutter.
      */}
      <div
        style={{
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          padding: '72px 48px 56px 72px',
          width: '54%',
          height: '100%',
        }}
      >
        {/* Eyebrow — vermillion rule + uppercase tracking */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            fontSize: 15,
            letterSpacing: 4,
            textTransform: 'uppercase',
            color: OG_BRAND.midnight,
            opacity: 0.62,
            fontFamily: 'Geist',
            fontWeight: 600,
          }}
        >
          <span
            style={{
              width: 28,
              height: 2,
              background: OG_BRAND.vermillion,
              display: 'flex',
            }}
          />
          {eyebrow}
        </div>

        {/* Title */}
        <div
          style={{
            fontFamily: 'Fraunces',
            fontSize: titleSize,
            fontWeight: 500,
            color: OG_BRAND.midnight,
            marginTop: 24,
            lineHeight: 1.06,
            letterSpacing: -1.4,
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {title}
        </div>

        {/* Description — Fraunces, anchored under the title */}
        {description ? (
          <div
            style={{
              fontFamily: 'Fraunces',
              fontSize: 22,
              fontWeight: 400,
              color: OG_BRAND.midnight,
              opacity: 0.74,
              marginTop: 28,
              lineHeight: 1.42,
              letterSpacing: -0.2,
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            {description}
          </div>
        ) : null}

        {/* Footer — domain in mono-uppercase + optional CTA arrow */}
        <div
          style={{
            display: 'flex',
            marginTop: 'auto',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontFamily: 'Geist',
            fontSize: 14,
            color: OG_BRAND.midnight,
            opacity: 0.75,
            letterSpacing: 2.4,
            textTransform: 'uppercase',
            fontWeight: 600,
          }}
        >
          <span style={{ display: 'flex' }}>{site}</span>
          {props.ctaLabel ? (
            <span
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                fontFamily: 'Fraunces',
                fontSize: 22,
                fontWeight: 500,
                color: OG_BRAND.vermillion,
                textTransform: 'none',
                letterSpacing: -0.2,
              }}
            >
              {props.ctaLabel}
              <span style={{ display: 'flex', fontSize: 20 }}>→</span>
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}
