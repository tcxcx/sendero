# Phase 4 / 4.5 — Solana Gateway runbook

This is what the operator does the day Phase 4 ships. The code change is
in `@sendero/circle/gateway-solana-mint` and `transferViaGateway`'s
discriminated-union branch. USDC won't actually mint on Solana until the
operational steps below are done.

## Phase 4 scope

- **In scope**: Solana as a Gateway DESTINATION. EVM source → Solana
  destination transfers. The tenant Gateway EOA still signs the burn
  intent (EVM EIP-712); Sendero's Solana relayer mints on the Solana
  side.
- **Phase 4.5 scope**: Solana as a deposit/source chain for unified
  balance. Each tenant gets a Circle DCW Solana operations wallet; the
  webhook/manual sweep path deposits that wallet's USDC through the
  Circle Wallets adapter and Unified Balance Kit. Gateway balances query
  domain 5 with the Solana depositor address, not the EVM signer.

## What automatically happens (no operator action)

- The `Sol_Devnet` and `Sol` entries are in `GATEWAY_CHAINS` from
  `@sendero/circle/gateway`. `/api/gateway/transfer` accepts them as
  destinations once Phase 4 lands.
- The `transferViaGateway` function dispatches to the Solana mint path
  when destination is Solana — same EVM signing for the burn intent,
  Solana-encoded fields, mint via the relayer.
- Recipient validation: EVM destinations require `0x...`, Solana
  destinations require base58 — route returns clear 400s on mismatch.
- Solana base58 recipient is auto-resolved to the USDC ATA (the route
  derives the ATA if you pass a wallet; uses the account directly if you
  pass an existing token account).

## What the operator MUST do (otherwise Solana mints fail)

### 1. Generate Sendero's Solana relayer keypair

The relayer is a single platform-level Solana keypair. It pays SOL gas
for `gatewayMint` calls and signs as `payer + destinationCaller`. It
never holds USDC and is not per-tenant.

```bash
# Generate fresh keypair (output is a JSON byte array — Solana CLI format)
solana-keygen new --outfile sendero-gateway-relayer.json

# Or, if you prefer base58 (Phantom export format), use any keypair tool
# that produces base58 secret keys.

# Print the public address (= the relayer's address):
solana-keygen pubkey sendero-gateway-relayer.json
```

Keep `sendero-gateway-relayer.json` in a secure location. The contents
become the `SENDERO_GATEWAY_SOLANA_RELAYER_SECRET_KEY` env value.

### 2. Fund the relayer with SOL

Each `gatewayMint` instruction costs roughly 5,000-10,000 lamports
(0.000005-0.00001 SOL) on Solana mainnet. Devnet is free.

**For Solana Devnet (testing):**

```bash
solana airdrop 2 $(solana-keygen pubkey sendero-gateway-relayer.json) \
  --url https://api.devnet.solana.com
```

Devnet airdrop is rate-limited; if it fails, try
https://faucet.solana.com or wait a few minutes.

**For Solana Mainnet (production):**

Send 0.1-1 SOL to the relayer's pubkey from any funded mainnet wallet.
At ~$200/SOL, 0.5 SOL = $100 covers ~50,000 mints — very generous.
Top up when balance drops below 0.05 SOL.

```bash
# Verify balance:
solana balance $(solana-keygen pubkey sendero-gateway-relayer.json) \
  --url https://api.mainnet-beta.solana.com
```

### 3. Set the env var on Vercel

Use the REST API pattern from CLAUDE.md (the `vercel env add` CLI is
broken for all-preview scope):

```bash
# Format the secret. Use whichever your keypair file produces:

# Option A: JSON array (from Solana CLI keypair file)
SECRET=$(cat sendero-gateway-relayer.json)

# Option B: base58 (from Phantom export)
SECRET="<paste-base58-secret>"

TOKEN=$(jq -r .token ~/Library/Application\ Support/com.vercel.cli/auth.json)
PROJECT_ID=$(jq -r .projectId .vercel/project.json)
TEAM_ID=$(jq -r .orgId .vercel/project.json)

for SCOPE in production preview development; do
  curl -X POST "https://api.vercel.com/v10/projects/$PROJECT_ID/env?teamId=$TEAM_ID&upsert=true" \
    -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d "{\"key\":\"SENDERO_GATEWAY_SOLANA_RELAYER_SECRET_KEY\",\"value\":${SECRET@Q},\"type\":\"sensitive\",\"target\":[\"$SCOPE\"]}"
done

# Pull to local dev:
vercel env pull .env.local
```

`type:"sensitive"` locks readback to the dashboard — once set, you can
only rotate, not decrypt back. Keep the keypair file as the source of
truth in a password manager.

