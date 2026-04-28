import { resolvePublicOrigin } from '@sendero/seo';

import { createPageMetadata } from '@/lib/metadata';
import { getUpdatesSorted } from '@/lib/updates';

export const metadata = createPageMetadata({
  title: 'Updates · Sendero',
  description:
    'Release notes, platform updates, and shipped features for Sendero — agentic travel-ops with on-chain USDC settlement. New capabilities for the CLI, Claude Code plugin, MCP server, channel adapters, and billing.',
  path: '/updates',
  og: {
    title: 'Updates · Sendero',
    description: 'What just shipped on Sendero.',
  },
  keywords: [
    'sendero updates',
    'sendero changelog',
    'sendero release notes',
    'mcp server changelog',
    'claude code plugin updates',
  ],
});

const CATEGORY_LABEL: Record<string, string> = {
  platform: 'Platform',
  cli: 'CLI',
  plugin: 'Plugin',
  mcp: 'MCP',
  channels: 'Channels',
  billing: 'Billing',
  security: 'Security',
  docs: 'Docs',
};

export default function UpdatesPage() {
  const updates = getUpdatesSorted();
  const appOrigin = resolvePublicOrigin(
    process.env.NEXT_PUBLIC_APP_URL,
    'https://app.sendero.travel'
  );

  return (
    <main className="mk-root">
      <header className="mk-nav">
        <div className="mk-brand">
          <img
            alt=""
            className="mk-mark"
            decoding="async"
            src="/brand/logo-masters/clean/sendero_icon_vermilion_clean_2048.png"
          />
          <span>SENDERO</span>
          <span className="mk-x">·</span>
          <span>ARC</span>
        </div>
        <div className="mk-nav-tools">
          <nav className="mk-nav-apps" aria-label="Sendero product navigation">
            <a href="/">Home</a>
            <a href="/agents">Agents</a>
            <a href="/pricing">Pricing</a>
            <a href="/updates">Updates</a>
            <a href={appOrigin}>App</a>
          </nav>
        </div>
      </header>

      <section className="mk-hero" style={{ minHeight: 'auto', paddingBottom: 32 }}>
        <div className="mk-hero-copy" style={{ maxWidth: '70ch' }}>
          <div className="mk-eyebrow">Updates</div>
          <h1 className="mk-title">What just shipped on Sendero</h1>
          <p className="mk-subtitle">
            Release notes, platform updates, and feature drops. The newest changes — agent
            capabilities, CLI commands, MCP tooling, and on-chain plumbing — land here first.
          </p>
        </div>
      </section>

      <section
        style={{
          maxWidth: '900px',
          margin: '0 auto',
          padding: '0 max(24px, 6vw) 96px',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
          {updates.map((update) => (
            <article
              key={update.slug}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 16,
                padding: '32px',
                border: '1px solid color-mix(in oklab, var(--ink) 14%, transparent)',
                background: 'color-mix(in oklab, var(--ink) 2%, white)',
              }}
            >
              <header
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  alignItems: 'baseline',
                  gap: 12,
                }}
              >
                <span
                  style={{
                    fontFamily: 'var(--mono)',
                    fontSize: 11,
                    letterSpacing: '0.14em',
                    textTransform: 'uppercase',
                    color: 'var(--vermillion)',
                  }}
                >
                  v{update.version}
                </span>
                <span
                  style={{
                    fontFamily: 'var(--mono)',
                    fontSize: 11,
                    letterSpacing: '0.04em',
                    color: 'var(--muted)',
                  }}
                >
                  {update.date}
                </span>
                <div style={{ display: 'flex', gap: 6, marginLeft: 'auto', flexWrap: 'wrap' }}>
                  {update.categories.map((cat) => (
                    <span
                      key={cat}
                      style={{
                        fontFamily: 'var(--mono)',
                        fontSize: 10,
                        letterSpacing: '0.12em',
                        textTransform: 'uppercase',
                        padding: '3px 8px',
                        background: 'color-mix(in oklab, var(--ink) 8%, transparent)',
                        color: 'var(--ink)',
                      }}
                    >
                      {CATEGORY_LABEL[cat] ?? cat}
                    </span>
                  ))}
                </div>
              </header>

              <h2
                style={{
                  fontFamily: 'var(--display)',
                  fontSize: 'clamp(20px, 2.4vw, 28px)',
                  letterSpacing: '-0.005em',
                  fontWeight: 500,
                  margin: 0,
                  color: 'var(--ink)',
                }}
              >
                {update.title}
              </h2>

              <p style={{ fontSize: 14, lineHeight: 1.65, color: 'var(--ink)', margin: 0 }}>
                {update.summary}
              </p>

              <ul
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                  margin: 0,
                  padding: '0 0 0 1.2em',
                  fontSize: 13,
                  lineHeight: 1.6,
                  color: 'color-mix(in oklab, var(--ink) 80%, transparent)',
                }}
              >
                {update.highlights.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
