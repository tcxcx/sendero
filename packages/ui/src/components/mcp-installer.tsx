'use client';

/**
 * McpInstaller — single shared component for surfacing every Sendero
 * install path (CLI / Plugin / Skills / MCP) on a single tabbed panel.
 *
 * Lives in @sendero/ui because three callers need it:
 *  - apps/marketing /agents — public, no Clerk session, links to the
 *    dashboard for key minting via `apiKeysHref`.
 *  - apps/app dashboard      — Clerk-authed, slots the real
 *    `<APIKeys />` component into `apiKeysSlot`.
 *  - apps/docs               — public, same shape as marketing.
 *
 * The component does NOT mint API keys itself. Sendero keys are
 * Clerk-managed; users always go through Clerk's `<APIKeys />`
 * component (or the dashboard surface that wraps it). This component
 * either renders that slot inline (when authed) or sends the user to
 * the dashboard page that does (when public).
 *
 * Tabs:
 *   1. CLI    — npx @sendero/cli@latest, the one-line entry point.
 *   2. Plugin — Claude Code plugin (.mcp.json + skill bundle).
 *   3. Skills — list of bundled Claude Code skills + when each fires.
 *   4. MCP    — raw HTTP/JSON-RPC wire-up for direct MCP clients.
 *
 * Style: Sendero parchment + vermillion + ink. No Midday tokens.
 */

