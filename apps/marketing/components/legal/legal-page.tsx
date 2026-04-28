import type { ReactNode } from 'react';

/**
 * LegalPage — shared shell for /policy and /terms (and any future
 * legal route). Drops the home page's nav + a centered prose column,
 * uses Sendero's parchment-on-ink palette via the existing `mk-*`
 * CSS classes from apps/marketing/app/globals.css.
 *
 * Copy is plain MDX-style content rendered as React children — keeps
 * editing low-friction (no MDX pipeline needed for two pages) and
 * lets us inline date/effective-date front matter via props.
 */

interface LegalPageProps {
  /** Human title shown in the eyebrow + h1. */
  eyebrow: string;
  /** Page heading. */
  title: string;
  /** ISO date — when this version became effective. */
  effectiveDate: string;
  /** Page content (h2/h3/p/ul/li/strong/code). */
  children: ReactNode;
}

// Header + footer come from apps/marketing/app/layout.tsx
// (SiteHeader / SiteFooter). This shell renders only the prose column.
export function LegalPage({ eyebrow, title, effectiveDate, children }: LegalPageProps) {
  return (
    <>
      <article
        className="legal-prose"
        style={{
          maxWidth: '70ch',
          margin: '0 auto',
          padding: '64px max(24px, 6vw) 96px',
          color: 'var(--fg)',
          fontSize: 15,
          lineHeight: 1.75,
        }}
      >
        <div className="mk-eyebrow" style={{ marginBottom: 8 }}>
          {eyebrow}
        </div>
        <h1
          style={{
            fontFamily: 'var(--display)',
            fontSize: 'clamp(28px, 3.5vw, 44px)',
            letterSpacing: '-0.01em',
            fontWeight: 450,
            margin: '0 0 8px',
          }}
        >
          {title}
        </h1>
        <p
          style={{
            color: 'var(--muted)',
            fontSize: 13,
            margin: '0 0 40px',
            fontFamily: 'var(--mono)',
            letterSpacing: '0.04em',
          }}
        >
          Effective {effectiveDate}
        </p>
        <div className="legal-body">{children}</div>
        <hr
          style={{
            border: 'none',
            borderTop: '1px solid color-mix(in oklab, var(--fg) 12%, transparent)',
            margin: '48px 0 24px',
          }}
        />
        <p style={{ fontSize: 13, color: 'var(--muted)' }}>
          Questions? Email{' '}
          <a href="mailto:legal@sendero.travel" style={{ color: 'var(--vermillion)' }}>
            legal@sendero.travel
          </a>{' '}
          or read our{' '}
          <a href="/policy" style={{ color: 'var(--vermillion)' }}>
            Privacy Policy
          </a>{' '}
          and{' '}
          <a href="/terms" style={{ color: 'var(--vermillion)' }}>
            Terms of Service
          </a>
          .
        </p>
      </article>

      {/*
        Inline prose styling — mirrors apps/docs Fumadocs defaults so
        legal copy reads consistently across marketing + docs.
      */}
      <style>{`
        .legal-body h2 {
          font-family: var(--display);
          font-size: clamp(20px, 2.2vw, 26px);
          font-weight: 500;
          margin: 36px 0 12px;
          letter-spacing: -0.005em;
        }
        .legal-body h3 {
          font-family: var(--display);
          font-size: clamp(16px, 1.8vw, 19px);
          font-weight: 500;
          margin: 24px 0 8px;
        }
        .legal-body p { margin: 0 0 14px; }
        .legal-body ul, .legal-body ol { margin: 0 0 14px; padding-left: 1.4em; }
        .legal-body li { margin: 0 0 6px; }
        .legal-body strong { font-weight: 500; color: var(--fg); }
        .legal-body code {
          font-family: var(--mono);
          font-size: 13px;
          padding: 1px 5px;
          background: color-mix(in oklab, var(--fg) 6%, transparent);
          border-radius: 3px;
        }
        .legal-body a { color: var(--ink); text-decoration: underline; text-underline-offset: 2px; }
        .legal-body a:hover { color: var(--fg); }
      `}</style>
    </>
  );
}
