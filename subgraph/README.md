# SenderoGuestEscrow subgraph — DEPRECATED

> **This subgraph is deprecated.** It was scaffolded for Goldsky deployment,
> which costs $50+/mo baseline — too expensive for Sendero's scale.
>
> **Use [`../ponder/`](../ponder/) instead.** Same entities, same queries,
> TypeScript-native, hosts on Railway for ~$5/mo.
>
> Kept here for reference and in case The Graph Network ever adds Arc
> support (at which point this subgraph could be re-purposed).

Indexes `SenderoGuestEscrow` events on Arc L2 for UI list queries.

## Layout

```
subgraph/
├── subgraph.yaml              # manifest (data source + event handlers)
├── schema.graphql             # GraphQL entities
├── src/
│   └── mapping.ts             # AssemblyScript event handlers
├── abis/
│   └── SenderoGuestEscrow.json  # generated from forge build
└── scripts/
    └── sync-abi.js            # copy ABI from ../contracts/out
```

## Setup

```bash
cd subgraph
bun install

# Copy the compiled ABI from Forge
bun run sync-abi

# After deploying the contract, update subgraph.yaml:
#   source.address  = deployed escrow address
#   source.startBlock = block of the deploy tx

bun run codegen
bun run build
```

## Deploy

Three options:

### Goldsky (recommended for Arc Testnet)

Arc Testnet isn't on The Graph's hosted service yet. Goldsky supports
custom EVM chains. Set up an account, install the CLI, and:

```bash
goldsky login
goldsky subgraph deploy sendero-guest-escrow/v0.1.0 --path ./
```

### The Graph Studio

If Arc gets added to Studio:

```bash
graph auth --studio <DEPLOY_KEY>
graph deploy --studio sendero-guest-escrow
```

### Self-hosted graph-node

For full control, run `graph-node` against an Arc archive node.

## Example queries

All active trips for a corporate buyer:

```graphql
{
  trips(where: { buyer: "0xABC...", status_in: [ACTIVE, CLAIMED] }) {
    id budget reserved spent expiresAt metadataCID
    bookings { id amount actualAmount fee vendor status }
  }
}
```

Live spend timeseries for CFO dashboard:

```graphql
{
  buyerAggregate(id: "0xABC...") {
    tripsCreated tripsActive tripsCompleted
    totalFunded totalSpent totalSwept
  }
}
```

Agent performance:

```graphql
{
  agentAggregates(orderBy: bookingsSettled, orderDirection: desc) {
    id tripsAssigned bookingsSettled totalFeeEarned actionCount
  }
}
```

Trip activity feed:

```graphql
{
  tripEvents(
    where: { trip: "0xTRIP..." }
    orderBy: timestamp
    orderDirection: desc
  ) {
    kind amount txHash timestamp
    booking { id status }
  }
}
```

Agent action log (x402 metering):

```graphql
{
  agentActions(
    where: { trip: "0xTRIP..." }
    orderBy: timestamp
  ) {
    actionType feeMicro timestamp txHash
  }
}
```

## Updating after contract changes

1. Rebuild contracts: `cd ../contracts && forge build`
2. Sync ABI: `cd ../subgraph && bun run sync-abi`
3. If event signatures changed, update `subgraph.yaml` and `schema.graphql`
4. Regenerate types: `bun run codegen`
5. Rebuild: `bun run build`
6. Redeploy with bumped version
