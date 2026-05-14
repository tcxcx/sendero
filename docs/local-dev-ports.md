# Local dev ports — Sendero + desk-v1 side-by-side

Canonical port allocation so the two stacks can run on one machine for
cross-repo round-trip work (e.g., `@sendero/pasillo-client` against
`apps/pasillo` via OIDC + HMAC). **desk-v1 has port priority.** Sendero
intentionally lives in 3010–3030 to leave 3000–3009 + 6006 + 8787 +
8788 + 9230 to BUFI.

## desk-v1

| Port | App | Notes |
|---|---|---|
| 3000 | `@bu/app` | Next.js — main BUFI app |
| 3002 | `@bu/motora` | wrangler dev — banking aggregation |
| 3003 | `@bu/pasillo` | wrangler dev — API gateway (the one Sendero consumes) |
| 3004 | `@bu/web` | Next.js — marketing |
| 3009 | `@bu/studio-admin` | Next.js — admin dashboard |
| 6006 | `@bu/ui` | Storybook |
| 8787 | `@bu/shiva` | wrangler dev — identity service (Pasillo's auth backend) |
| 8788 | dev OIDC mock | `apps/pasillo/scripts/dev-oidc-issuer.ts` — issues JWTs for Sendero's local OIDC fallback |
| 9230 | motora inspector | wrangler `--inspector-port` |

Bring up the full stack from `desk-v1/`:

```bash
bun run dev:complete     # @bu/app + shiva + motora + studio-admin + worker + trigger + webhooks
```

For the Pasillo auth dance specifically:

```bash
cd apps/pasillo
bun run dev:auth-stack   # OIDC mock :8788 + pasillo wrangler :3003
```

## Sendero (this repo)

| Port | App | Notes |
|---|---|---|
| 3010 | `@sendero/app` | Next.js — main Sendero app (`APP_PORT`) |
| 3011 | `@sendero/marketing` | Next.js (`MARKETING_PORT`) |
| 3012 | `@sendero/help` | Next.js (`HELP_PORT`) |
| 3013 | `@sendero/admin` | Next.js (`ADMIN_PORT`) |
| 3014 | `@sendero/minions` (open-agents) | Next.js (`MINIONS_PORT`) |
| 3020 | `@sendero/docs` | Next.js (`DOCS_PORT`) |
| 3021 | `@sendero/edge` | **Bun** + Hono server (`PORT`). NOT wrangler. The `wrangler.toml` declares `PORT = "8787"` for the production CF Workers deploy only — `wrangler dev` against `apps/edge/` locally would clash with `@bu/shiva`. Use `bun run --cwd apps/edge dev` instead. |
| 3030 | `@sendero/storybook` | Storybook (`STORYBOOK_PORT`) |
| 42069 | `@sendero/indexer` | Ponder dev (`PONDER_PORT`) |

Bring up the full stack:

```bash
bun dev:complete   # app + marketing + help + docs + edge + indexer + storybook + admin
# or
bun dev:edge       # edge worker only — fast iteration
```

## Cross-repo session

To run both stacks for `@sendero/pasillo-client` ↔ Pasillo testing:

1. **Terminal 1** (BUFI auth stack):
   ```bash
   cd /Users/criptopoeta/coding-dojo/desk-v1/apps/pasillo
   bun run dev:auth-stack
   # → OIDC mock on :8788, pasillo on :3003
   ```

2. **Terminal 2** (Sendero):
   ```bash
   cd /Users/criptopoeta/coding-dojo/sendero
   export PASILLO_URL=http://localhost:3003
   export PASILLO_HMAC_SECRET=<from desk-v1 .dev.vars>
   export PASILLO_DEV_OIDC_TOKEN_URL=http://localhost:8788/token
   bun dev   # app on :3010 — calls Pasillo via the env above
   ```

3. **Verify** (terminal 3):
   ```bash
   # Sendero side responsive
   curl http://localhost:3010/api/openapi.json | jq '.info.version'

   # Pasillo side responsive
   curl http://localhost:3003/health

   # Edge worker for x402 demo (separate, doesn't depend on Pasillo)
   curl http://localhost:3021/health
   ```

## Conflict audit

As of 2026-05-13: **no port clashes.** desk-v1 owns 3000–3009 + 6006 +
8787 + 8788 + 9230. Sendero owns 3010–3030 + 42069. The only adjacency
is the wrangler.toml advisory above.

When adding a new dev server to either repo, pick from the unused band:
- 3005–3008 — free, but reserved as buffer for BUFI growth
- 3015–3019 — free, prefer for new Sendero apps
- 3022–3029 — free, prefer for new Sendero apps
- 3031+ — free, prefer for new Sendero apps
- 9231–9999 — free, prefer for new desk-v1 inspector ports
