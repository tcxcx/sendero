# @sendero/help

Help center for Sendero — Next.js 16, basehub-backed CMS, served from `help.sendero.travel`.

## Run it

```bash
bun install               # from the repo root
bun --cwd apps/help dev   # dev server
```

## Production deploys — rolling releases

Config: [`.rolling-release.json`](./.rolling-release.json).

| Stage | Traffic | Bake time |
|---|---|---|
| 1 | 25% | 15 min |
| 2 | 100% | — |

Total: ~15 min. Two-stage because the help center is read-mostly and mostly static — a blunt rollout still catches the catastrophic-render case but doesn't drag heel.

**Deploy:**

```bash
bun run deploy:help                  # from repo root
bun run deploy:rolling:status:help
bun run deploy:rolling:abort:help    # if the canary breaks
```

See the root [README.md](../../README.md#rolling-releases-on-vercel--gradual-production-rollouts) for the full rolling-releases playbook.
