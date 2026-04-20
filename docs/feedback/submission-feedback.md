# Circle Product Feedback — Sendero submission

> Running log of what we used, what worked, what broke, what could be better. Updated as we build. Copy-paste into the submission form on Apr 25.

---

## Which Circle products we used

| Product | How we used it | Track |
|---|---|---|
| **Arc** (settlement L1) | Every tool call settles on Arc Testnet. USDC as native gas. | required |
| **USDC** | Value layer. Per-tool pricing $0.0005–$0.01. 11 tools charge in USDC. | required |
| **Circle Nanopayments** (`@circle-fin/x402-batching`) | x402-gated MCP tool API. Buyers sign EIP-3009 offchain, Gateway batches settlement. | required |
| **Circle Gateway** (`gateway-api-testnet.circle.com`) | Unified treasury balance across 7 testnets. Sub-500ms burn+mint into Arc. Nanopayment settlement layer. | recommended |
| **Circle App Kit** (`@circle-fin/app-kit` v1.3) | Swap USDC↔EURC, send, CCTP bridge on Arc. | recommended |
| **Circle Modular Wallets** (`@circle-fin/modular-wallets-core`) | Passkey MSCA for user-side auth. ERC-4337 + passkey WebAuthn. | recommended |
| **Circle Developer Controlled Wallets** (`@circle-fin/developer-controlled-wallets`) | Treasury faucet drip (`/api/fund-msca`). DCW `createTransaction` for USDC transfer on Arc. | recommended |
| **Circle Adapter — viem v2** (`@circle-fin/adapter-viem-v2`) | App Kit signer bound to a viem EOA. Replaces Circle Wallets adapter (see issue below). | recommended |
| **Circle Wallets Adapter** (`@circle-fin/adapter-circle-wallets`) | Attempted, abandoned — see issue below. | recommended |
| **ERC-8183** (job escrow) | Hold-and-capture agentic commerce primitive, live on Arc. | standard |
| **ERC-8004** (agent identity + reputation) | Agent NFT #2286 on Arc, on-chain rep score after each trip. | standard |

---

## Why we chose these products

- **Arc + USDC as native gas** makes sub-cent per-tool pricing (≤ $0.01 hackathon requirement) economically viable. On Ethereum mainnet each of our tool calls would cost $0.40–$3 in gas, blowing the unit economics immediately.
- **Gateway's batched settlement** lets us charge $0.0005 per `check_treasury` call — literally unprofitable at any traditional rollup's gas price. The margin panel in the demo quantifies this: **~600× cost delta** vs Ethereum L1.
- **Modular Wallets + passkeys** gives users a wallet they never have to think about. WebAuthn registration, MSCA on Arc, gasless via Gas Station. The user sees "sign in," not "connect wallet."
- **App Kit** lets us compose swap + bridge + send under one typed API, instead of hand-rolling three chain-specific contract integrations.
- **MCP + `@sendero/tools` registry** — every tool lights up simultaneously on web chat, Claude Desktop, ChatGPT Apps, Slack, WhatsApp, Discord via `routeToAgent`. Adding a tool is one file in `packages/tools/src/`.

---

## What worked well

### Circle Gateway on Arc Testnet
- Arc Testnet (domain 26) is a first-class citizen. Deposit UX is exactly as promised: `approve` + `deposit` and the balance shows up in the unified API within a second or two.
- `POST /v1/balances` returns a clean shape — per-domain breakdown + total. Drop-in for dashboards.
- `POST /v1/transfer` correctly attested + minted in ~500ms in our tests. The burn+mint flow via `gatewayMint` on destination worked on first try once EIP-712 was spec-exact.

### App Kit
- Typed `SwapParams` / `SendParams` / `BridgeParams` export from `@circle-fin/app-kit` — very helpful, catches schema bugs at compile.
- Swap on Arc (USDC → EURC) fires in one `kit.swap()` call once the adapter is correct. Success path is smooth.
- CCTP v2 bridge via `kit.bridge()` with `Arc_Testnet` as destination worked without drama.

