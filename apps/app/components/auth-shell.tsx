import type { ReactNode } from 'react';

import Link from 'next/link';

import { LanguageSelector } from './language-selector';

type AuthShellProps = {
  title: string;
  description: string;
  asideTitle: string;
  asideItems: string[];
  canonicalPath?: string;
  locale: string;
  children: ReactNode;
};

export function AuthShell({
  title,
  description,
  asideTitle,
  asideItems,
  canonicalPath = '/',
  locale,
  children,
}: AuthShellProps) {
  return (
    <>
      <style>{authShellStyles}</style>
      <main className="auth-shell grid min-h-screen bg-[var(--bg)] text-[var(--text)] lg:grid-cols-[minmax(360px,0.92fr)_minmax(420px,1.08fr)]">
        <section className="auth-pane-left relative flex flex-col justify-between overflow-hidden border-b border-[var(--border)] px-5 py-6 sm:px-8 lg:min-h-screen lg:border-b-0 lg:border-r">
          <RegistrationMark position="tl" />
          <RegistrationMark position="tr" />
          <RegistrationMark position="bl" />
          <RegistrationMark position="br" />

          <div className="s-enter s-enter-1 relative flex items-start justify-between gap-4">
            <Link
              href="/"
              className="s-press -ml-1 inline-flex items-center gap-3 rounded-sm px-1 pt-3 no-underline"
            >
              <img
                alt=""
                aria-hidden="true"
                className="size-7 shrink-0 object-contain"
                decoding="async"
                src="/brand/logo-masters/clean/sendero_icon_vermilion_clean_2048.png"
              />
              <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--text)]">
                Sendero
              </span>
            </Link>

            {/* Paper plane: small in-flight mark floating above the
                wordmark. Reads editorially as "letter dispatched". */}
            <svg
              aria-hidden="true"
              className="auth-plane pointer-events-none absolute left-[132px] top-1 hidden h-6 w-16 sm:block"
              fill="none"
              viewBox="0 0 64 24"
            >
              {/* Flight trail — static dashed curve, pre-drawn faint */}
              <path
                className="auth-plane-trail"
                d="M 2,20 Q 16,14 30,10 T 48,6"
                fill="none"
                opacity="0.32"
                stroke="var(--ink)"
                strokeDasharray="1.5 2"
                strokeLinecap="round"
                strokeWidth="0.9"
              />
              {/* Plane body (Lucide-style silhouette) + fold crease.
                  Grouped so drift transforms rotate around a tail-ish
                  origin, giving a believable in-flight feel. */}
              <g className="auth-plane-body">
                <path
                  d="M 60,2 L 42,22 L 36,14 L 18,10 Z"
                  fill="none"
                  pathLength="1"
                  stroke="var(--ink)"
                  strokeDasharray="1 1.1"
                  strokeDashoffset="1"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="1.1"
                />
                <path
                  d="M 60,2 L 36,14"
                  fill="none"
                  pathLength="1"
                  stroke="var(--ink)"
                  strokeDasharray="1 1.1"
                  strokeDashoffset="1"
                  strokeLinecap="round"
                  strokeWidth="1.1"
                />
              </g>
            </svg>

            <LanguageSelector canonicalPath={canonicalPath} currentLocale={locale} />
          </div>

          <div className="auth-left-plate relative flex flex-1 flex-col justify-between gap-10 py-6 lg:py-8">
            <RegistrationCross position="tl" />
            <RegistrationCross position="tr" />
            <RegistrationCross position="bl" />
            <RegistrationCross position="br" />

            <div className="relative max-w-xl">
              <div className="s-enter s-enter-2 mb-6 inline-flex items-center gap-2.5 font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--text-dim)]">
                <span
                  aria-hidden
                  className="auth-eyebrow-dot inline-block h-1.5 w-1.5 rounded-full bg-[var(--ink)]"
                />
                <span>{asideTitle}</span>
              </div>
              <h1 className="s-enter s-enter-3 auth-title m-0 text-[36px] font-medium leading-[1.02] tracking-[-0.015em] sm:text-[48px] lg:text-[60px]">
                {title}
              </h1>
              <svg
                aria-hidden
                className="auth-rule mt-6 block h-[10px] w-[128px]"
                fill="none"
                viewBox="0 0 128 10"
              >
                <path
                  d="M0 5 L118 5"
                  stroke="var(--ink)"
                  strokeLinecap="square"
                  strokeWidth="1.5"
                />
                <circle cx="122" cy="5" r="2.5" fill="var(--ink)" />
              </svg>
              <p className="s-enter s-enter-4 mt-5 max-w-md text-base leading-7 text-[var(--text-dim)]">
                {description}
              </p>
            </div>

            <div className="s-enter s-enter-5 grid gap-6">
              <ol
                className="auth-index relative grid gap-0 border-t border-[var(--border)]"
                role="list"
              >
                {asideItems.map((item, i) => (
                  <li
                    className="auth-index-row group relative flex items-start gap-4 border-b border-[var(--border)] py-3.5 pl-5 pr-2 text-sm leading-6 text-[var(--text)]"
                    key={item}
                  >
                    <span
                      aria-hidden
                      className="auth-index-rule pointer-events-none absolute inset-y-0 left-0 w-[2px] origin-top bg-[var(--ink)]"
                    />
                    <span className="shrink-0 pt-0.5 font-mono text-[10px] uppercase tracking-[0.14em] tabular-nums text-[var(--text-faint)]">
                      {String(i + 1).padStart(2, '0')}
                    </span>
                    <span className="flex-1">{item}</span>
                  </li>
                ))}
              </ol>

              {/* Agent-route schematic: CHANNEL → TENANT → ARC.
                  Three nodes on a single gentle bow, arrow head at
                  the terminal. viewBox matches the rendered aspect
                  ratio (240:24) so nothing letterboxes or squishes.
                  Labels positioned at node x-coords, not via flex. */}
              <div className="auth-route-group relative w-full max-w-[240px]">
                <svg
                  aria-hidden="true"
                  className="auth-route block h-6 w-full"
                  fill="none"
                  viewBox="0 0 240 24"
                >
                  {/* Connective arc. Symmetric bow from 14 → 4 → 14. */}
                  <path
                    className="auth-route-line"
                    d="M 20,14 C 80,4 160,4 220,14"
                    fill="none"
                    pathLength="1"
                    stroke="var(--ink)"
                    strokeDasharray="1 1.1"
                    strokeDashoffset="1"
                    strokeLinecap="round"
                    strokeWidth="1.25"
                  />
                  {/* Arrow head just before the ARC node */}
                  <path
                    className="auth-route-arrow"
                    d="M 212,10 L 220,14 L 212,18"
                    fill="none"
                    pathLength="1"
                    stroke="var(--ink)"
                    strokeDasharray="1 1.1"
                    strokeDashoffset="1"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="1.25"
                  />
                  {/* Nodes: CHANNEL, TENANT (on the crest), ARC */}
                  <circle cx="20" cy="14" fill="var(--ink)" r="2.75" />
                  <circle className="auth-route-pulse" cx="120" cy="6" fill="var(--ink)" r="2.75" />
                  <circle cx="220" cy="14" fill="var(--ink)" r="2.75" />
                </svg>
                {/* Labels under each node. Outer labels align to the
                    container edges (nodes sit 20px inside a 240-wide
                    viewBox, so edge-anchored reads as under-the-dot
                    without overflowing the section's clip). Middle
                    label centers on the crest node. */}
                <div className="auth-route-labels relative mt-2 h-3 font-mono text-[10px] uppercase tracking-[0.14em] text-[color-mix(in_oklab,var(--ink)_72%,transparent)]">
                  <span className="absolute left-0">Channel</span>
                  <span className="absolute left-1/2 -translate-x-1/2">Tenant</span>
                  <span className="absolute right-0">Arc</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="auth-pane-right relative flex items-center justify-center overflow-hidden py-8 lg:min-h-screen lg:py-10">
          <div aria-hidden className="pointer-events-none absolute inset-0">
            <img
              alt=""
              className="auth-hero-top absolute inset-x-0 top-0 h-[min(62vh,640px)] w-full object-cover object-top opacity-50 [mask-image:linear-gradient(to_bottom,black_0%,rgba(0,0,0,0.92)_18%,rgba(0,0,0,0.55)_48%,rgba(0,0,0,0.18)_78%,transparent_100%)] [-webkit-mask-image:linear-gradient(to_bottom,black_0%,rgba(0,0,0,0.92)_18%,rgba(0,0,0,0.55)_48%,rgba(0,0,0,0.18)_78%,transparent_100%)]"
              decoding="async"
              src="/brand/app-hero-transparent-edge.png"
            />
            <div className="auth-hero-bottom absolute inset-x-0 bottom-0 h-[min(58vh,620px)] overflow-hidden [mask-image:linear-gradient(to_top,black_0%,rgba(0,0,0,0.95)_28%,rgba(0,0,0,0.5)_62%,rgba(0,0,0,0.12)_88%,transparent_100%)] [-webkit-mask-image:linear-gradient(to_top,black_0%,rgba(0,0,0,0.95)_28%,rgba(0,0,0,0.5)_62%,rgba(0,0,0,0.12)_88%,transparent_100%)]">
              <img
                alt=""
                className="auth-hero-bottom-img absolute inset-x-0 bottom-0 h-[112%] w-full object-cover object-bottom opacity-[0.34]"
                decoding="async"
                src="/brand/generated/escrow-document-flow.png"
              />
            </div>
            <div className="absolute inset-x-0 top-[34%] h-[32%] bg-[linear-gradient(to_bottom,transparent,color-mix(in_oklch,var(--bg)_62%,transparent)_42%,color-mix(in_oklch,var(--bg)_62%,transparent)_58%,transparent)]" />
          </div>

          <div className="s-enter auth-enter-form relative z-10 mx-auto w-full max-w-md px-5 sm:px-8">
            <div className="auth-plate relative py-2">
              <RegistrationCross position="tl" />
              <RegistrationCross position="tr" />
              <RegistrationCross position="bl" />
              <RegistrationCross position="br" />

              {children}

              <div className="mt-6 flex items-center gap-3 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--text-faint)]">
                <span className="inline-flex items-center gap-1.5 text-[var(--ink)]">
                  <span
                    aria-hidden
                    className="auth-eyebrow-dot block h-1.5 w-1.5 rounded-full bg-[var(--ink)] shadow-[0_0_0_3px_color-mix(in_oklab,var(--ink)_18%,transparent)]"
                  />
                  Secured channel
                </span>
                <span aria-hidden className="h-px flex-1 bg-[var(--border)]" />
                <span>Passkey-first</span>
              </div>
            </div>
          </div>
        </section>
      </main>
    </>
  );
}

