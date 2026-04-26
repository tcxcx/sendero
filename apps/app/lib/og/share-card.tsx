/**
 * Reusable Satori share-card component.
 *
 * Pure JSX-for-Satori. The same component renders the card surface whether
 * it is mounted via the `ImageResponse` route at `/api/og/share` or used
 * for previewing the brand frame in storybook fixtures. No state, no
 * effects, no DOM APIs, only the subset of CSS Satori understands.
 *
 * Brand palette mirrors `apps/app/app/stamps/[tokenId]/opengraph-image.tsx`
 * (parchment background, vermillion accents, midnight ink, mono-uppercase
 * kicker) so cross-channel share images sit alongside the stamp + agent OGs
 * as a single visual family.
 *
 * Layout, top-down:
 *   1. Eyebrow line: vermillion bar + uppercase "SENDERO" kicker
 *   2. Title: heavy display sized to fit ~3 lines
 *   3. Body: medium weight, max ~3 lines, ellipsized when longer
 *   4. Optional bullet list (capped at 3 visible items)
 *   5. Footer: sendero.travel domain + optional CTA hint
 *   6. Right-edge vermillion accent bar
 */

import type { ReactElement } from 'react';

export const SHARE_CARD_SIZE = { width: 1200, height: 630 } as const;

const BRAND = {
  vermillion: '#D65438',
  midnight: '#1F2A44',
  sea: '#0F7C82',
  parchment: '#EEDCC7',
  parchmentLight: '#F7EFE4',
  hairline: '#D8C1A7',
} as const;

const MAX_VISIBLE_BULLETS = 3;
const TITLE_HARD_CAP = 140;
const BODY_HARD_CAP = 280;
const BULLET_HARD_CAP = 90;

export interface ShareCardProps {
  title: string;
  body: string;
  bullets?: string[];
  /** Optional kicker, defaults to "SENDERO". */
  kicker?: string;
  /** Footer hint text, defaults to "sendero.travel". */
  footer?: string;
  /** Optional CTA label rendered as a pill in the footer row. */
  ctaLabel?: string;
}

function clip(input: string, max: number): string {
  if (input.length <= max) return input;
  return `${input.slice(0, max - 1)}…`;
}

export function ShareCard(props: ShareCardProps): ReactElement {
  const kicker = (props.kicker ?? 'Sendero').toUpperCase();
  const footer = props.footer ?? 'sendero.travel';
  const title = clip(props.title, TITLE_HARD_CAP);
  const body = clip(props.body, BODY_HARD_CAP);
  const bullets = (props.bullets ?? [])
    .slice(0, MAX_VISIBLE_BULLETS)
    .map(b => clip(b, BULLET_HARD_CAP));

  // Title size scales with length so very long headlines stay on the
  // canvas without wrapping into an ugly fourth line. Three breakpoints
  // are enough; Satori does not support fluid CSS.
  const titleSize = title.length > 80 ? 60 : title.length > 40 ? 76 : 92;

  return (
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
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: `radial-gradient(circle at 30% 20%, ${BRAND.parchmentLight}, transparent 60%), radial-gradient(circle at 80% 80%, rgba(214, 84, 56, 0.06), transparent 50%)`,
          display: 'flex',
        }}
      />

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
        {kicker}
      </div>

      <div
        style={{
          fontSize: titleSize,
          fontWeight: 600,
          color: BRAND.midnight,
          marginTop: 28,
          lineHeight: 1.05,
          letterSpacing: -1,
          maxWidth: 1040,
          display: 'flex',
        }}
      >
        {title}
      </div>

      <div
        style={{
          fontSize: 26,
          color: BRAND.midnight,
          opacity: 0.75,
          marginTop: 18,
          maxWidth: 1040,
          lineHeight: 1.35,
          display: 'flex',
        }}
      >
        {body}
      </div>

      {bullets.length > 0 ? (
        <div
          style={{
            marginTop: 22,
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          {bullets.map((b, i) => (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: Satori output is static; index keys are stable.
              key={i}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 12,
                fontSize: 22,
                color: BRAND.midnight,
                opacity: 0.78,
                lineHeight: 1.3,
              }}
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  marginTop: 12,
                  background: BRAND.sea,
                  borderRadius: 999,
                  display: 'flex',
                  flexShrink: 0,
                }}
              />
              <span style={{ display: 'flex' }}>{b}</span>
            </div>
          ))}
        </div>
      ) : null}

      <div
        style={{
          display: 'flex',
          marginTop: 'auto',
          paddingTop: 22,
          borderTop: `1px solid ${BRAND.hairline}`,
          fontSize: 18,
          color: BRAND.midnight,
          opacity: 0.65,
          letterSpacing: 0.4,
          alignItems: 'center',
          justifyContent: 'space-between',
          fontFamily: 'monospace',
        }}
      >
        <span style={{ display: 'flex' }}>{footer}</span>
        {props.ctaLabel ? (
          <span
            style={{
              display: 'flex',
              padding: '8px 16px',
              borderRadius: 999,
              background: BRAND.vermillion,
              color: '#FDFBF7',
              fontFamily: 'sans-serif',
              fontSize: 18,
              fontWeight: 600,
              letterSpacing: 0.2,
            }}
          >
            {props.ctaLabel}
          </span>
        ) : null}
      </div>

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
    </div>
  );
}
