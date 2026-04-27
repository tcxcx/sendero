'use client';

/**
 * McpInstallCard — reusable "Wire Sendero into your AI tools" card.
 *
 * Single source of truth for the four canonical MCP install paths:
 * Claude Desktop, Claude Code, Codex CLI, Cursor / IDE. Renders a
 * PillTabs row across them and one snippet at a time so the surface
 * stays compact regardless of where it's embedded.
 *
 * Used in:
 *   - apps/app  · /dashboard/integrations/mcp (variant="standalone")
 *   - apps/app  · /dashboard/channels/slack share card (variant="embedded")
 *   - apps/docs · /docs/mcp-integration  (planned)
 *
 * The component is a leaf component — it takes URLs as props rather
 * than reading env, so it can render in any package or app without
 * pulling in `process.env.NEXT_PUBLIC_*`. Callers compose
 * `mcpUrl`, `apiKeysUrl`, `docsUrl` from their environment helper.
 *
 * Auth contract surfaced in the snippets: every MCP call requires
 * `Authorization: Bearer ak_…`. `/api/mcp` returns JSON-RPC -32001
 * without a valid key on POST. Read-only tools are NOT exempt.
 */

import { useState } from 'react';

import { motion } from 'motion/react';

import { PillTabs } from './pill-tabs';

interface McpInstallCardProps {
  /** Full URL of the MCP endpoint, e.g. `https://app.sendero.travel/api/mcp`. */
  mcpUrl: string;
  /** URL where the user can mint or manage API keys. Renders as inline link. */
  apiKeysUrl?: string;
  /** Optional canonical docs page for the MCP integration. When provided,
   *  renders a "Read full docs ↗" link below the snippet so users can dive
   *  deeper without leaving the card empty-handed. */
  docsUrl?: string;
  /** Hide the section heading + sub-copy when embedded in a larger card
   *  that already provides context (e.g. the Slack share card). */
  variant?: 'standalone' | 'embedded';
  /** Override the iconography for callers that don't ship the brand asset
   *  (e.g. external docs sites). Defaults to Sendero's AI-chip icon path
   *  served from `apps/app/public/brand/icons`. */
  iconSrc?: string;
}

type ClientKey = 'claude-desktop' | 'claude-code' | 'codex' | 'cursor';

interface SnippetMeta {
  label: string;
  filename?: string;
  lang: string;
  rows: number;
  text: string;
  /** Anchor fragment on the docs page so each tab can deep-link. */
  docsAnchor: string;
}

