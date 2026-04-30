# Phase 3 — Avalanche Fuji enablement runbook

This is what the operator does the day Phase 3 ships. The code change is
one line in `@sendero/env/chains` and is already merged — but USDC won't
actually move on AVAX-FUJI until the operational steps below are done.

## What automatically happens (no operator action)

These flow through the Phase 2 abstractions on next provisioning pass:

- Every existing tenant gets a new `circle_wallets` row with
  `kind='operations'`, `chain='AVAX-FUJI'` provisioned via Circle SDK.
  Triggered by the login hook on next dashboard navigation OR by the
  `/api/cron/provision-gateway` cron within 30 minutes.
- `TenantGatewayConfig.enabledDomains` widens from `[26]` to `[1, 26]`
  for every tenant (monotonic merge — never narrows).
- `WalletDropdown` `<UnifiedBalanceSection />` starts surfacing
  Avalanche Fuji as a per-chain row in the breakdown drawer.
- The Circle webhook fan-out (`/api/webhooks/circle`) starts dispatching
  AVAX-FUJI inbound notifications to `sweepChain` because
  `mapCircleBlockchainToChainKey` matches via the new `circleId` field.

## What the operator MUST do (otherwise USDC won't actually move)

### 1. Fund the platform sponsor EOA on Avalanche Fuji

The sponsor pays AVAX gas for `depositWithAuthorization` calls on every
chain. Phase 1 funded it for Arc; Phase 3 needs Avalanche Fuji.

```bash
# Get the sponsor address (same EOA across all chains).
echo "Sponsor address: $TREASURY_VIEM_ADDRESS"

# Fund via the Avalanche Fuji faucet:
open https://faucet.avax.network/

# Verify balance:
cast balance "$TREASURY_VIEM_ADDRESS" --rpc-url https://avalanche-fuji-c-chain-rpc.publicnode.com
```

Keep ≥0.5 AVAX-FUJI. Each `depositWithAuthorization` costs ~0.001-0.01
AVAX depending on network conditions. Top up if balance drops below 0.1.

Phase 5 will replace this with KMS-backed signing + Circle Gas Station
'circle-sca' sponsor mode (no native gas to manage).

### 2. Register the Circle webhook for AVAX-FUJI

Circle's developer console fires webhook notifications per blockchain.
The Phase 1 setup registered `ARC-TESTNET`; Phase 3 adds `AVAX-FUJI`.

**Production / Preview:**
- Circle Console → Developer → Notifications
- Add subscription:
  - URL: `https://<production-app-host>/api/webhooks/circle`
  - Notification types: `transactions.inbound`, `transactions.outbound`,
    `modularWallet.inboundTransfer`, `modularWallet.outboundTransfer`,
    `modularWallet.userOperation`
  - Blockchain: `AVAX-FUJI`

**Development (ngrok):**
- Same endpoint via the ngrok tunnel from `bun webhooks:ngrok`
- URL: `https://<subdomain>.ngrok-free.app/api/webhooks/circle`

The HMAC signature gate already trusts Circle's pubkey — no env change
needed for the webhook itself. The fan-out picks up AVAX-FUJI through
the chain-config layer automatically once `getTenantOperationsChains()`
includes it (which Phase 3 does).

### 3. Verify provisioning ran

After login hook or cron has fired:

```sql
-- Should return one row per tenant with both chains.
SELECT "tenantId", chain, kind, "createdAt"
FROM circle_wallets
WHERE kind = 'operations'
ORDER BY "tenantId", chain;

-- enabledDomains should be {1, 26} for every active tenant.
SELECT "tenantId", "enabledDomains"
FROM tenant_gateway_configs;
```

If a tenant is missing the AVAX row 30+ minutes after merge, force the
cron:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
  https://<production-app-host>/api/cron/provision-gateway
```

### 4. End-to-end smoke test

Once funded + registered + provisioned, smoke-test the full loop:

```bash
# 1. Identify a test tenant's ops DCW address for AVAX-FUJI:
psql -c "SELECT address FROM circle_wallets WHERE \"tenantId\" = '<test-tenant-id>' AND kind = 'operations' AND chain = 'AVAX-FUJI'"

# 2. Send a small USDC amount to that address from a test wallet
#    (Avalanche Fuji USDC: 0x5425890298aed601595a70AB815c96711a31Bc65).

# 3. Watch the logs:
#    [webhooks/circle] dispatching gateway sweep tenantId=... chainKey=Avalanche_Fuji
#    [webhooks/circle] gateway sweep result tenantId=... result.status=confirmed

# 4. Verify the deposit log:
psql -c "SELECT chain, status, \"depositTxHash\", \"confirmedAt\" FROM gateway_deposit_logs WHERE \"tenantId\" = '<test-tenant-id>' ORDER BY \"createdAt\" DESC LIMIT 5"

# 5. Verify the unified balance shows AVAX-FUJI in the breakdown:
curl -H "Cookie: <clerk-session-cookie>" \
  https://<production-app-host>/api/gateway/balance | jq '.perDomain'
```

Expected: a `domain: 1, chain: "Avalanche_Fuji"` entry with non-zero
balance after Circle finalizes the deposit (~2 minutes on Fuji).

## Failure modes to watch for the first 24h

| Symptom | Likely cause | Fix |
|---|---|---|
| Sweep fails with "Tenant EOA has 0 USDC base units on Avalanche_Fuji, need …" | Step 1 of sweep (ops DCW → tenant EOA) didn't confirm before step 2 ran. Race in Circle SDK polling. | Re-run sweep manually via `POST /api/gateway/deposit` with same `webhookEventId`. |
| `depositWithAuthorization` reverts on-chain | Sponsor EOA out of AVAX gas | Top up AVAX-FUJI faucet. |
| Webhook fires but no sweep dispatches | Tenant `metadata.gatewayEnabled !== true` | Set the flag per the feature-flag rollout doc. |
| Circle Gateway `/balances` returns empty for domain 1 | Tenant has never deposited on AVAX yet | Expected; balance lights up after first inbound + sweep. |

## What Phase 4 (Solana) needs that Phase 3 didn't

Phase 3 = "Avalanche works because it's another EVM chain." Phase 4
will need:

- Different signing curve (Ed25519, no EIP-712).
- A SOL relayer keypair Sendero owns (gas sponsor — no Gateway forwarding
  on the Solana side).
- Self-mint code path (port `gateway-solana.ts` from desk-v1).
- Solana `circleId` = `'SOL-DEVNET'` testnet / `'SOL'` mainnet, domain 5.

Don't try to enable Solana via the same one-line addition — the chain
config widening will pull Solana into the operations list, but
`provisionTenantOpsDcw` will fail because `accountType: 'SCA'` doesn't
exist on Solana. Phase 4 explicitly branches on chain type.
