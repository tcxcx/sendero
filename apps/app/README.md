# @sendero/app

Authenticated console for Sendero — Next.js 16 App Router, served from `app.sendero.travel`. Highest blast radius in the monorepo: handles auth, money, settlement, and agent dispatch.

## Run it

```bash
bun install              # from the repo root
bun --cwd apps/app dev   # dev server on :3010
```

See the root [README.md](../../README.md) for env vars, Clerk wiring, Circle wallet provisioning, and the full development setup.

## Production deploys — rolling releases

Every production deploy of `@sendero/app` rolls out in stages — never 100% at once. Config lives in [`.rolling-release.json`](./.rolling-release.json):

| Stage | Traffic | Bake time |
|---|---|---|
| 1 | 5% | 15 min |
| 2 | 25% | 30 min |
| 3 | 50% | 60 min |
| 4 | 100% | — |

Total: ~1h 45m of canary observation before full promotion. Most aggressive of the four web apps because this surface settles bookings and mints API keys.

**Apply / change config:**

```bash
bun run deploy:rolling:configure           # from the repo root, applies all apps
bun run deploy:rolling:configure -- app    # just this app
```

**Deploy a canary:**

```bash
bun run deploy:app                         # vercel deploy --prod from repo root
```

Once Rolling Releases is enabled, normal git pushes also use the staged rollout — no CLI required per deploy.

**Halt / approve / finish a rolling release:**

```bash
bun run deploy:rolling:status:app          # current stage + canary deployment id
bun run deploy:rolling:abort:app           # stop the canary, revert to the previous deployment
bun run deploy:rolling:approve:app         # manual-mode only — advance to the next stage now
bun run deploy:rolling:complete:app        # promote canary to 100% immediately
```

**Emergency hotfix (skip rolling release):**

```bash
bun run deploy:rolling:disable -- app
bun run deploy:app
bun run deploy:rolling:configure -- app    # re-enable for next deploy
```

**Auto-halt on degradation.** Vercel does not expose an automatic error-rate halt as a config primitive. Watch the Observability tab on the project, or wire a script against `POST /v1/projects/{id}/rollback/{deploymentId}` if you want CI to halt on a degraded canary.

See the root [README.md](../../README.md#rolling-releases-on-vercel--gradual-production-rollouts) for the full rolling-releases playbook.