### 4. Register Circle webhook for Solana inbound

Phase 4.5 handles Solana inbound. Register the webhook before exposing
Solana deposit addresses in production.

In the Circle Console → Notifications → add subscription:
- URL: same as your existing `/api/webhooks/circle` endpoint
- Blockchain: `SOL-DEVNET` (or `SOL` for mainnet)
- Notification types: `transactions.inbound`, `transactions.outbound`

The webhook fan-out matches the Solana operations wallet by
`circleWalletId` and calls `sweepChain()`. For Solana chains, `sweepChain`
uses the Circle Wallets adapter instead of the EVM EIP-3009 helper.

### 5. End-to-end smoke test

Once funded + env set, smoke-test the EVM → Solana transfer path:

```bash
# 1. Pick a tenant with funded Gateway balance on an EVM chain (Arc).

# 2. Pick a Solana destination wallet. Either:
#    - A wallet you control (the route auto-derives the USDC ATA), or
#    - An existing USDC token account (use the ATA address directly).

# 3. Call /api/gateway/transfer:
curl -X POST "https://<production-app-host>/api/gateway/transfer" \
  -H "Cookie: <clerk-session-cookie>" \
  -H "Content-Type: application/json" \
  -d '{
    "from": "Arc_Testnet",
    "to": "Sol_Devnet",
    "amount": "0.5",
    "recipient": "<solana-base58-wallet-or-ata>"
  }'

# Expected response:
# {
#   "state": "success",
#   "from": "Arc_Testnet",
#   "to": "Sol_Devnet",
#   "amount": "0.5",
#   "recipient": "<solana-address>",
#   "mintHash": "<solana-tx-signature>",  // 88-char base58 sig (NOT 0x-prefixed)
#   "explorerUrl": "https://explorer.solana.com/tx/<sig>?cluster=devnet",
#   "transferLogId": "<uuid>"
# }
```

Verify on Solana explorer:
- Open the `explorerUrl` from the response
- The transaction shows the `gatewayMint` instruction
- USDC arrived at the recipient ATA

Verify in Sendero's logs:
```sql
SELECT id, "destinationChain", "mintTxHash", status, "confirmedAt"
FROM gateway_transfer_logs
WHERE "tenantId" = '<test-tenant>'
  AND "destinationChain" = 'Sol_Devnet'
ORDER BY "createdAt" DESC LIMIT 3;
```

## Failure modes to watch the first 24h

| Symptom | Likely cause | Fix |
|---|---|---|
| `Solana minting is disabled` error | `SENDERO_GATEWAY_SOLANA_RELAYER_SECRET_KEY` not set | Set the Vercel env, redeploy |
| Mint tx fails with "insufficient funds" | Relayer out of SOL | Top up via faucet (devnet) or send SOL (mainnet) |
| Mint tx confirmed but USDC didn't arrive | Recipient ATA mismatch — recipient was a wallet, ATA derivation failed | Check `gateway_transfer_logs.recipientAddress` matches the actual ATA on Solana explorer |
| `Recipient is a token account for mint X, expected USDC` | User passed a token account for a different SPL token (USDT, etc.) | Use the wallet address; route auto-derives the USDC ATA |
| Burn intent rejected by Gateway API | Solana address encoding broken | Check `solAddressToBytes32` is using base58-decoded bytes (no left-pad), not address-padding |
| `transferViaGateway: Solana sources not yet supported` | Trying to transfer FROM Solana | Phase 4.5 work; for now, route Solana inbound via a different rail |

## What changes in the UI

Operator dashboard (`<UnifiedBalanceSection />`) shows Solana balances
in the per-chain breakdown automatically — the `/api/gateway/balance`
route iterates `enabledDomains`, and tenants who've received USDC on
Solana via Gateway will show `domain: 5, chain: "Sol_Devnet"` rows.

Note: `enabledDomains` only widens to include 5 (SOL) when the tenant
has Solana liquidity. Phase 4 doesn't auto-add Solana to every tenant's
`enabledDomains` because Solana isn't an operations chain yet (Phase
4.5 work).

## Phase 4.5 implementation status

- Per-tenant Solana Circle DCW operations wallet: implemented.
- Solana Gateway depositor address on `TenantGatewayConfig`: implemented.
- Solana inbound webhook fan-out: implemented via `sweepChain()`.
- Manual Solana deposit support: implemented in `/api/gateway/deposit`.
- Gateway balance query for Solana domain 5: implemented with the Solana
  depositor address.
- Solana burn-source transfers through `/api/gateway/transfer`: still use
  the explicit Solana burn-intent path when needed; App Kit Unified
  Balance spend is preferred for pooled source allocation.
