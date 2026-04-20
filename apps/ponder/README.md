# Sendero indexer (Ponder)

TypeScript indexer for `SenderoGuestEscrow` on Arc Testnet. Replaces
the Goldsky/subgraph deployment with a self-hostable Postgres-backed
indexer that costs ~$5/mo on Railway instead of $50+/mo.

## Why Ponder

- **TypeScript end-to-end.** No AssemblyScript. Same language as the
  app and the `@sendero/guest` helpers.
- **Postgres-native.** Your data is just tables. Query with SQL or the
  auto-generated GraphQL endpoint.
- **Hot-reload dev.** `ponder dev` restarts instantly on schema or
  handler changes.
- **Portable.** If we outgrow self-hosting, move to Ponder Cloud, Envio,
  or a custom `graph-node` without rewriting handlers.

## Local dev

```bash
cp .env.example .env.local
bun install

# Sync the ABI from ../contracts/out (run after any forge build)
bun run sync-abi

# Dev server (auto-reloads on changes)
bun run dev
```

GraphQL at http://localhost:42069/graphql. Ponder auto-generates read
queries from the schema. Postgres (SQLite in dev) at the URL Ponder prints.

## Production (Railway, ~$5/mo)

```bash
# One-time: link the repo to Railway
railway init

# Provision Postgres
railway add -d postgresql

# Set env vars
railway variables set PONDER_RPC_URL_ARC_TESTNET=https://rpc.testnet.arc.network
railway variables set PONDER_ESCROW_ADDRESS=0x42B447Fe874CbC5cCD18a8Ab4Ffa2E297eb7F873
railway variables set PONDER_ESCROW_START_BLOCK=38182687
# DATABASE_URL is injected automatically by Railway's Postgres addon

# Deploy
railway up
```

Ponder starts up, backfills from `startBlock` to head, then indexes new
events as they come in.

## Alternatives considered

| Option | Cost | Decision |
|---|---|---|
| Goldsky | $50+/mo baseline | ❌ too expensive for small projects |
| The Graph Network | Per-query, ~$0.0001 each | ❌ doesn't support Arc (custom chain) |
| Alchemy Subgraphs | $49+/mo | ❌ same problem |
| Envio HyperIndex | Free tier, paid from $0 | Strong alternative — consider if Ponder chokes |
| **Ponder self-host** | **$5/mo Railway** | ✅ chosen |
| Ponder Cloud | Free tier generous | Upgrade path if self-host becomes a chore |
| DIY viem + Postgres | $5/mo + eng time | Rejected — Ponder is barely more complex |

## Example queries

All active trips for a corporate buyer:

```graphql
{
  trips(where: { buyer: "0xABC...", status_in: ["ACTIVE", "CLAIMED"] }) {
    id budget reserved spent expiresAt metadataCID
    bookings { id amount actualAmount fee vendor status }
  }
}
```

Buyer spend summary for CFO dashboard:

```graphql
{
  buyerAggregate(id: "0xABC...") {
    tripsCreated tripsActive tripsCompleted
    totalFunded totalSpent totalSwept
  }
}
```

Agent performance leaderboard:

```graphql
{
  agentAggregates(orderBy: "bookingsSettled", orderDirection: "desc", limit: 10) {
    id tripsAssigned bookingsSettled totalFeeEarned actionCount
  }
}
```

Trip activity timeline:

```graphql
{
  tripEvents(
    where: { tripId: "0xTRIP..." }
    orderBy: "timestamp"
    orderDirection: "desc"
  ) {
    kind amount txHash timestamp
  }
}
```

Agent action audit log (x402 metering):

```graphql
{
  agentActions(
    where: { tripId: "0xTRIP..." }
    orderBy: "timestamp"
  ) {
    actionType feeMicro timestamp txHash
  }
}
```

Direct SQL is also available — Ponder exposes the Postgres connection
if you want to hit it from a cron, admin tool, or custom service.

## Updating after contract changes

1. Rebuild contracts: `cd ../contracts && forge build`
2. Sync ABI: `cd ../ponder && bun run sync-abi`
3. If event signatures changed, update `ponder.config.ts` start block +
   redeploy (Ponder re-indexes from the new block)
4. If schema changed, migrate Postgres (Ponder handles schema drift in
   dev; production needs manual migration or fresh DB)
