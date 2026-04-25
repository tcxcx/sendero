# @sendero/edge

One Bun + Hono worker serving every non-UI surface from a single deploy:

| Route       | Surface                         |
| ----------- | ------------------------------- |
| `/`         | Surface manifest                |
| `/health`   | Liveness + version probe        |
| `/mcp`      | MCP JSON-RPC 2.0 for AI clients |
| `/whatsapp` | Meta WhatsApp Business webhook  |
| `/slack`    | Slack slash-command webhook     |
| `/discord`  | Discord interactions webhook    |
| `/llms.txt` | Discoverability for agents      |

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

## Canary rollouts

Every change to `apps/edge/**` can be rolled out gradually with auto-rollback on health-probe failure. Three thin wrappers around `wrangler versions {upload,deploy}` handle the version-id juggling:

```bash
bun run deploy:edge:canary -- --pct 10   # upload current code, route 10%
bun run deploy:edge:promote              # promote the canary to 100%
bun run deploy:edge:rollback             # 100% back to the previous version
```

Default canary slice is 10%; pass `--pct 25` (etc.) to override. Each script prints new + previous version IDs.

### Auto-rollout workflow

`.github/workflows/edge-canary-rollout.yml` runs after every push to `main` that touches `apps/edge/**` or its workspace deps. 3-stage gradient with `scripts/edge-health-check.sh` gating each stage:

| Stage | Traffic | Soak  | Probes | On fail                                      |
|-------|---------|-------|--------|----------------------------------------------|
| 1     | 10%     | 5 min | 3×60s  | `deploy:edge:rollback` + open incident issue |
| 2     | 50%     | 5 min | 3×60s  | rollback + issue                             |
| 3     | 100%    | —     | 3×60s  | rollback + issue                             |

On success the workflow comments on the merged PR with the rolled-out version ID and probe count.

### Skipping the canary (hotfixes)

Add the `skip-canary` label to the PR before merge. The plain `wrangler deploy` path (CF Workers Builds dashboard runs `bun run deploy:edge`) still ships the change at 100% immediately.

### Wrangler commands under the hood

Verified against wrangler v4.85.0:

```bash
# Upload code as a new version, no traffic routed:
wrangler versions upload --message "<intent>"

# Split traffic between two versions (--yes required in CI):
wrangler versions deploy <new>@10% <prev>@90% --yes --message "canary 10%"

# Promote a single version to 100%:
wrangler versions deploy <id>@100% --yes --message "promote"
```

If CI starts hanging on an interactive prompt, bump wrangler — `--yes` for `versions deploy` was historically broken (cloudflare/workers-sdk#5709).

### Local testing

`wrangler versions {upload,deploy}` need a real CF API token, so canary scripts can't be exercised end-to-end without auth. The closest local check is the dry-run:

```bash
bun run deploy:edge:dry-run
```

## Adapter status

- `mcp` — ✅ production-quality, JSON-RPC 2.0, identical protocol to the Next.js `/api/mcp`.
- `whatsapp` — 🟡 shell. Webhook verification + inbound parse + Graph API send wired; intent routing stubbed (echoes + treasury lookup). Needs an LLM to match the web chat's 11-tool surface.
- `slack` — 🟡 shell. Slash-command ack + response_url follow-up; intent routing stubbed.
- `discord` — 🟡 shell. PING/command parse + immediate reply; signature verification stubbed.

Swap the three `inferReply(text)` stubs for a shared `routeToAgent(text, toolList)` that runs `@ai-sdk/anthropic` or `@ai-sdk/openai` with tool-calling — same pattern as `app/api/chat/route.ts`. This is the post-hackathon next step.

## Health probe

Continuous liveness check, decoupled from CI/CD. The systems that hold up are the ones deliberately stressed.

### `/health` endpoint

Public, unauthenticated, always 200 (if it executes, the worker is alive). Returns:

```json
{
  "ok": true,
  "version": "<git sha or 'unknown'>",
  "uptime_ms": 12345,
  "timestamp": "2026-04-24T12:34:56.000Z",
  "deployment": "production"
}
```

`version` reads `CF_VERSION_METADATA` / `WORKER_VERSION_ID` and falls back to `'unknown'` when the binding isn't exposed. `deployment` is `production` when `CF_ENV`/`WORKER_ENV` says so, otherwise `preview`.

### How the probe works

`scripts/edge-health-check.sh` is the single source of truth. Run by `.github/workflows/edge-health.yml` on `*/5 * * * *` (every 5 minutes). The cadence intentionally matches GitHub Actions schedule resolution — sub-minute polling drifts and burns minutes without improving real MTTD.

Gates, in order:

1. **HTTP 200** — anything else fails.
2. **Body shape** — `jq -e '.ok == true and .timestamp != null'`.
3. **Latency SLO** — fail at 2000ms, warn at 1500ms.

Each tick emits a JSONL line to stdout (`{timestamp, url, status_code, latency_ms, ok, reason?}`) and:

- On **failure**, opens a labeled (`edge-health-incident`) GitHub issue, or appends a comment to the existing one — never spam-creates duplicates for an ongoing incident.
- On **recovery**, posts `Recovery detected at <ts>` and closes the issue.

When `GITHUB_TOKEN` is unset (local run), no GitHub side effects — just JSONL + exit code.

### Test locally

```bash
# Probe the live production worker
bash scripts/edge-health-check.sh

# Probe a local dev server
HEALTH_URL=http://localhost:3021/health bash scripts/edge-health-check.sh

# Verify the failure path (404 fails the body-shape gate)
HEALTH_URL=https://example.com/404 bash scripts/edge-health-check.sh; echo $?
```

Override the workflow's target without editing YAML by setting repo variable `EDGE_HEALTH_URL` (e.g., to a preview alias).

### Disable temporarily

Set repo variable `EDGE_HEALTH_PAUSE=1`. The workflow checks for it before running and exits early. Unset to resume.

## Why a separate edge worker

The Next.js app runs the web UI. This worker runs everything else. Split because:

1. Edge runtime cold starts in <50ms; Next.js is ~500ms+.
2. Slack, WhatsApp, Discord all require <3s webhook acks — perfect for edge.
3. MCP can scale horizontally without React hydration tax.
4. Single tool registry means adding a surface = one adapter file, zero duplication.
