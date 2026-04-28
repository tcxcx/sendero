# @sendero/cli

Agent-native CLI for the Sendero travel-ops platform. Run via `npx`,
no global install needed.

```bash
npx @sendero/cli@latest
```

## Quickstart

```bash
# Mint and save an API key (browser flow → paste back)
npx @sendero/cli@latest auth login

# List the live tool catalog (~49 tools)
npx @sendero/cli@latest tools list

# Dispatch a tool via JSON-RPC
npx @sendero/cli@latest tools call search_flights '{"origin":"BUE","destination":"MIA","date":"2026-05-12"}'

# Bootstrap the Claude Code plugin
npx @sendero/cli@latest mcp install
```

## Auth precedence

1. `SENDERO_API_KEY` env var
2. `~/.sendero/key` (written by `auth login`, `chmod 600`)
3. Prompt (interactive only)

## Endpoint precedence

1. `SENDERO_API_URL` env var
2. `https://app.sendero.travel`

## Output format

When stdout is a TTY: human-readable tables.
When stdout is piped (agent / script): newline-delimited JSON.

## Source

The CLI lives at [`packages/cli/`](https://github.com/tcxcx/sendero/tree/main/packages/cli).
Build with `bun run build`, run locally with `bun run dev`.

## License

Apache-2.0
