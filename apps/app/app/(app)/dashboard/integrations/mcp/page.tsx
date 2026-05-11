/**
 * /dashboard/integrations/mcp — operator's "wire Sendero into my AI tools" page.
 *
 * Two-column hero layout matching the Slack share card:
 *   left rail  → brand panel + icon strip (visual anchor)
 *   right rail → API keys panel (Clerk-native) → MCP install card with
 *                PillTabs across Claude Desktop / Claude Code / Codex /
 *                Cursor → checklist → "How this works" expander.
 *
 * Single source of truth for the four MCP install snippets is
 * `<McpInstallCard />`; the same component renders inside the Slack
 * share card so docs + dashboard never drift.
 */

import { McpInstallCard } from '@sendero/ui/mcp-install-card';

import ApiKeysPanel from '@/app/(app)/dashboard/settings/api-keys/page';
import { McpIntegrationHero } from '@/components/channels/mcp-integration-hero';
import { docsUrl as buildDocsUrl } from '@/lib/docs-url';

const APP_ORIGIN = (process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.sendero.travel').replace(
  /\/$/,
  ''
);

export default function McpIntegrationsPage() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <header style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <h1 className="t-h1">MCP integration</h1>
        <p className="t-body ink-70" style={{ maxWidth: '60ch' }}>
          Sendero exposes its full tool surface — flight search, booking, holds, settlement, stamps
          — as an MCP server. Wire it into Claude Desktop, Claude Code, Codex, Cursor, or any
          MCP-compatible agent.
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
        <McpIntegrationHero />

        <div style={{ display: 'flex', flexDirection: 'column', gap: 18, minWidth: 0 }}>
          <ApiKeysPanel />
          <McpInstallCard
            mcpUrl={`${APP_ORIGIN}/api/mcp`}
            apiKeysUrl="/dashboard/settings/api-keys"
            docsUrl={buildDocsUrl('/docs/mcp-integration')}
            variant="standalone"
          />

          <ol
            style={{
              margin: 0,
              padding: '14px 16px',
              listStyle: 'none',
              counterReset: 'mcp-step',
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
              "Pick your client below and copy the snippet — it's a one-liner per tool.",
              'Replace ak_... with your key, then restart the agent.',
              'Ask: "Use Sendero to search flights from BUE to SFO on May 15."',
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
                <strong>Tool surface:</strong> the same canonical tool registry that powers
                <code className="t-mono" style={{ fontSize: 11 }}>
                  {' '}
                  /api/agent/dispatch
                </code>{' '}
                is exposed via MCP. Read tools (<code className="t-mono">search_flights</code>,
                <code className="t-mono"> search_stays</code>) and write tools (
                <code className="t-mono">book_flight</code>,{' '}
                <code className="t-mono">settle_invoice</code>) flow through the same auth gate.
              </p>
              <p style={{ margin: '0 0 8px' }}>
                <strong>Auth:</strong> every MCP method (<code className="t-mono">tools/list</code>,
                <code className="t-mono"> tools/call</code>) requires{' '}
                <code className="t-mono">Authorization: Bearer ak_…</code>. The key resolves to your
                tenant; metered tool calls bill against your workspace's plan tier and settlement
                wallet (Arc Circle MSCA or Solana Squads V4 vault, per your tenant's primary chain),
                with your plan's nanopayment discount applied.
              </p>
              <p style={{ margin: '0 0 8px' }}>
                <strong>Sandbox vs. production:</strong> sandbox keys (auto-minted on workspace
                creation) route every meter event into{' '}
                <code className="t-mono">MeterEvent.status = 'sandbox'</code> — no real USDC moves.
                Switch to a production key once you're ready to settle.
              </p>
              <p style={{ margin: 0 }}>
                <strong>Trouble?</strong> If <code className="t-mono">tools/list</code> returns
                JSON-RPC error <code className="t-mono">-32001</code>, the bearer header is missing
                or your key was revoked — re-mint above and retry.
              </p>
            </div>
          </details>
        </div>
      </article>
    </div>
  );
}
