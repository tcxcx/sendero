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

  // Header + footer come from app/layout.tsx (SiteHeader / SiteFooter).
  return (
    <>
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          {updates.map((update, idx) => (
            <article
              key={update.slug}
              className="updates-card"
              style={{
                position: 'relative',
                display: 'grid',
                gridTemplateColumns: 'minmax(120px, 160px) 1fr',
                gap: 32,
                padding: '36px 32px',
                background: '#fdfbf7',
                border: '1px solid color-mix(in oklab, var(--fg) 14%, transparent)',
              }}
            >
              {/*
                Left rail: editorial release-marker. Big version number set
                in the display serif, date below in mono. Picks up the
                editorial-magazine rhythm Sendero's brand book asks for
                (DESIGN.md §1) without recycling the generic "card with
                metadata pills above headline" pattern.
              */}
              <aside
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                  borderRight: '1px solid color-mix(in oklab, var(--fg) 10%, transparent)',
                  paddingRight: 24,
                }}
              >
                <span
                  style={{
                    fontFamily: 'var(--mono-x)',
                    fontSize: 10,
                    letterSpacing: '0.18em',
                    textTransform: 'uppercase',
                    color: 'color-mix(in oklab, var(--fg) 50%, transparent)',
                  }}
                >
                  Release {String(updates.length - idx).padStart(2, '0')}
                </span>
                <span
                  style={{
                    fontFamily: 'var(--display)',
                    fontSize: 'clamp(28px, 3.4vw, 38px)',
                    fontWeight: 450,
                    letterSpacing: '-0.01em',
                    color: 'var(--ink)',
                    lineHeight: 1,
                  }}
                >
                  v{update.version}
                </span>
                <span
                  style={{
                    fontFamily: 'var(--mono-x)',
                    fontSize: 11,
                    letterSpacing: '0.04em',
                    color: 'color-mix(in oklab, var(--fg) 55%, transparent)',
                    marginTop: 4,
                  }}
                >
                  {update.date}
                </span>
              </aside>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {update.categories.map(cat => (
                    <span
                      key={cat}
                      style={{
                        fontFamily: 'var(--mono-x)',
                        fontSize: 10,
                        letterSpacing: '0.14em',
                        textTransform: 'uppercase',
                        padding: '3px 8px',
                        border: '1px solid color-mix(in oklab, var(--ink) 35%, transparent)',
                        color: 'var(--ink)',
                        background: 'color-mix(in oklab, var(--ink) 5%, white)',
                      }}
                    >
                      {CATEGORY_LABEL[cat] ?? cat}
                    </span>
                  ))}
                </div>

                <h2
                  style={{
                    fontFamily: 'var(--display)',
                    fontSize: 'clamp(22px, 2.6vw, 30px)',
                    letterSpacing: '-0.005em',
                    fontWeight: 450,
                    margin: 0,
                    color: 'var(--fg)',
                    lineHeight: 1.18,
                    textWrap: 'balance',
                  }}
                >
                  {update.title}
                </h2>

                <p
                  style={{
                    fontSize: 15,
                    lineHeight: 1.65,
                    color: 'var(--fg)',
                    margin: 0,
                    maxWidth: '62ch',
                  }}
                >
                  {update.summary}
                </p>

                <ul
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                    margin: '4px 0 0',
                    padding: 0,
                    listStyle: 'none',
                    fontSize: 13,
                    lineHeight: 1.6,
                    color: 'color-mix(in oklab, var(--fg) 72%, transparent)',
                  }}
                >
                  {update.highlights.map(line => (
                    <li
                      key={line}
                      style={{
                        position: 'relative',
                        paddingLeft: 16,
                      }}
                    >
                      <span
                        aria-hidden="true"
                        style={{
                          position: 'absolute',
                          left: 0,
                          top: '0.7em',
                          width: 6,
                          height: 1,
                          background: 'var(--ink)',
                        }}
                      />
                      {line}
                    </li>
                  ))}
                </ul>
              </div>
            </article>
          ))}
        </div>
      </section>

      {/*
        Editorial hover state — entry cards lift slightly + the left
        rail border turns vermillion. Subtle reward for moving the
        cursor over a release; not a banner-ad bounce.
      */}
      <style>{`
        .updates-card {
          transition: transform 200ms ease-out, border-color 200ms ease-out;
        }
        .updates-card:hover {
          transform: translateY(-2px);
          border-color: color-mix(in oklab, var(--fg) 28%, transparent);
        }
        .updates-card:hover aside {
          border-right-color: var(--ink) !important;
        }
        @media (max-width: 720px) {
          .updates-card {
            grid-template-columns: 1fr !important;
            gap: 16px !important;
            padding: 24px !important;
          }
          .updates-card aside {
            border-right: 0 !important;
            border-bottom: 1px solid color-mix(in oklab, var(--fg) 10%, transparent);
            padding-right: 0 !important;
            padding-bottom: 16px;
            flex-direction: row !important;
            align-items: baseline;
            gap: 12px !important;
          }
        }
      `}</style>
    </>
  );
}