type MarkPosition = 'tl' | 'tr' | 'bl' | 'br';

function RegistrationMark({ position }: { position: MarkPosition }) {
  const map: Record<MarkPosition, string> = {
    tl: 'top-3 left-3',
    tr: 'top-3 right-3',
    bl: 'bottom-3 left-3',
    br: 'bottom-3 right-3',
  };
  return (
    <span
      aria-hidden
      className={`pointer-events-none absolute hidden text-[var(--border-strong)] sm:block ${map[position]}`}
    >
      <svg fill="none" height="10" viewBox="0 0 10 10" width="10">
        <path d="M0 5 H10 M5 0 V10" stroke="currentColor" strokeWidth="0.8" />
      </svg>
    </span>
  );
}

function RegistrationCross({ position }: { position: MarkPosition }) {
  const map: Record<MarkPosition, string> = {
    tl: '-top-[6px] -left-[6px]',
    tr: '-top-[6px] -right-[6px]',
    bl: '-bottom-[6px] -left-[6px]',
    br: '-bottom-[6px] -right-[6px]',
  };
  return (
    <span
      aria-hidden
      className={`auth-plate-cross pointer-events-none absolute text-[var(--ink)] ${map[position]}`}
    >
      <svg fill="none" height="12" viewBox="0 0 12 12" width="12">
        <path d="M0 6 H12 M6 0 V12" stroke="currentColor" strokeWidth="1" />
      </svg>
    </span>
  );
}

