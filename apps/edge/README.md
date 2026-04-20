# @sendero/edge

One Bun + Hono worker serving every non-UI surface from a single deploy:

| Route       | Surface                         |
| ----------- | ------------------------------- |
| `/`         | Health + surface manifest       |
| `/mcp`      | MCP JSON-RPC 2.0 for AI clients |
| `/whatsapp` | Meta WhatsApp Business webhook  |
| `/slack`    | Slack slash-command webhook     |
| `/discord`  | Discord interactions webhook    |
| `/llms.txt` | Discoverability for agents      |

Every adapter loads tools from `@sendero/tools` (the workspace package). Add a tool there — it lights up on every surface automatically. No drift.

## Run

```bash
bun run apps/edge/src/index.ts
# → listening on :3020
curl localhost:3020/
curl -X POST localhost:3020/mcp -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

## Deploy

### Cloudflare Workers (recommended — Hono is first-class there)

```bash
cd apps/edge
npx wrangler secret put ANTHROPIC_API_KEY   # and each other secret
npx wrangler deploy
```

Routes map cleanly out of the Hono app. Free tier covers hackathon load.

### Local dev

```bash
bun run dev:edge          # from repo root, listens on :3020
```

### Vercel (experimental)

`vercel.json` + `api/[[...route]].ts` route exist, but Vercel's monorepo
handling of `workspace:*` deps is thin. Either vendor `@sendero/tools/src`
into this package or deploy via Cloudflare. Local `bun run dev:edge`
always works.

## Adapter status

- `mcp` — ✅ production-quality, JSON-RPC 2.0, identical protocol to the Next.js `/api/mcp`.
- `whatsapp` — 🟡 shell. Webhook verification + inbound parse + Graph API send wired; intent routing stubbed (echoes + treasury lookup). Needs an LLM to match the web chat's 11-tool surface.
- `slack` — 🟡 shell. Slash-command ack + response_url follow-up; intent routing stubbed.
- `discord` — 🟡 shell. PING/command parse + immediate reply; signature verification stubbed.

Swap the three `inferReply(text)` stubs for a shared `routeToAgent(text, toolList)` that runs `@ai-sdk/anthropic` or `@ai-sdk/openai` with tool-calling — same pattern as `app/api/chat/route.ts`. This is the post-hackathon next step.

## Why a separate edge worker

The Next.js app runs the web UI. This worker runs everything else. Split because:

1. Edge runtime cold starts in <50ms; Next.js is ~500ms+.
2. Slack, WhatsApp, Discord all require <3s webhook acks — perfect for edge.
3. MCP can scale horizontally without React hydration tax.
4. Single tool registry means adding a surface = one adapter file, zero duplication.
