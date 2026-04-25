# @sendero/edge

One Bun + Hono worker serving every non-UI surface from a single deploy:

| Route       | Surface                         |
| ----------- | ------------------------------- |
| `/`         | Health + surface manifest       |
| `/mcp`      | MCP JSON-RPC 2.0 for AI clients |
| `/whatsapp` | Meta WhatsApp Business webhook  |
| `/discord`  | Discord interactions webhook    |
| `/llms.txt` | Discoverability for agents      |

> **Slack moved.** Slack webhook handling now lives in the Next.js app at
> `apps/app/app/api/webhooks/slack/{events,interactions,oauth-callback}`.
> Vercel Fluid Compute gives that runtime full Node.js + Prisma + Workflow
> DevKit, which the CF Workers edge can't match. The `/api/agent/dispatch`
> fan-in already runs on apps/app — Slack now sits on the same runtime.

Every adapter loads tools from `@sendero/tools` (the workspace package). Add a tool there — it lights up on every surface automatically. No drift.

## Run

```bash
bun run apps/edge/src/index.ts
# → listening on :3021
curl localhost:3021/
curl -X POST localhost:3021/mcp -H 'content-type: application/json' \
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
bun run dev:edge          # from repo root, listens on :3021
```

### Vercel

Vercel deploys for this package must use the prebuilt flow. `@sendero/edge`
imports several `workspace:*` packages, so a remote deploy that uploads only
`apps/edge` cannot install or bundle the tool registry.

```bash
cd apps/edge
bun run vercel:build
bun run vercel:deploy
```

`vercel:build` runs with the local monorepo available and writes
`.vercel/output`; `vercel:deploy` uploads that prebuilt output to
`sendero-arc-edge` without asking Vercel to reinstall a partial workspace.

## Adapter status

- `mcp` — ✅ production-quality, JSON-RPC 2.0, identical protocol to the Next.js `/api/mcp`.
- `whatsapp` — 🟡 shell. Webhook verification + inbound parse + Graph API send wired; intent routing stubbed (echoes + treasury lookup). Needs an LLM to match the web chat's 11-tool surface.
- `slack` — moved off the edge. Webhooks now run in the Next.js app at `apps/app/app/api/webhooks/slack/{events,interactions,oauth-callback}` so they can use Prisma + Workflow DevKit + the shared agent runtime.
- `discord` — 🟡 shell. PING/command parse + immediate reply; signature verification stubbed.

Swap the two remaining `inferReply(text)` stubs for a shared `routeToAgent(text, toolList)` that runs `@ai-sdk/anthropic` or `@ai-sdk/openai` with tool-calling — same pattern as `app/api/chat/route.ts`. This is the post-hackathon next step.

## Why a separate edge worker

The Next.js app runs the web UI. This worker runs everything else. Split because:

1. Edge runtime cold starts in <50ms; Next.js is ~500ms+.
2. WhatsApp and Discord require <3s webhook acks — perfect for edge. (Slack also requires <3s, but it now runs on Vercel Fluid Compute via `after()` deferral so the agent can reach Prisma + Workflow DevKit.)
3. MCP can scale horizontally without React hydration tax.
4. Single tool registry means adding a surface = one adapter file, zero duplication.
