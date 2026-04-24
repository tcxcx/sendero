/**
 * Full-screen loading overlay — shown during Next.js route transitions
 * (locale changes do a full navigation through `?locale=xx-XX`, which
 * triggers the layout's `loading.tsx`) and on initial dashboard boot.
 *
 * Visual layer cake:
 *   · Fixed inset-0 topography pattern at low opacity over the
 *     parchment field — same contour SVG the ink/agent-console uses,
 *     so the overlay reads like "the same map-room, waiting."
 *   · Centered floating card: Sendero mark + "Fantasmita LLC®{year}"
 *     lockup pulled from BrandUpgradeCard (so re-skins propagate), a
 *     12-bar vermillion spinner, and a soft "Loading" label.
 *
 * Server component — no state, no hooks. Next.js mounts this from
 * `loading.tsx`; when the page resolves the overlay unmounts as the
 * router swaps to the new segment.
 */

const SENDERO_LOGO_SRC = '/brand/logo-masters/clean/sendero_icon_vermilion_clean_2048.png';

export function AppLoadingOverlay({ label = 'Loading' }: { label?: string }) {
  const year = new Date().getFullYear();

  return (
    <div
      aria-live="polite"
      aria-busy="true"
      className="fixed inset-0 z-[9000] flex h-svh w-screen items-center justify-center overflow-hidden"
      style={{ background: 'var(--surface-base, #eedcc7)' }}
    >
      {/* Topography backdrop — same mask-image trick as the ink tooltip. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundColor: 'var(--ink, #fb542b)',
          WebkitMaskImage: 'url("/patterns/topography.svg")',
          maskImage: 'url("/patterns/topography.svg")',
          WebkitMaskRepeat: 'repeat',
          maskRepeat: 'repeat',
          WebkitMaskSize: '260px 260px',
          maskSize: '260px 260px',
          opacity: 0.14,
        }}
      />

      {/* Centered floating card */}
      <div
        className="relative z-10 flex flex-col items-center gap-6 rounded-[var(--radius-xl,20px)] px-10 py-10"
        style={{
          background: 'color-mix(in oklab, var(--surface-floating, #FDFBF7) 96%, transparent)',
          border: '1.5px solid color-mix(in oklab, var(--ink, #fb542b) 22%, transparent)',
          boxShadow:
            '0 30px 60px -20px color-mix(in oklab, var(--ink, #fb542b) 28%, transparent), 0 4px 8px rgba(31, 42, 68, 0.08)',
          backdropFilter: 'blur(14px) saturate(1.1)',
          WebkitBackdropFilter: 'blur(14px) saturate(1.1)',
        }}
      >
        {/* Brand lockup — mirrors BrandUpgradeCard so rebrands propagate.
            Plain <img> (not next/image) because the logo is a
            pre-optimized PNG and the loading screen must not add a
            second image-transform round-trip. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={SENDERO_LOGO_SRC}
          alt=""
          width={72}
          height={72}
          className="h-14 w-14 object-contain"
        />
        <div className="flex flex-col items-center gap-0.5">
          <span
            aria-hidden
            className="text-[22px] leading-none tracking-[-0.01em] text-[color:var(--ink,#fb542b)]"
            style={{ fontFamily: 'var(--font-display, var(--font-serif, serif))' }}
          >
            Sendero
          </span>
          <span className="mt-0.5 text-center font-mono text-[8.5px] uppercase tracking-[0.18em] text-[color:var(--text-faint,#999)]">
            Fantasmita LLC
            <span className="mx-1" aria-hidden>
              ®
            </span>
            {year}
          </span>
        </div>

        {/* 12-bar spinner — ported from desk-v1's `loading-bar` pattern
            (see packages/ui/src/globals.css :: Spinner). Class hooks
            stay compatible so future upgrades can share CSS. */}
        <div
          className="app-loading-spinner"
          style={{ '--spinner-size': '48px' } as React.CSSProperties}
        >
          <div className="app-loading-spinner__ring">
            {Array.from({ length: 12 }).map((_, i) => (
              <span
                key={`loading-bar-${i}`}
                className="app-loading-spinner__bar"
                style={{
                  animationDelay: `${-1.2 + i * 0.1}s`,
                  transform: `rotate(${i * 30}deg) translate(146%)`,
                }}
              />
            ))}
          </div>
        </div>

        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:var(--text-dim,#6b6b6b)]">
          {label}…
        </span>
      </div>
    </div>
  );
}
