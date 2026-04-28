/**
 * /dashboard/integrations/claude-code — install page for the Sendero
 * Claude Code plugin. Mirrors the structure of /dashboard/integrations/mcp:
 * brand hero on the left, API keys + install snippet on the right,
 * checklist + "How this works" expander below.
 *
 * The plugin is a packaged Claude Code extension that bundles the
 * Sendero MCP server config plus a travel-booking skill that teaches
 * Claude when and how to call the tool surface. Unlike the raw MCP
 * tab (which gives users `claude mcp add sendero`), this is the
 * versioned, distributable equivalent — install once, namespaced as
 * `/sendero:travel-booking`, updates via marketplace.
 */

import { ClaudeCodePluginMark } from '@sendero/icons';

import ApiKeysPanel from '@/app/(app)/dashboard/settings/api-keys/page';
import { docsUrl as buildDocsUrl } from '@/lib/docs-url';

const APP_ORIGIN = (process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.sendero.travel').replace(
  /\/$/,
  ''
);
const PLUGIN_DOWNLOAD_URL = `${APP_ORIGIN}/downloads/sendero-claude-code-plugin.zip`;
const PLUGIN_REPO_URL = 'https://github.com/tcxcx/sendero/tree/main/apps/claude-code-plugin';

export default function ClaudeCodePluginIntegrationPage() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <header style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <h1 className="t-h1">Claude Code plugin</h1>
        <p className="t-body ink-70" style={{ maxWidth: '60ch' }}>
          A versioned Claude Code plugin that bundles the Sendero MCP server config plus a
          travel-booking skill. Install once, namespaced as <code className="t-mono">sendero</code>,
          and Claude knows when and how to use the full tool surface.
        </p>
      </header>

      <article
        className="sd-card-raised"
        style={{
          padding: 20,
          display: 'grid',
          gridTemplateColumns: 'minmax(220px, 260px) 1fr',
          gap: 24,
          alignItems: 'start',
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'flex-start',
            gap: 14,
            padding: '8px 4px',
          }}
        >
          <span style={{ color: 'var(--ink, #1f2a44)' }}>
            <ClaudeCodePluginMark size={140} />
          </span>
          <div
            style={{
              fontFamily: 'var(--font-mono-x, ui-monospace, monospace)',
              fontSize: 13,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              color: 'var(--ink, #1f2a44)',
              textAlign: 'center',
            }}
          >
            Sendero · v0.1.0
          </div>
          <div
            style={{
              fontSize: 12,
              lineHeight: 1.55,
              color: 'var(--text-dim, #555)',
              textAlign: 'center',
              maxWidth: 220,
            }}
          >
            Plugin includes the Sendero MCP server (
            <code className="t-mono" style={{ fontSize: 11 }}>
              .mcp.json
            </code>
            ) plus the
            <code className="t-mono" style={{ fontSize: 11 }}>
              {' '}
              /sendero:travel-booking
            </code>{' '}
            skill that teaches Claude when to use it.
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 18, minWidth: 0 }}>
          <ApiKeysPanel />

          <section
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
              padding: 16,
              borderRadius: 12,
              background: 'var(--surface-floating, #fdfbf7)',
              border: '1px solid color-mix(in oklab, var(--ink, #1f2a44) 10%, transparent)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span
                className="t-mono"
                style={{
                  fontSize: 11,
                  letterSpacing: '0.12em',
                  textTransform: 'uppercase',
                  color: 'var(--ink, #1f2a44)',
                }}
              >
                Install
              </span>
              <a
                href={PLUGIN_DOWNLOAD_URL}
                style={{
                  marginLeft: 'auto',
                  fontSize: 12,
                  fontWeight: 600,
                  color: 'var(--vermillion, #fb542b)',
                  textDecoration: 'none',
                }}
              >
                Download .zip ↓
              </a>
              <a
                href={PLUGIN_REPO_URL}
                target="_blank"
                rel="noreferrer"
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: 'var(--ink, #1f2a44)',
                  textDecoration: 'none',
                }}
              >
                View source ↗
              </a>
            </div>

            <pre
              className="t-mono"
              style={{
                margin: 0,
                padding: 14,
                fontSize: 12,
                lineHeight: 1.55,
                background: '#0e1320',
                color: '#fdfbf7',
                borderRadius: 8,
                overflowX: 'auto',
              }}
            >
              {`# Clone or download
git clone https://github.com/tcxcx/sendero.git

# Set the API key (sandbox or production)
export SENDERO_API_KEY=ak_your_key_here

# Launch Claude Code with the plugin loaded
claude --plugin-dir ./sendero/apps/claude-code-plugin

# Verify
/help    # → Sendero MCP server + /sendero:travel-booking skill should be listed`}
            </pre>

            <p style={{ margin: 0, fontSize: 12, color: 'var(--text-dim, #555)' }}>
              Once we publish to a plugin marketplace, the install collapses to
              <code className="t-mono" style={{ fontSize: 11 }}>
                {' '}
                /plugin marketplace add tcxcx/sendero
              </code>{' '}
              followed by{' '}
              <code className="t-mono" style={{ fontSize: 11 }}>
                /plugin install sendero@sendero
              </code>
              .
            </p>
          </section>

          <ol
            style={{
              margin: 0,
              padding: '14px 16px',
              listStyle: 'none',
              counterReset: 'plugin-step',
              background: 'var(--tint-vermillion-soft, rgba(251,84,43,0.05))',
              borderRadius: 10,
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              fontSize: 13,
              lineHeight: 1.5,
              color: 'var(--ink, #1f2a44)',
            }}
          >
            {[
              'Mint a production API key from the panel above (Clerk Manage keys).',
              'Export it as SENDERO_API_KEY in the shell where you launch Claude Code.',
              'Clone the repo or download the .zip, then point Claude Code at the plugin folder.',
              'Ask Claude: "Use Sendero to find a refundable flight from BUE to MIA on May 12."',
            ].map((step, i) => (
              <li
                // biome-ignore lint/suspicious/noArrayIndexKey: static checklist
                key={i}
                style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}
              >
                <span
                  aria-hidden
                  style={{
                    width: 22,
                    height: 22,
                    flexShrink: 0,
                    borderRadius: 11,
                    background: 'var(--vermillion, #fb542b)',
                    color: '#fdfbf7',
                    display: 'grid',
                    placeItems: 'center',
                    fontSize: 11,
                    fontWeight: 700,
                    fontFamily: 'var(--font-mono-x, ui-monospace, monospace)',
                  }}
                >
                  {i + 1}
                </span>
                <span>{step}</span>
              </li>
            ))}
          </ol>

          <details
            style={{
              padding: '10px 14px',
              borderRadius: 8,
              background: 'var(--surface-floating, #fdfbf7)',
              border: '1px solid color-mix(in oklab, var(--ink, #1f2a44) 10%, transparent)',
            }}
          >
            <summary
              style={{
                cursor: 'pointer',
                fontSize: 12,
                fontWeight: 600,
                color: 'var(--ink, #1f2a44)',
                userSelect: 'none',
                listStyle: 'none',
              }}
            >
              How this works ▾
            </summary>
            <div
              style={{
                marginTop: 10,
                fontSize: 12.5,
                lineHeight: 1.6,
                color: 'var(--text-dim, #555)',
              }}
            >
              <p style={{ margin: '0 0 8px' }}>
                <strong>Plugin = MCP + skill.</strong> The bundled{' '}
                <code className="t-mono">.mcp.json</code> registers Sendero as an HTTP MCP server,
                so all ~49 tools auto-discover when Claude Code starts. The bundled SKILL.md
                teaches Claude when to reach for them and how to call them safely (confirm scope
                before settlement, respect plan caps, never fabricate offer IDs).
              </p>
              <p style={{ margin: '0 0 8px' }}>
                <strong>Credential model:</strong> the plugin is{' '}
                <em>credential-less</em> — your API key lives in your env (
                <code className="t-mono">SENDERO_API_KEY</code>), not the manifest. Rotate keys
                from the dashboard without re-installing.
              </p>
              <p style={{ margin: '0 0 8px' }}>
                <strong>Plugin vs. raw MCP tab:</strong> the{' '}
                <a href="/dashboard/integrations/mcp" style={{ color: 'var(--vermillion, #fb542b)' }}>
                  MCP integration page
                </a>{' '}
                gives you the raw <code className="t-mono">claude mcp add sendero</code> command —
                fastest one-off wire-up. This plugin path adds versioning, the skill, and a
                marketplace-ready package — better for teams and shared workflows.
              </p>
              <p style={{ margin: 0 }}>
                <strong>Sister installer:</strong> Claude Desktop users should install the{' '}
                <a href={`${APP_ORIGIN}/downloads/sendero.mcpb`} style={{ color: 'var(--vermillion, #fb542b)' }}>
                  .mcpb bundle
                </a>{' '}
                instead — same MCP endpoint, packaged for the desktop app.
              </p>
            </div>
          </details>

          <div style={{ fontSize: 12, color: 'var(--text-dim, #555)' }}>
            <a
              href={buildDocsUrl('/docs/claude-code-plugin')}
              style={{ color: 'var(--vermillion, #fb542b)', textDecoration: 'none' }}
            >
              Read the full plugin docs ↗
            </a>
          </div>
        </div>
      </article>
    </div>
  );
}
