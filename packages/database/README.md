# @sendero/database

Prisma + Neon Postgres data layer for Sendero × Arc.

## What's in here

- `prisma/schema.prisma` — multi-tenant schema (Tenants, Users, Policies, Trips, Bookings, Suppliers, Wallets, MeterEvents, Settlements, Attestations, Sessions, Subscriptions).
- `src/index.ts` — singleton `PrismaClient` with Neon serverless adapter for edge.
- `src/types.ts` — reusable `Prisma.validator` helper types (`TripWithBookings`, `TenantFull`, etc.) and JSON shapes (`PolicyRules`, `TripEvent`).
- `src/seed.ts` — one-shot demo seed: SP Corporate Travel + Vale-2026 policy + sample Trip/Booking/Settlement/Attestation.

## Setup — Neon

1. Create a Neon project: <https://console.neon.tech>.
2. Grab the **pooled** URL (for serverless / edge) and the **direct** URL (for migrations).
3. Add to the repo root `.env.local`:
   ```bash
   DATABASE_URL="postgresql://<user>:<password>@<host>-pooler.neon.tech/<db>?sslmode=require"
   DIRECT_URL="postgresql://<user>:<password>@<host>.neon.tech/<db>?sslmode=require"
   # Optional — "neon" (default on Vercel) or "node" (default locally)
   SENDERO_DB_DRIVER=node
   ```

## Commands

```bash
# From repo root or packages/database/
bun install
bun run --cwd packages/database db:generate        # generate Prisma client
bun run --cwd packages/database db:migrate         # create + apply dev migration
bun run --cwd packages/database db:migrate:deploy  # CI/prod
bun run --cwd packages/database db:push            # skip migrations — sync schema
bun run --cwd packages/database db:studio          # GUI
bun run --cwd packages/database db:seed            # demo tenant
bun run --cwd packages/database db:reset           # drop + migrate + seed
```

First-time flow:

```bash
bun install
bun run --cwd packages/database db:generate
bun run --cwd packages/database db:migrate       # name it e.g. "init"
bun run --cwd packages/database db:seed
```

## Runtime selection

`src/index.ts` auto-picks a driver:

- `SENDERO_DB_DRIVER=neon` → WebSocket-based Neon serverless driver (edge-safe).
- `SENDERO_DB_DRIVER=node` → default Prisma TCP pool (fastest in dev / scripts).
- Default: `neon` when `VERCEL_ENV=production`, else `node`.

## Using it from apps

```ts
import { prisma } from '@sendero/database';
import type { TripWithBookings } from '@sendero/database/types';

const trip: TripWithBookings | null = await prisma.trip.findUnique({
  where: { id: tripId },
  include: { bookings: { include: { supplier: true } }, policy: true, traveler: true },
});
```

## Design notes

- **Row-level isolation** — every tenant-scoped row has `tenantId` with an index on `(tenantId, createdAt)`. Build a Prisma middleware in the app layer to inject the clerk-org id as a filter.
- **Append-only financial tables** — `MeterEvent`, `Settlement`, `SettlementLeg`, `Attestation` have no `updatedAt`; only `Settlement.status` transitions via new rows in practice (don't UPDATE historical values).
- **Cascade rules**:
  - Deleting a `Tenant` cascades user-visible content (Trips, Bookings, Policies, Sessions, Memberships) but **Restricts** financial tables (Settlements, Attestations) — you must archive, not delete.
  - Deleting a `User` nulls out `travelerId` / `createdById` rather than cascading Trips.
- **JSON columns** (`Policy.rules`, `Trip.events`, `Trip.intent`, `Booking.rawDuffel`, `Booking.segments`, `*.metadata`) — flexible without schema churn; typed via `src/types.ts`.
- **Money** — stored as `BigInt` in micro-USDC (1e-6) on every settlement / meter row. `Booking.totalUsd` is `Decimal(12,2)` because Duffel returns decimals.

## Migration from in-memory state

`packages/tools/src/meter.ts` stays as-is (in-memory ring buffer). To persist, wire a **subscriber** in the Next.js chat route or edge handler:

```ts
import { subscribeMeter } from '@sendero/tools/meter';
import { prisma } from '@sendero/database';

subscribeMeter(async (e) => {
  await prisma.meterEvent.create({
    data: {
      toolName: e.toolName,
      priceMicroUsdc: BigInt(Math.round(parseFloat(e.priceUsdc) * 1e6)),
      status: e.status,
      settlementRef: e.settlementRef,
      payerAddress: e.payer,
      note: e.note,
      tenantId: ctx.tenantId,
      userId: ctx.userId,
    },
  });
});
```

Likewise for `packages/tools/src/check-policy.ts`: the hard-coded `POLICIES` map becomes a `prisma.policy.findFirst({ where: { slug } })`. Tool code stays fallback-compatible.
