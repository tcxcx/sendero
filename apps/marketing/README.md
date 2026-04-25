# @sendero/marketing

Public marketing site for Sendero — Next.js 16, served from `sendero.travel`.

## Run it

```bash
bun install                    # from the repo root
bun --cwd apps/marketing dev   # dev server
```

## Production deploys — rolling releases

Config: [`.rolling-release.json`](./.rolling-release.json).

| Stage | Traffic | Bake time |
|---|---|---|
| 1 | 10% | 10 min |
| 2 | 50% | 30 min |
| 3 | 100% | — |

Total: ~40 min of canary observation. Faster than `apps/app` because the public site has lower transaction stakes.

**Deploy:**

```bash
bun run deploy:marketing                  # from repo root
bun run deploy:rolling:status:marketing
bun run deploy:rolling:abort:marketing    # if the canary breaks
```

See the root [README.md](../../README.md#rolling-releases-on-vercel--gradual-production-rollouts) for the full rolling-releases playbook.