export function McpInstallCard({
  mcpUrl,
  apiKeysUrl,
  docsUrl,
  variant = 'standalone',
  iconSrc = '/brand/icons/16-ai-chip.png',
}: McpInstallCardProps) {
  const SNIPPETS: Record<ClientKey, SnippetMeta> = {
    'claude-desktop': {
      label: 'Claude Desktop',
      filename: '~/Library/Application Support/Claude/claude_desktop_config.json',
      lang: 'json',
      rows: 9,
      docsAnchor: 'claude-desktop',
      text: `{
  "mcpServers": {
    "sendero": {
      "type": "http",
      "url": "${mcpUrl}",
      "headers": { "Authorization": "Bearer ak_..." }
    }
  }
}`,
    },
    'claude-code': {
      label: 'Claude Code',
      lang: 'bash',
      rows: 4,
      docsAnchor: 'claude-code',
      text: `claude mcp add sendero \\
  --transport http \\
  --url ${mcpUrl} \\
  --header "Authorization: Bearer ak_..."`,
    },
    codex: {
      label: 'Codex CLI',
      filename: '~/.codex/config.toml',
      lang: 'toml',
      rows: 3,
      docsAnchor: 'codex',
      text: `[mcp_servers.sendero]
url = "${mcpUrl}"
headers = { Authorization = "Bearer ak_..." }`,
    },
    cursor: {
      label: 'Cursor / IDE',
      filename: '.cursor/mcp.json',
      lang: 'json',
      rows: 11,
      docsAnchor: 'cursor',
      text: `{
  "mcpServers": {
    "sendero": {
      "url": "${mcpUrl}",
      "headers": {
        "Authorization": "Bearer ak_..."
      }
    }
  }
}`,
    },
  };

  const [tab, setTab] = useState<ClientKey>('claude-desktop');
  const [copied, setCopied] = useState(false);
  const active = SNIPPETS[tab];

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(active.text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard blocked — value is visible in the textarea */
    }
  };

  const headingId = 'mcp-install-heading';
  const tabDocsHref = docsUrl ? `${docsUrl}#${active.docsAnchor}` : null;

  return (
    <section
      aria-labelledby={headingId}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        padding: variant === 'embedded' ? '14px 16px' : 20,
        borderRadius: variant === 'embedded' ? 10 : 12,
        background: 'var(--surface-floating, #fdfbf7)',
        border: '1px solid color-mix(in oklab, var(--ink, #1f2a44) 10%, transparent)',
      }}
    >
      {variant === 'standalone' ? (
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={iconSrc} alt="" style={{ width: 28, height: 28, objectFit: 'contain' }} />
          <div style={{ flex: 1 }}>
            <h2
              id={headingId}
              className="t-h3"
              style={{ fontSize: 17, lineHeight: 1.2, margin: 0 }}
            >
              Wire Sendero into your AI tools
            </h2>
            <p className="t-body ink-70" style={{ marginTop: 4, fontSize: 13, lineHeight: 1.55 }}>
              Pick your client. Paste the snippet. Replace{' '}
              <code className="t-mono" style={{ fontSize: 12 }}>
                ak_...
              </code>{' '}
              with a Sendero production API key
              {apiKeysUrl ? (
                <>
                  {' '}
                  —{' '}
                  <a
                    href={apiKeysUrl}
                    style={{ color: 'var(--ink, #1f2a44)', textDecoration: 'underline' }}
                  >
                    mint one here
                  </a>
                </>
              ) : null}
              .
            </p>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={iconSrc} alt="" style={{ width: 22, height: 22, objectFit: 'contain' }} />
          <div style={{ flex: 1 }}>
            <h3
              id={headingId}
              className="t-h4"
              style={{ margin: 0, fontSize: 14, lineHeight: 1.2 }}
            >
              For AI agents (MCP)
            </h3>
            <p
              className="t-body ink-70"
              style={{ margin: '2px 0 0', fontSize: 12, lineHeight: 1.5 }}
            >
              Pick your client and paste the snippet. Every call needs a Sendero API key.
            </p>
          </div>
        </div>
      )}

      <PillTabs<ClientKey>
        id="mcp-client-tabs"
        ariaLabel="Choose an MCP client"
        value={tab}
        onChange={setTab}
        tabs={(Object.keys(SNIPPETS) as ClientKey[]).map(k => ({
          value: k,
          label: SNIPPETS[k].label,
        }))}
      />

      <motion.div
        key={tab}
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
        style={{ display: 'flex', flexDirection: 'column', gap: 6 }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
            minHeight: 22,
          }}
        >
          {active.filename ? (
            <code
              className="t-mono"
              style={{
                fontSize: 10.5,
                padding: '2px 8px',
                borderRadius: 4,
                background: 'color-mix(in oklab, var(--ink, #1f2a44) 6%, transparent)',
                color: 'var(--ink, #1f2a44)',
              }}
            >
              {active.filename}
            </code>
          ) : (
            <span
              className="t-mono"
              style={{
                fontSize: 10,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                color: 'var(--text-dim, #666)',
              }}
            >
              {active.lang}
            </span>
          )}
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            {tabDocsHref ? (
              <a
                href={tabDocsHref}
                target="_blank"
                rel="noreferrer"
                style={ghostLinkStyle}
                title={`${active.label} docs`}
              >
                Docs ↗
              </a>
            ) : null}
            <button type="button" onClick={copy} style={ghostCopyBtn}>
              {copied ? 'Copied' : 'Copy snippet'}
            </button>
          </div>
        </div>
        <textarea
          readOnly
          value={active.text}
          rows={active.rows}
          onFocus={e => e.currentTarget.select()}
          style={{
            padding: '10px 12px',
            borderRadius: 6,
            border: '1px solid color-mix(in oklab, var(--ink, #1f2a44) 12%, transparent)',
            background: 'color-mix(in oklab, var(--ink, #1f2a44) 4%, transparent)',
            fontFamily: 'var(--font-mono-x, ui-monospace, SFMono-Regular, Menlo, monospace)',
            fontSize: 11.5,
            lineHeight: 1.55,
            color: 'var(--ink, #1f2a44)',
            resize: 'vertical',
          }}
        />
      </motion.div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 8,
        }}
      >
        <p
          style={{
            margin: 0,
            fontSize: 11,
            lineHeight: 1.5,
            color: 'var(--text-dim, #666)',
            flex: 1,
            minWidth: 0,
          }}
        >
          Endpoint:{' '}
          <code
            className="t-mono"
            style={{
              padding: '2px 6px',
              borderRadius: 4,
              background: 'color-mix(in oklab, var(--ink, #1f2a44) 6%, transparent)',
              fontSize: 10.5,
            }}
          >
            {mcpUrl}
          </code>
          . Every call requires{' '}
          <code className="t-mono" style={{ fontSize: 10.5 }}>
            Authorization: Bearer ak_…
          </code>
          .
        </p>
        {docsUrl ? (
          <a
            href={docsUrl}
            target="_blank"
            rel="noreferrer"
            style={{
              ...ghostLinkStyle,
              padding: '5px 12px',
              fontSize: 10.5,
            }}
          >
            Read MCP docs ↗
          </a>
        ) : null}
      </div>
    </section>
  );
}

const ghostCopyBtn: React.CSSProperties = {
  padding: '4px 10px',
  background: 'transparent',
  color: 'var(--ink, #1f2a44)',
  border: '1px solid color-mix(in oklab, var(--ink, #1f2a44) 18%, transparent)',
  borderRadius: 6,
  fontSize: 10,
  fontFamily: 'var(--font-mono-x, ui-monospace, monospace)',
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  fontWeight: 600,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

const ghostLinkStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  padding: '4px 10px',
  background: 'transparent',
  color: 'var(--ink, #1f2a44)',
  border: '1px solid color-mix(in oklab, var(--ink, #1f2a44) 18%, transparent)',
  borderRadius: 6,
  fontSize: 10,
  fontFamily: 'var(--font-mono-x, ui-monospace, monospace)',
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  fontWeight: 600,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  textDecoration: 'none',
};