### Nanopayments / x402-batching SDK
- `@circle-fin/x402-batching@2.1.0` exports both buyer (`GatewayClient`, `BatchEvmScheme`) and seller (`BatchFacilitatorClient`, `GatewayEvmScheme`) surfaces from a single install. Clean.
- EIP-3009 `TransferWithAuthorization` works as documented — the `GatewayWalletBatched` domain name + version `1` are exactly as spec'd.
- Arc's 0.5-second deposit finality (per the "Deposit time" table in the docs) means the whole nanopayment flow is tight enough for live demos.

### Modular Wallets + Passkey
- `toCircleSmartAccount` + `toWebAuthnAccount` with `getFn` override for local-host WebAuthn works as documented.
- MSCA address is deterministic from the passkey — we verified by re-logging in across sessions and getting the same address. Critical for onboarding.

### ERC-8004 / ERC-8183 live on Arc
- Registry + reputation contracts live on Arc Testnet. Our agent NFT (#2286) has a persistent `(stars, count, validators)` record that updates on every settled job.
- Gas to write an attestation is ~10¢-equivalent in USDC — viable for per-trip reputation even at hackathon scale.

---

## What we hit that could be improved

### 1. App Kit — Circle Wallets adapter incompatible with Swap Kit on Arc
**Symptom:** When using `createCircleWalletsAdapter` (DCW-backed) with `kit.swap()` on Arc Testnet, we got:
```
Unsupported transaction params: gas, gasPrice, maxFeePerGas, maxPriorityFeePerGas, nonce, value
```
**Root cause (found after reading source):** `@circle-fin/usdckit/dist/esm/providers/circle-wallets/transports/index.js` line 127 — the Circle Wallets transport explicitly rejects these params on `eth_call`, because Circle's internal query-contract API doesn't forward them. But Swap Kit's viem simulation path *always* passes gas/nonce in the `eth_call` envelope.

**Our workaround:** switched to `createViemAdapterFromPrivateKey` pointing at Arc RPC directly. Works immediately.

**Suggestion:** either (a) have the Circle Wallets transport silently drop the unsupported params instead of throwing, or (b) document the incompatibility clearly in the App Kit quickstart so devs don't waste 4 hours debugging. A dedicated "App Kit + DCW + Arc" troubleshooting page would land well.

### 2. App Kit — `SendParams` address enforcement drift
**Symptom:** `/api/send` blew up with:
```
Cannot call getAddress() on developer-controlled adapters. Address must be provided explicitly in the operation context.
```
even when `from.address` was supplied.

**Root cause:** `prepareSend` in `@circle-fin/app-kit@1.3.0` unconditionally calls `fromAdapter.getAddress(fromChain)` regardless of whether `from.address` is provided. For dev-controlled adapters this throws.

**Our workaround:** rewired `/api/send` through Circle DCW `createTransaction` directly. Works.

**Suggestion:** in `prepareSend`, check if `from.address` is already set and skip the `adapter.getAddress()` call. One-line fix. Currently forces devs off `kit.send()` entirely for DCW use cases.

### 3. `mcp-use` package requires Zod 4, hard-blocks adoption
**Context:** We wanted to use `mcp-use@1.24.1` to refactor our MCP server with React widgets. It imports `z.toJSONSchema` which is **Zod 4 only**. Our stack is pinned to **Zod 3.25.x by viem 2.48 + every Circle SDK adapter**.

**Impact:** Cannot use `mcp-use` until viem + Circle upgrade to Zod 4. We reverted to a hand-rolled Hono JSON-RPC MCP.

**Suggestion:** if `mcp-use` is part of the Circle-blessed stack, align its Zod major version with the rest of `@circle-fin/*` packages. Or publish a `mcp-use@0.x` fork pinned to Zod 3 for projects already deeply committed.

### 4. Nanopayments + MSCA: EIP-3009 signing path for passkey wallets unclear
**Context:** We'd love to let users pay per tool call from their passkey MSCA. But EIP-3009 is the standard EOA signing path. MSCA would need EIP-1271 contract-signature verification on the facilitator side.

**Status:** Docs don't say whether `BatchFacilitatorClient` accepts EIP-1271 signatures for smart-contract wallets (ERC-4337 accounts). Our read of the SDK source suggests no.

**Suggestion:** either document "Nanopayments work with EOAs only" clearly, or extend `BatchFacilitatorClient.verify` to accept EIP-1271 signatures from smart accounts. The latter unlocks the "passkey wallet pays per MCP tool call" UX that's a natural evolution of agentic commerce.

### 5. Arc Bundler — minimum priority fee not surfaced in docs
**Symptom:** Initial `sendUserOperation` calls failed with:
```
maxPriorityFeePerGas is 3828002 but must be at least 1000000000
```

**Found via trial and error:** Arc's bundler enforces a 1 gwei priority-fee floor that's higher than mainnet-like chains. Had to override `estimateFeesPerGas` in the bundler client config.

**Suggestion:** put this in the Arc + Modular Wallets quickstart explicitly. Something like "on Arc Testnet, set `maxPriorityFeePerGas >= 1 gwei`." Saved us 2h of debugging.

### 6. Testnet deposit wait times unevenness
The Nanopayments buyer quickstart's deposit table is the single most useful snippet in those docs:

| Chain | Deposit time |
|---|---|
| Arc Testnet | ~0.5 sec |
| Avalanche Fuji | ~8 sec |
| Base Sepolia | ~13-19 min |

For a hackathon or demo, 13-19 min on Base Sepolia is unusable. We had to depose exclusively through Arc Testnet. Bridge Kit from Sepolia to Arc is suggested but adds friction.

**Suggestion:** auto-redirect deposits to a fast-finality chain + silent bridge, or warn in the SDK with an explicit "deposit_will_take_X_minutes" response field. Right now you find out only when your CI timeout hits.

---

## Recommendations to make the developer experience more seamless or scalable

### Documentation
1. **One-page "Arc + App Kit + DCW gotchas"** covering the three issues above (Circle Wallets adapter + Swap, SendParams bug, Arc bundler priority fee). Would save every new builder a full day.
2. **Zod version compatibility matrix** across `@circle-fin/*` packages. We hit this once, but a new dev hits it every week.
3. **"Nanopayments with smart accounts"** — even if the answer is "not yet supported," say so clearly.

### SDK
4. **Unify types across `@x402/core`, `@x402/evm`, and `@circle-fin/x402-batching`.** Currently `PaymentPayload` and `PaymentRequirements` are redeclared in each package with slight shape differences. Tightening these saves debugging time.
5. **Hono-compatible middleware for `createGatewayMiddleware`.** Most edge-native stacks (Vercel Edge, Cloudflare Workers, Deno Deploy) use Hono or native `Fetch`. Express is the minority. An official Hono export would land well.
6. **Circle Arc MCP server reference implementation.** There's huge value in a canonical "expose your Circle API as an MCP tool registry with x402 gating" example. We built this for Sendero — a reference template would accelerate everyone else.

### Infrastructure
7. **Batched settlement observability in the Developer Console.** Right now we can see individual Gateway transfers but not "the batch your 50 nanopayments ended up in." Give sellers a grouped view.
8. **Testnet USDC faucet rate limit + batch drip.** Drips at 20 USDC/request means for high-frequency nanopayment testing we hit the rate limit before we can run a realistic demo. A higher-volume dev faucet (or a queue-backed one) would unblock this.

---

## What we built with all of this (the pitch sentence)

> Sendero turns every MCP tool call into a pay-per-action agentic-commerce primitive. An AI agent (web, Claude Desktop, Slack, Discord, or a WhatsApp thread) pays between $0.0005 and $0.01 USDC per tool invocation via Circle Nanopayments on Arc. A single travel-planning workflow triggers 54+ on-chain nanopayment authorizations in 2 minutes — a workload that would cost $40+ in Ethereum gas but costs $0.07 on Arc with Gateway batching. Agents finally run economically viable high-frequency loops.

Track: **Agent-to-Agent Payment Loop** (primary) + **Per-API Monetization Engine** (secondary — same primitive from the seller's angle).

---

## Open items to add before Apr 25 submission

- [ ] Include final transaction-count numbers from the live demo run
- [ ] Add margin-panel screenshots ("Arc $0.07 vs Ethereum $43.20")
- [ ] Include the Claude Desktop `mcpServers` config snippet (so judges can reproduce)
- [ ] Note any issues found while running the on-site demo on Apr 25-26
- [ ] Capture x402 facilitator latency numbers (verify + settle) in our environment
