/**
 * Sendero updates feed — drives the /updates marketing page.
 *
 * Source of truth for now: this typed array. Each entry has a
 * version, date, headline, summary, and optional category tags.
 * Newest first; the /updates index page pages over them.
 *
 * When we eventually move to MDX (Midday-style — see
 * `/Users/criptopoeta/Downloads/midday-main\ 2/apps/website/src/lib/blog.ts`
 * for their pattern), the route shape stays the same: same fields,
 * same sort, swap this loader for `getBlogPosts()`.
 */

export type UpdateCategory =
  | 'platform'
  | 'cli'
  | 'plugin'
  | 'mcp'
  | 'channels'
  | 'billing'
  | 'security'
  | 'docs';

export interface UpdateEntry {
  /** Slug for the eventual /updates/[slug] route. Stable, kebab-case. */
  slug: string;
  /** Version this update covers. */
  version: string;
  /** Publication date (YYYY-MM-DD). */
  date: string;
  /** Headline shown in the index list. */
  title: string;
  /** One-paragraph summary. */
  summary: string;
  /** Bullet-point highlights of what shipped. */
  highlights: string[];
  /** Categories for filtering / pills. */
  categories: UpdateCategory[];
}

export const UPDATES: UpdateEntry[] = [
  {
    slug: 'v0-4-0-platform-release',
    version: '0.4.0',
    date: '2026-04-28',
    title: 'Platform release — unified inbox, MCPB, /playground, Claude Code plugin',
    summary:
      "First Sendero platform-wide release. The trip ledger goes unified across WhatsApp, Slack, MCP, and the operator console. We ship a one-click .mcpb installer for Claude Desktop, a versioned plugin for Claude Code with a /sendero:travel-booking skill, the new /playground sandbox surface, and a hardened settle-action TOCTOU close.",
    highlights: [
      'Unified inbox ledger — WhatsApp + Slack + dispatch all write to a single Trip.events stream',
      'Operator console KPIs (Today / Settled-30d / Avg-response) computed from real Trip.events latency',
      'Claude Desktop one-click .mcpb installer (apps/mcpb), branded download at /downloads/sendero.mcpb',
      'Claude Code plugin (apps/claude-code-plugin) with /sendero:travel-booking skill and shared <McpInstaller />',
      '/playground sign-in-gated sandbox surface — full agent loop, sandbox-routed, per-user + per-IP rate limits',
      'TransferAttempt unique partial index closes the settle-action TOCTOU race',
      'OG_SHARE_SIGNING_SECRET hard-split from INVOICE_SIGNING_SECRET — independent rotation',
    ],
    categories: ['platform', 'plugin', 'mcp', 'channels', 'security'],
  },
  {
    slug: 'v0-3-mcp-integration-polish',
    version: '0.3.0',
    date: '2026-04-15',
    title: 'MCP integration — Cursor, VS Code, Codex deep-links',
    summary:
      'One-click MCP install URLs for Cursor and VS Code. Codex CLI config snippet for ~/.codex/config.toml. Updated docs site with MCP integration guide and the Sendero tool catalog inside Claude Desktop.',
    highlights: [
      'McpInstallCard with PillTabs across Claude Desktop / Claude Code / Codex / Cursor / VS Code',
      'cursor.com/install-mcp deep link (b64-encoded Sendero config)',
      'vscode:mcp/install URL for VS Code one-click adoption',
      'apps/docs/content/docs/mcp-integration.mdx — full integration guide',
      "OpenAPI 3.1 spec at /api/openapi.json — single source of truth for tools and llms.txt",
    ],
    categories: ['mcp', 'docs'],
  },
  {
    slug: 'v0-2-channel-rendering-shared',
    version: '0.2.0',
    date: '2026-04-01',
    title: 'Canonical channel-render layer + share-image system',
    summary:
      'Every agent message — text, card, tool call, approval request — now flows through one canonical ChannelMessage union before any surface paints it. Slack Block Kit, WhatsApp Cloud API interactive messages, web bubbles, and email all render from the same input. New Satori-based share image generator with HMAC-signed tokens.',
    highlights: [
      'apps/app/lib/channel-render — ChannelMessage discriminated union covers text, card, tool_invocation, tool_result, approval_request, reasoning, sources',
      'Per-channel renderers: operator (web), Slack Block Kit, WhatsApp Cloud, web traveler',
      'apps/app/lib/channel-send — orchestrators that combine canonical render + native send primitives',
      'Satori share image generator at /api/og/share — HMAC-signed payloads, fail-soft on signature mismatch',
      'Bundle-leak guard test prevents server-only renderers from sneaking into client bundles',
    ],
    categories: ['platform', 'channels'],
  },
  {
    slug: 'v0-1-on-chain-settlement-arc',
    version: '0.1.0',
    date: '2026-03-15',
    title: 'On-chain settlement on Arc — first end-to-end booking',
    summary:
      'Sendero settles its first end-to-end booking on Circle Arc-Testnet. Confirm a flight, the booking is ticketed, settlement lands on-chain, the audit URL surfaces in the response. Two revenue legs (SaaS + nanopayments) fully wired through Clerk Billing and Circle Wallet.',
    highlights: [
      'Circle Wallet integration (Arc-Testnet USDC) — every workspace gets a treasury wallet',
      'confirm_booking tool ticks the offer + writes the on-chain audit row in one call',
      'NanopayBatch + MeterEvent pipeline — sandbox keys route to MeterEvent.status="sandbox"',
      'SenderoStamps ERC-1155 deployed via Circle SCP at 0xcc0fa83…b71a03',
      'Clerk Billing 4-tier plan (Free / Basic / Pro / Enterprise) with materialized discount basis points',
    ],
    categories: ['platform', 'billing'],
  },
];

/** Most recent first. */
export function getUpdatesSorted(): UpdateEntry[] {
  return [...UPDATES].sort((a, b) => (a.date > b.date ? -1 : 1));
}