import { Check, Copy } from 'lucide-react';
import { useCallback, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';

import { cn } from '../utils/cn';

export type McpInstallerTab = 'cli' | 'plugin' | 'skills' | 'mcp';

export interface McpInstallerSkill {
  /** Slug used inside Claude Code (e.g. "travel-booking" → /sendero:travel-booking). */
  slug: string;
  /** Display name. */
  name: string;
  /** One-line "when this skill fires" hint. */
  trigger: string;
}

export interface McpInstallerProps {
  /** MCP endpoint, e.g. `https://app.sendero.travel/api/mcp`. */
  mcpUrl: string;
  /**
   * Where to send users to mint an API key. The Sendero rule: keys are
   * always minted via Clerk's `<APIKeys />` component, embedded in the
   * dashboard. Marketing + docs link out; the dashboard slots the
   * component inline via `apiKeysSlot`.
   */
  apiKeysHref?: string;
  /**
   * Optional inline render of Clerk's `<APIKeys />` (or the existing
   * ApiKeysPanel wrapper). When provided, the panel renders inline and
   * the "Get an API key" CTA collapses to a heading.
   */
  apiKeysSlot?: ReactNode;
  /** Initial tab. Defaults to 'cli'. */
  defaultTab?: McpInstallerTab;
  /** Skills bundled in the Claude Code plugin. Defaults to the canonical list. */
  skills?: ReadonlyArray<McpInstallerSkill>;
  /** Optional class for the outer card. */
  className?: string;
  /** Optional inline style override. */
  style?: CSSProperties;
}

const DEFAULT_SKILLS: ReadonlyArray<McpInstallerSkill> = [
  {
    slug: 'travel-booking',
    name: 'Travel booking',
    trigger:
      'Search inventory, place holds, ticket bookings, settle on-chain. The default skill — covers the happy-path agent surface.',
  },
  {
    slug: 'settlement',
    name: 'Settlement',
    trigger:
      'Confirm bookings + settle on-chain in USDC. Confirm-before-settle pattern, take-rate handling, Arcscan audit URL surfacing.',
  },
  {
    slug: 'reconciliation',
    name: 'Reconciliation',
    trigger: 'Match on-chain settlements with workspace bookings. Anomaly flagging + period close.',
  },
  {
    slug: 'cap-management',
    name: 'Cap management',
    trigger:
      'Read workspace spend caps before settling. Refuse CAP_EXCEEDED gracefully, propose tier-upgrade with concrete math.',
  },
  {
    slug: 'audit-export',
    name: 'Audit & export',
    trigger:
      'Trip summary PDFs, audit log CSVs, route maps, receipt zips. Pick the right format for the audience.',
  },
  {
    slug: 'cross-channel',
    name: 'Cross-channel',
    trigger:
      'Reason across WhatsApp, Slack, MCP, web. One Trip.events ledger; approvals route to the operator channel.',
  },
  {
    slug: 'agent-identity',
    name: 'Agent identity (ERC-8004)',
    trigger:
      'Register agents and identities on-chain. Pin verifiable agent ids to settlements for auditors.',
  },
];

const TABS: ReadonlyArray<{ value: McpInstallerTab; label: string }> = [
  { value: 'cli', label: 'CLI' },
  { value: 'plugin', label: 'Plugin' },
  { value: 'skills', label: 'Skills' },
  { value: 'mcp', label: 'MCP' },
];

export function McpInstaller({
  mcpUrl,
  apiKeysHref = 'https://app.sendero.travel/dashboard/settings/api-keys',
  apiKeysSlot,
  defaultTab = 'cli',
  skills = DEFAULT_SKILLS,
  className,
  style,
}: McpInstallerProps) {
  const [tab, setTab] = useState<McpInstallerTab>(defaultTab);

  return (
    <div
      className={cn(
        'mcp-installer flex w-full flex-col gap-5 border bg-[var(--surface-raised,#fdfbf7)] p-6',
        className
      )}
      style={{
        borderColor: 'color-mix(in oklab, var(--ink, #1f2a44) 18%, transparent)',
        ...style,
      }}
    >
      <header className="flex flex-col gap-1">
        <h2 className="font-sans text-xl tracking-tight text-[var(--ink,#1f2a44)]">
          Install Sendero
        </h2>
        <p className="text-sm text-[color-mix(in_oklab,var(--ink,#1f2a44)_65%,transparent)]">
          One CLI, one plugin, one MCP endpoint. Pick how you want to wire your agent in.
        </p>
      </header>

      <nav
        role="tablist"
        aria-label="Sendero install paths"
        className="flex w-full border-b"
        style={{ borderColor: 'color-mix(in oklab, var(--ink, #1f2a44) 18%, transparent)' }}
      >
        {TABS.map(t => {
          const active = t.value === tab;
          return (
            <button
              key={t.value}
              type="button"
              role="tab"
              aria-selected={active}
              aria-controls={`mcp-installer-panel-${t.value}`}
              id={`mcp-installer-tab-${t.value}`}
              onClick={() => setTab(t.value)}
              className={cn(
                'relative flex-1 border-b-2 px-3 py-2 font-mono text-[11px] uppercase tracking-[0.14em] transition-colors',
                active ? '' : 'hover:text-[var(--ink,#1f2a44)]'
              )}
              style={{
                color: active
                  ? 'var(--ink, #1f2a44)'
                  : 'color-mix(in oklab, var(--ink, #1f2a44) 55%, transparent)',
                borderBottomColor: active ? 'var(--vermillion, #fb542b)' : 'transparent',
                marginBottom: '-1px',
              }}
            >
              {t.label}
            </button>
          );
        })}
      </nav>

      <div
        id={`mcp-installer-panel-${tab}`}
        role="tabpanel"
        aria-labelledby={`mcp-installer-tab-${tab}`}
        className="flex flex-col gap-4"
      >
        {tab === 'cli' ? <CliPanel mcpUrl={mcpUrl} /> : null}
        {tab === 'plugin' ? <PluginPanel /> : null}
        {tab === 'skills' ? <SkillsPanel skills={skills} /> : null}
        {tab === 'mcp' ? <McpPanel mcpUrl={mcpUrl} /> : null}
      </div>

      <footer
        className="flex flex-col gap-3 border-t pt-4"
        style={{ borderColor: 'color-mix(in oklab, var(--ink, #1f2a44) 12%, transparent)' }}
      >
        <div className="flex flex-col gap-1">
          <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--ink,#1f2a44)]">
            API key
          </span>
          <p className="text-xs text-[color-mix(in_oklab,var(--ink,#1f2a44)_65%,transparent)]">
            Sendero keys are minted via Clerk in the dashboard. Sandbox keys ship with every new
            workspace; production keys are gated by your plan tier.
          </p>
        </div>
        {apiKeysSlot ? (
          <div>{apiKeysSlot}</div>
        ) : (
          <a
            href={apiKeysHref}
            target={apiKeysHref.startsWith('http') ? '_blank' : undefined}
            rel={apiKeysHref.startsWith('http') ? 'noreferrer' : undefined}
            className="inline-flex h-10 w-fit items-center justify-center px-5 font-mono text-[12px] uppercase tracking-[0.14em] text-[var(--parchment,#fdfbf7)] transition-colors hover:opacity-90"
            style={{ background: 'var(--ink, #1f2a44)' }}
          >
            Get an API key →
          </a>
        )}
      </footer>
    </div>
  );
}

function CliPanel({ mcpUrl }: { mcpUrl: string }) {
  const apiKeyHint = 'ak_your_key_here';
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-[color-mix(in_oklab,var(--ink,#1f2a44)_70%,transparent)]">
        The fastest path. One <code className="font-mono text-xs">npx</code> command, no global
        install. Auth runs in your browser and writes{' '}
        <code className="font-mono text-xs">~/.sendero/key</code> with chmod 600.
      </p>
      <CodeBlock
        label="1 · Mint and save an API key"
        language="bash"
        code={`npx @sendero/cli@latest auth login`}
      />
      <CodeBlock
        label="2 · Bootstrap the Claude Code plugin"
        language="bash"
        code={`npx @sendero/cli@latest mcp install`}
      />
      <CodeBlock
        label="3 · List the live tool catalog"
        language="bash"
        code={`npx @sendero/cli@latest tools list`}
      />
      <CodeBlock
        label="4 · Dispatch a tool (JSON-RPC over /api/mcp)"
        language="bash"
        code={`npx @sendero/cli@latest tools call search_flights '{"origin":"BUE","destination":"MIA","date":"2026-05-12"}'`}
      />
      <details className="text-xs text-[color-mix(in_oklab,var(--ink,#1f2a44)_70%,transparent)]">
        <summary className="cursor-pointer font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--ink,#1f2a44)]">
          Endpoint override (advanced)
        </summary>
        <p className="mt-2">
          Set <code className="font-mono">SENDERO_API_URL</code> to a non-prod base (e.g., staging).
          The CLI reuses it for both <code className="font-mono">/api/openapi.json</code> and{' '}
          <code className="font-mono">{mcpUrl.replace(/^https?:\/\/[^/]+/, '')}</code>. Set{' '}
          <code className="font-mono">SENDERO_API_KEY={apiKeyHint}</code> to bypass the saved file
          (useful in CI).
        </p>
      </details>
    </div>
  );
}

function PluginPanel() {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-[color-mix(in_oklab,var(--ink,#1f2a44)_70%,transparent)]">
        Versioned, distributable. Bundles the MCP server config plus a skill that teaches Claude
        when and how to use Sendero — confirm scope before settlement, respect plan caps, never
        fabricate offer IDs, surface Arcscan audit URLs.
      </p>
      <CodeBlock
        label="Option A · CLI bootstrap (recommended)"
        language="bash"
        code={`npx @sendero/cli@latest mcp install`}
      />
      <CodeBlock
        label="Option B · Clone + load locally"
        language="bash"
        code={`git clone https://github.com/tcxcx/sendero.git
export SENDERO_API_KEY=ak_your_key_here
claude --plugin-dir ./sendero/apps/claude-code-plugin`}
      />
      <CodeBlock
        label="Option C · Marketplace (once published)"
        language="bash"
        code={`/plugin marketplace add tcxcx/sendero
/plugin install sendero@sendero`}
      />
      <p className="text-xs text-[color-mix(in_oklab,var(--ink,#1f2a44)_60%,transparent)]">
        Verify with <code className="font-mono text-xs">/help</code> — the Sendero MCP server and
        the <code className="font-mono text-xs">/sendero:travel-booking</code> skill should both be
        listed.
      </p>
    </div>
  );
}

function SkillsPanel({ skills }: { skills: ReadonlyArray<McpInstallerSkill> }) {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-[color-mix(in_oklab,var(--ink,#1f2a44)_70%,transparent)]">
        Skills are markdown files inside the plugin that teach Claude when to call which Sendero
        tools. They auto-load when the plugin is installed; trigger by asking Claude in plain
        language.
      </p>
      <div className="flex flex-col gap-3">
        {skills.map(skill => (
          <div
            key={skill.slug}
            className="flex flex-col gap-1.5 border p-4"
            style={{
              borderColor: 'color-mix(in oklab, var(--ink, #1f2a44) 18%, transparent)',
              background: 'color-mix(in oklab, var(--ink, #1f2a44) 3%, white)',
            }}
          >
            <div className="flex items-baseline justify-between gap-3">
              <span className="font-sans text-sm font-semibold text-[var(--ink,#1f2a44)]">
                {skill.name}
              </span>
              <code className="font-mono text-[11px] text-[var(--vermillion,#fb542b)]">
                /sendero:{skill.slug}
              </code>
            </div>
            <p className="text-xs text-[color-mix(in_oklab,var(--ink,#1f2a44)_65%,transparent)]">
              {skill.trigger}
            </p>
          </div>
        ))}
        <p className="text-[11px] uppercase tracking-[0.14em] text-[color-mix(in_oklab,var(--ink,#1f2a44)_55%,transparent)]">
          Skills auto-load when the plugin is installed. The list will be tuned during the mainnet
          cutover and locked in v1.0.
        </p>
      </div>
    </div>
  );
}

function McpPanel({ mcpUrl }: { mcpUrl: string }) {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-[color-mix(in_oklab,var(--ink,#1f2a44)_70%,transparent)]">
        Direct MCP wire-up — no plugin, no skill, just the tool surface. Use this for clients that
        haven't adopted the Claude Code plugin format (Codex, Cursor, VS Code, custom agents).
      </p>
      <CodeBlock
        label="Claude Code (one-shot)"
        language="bash"
        code={`claude mcp add sendero \\
  --transport http \\
  --url ${mcpUrl} \\
  --header "Authorization: Bearer ak_your_key_here"`}
      />
      <CodeBlock
        label="Cursor / VS Code (mcp.json)"
        language="json"
        code={`{
  "mcpServers": {
    "sendero": {
      "type": "http",
      "url": "${mcpUrl}",
      "headers": { "Authorization": "Bearer ak_your_key_here" }
    }
  }
}`}
      />
      <CodeBlock
        label="Codex (~/.codex/config.toml)"
        language="toml"
        code={`[mcp_servers.sendero]
url = "${mcpUrl}"
headers = { Authorization = "Bearer ak_your_key_here" }`}
      />
    </div>
  );
}

function CodeBlock({
  label,
  language,
  code,
}: {
  label: string;
  language: 'bash' | 'json' | 'toml';
  code: string;
}) {
  const [copied, setCopied] = useState(false);
  const onCopy = useCallback(async () => {
    if (typeof window === 'undefined' || !navigator?.clipboard?.writeText) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      // Best-effort; older browsers / sandboxed iframes drop clipboard.
    }
  }, [code]);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--ink,#1f2a44)]">
          {label}
        </span>
        <span
          className="font-mono text-[10px] uppercase tracking-[0.18em]"
          style={{ color: 'color-mix(in oklab, var(--ink, #1f2a44) 50%, transparent)' }}
        >
          {language}
        </span>
      </div>
      <div className="relative">
        <pre
          className="overflow-x-auto p-4 pr-12 font-mono text-[12px] leading-[1.55]"
          style={{
            background: '#0e1320',
            color: '#fdfbf7',
            border: '1px solid color-mix(in oklab, var(--ink, #1f2a44) 18%, transparent)',
          }}
        >
          {code}
        </pre>
        <button
          type="button"
          onClick={onCopy}
          aria-label={copied ? 'Copied' : 'Copy to clipboard'}
          className="absolute right-2 top-2 inline-flex h-7 w-7 items-center justify-center rounded-sm text-[#fdfbf7]/70 transition hover:text-[#fdfbf7]"
          style={{
            background: 'color-mix(in oklab, #fdfbf7 8%, transparent)',
          }}
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        </button>
      </div>
    </div>
  );
}