/* --------------------------------------------------------------
   Local auth-only styles.
   Shared primitives (.s-enter, .s-press, curves) live in
   @sendero/ui/motion.css. This file keeps only the bespoke
   choreography: rule draw, index scaleX hover, plate crosses.
   -------------------------------------------------------------- */
const authShellStyles = `
.auth-shell { position: relative; }
.auth-title { font-feature-settings: "ss01", "cv11"; }

/* Index row: transform-based hover (composite, never layout) */
.auth-index-row {
  transition: background-color var(--s-dur-base) var(--s-ease-out);
}
.auth-index-row:hover {
  background-color: color-mix(in oklab, var(--ink) 4%, transparent);
}
.auth-index-row .auth-index-rule {
  transform-origin: left center;
  transition: transform var(--s-dur-base) var(--s-ease-out);
}
.auth-index-row:hover .auth-index-rule {
  transform: scaleX(2);
}

.auth-pane-right::after {
  content: "";
  position: absolute;
  inset: 0;
  pointer-events: none;
  background-image: radial-gradient(color-mix(in oklab, var(--text-dim) 14%, transparent) 1px, transparent 1px);
  background-size: 3px 3px;
  opacity: 0.04;
  mix-blend-mode: multiply;
}

/* Plate crosses: hover choreography lives outside the motion media query
   so the transition is always primed for interaction. Rotation itself
   is suppressed under prefers-reduced-motion: reduce (see below).
   The crosses are + glyphs; 45deg turns them into ×, a whispered
   state-change the eye catches without a caption. */
.auth-plate-cross {
  transition: transform var(--s-dur-base) var(--s-ease-spring);
  transform-origin: 50% 50%;
  will-change: transform;
}
.auth-plate:hover .auth-plate-cross {
  transform: rotate(45deg);
}
/* Diagonal ripple from top-left → bottom-right */
.auth-plate:hover .auth-plate-cross:nth-child(1) { transition-delay: 0ms; }
.auth-plate:hover .auth-plate-cross:nth-child(2) { transition-delay: 40ms; }
.auth-plate:hover .auth-plate-cross:nth-child(3) { transition-delay: 40ms; }
.auth-plate:hover .auth-plate-cross:nth-child(4) { transition-delay: 80ms; }

@media (prefers-reduced-motion: no-preference) {
  /* Form bloom — scale-from-0.985 per Emil, never 0 */
  .auth-enter-form {
    opacity: 0;
    transform: translate3d(0, 6px, 0) scale(0.985);
    animation: auth-form-in 420ms var(--s-ease-out) 240ms forwards;
  }

  /* Hero images: clip-path reveal on first load */
  .auth-hero-top {
    clip-path: inset(0 0 100% 0);
    animation: auth-hero-top-in 720ms var(--s-ease-in-out) 120ms forwards;
  }
  .auth-hero-bottom {
    clip-path: inset(100% 0 0 0);
    animation: auth-hero-bottom-in 720ms var(--s-ease-in-out) 240ms forwards;
  }
  /* Source PNG has transparent padding at its bottom edge.
     Push the img down so illustrated content lands flush against
     the viewport edge; overflow-hidden on wrapper clips the bleed. */
  .auth-hero-bottom-img {
    transform: translate3d(0, 6%, 0);
  }

  /* The editorial rule: draw first, then drop the dot */
  .auth-rule path {
    stroke-dasharray: 118;
    stroke-dashoffset: 118;
    animation: auth-rule-draw 560ms var(--s-ease-in-out) 300ms forwards;
  }
  .auth-rule circle {
    opacity: 0;
    transform-origin: 122px 5px;
    animation: auth-rule-dot 260ms var(--s-ease-out) 820ms forwards;
  }

  /* Index rules animate in with the section, quickly */
  .auth-index-row .auth-index-rule {
    transform: scaleX(0);
    transform-origin: top;
    animation: auth-rule-in 360ms var(--s-ease-out) forwards;
  }
  .auth-index-row:nth-child(1) .auth-index-rule { animation-delay: 520ms; }
  .auth-index-row:nth-child(2) .auth-index-rule { animation-delay: 580ms; }
  .auth-index-row:nth-child(3) .auth-index-rule { animation-delay: 640ms; }
  .auth-index-row:nth-child(4) .auth-index-rule { animation-delay: 700ms; }
  .auth-index-row:hover .auth-index-rule {
    animation: none;
    transform: scaleX(2);
  }

  .auth-plate-cross {
    opacity: 0;
    animation: auth-fade-in 320ms var(--s-ease-out) forwards;
  }
  .auth-plate-cross:nth-child(1) { animation-delay: 560ms; }
  .auth-plate-cross:nth-child(2) { animation-delay: 600ms; }
  .auth-plate-cross:nth-child(3) { animation-delay: 640ms; }
  .auth-plate-cross:nth-child(4) { animation-delay: 680ms; }

          .auth-eyebrow-dot {
            animation: auth-dot-pulse 3.6s var(--s-ease-in-out) 1200ms infinite;
          }

          /* Agent-route: draw the single curve, then drop the three nodes
             in left-to-right. Middle node picks up a slow ambient pulse. */
          .auth-route path {
            animation: s-draw-line 720ms var(--s-ease-in-out) 480ms forwards;
          }
          .auth-route circle {
            opacity: 0;
            animation: s-fade 320ms var(--s-ease-out) forwards;
          }
          .auth-route circle:nth-of-type(1) { animation-delay: 480ms; }
          .auth-route circle:nth-of-type(2) { animation-delay: 800ms; }
          .auth-route circle:nth-of-type(3) { animation-delay: 1120ms; }
          .auth-route-pulse {
            transform-box: fill-box;
            transform-origin: center;
            animation:
              s-fade 320ms var(--s-ease-out) 800ms forwards,
              auth-route-pulse 4.2s var(--s-ease-in-out) 2s infinite;
          }

          /* Paper plane: trail draws first, then the plane body draws
             and hands off to an ambient drift. */
          .auth-plane path:nth-of-type(1) {
            animation: s-draw-line 900ms var(--s-ease-in-out) 1200ms forwards;
          }
          .auth-plane path:nth-of-type(2) {
            transform-box: fill-box;
            transform-origin: center;
            animation:
              s-draw-line 560ms var(--s-ease-out) 2000ms forwards,
              auth-plane-drift 6s var(--s-ease-in-out) 2800ms infinite;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          /* Preserve the image offset (not decorative — fixes PNG padding),
             but suppress the decorative cross rotation on hover. */
          .auth-hero-bottom-img {
            transform: translate3d(0, 6%, 0);
          }
          .auth-plate-cross {
            transition: none;
          }
          .auth-plate:hover .auth-plate-cross {
            transform: none;
          }

          /* Reveal decorative SVGs without motion. */
          .auth-route path { stroke-dashoffset: 0; }
          .auth-route circle { opacity: 1; }
          .auth-route-pulse { animation: none; }
          .auth-plane path { stroke-dashoffset: 0; }
          .auth-plane path:nth-of-type(2) { animation: none; }
        }

@keyframes auth-form-in {
  to { opacity: 1; transform: translate3d(0, 0, 0) scale(1); }
}
@keyframes auth-hero-top-in {
  to { clip-path: inset(0 0 0 0); }
}
@keyframes auth-hero-bottom-in {
  to { clip-path: inset(0 0 0 0); }
}
@keyframes auth-rule-draw {
  to { stroke-dashoffset: 0; }
}
@keyframes auth-rule-dot {
  to { opacity: 1; }
}
@keyframes auth-rule-in {
  to { transform: scaleX(1); }
}
@keyframes auth-fade-in {
  to { opacity: 1; }
}
        @keyframes auth-dot-pulse {
          0%, 100% { box-shadow: 0 0 0 0 color-mix(in oklab, var(--ink) 22%, transparent); }
          50%      { box-shadow: 0 0 0 6px color-mix(in oklab, var(--ink) 0%, transparent); }
        }

        /* Scoped SVG-circle pulse (opacity + scale). Kept local so we
           don't collide with the existing global s-pulse-dot, which
           animates box-shadow on HTML elements. */
        @keyframes auth-route-pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50%      { opacity: 0.6; transform: scale(1.15); }
        }
        @keyframes auth-plane-drift {
          0%, 100% { transform: translate(0, 0) rotate(0deg); }
          50%      { transform: translate(-1px, -2px) rotate(-1.5deg); }
        }
        `;
