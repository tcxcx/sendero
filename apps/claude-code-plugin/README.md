# Sendero — Claude Code Plugin

AI travel booking with on-chain USDC settlement, available as a
first-class plugin for [Claude Code](https://claude.com/claude-code).

This plugin bundles the Sendero MCP server (`https://app.sendero.travel/api/mcp`)
plus a travel-booking skill that teaches Claude when to reach for it
and how to call it safely.

## What you get after install

- ~49 MCP tools (`search_flights`, `hold`, `confirm_booking`,
  `settle_*`, `wallet_balance`, `export_*`, etc.) auto-discovered
  via the bundled `.mcp.json`.
- A `/sendero:travel-booking` skill that gives Claude the operating
  rules: confirm scope before settlement, respect plan caps, never
  fabricate offer IDs, surface the Arcscan audit URL after every
  `confirm_booking`.

## Install

### One-line (plugin marketplace, recommended once we publish)

```bash
/plugin marketplace add tcxcx/sendero
/plugin install sendero@sendero
```

### From a local clone (today)

```bash
git clone https://github.com/tcxcx/sendero.git
claude --plugin-dir ./sendero/apps/claude-code-plugin
```

### Configure the API key

Mint a key (sandbox or production) at
[app.sendero.travel/dashboard/settings/api-keys](https://app.sendero.travel/dashboard/settings/api-keys),
then export it before launching Claude Code:

```bash
export SENDERO_API_KEY=ak_your_key_here
# Optional override for self-hosted / staging:
# export SENDERO_MCP_URL=https://staging.sendero.travel/api/mcp
claude
```

Verify the install:

```
/help
# You should see the Sendero MCP server listed and the
# /sendero:travel-booking skill available.
```

Then ask Claude something like:

> "Use Sendero to find a refundable flight from BUE to MIA on May 12."

## What's inside

```
apps/claude-code-plugin/
├── .claude-plugin/
│   └── plugin.json       — manifest (name=sendero, version=0.1.0)
├── .mcp.json             — Sendero HTTP MCP server config
├── skills/
│   └── travel-booking/
│       └── SKILL.md      — operating rules, plan tiers, failure modes
├── icons/                — brand assets
└── scripts/
    └── pack.ts           — packaging helper for releases
```

The plugin is **stateless and credential-less**. Your API key lives in
your env, not in the plugin manifest. Rotate keys from the dashboard
without re-installing.

## Plan-tier reminders

| Tier | Monthly cap | Production keys | Nanopay discount |
|---|---|---|---|
| Free | $100 | 0 (sandbox only) | 0% |
| Basic ($19/mo) | $2,000 | 3 | 15% |
| Pro ($60/mo) | $20,000 | 25 | 30% |
| Enterprise (contact) | unlimited | unlimited | 50% |

Pro plan: 14-day trial, no card required.

## Sister installer for Claude Desktop

If you want the same surface inside Claude Desktop instead, install
the [Sendero MCPB bundle](https://app.sendero.travel/downloads/sendero.mcpb)
— it's the same MCP endpoint, packaged as a `.mcpb` extension.

## Related

- [Sendero docs](https://sendero.travel/docs)
- [MCP integration guide](https://sendero.travel/docs/mcp-integration)
- [Live OpenAPI spec](https://app.sendero.travel/api/openapi.json)
- [llms.txt](https://sendero.travel/llms.txt)

## License

Apache-2.0
