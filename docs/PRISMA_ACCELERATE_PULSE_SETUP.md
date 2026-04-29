# Prisma Accelerate + Pulse setup

`@sendero/database` now exports two opt-in sibling clients alongside
the default `prisma` workhorse:

- **`@sendero/database/accelerate`** → `prismaAccelerated` — connection
  pool + query result cache for hot reads. Wraps Prisma Accelerate.
- **`@sendero/database/pulse`** → `createPulseClient()` — real-time
  Postgres row-change subscriptions. Wraps Prisma Pulse.

The default `prisma` import keeps using the Neon adapter on edge and
the default pg pool in dev. **Nothing existing breaks.** These are
additive — adopt them per-route incrementally.

## What you (the operator) need to do

### 1. Get the credentials from console.prisma.io

Open the Prisma Data Platform project dashboard:
https://console.prisma.io/mqp38890rpse33thr98ianj5/cmofptkqk0ji710o6wk2qymph/cmofptkqk0ji510o6tvrbu9mw/dashboard

Two values to copy:

- **Accelerate connection string** — looks like
  `prisma+postgres://accelerate.prisma-data.net/?api_key=eyJ...`
  Found under: **Configuration → Connection string** in the Accelerate
  section.

- **Pulse API key** — separate value, looks like a JWT.
  Found under: **Pulse → API keys** (or Configuration → API keys
  depending on console version).

Both are tied to the same Prisma Data Platform project but treated as
distinct credentials so you can rotate them independently.

### 2. Set them as Vercel env vars

For each scope (production, preview, development):

```bash
# Bulk via the REST API pattern from CLAUDE.md (don't use `vercel env add`
# without a branch — that command is broken for all-preview scope).
TOKEN=$(jq -r .token ~/Library/Application\ Support/com.vercel.cli/auth.json)
PROJECT_ID=$(jq -r .projectId .vercel/project.json)
TEAM_ID=$(jq -r .orgId .vercel/project.json)

for SCOPE in production preview development; do
  curl -X POST "https://api.vercel.com/v10/projects/$PROJECT_ID/env?teamId=$TEAM_ID&upsert=true" \
    -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d "{\"key\":\"PRISMA_ACCELERATE_URL\",\"value\":\"<paste-accelerate-url>\",\"type\":\"sensitive\",\"target\":[\"$SCOPE\"]}"

  curl -X POST "https://api.vercel.com/v10/projects/$PROJECT_ID/env?teamId=$TEAM_ID&upsert=true" \
    -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d "{\"key\":\"PULSE_API_KEY\",\"value\":\"<paste-pulse-key>\",\"type\":\"sensitive\",\"target\":[\"$SCOPE\"]}"
done

# Pull to local dev:
vercel env pull .env.local
```

`type:"sensitive"` locks readback to the dashboard — you can't decrypt
these via the CLI after they're set, only rotate.

### 3. Verify locally

```bash
# Verify env is loaded:
grep -E '^(PRISMA_ACCELERATE_URL|PULSE_API_KEY)=' .env.local

# Smoke-test Accelerate (cached read):
bun --cwd packages/database run -e "
import { prismaAccelerated } from './src/accelerate';
const start = Date.now();
const t = await prismaAccelerated.tenant.findFirst({
  cacheStrategy: { ttl: 60 },
});
console.log('Tenant:', t?.id, 'Latency:', Date.now() - start, 'ms');
"
# First call: real Postgres latency. Second call within 60s: <10ms.

# Smoke-test Pulse (subscription, runs forever — Ctrl-C to stop):
bun --cwd packages/database run -e "
import { createPulseClient } from './src/pulse';
const pulse = createPulseClient();
const sub = await pulse.gatewayDepositLog.subscribe({});
for await (const event of sub) {
  console.log('Pulse event:', event);
}
"
# Then trigger an inbound USDC webhook in another terminal — the
# subscription should print the new GatewayDepositLog row.
```

## When to use which client

| Use case | Client | Why |
|---|---|---|
| User-facing route, fresh-data reads | `prisma` (default) | No staleness, fastest direct path |
| User-facing route, repeated reads (Tenant / User / CircleWallet lookups on the same request) | `prismaAccelerated` | Cache hit avoids Postgres round-trip |
| Cron job, reconciliation reads | `prisma` (default) | Need fresh data; cache hurts |
| Write path | `prisma` (default) | Accelerate adds latency on writes |
| Operator dashboard, polling for changes | Replace polling with `createPulseClient()` | Real-time without webhook overhead |
| Wallet balance SSE stream | Stay on `pg.Client` LISTEN/NOTIFY in `apps/app/lib/pg-listen.ts` | Already tuned + working; not worth migration |

## When NOT to use Accelerate

- Inside transactions that mutate (consistency boundary)
- Reads that need real-time freshness (use default `prisma` or Pulse)
- Read paths where ~minute-scale staleness changes correctness
  (booking confirmation status, payment finality)

## Rollback

If Accelerate or Pulse causes problems, revert by:

1. Removing `PRISMA_ACCELERATE_URL` from Vercel — `prismaAccelerated`
   falls back to direct `DATABASE_URL` and Accelerate becomes a
   pass-through (no error).
2. Removing `PULSE_API_KEY` from Vercel — any code that calls
   `createPulseClient()` will throw a clear error. New code that hasn't
   migrated still works because the default `prisma` singleton is
   untouched.

The default `prisma` workhorse is the safety net.
