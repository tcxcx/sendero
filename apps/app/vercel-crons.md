# `apps/app/vercel.json` cron registry

Vercel rejects unknown top-level keys in `vercel.json` (schema validation),
so the cron docs + Pro-tier restore list lives here instead of inline.

## Active (Vercel cron, Hobby = max 2)

| Path | Schedule | Purpose |
| ---- | -------- | ------- |
| `/api/cron/generate-platform-bills` | `0 2 1 * *` | Monthly tenant invoice generation. Runs at 02:00 UTC on the 1st. |
| `/api/cron/retry-wallet-provision` | `0 3 * * *` | Daily retry of failed Circle wallet provisions. Runs at 03:00 UTC. |

## Parked — restore on Pro tier upgrade

Drop these back into the `crons` array in `vercel.json` once the Vercel
project is on Pro (limit jumps from 2 → 40):

```json
{ "path": "/api/cron/retry-identity-provision", "schedule": "*/5 * * * *" },
{ "path": "/api/cron/refresh-markup-medians", "schedule": "0 0 * * 0" }
```

Until then, both endpoints still exist and accept `POST` with the
`CRON_SECRET` bearer header. Route them via:

- **GitHub Actions** — add a workflow under `.github/workflows/` with
  `schedule: cron: '*/5 * * * *'` triggers, calling the route via
  `curl -H "Authorization: Bearer $CRON_SECRET"`.
- **Trigger.dev** — already a project dependency. Define a scheduled
  task that hits the route.
- **Manual smoke** — `curl -H "Authorization: Bearer $CRON_SECRET"
  https://app.sendero.travel/api/cron/<name>` works for ad-hoc runs.

## Why each parked cron matters

- `retry-identity-provision` (every 5min) — chases failed ERC-8004
  identity provisions. Without it, orgs that hit a transient Circle
  failure stay in `provisioning` state until manual retry.
- `refresh-markup-medians` (weekly Sunday 00:00 UTC) — refreshes the
  `tenant_markup_medians` materialized view feeding the markup
  recommendation engine. Stale view = recommendations drift but don't
  break.
