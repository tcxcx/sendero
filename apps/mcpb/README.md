# `@sendero/mcpb`

One-click Claude Desktop installer for the Sendero MCP server.

## What it does

Bundles a tiny stdio→HTTP proxy as an `.mcpb` file (MCP Bundle format,
formerly `.dxt`). Users double-click the bundle in Claude Desktop, paste
their Sendero API key, and the agent works immediately. The proxy
forwards every JSON-RPC request to `https://app.sendero.travel/api/mcp`
with `Authorization: Bearer <user_config.api_key>`.

## Layout

```
apps/mcpb/
├── manifest.json          MCPB v0.3 manifest (consumed by Claude Desktop)
├── icon.png               512×512 brand mark for the install dialog
├── icons/                 size variants for the directory listing
├── server/
│   ├── index.ts           ~80-line stdio proxy (no external deps at runtime)
│   └── package.json       declares Node 20+ + @modelcontextprotocol/sdk dev
├── scripts/
│   └── build.ts           bun build + mcpb pack
├── dist/                  build output (gitignored)
└── sendero-<version>.mcpb final artifact (gitignored)
```

## Build

```bash
cd apps/mcpb
bun run build
```

Produces `apps/mcpb/sendero-0.1.0.mcpb`.

## Test locally

1. `bun run build`
2. Open Claude Desktop → Settings → Extensions → "Install from file…"
3. Pick the freshly built `sendero-<version>.mcpb`.
4. Paste a sandbox API key when prompted (mint at
   [/dashboard/settings/api-keys](https://app.sendero.travel/dashboard/settings/api-keys)).
5. Open a new chat, type `Use Sendero to search flights from BUE to SFO May 15`.

## Release

Tagged releases auto-build and attach the `.mcpb` to a GitHub Release via
`.github/workflows/mcpb-release.yml`. Cut a release with:

```bash
# Bump the version in apps/mcpb/package.json AND apps/mcpb/manifest.json,
# commit, tag, push.
git tag mcpb-v0.1.0
git push origin mcpb-v0.1.0
```

Stable canonical download:
`https://github.com/tcxcx/sendero/releases/latest/download/sendero.mcpb`

App-served redirect:
`https://app.sendero.travel/downloads/sendero.mcpb`

## Submit to Anthropic's curated directory

Once a stable v0.1+ ships, submit via the form linked at
<https://claude.com/docs/connectors/building/submission>. Required:

- `manifest.json` includes `privacy_policies` (we point at sendero.travel/legal/privacy)
- `icon.png` is 512×512 PNG (we resampled from the 2048×2048 brand master)
- Working install + tools/list demo on a clean Claude Desktop
- Repo link, support email, screenshots

Review queue is opaque — days to weeks.

## What this is NOT

- Not an OAuth flow. Bearer tokens only. When Anthropic fixes the
  Custom-Connectors UI to allow Bearer headers, we revisit
  whether to also offer the native remote-MCP path.
- Not a workspace runtime dep. Nothing in `apps/app` or `packages/*`
  imports from here. This package only ships the bundle artifact.
- Not a stdio MCP server in the substantive sense. It's a transport
  proxy. The actual tool implementations live at
  `apps/app/app/api/mcp/_mcp-app.ts` (Hono-served, JSON-RPC).
