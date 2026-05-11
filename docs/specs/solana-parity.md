# Solana parity — design + phased rollout

> **Goal:** 100% bucket parity between Arc and Solana so a tenant can
> pick either chain at org creation and the entire Sendero stack
> cascades to that choice. Hackathon target: Silicon Hackathon
> (Solana-focused).

## Why now

Sendero is already chain-agnostic at the wallet/Gateway layer. Circle
Gateway natively supports both EVM (Arc) and Solana, and Sendero
provides gas via the platform hot-wallet on both sides. The pieces
that aren't portable today:

1. ERC-8004 reputation (`IdentityRegistry` + `ReputationRegistry`) is
   EVM-only.
2. ERC-8183 `AgenticCommerce` job-escrow contract (Circle reference,
   `0x0747EEf0706327138c69792bF28Cd525089e4583` on Arc Testnet) is
   Solidity-only.
3. `SenderoGuestEscrow.sol` (773 lines, UUPS-upgradeable, ERC-7201
   storage) is Solidity-only.
4. Trip stamp NFTs go through thirdweb's TokenERC1155 → not on Solana.
5. x402 signature scheme is secp256k1 — Solana wants Ed25519.
6. Nanopayments meter doesn't route settlement chain by tenant.

Everything else (Duffel, MoonPay, Kapso WhatsApp, channel rendering,
the agent persona, the operator chat, the dashboard) is chain-agnostic
because Gateway abstracts USDC asset-first.

## Design decisions

### 1. Sendero's own agent — ONE canonical NFT, per-chain mirrored attestations

Sendero's brand = one identity. Splitting into per-chain NFTs creates
"which one is real?" + forks reputation.

- **Canonical Sendero agent** = ERC-8004 NFT on Arc
  (`SENDERO_AGENT_ID=2286`). This is the source-of-truth.
- **Per-chain attestations:**
  - Arc tenants → existing `give_feedback` against the Arc NFT.
  - Solana tenants → emit local attestation via a thin Anchor program
    that fires `RatingEmitted(agent_subject, score, tx_signature)`.
- **Sendero indexer mirrors Solana events to Arc** as cross-chain
  attestations against Sendero's canonical NFT (same `give_feedback`
  shape, source-tagged `chain: 'sol'`). Per Phase 5, this uses
  Gateway-based attestation transfer for ~sub-second propagation
  rather than waiting on indexer pull (~1-2 min lag).
- **Tenant agencies have their own per-chain identity** (Arc → ERC-8004
  IdentityRegistry NFT; Solana → Metaplex Agent Registry NFT). Tenant
  reputation lives entirely on their operating chain — only Sendero's
  is aggregated across both.

### 2. Trip-stamp NFTs — Metaplex Core (single-asset, modern)

Per-traveler trip stamps are rare (1-N per traveler), not high-volume.
**Metaplex Core** (single-asset) over Bubblegum (compressed). Core is
87% cheaper than Token Metadata, supports plugins, and has a built-in
**Asset Signer PDA** wallet so each stamp can autonomously hold tokens
or sign txs (matches our existing thirdweb `mintTo(address, …)` shape).

Mint path:
- Arc tenant trip → `complete_trip` calls `SenderoStamps.mintTo(...)`
  (existing thirdweb TokenERC1155, `0xCCf28A443e35F8bD982b8E8651bE9f6caFEd4672`).
- Solana tenant trip → `complete_trip` mints a Core asset via Metaplex
  CLI (`mplx core create-asset`) or SDK (`createV1` from
  `@metaplex-foundation/mpl-core`).

### 3. Tenant agency identity — Metaplex Agent Registry

The Metaplex **Agent Registry** program
(`1DREGFgysWYxLnRnKQnwrxnJQeSMk2HmGaC6whw2B2p`) is purpose-built for
this. `mintAndSubmitAgent` does the entire flow in one transaction:

1. Mints a Core asset (the agency's NFT).
2. Registers an on-chain identity record (PDA seeded by the asset).
3. Allocates an Asset Signer PDA wallet (the agency's on-chain treasury).
4. Optionally registers services + supported trust models.

Slots into the existing `OnchainIdentity` model with `kind='org'`,
`tenantId=...`, `chainId=<solana-devnet-magic>`, `contract=<core-program>`,
`agentId=<asset-pubkey>`. The same `cachedStars` / `cachedFeedbackCount`
columns surface the on-chain reputation read by the agent (per
`get_operator_agency` already shipped today).

### 4. Job-escrow + trip-escrow Anchor ports

Both Solidity contracts get an Anchor counterpart:

| Solidity | Anchor program | PDA seeds |
|---|---|---|
| `AgenticCommerce.sol` (ERC-8183) | `agentic_commerce` | `[b"job", job_id.to_le_bytes()]`, `[b"config"]` |
| `SenderoGuestEscrow.sol` v3.0.0 | `sendero_guest_escrow` | `[b"trip", trip_id]`, `[b"booking", booking_id]`, `[b"config"]` |

USDC SPL token. Devnet mint
`4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` cloned into the local
validator via `Anchor.toml`. v1 of `sendero_guest_escrow` skips the
v3.0.0 OTP-lockout machinery (`failed_claim_attempts` /
`claim_lockout_until`) — defer to v2 to keep the port tight. The
core flow (pre-fund → claim with sig+OTP → reserve/commit/settle →
sweep) ships in v1.

### 5. x402 signature scheme — Ed25519 on Solana, secp256k1 on Arc

The HTTP 402 protocol shape (header names, request signature format) is
chain-agnostic. The signing key + verification logic is per-chain:

- Arc → existing secp256k1 path via `keccak256(bearer)` HMAC + signed
  request (see `apps/app/app/api/agent/dispatch/route.ts`).
- Solana → Ed25519 keypair, verified server-side via
  `@solana/web3.js`'s `verify()` or `tweetnacl`.

`scopesRequireSignature()` triggers stay the same. The HMAC key
derivation differs: Arc uses `sha256(bearer)`, Solana uses the keypair's
public key as the verifier and the bearer as the auth-bound nonce.

### 6. Nanopayments — settle-chain by tenant

`MeterEvent` already has `tenantId`. Settlement logic in
`/api/cron/settle-nanopay-batches` reads `tenant.primaryChain` and
routes the burnIntent → mint flow to the right Gateway minter (Arc
treasury MSCA or Solana platform Sendero-owned PDA). Solana side uses
the existing `packages/circle/src/unified-gateway.ts::deposit` which
already supports `Sol_Devnet` / `Sol`.

## Phased rollout

### Phase 0 — Foundation (THIS COMMIT)

- ✅ `contracts/programs-solana/` Anchor workspace
  (`Anchor.toml`, `Cargo.toml`, two program crates with full type
  scaffolds — accounts, status enums, errors, events).
- ✅ `ChainKind` enum + `Tenant.primaryChain` (default `arc`).
- ✅ This plan doc.
- ✅ Toolchain confirmed: `solana-cli 3.1.12`, `anchor-cli 0.31.1`,
  `cargo 1.93.0`.
- ❌ NOT shipped: program implementations (just signatures + spec).
  No Prisma migration yet — the field is declared but unmigrated to
  avoid a stray migration in a refactoring commit. Migration ships
  with Phase 3.

### Phase 1 — `agentic_commerce` Anchor implementation

Fill in the function bodies:
- `initialize` → init `Config` PDA, set USDC mint + admin + treasury.
- `create_job` → init `Job` PDA, increment counter, emit `JobCreated`.
- `set_provider`, `set_budget`, `fund` (USDC `transfer` from client to
  escrow PDA's ATA), `submit`, `complete` (split fees + payout via PDA
  signer seeds), `reject`, `claim_refund`.
- Hook CPI plumbing for ACP-style hooks (whitelisted programs only).
- TypeScript test client (`tests/agentic-commerce.ts`) replaying the
  Arc quickstart flow against local validator.
- `anchor build && anchor test` green.

### Phase 2 — `sendero_guest_escrow` Anchor implementation

Same shape as Phase 1 but the bigger surface area:
- Trip + Booking PDAs.
- Pre-fund / claim / reserve / commit / settle / sweep.
- Ed25519 signature verification via `solana_program::ed25519_program`
  sibling instruction in `claim_trip`.
- Skip v3.0.0 OTP-lockout in v1.
- TypeScript tests for the full lifecycle.

### Phase 3 — Tenant primaryChain cascade (provisioning)

- Prisma migration for `Tenant.primaryChain`.
- Wire `tenant.primaryChain` through:
  - `apps/app/scripts/provision-circle-wallets.ts` — chain-aware.
  - `packages/circle/src/balance-sync.ts` — already chain-aware,
    just needs primaryChain default.
  - `OnchainIdentity` provisioning → routes to Arc IdentityRegistry vs
    Metaplex Agent Registry.
- Onboarding UI: `/app/onboarding/corporate/page.tsx` adds the choice.

### Phase 4 — Metaplex integration (trip stamps + agent registry)

- Add `@metaplex-foundation/mpl-core` + `@metaplex-foundation/umi` to
  `packages/circle` (or new `packages/metaplex` package).
- Trip stamp mint on `complete_trip` when `tenant.primaryChain='sol'`.
- Tenant agent NFT mint on org creation when `primaryChain='sol'` (via
  `mintAndSubmitAgent` from Agent Registry).
- Wire cached aggregations into existing `OnchainIdentity.cachedStars`
  via webhook from Solana indexer.

### Phase 5 — Cross-chain reputation mirror

- Anchor program: `sendero_attestation` — emits `RatingEmitted` event.
- Sendero indexer (new Vercel cron) reads Solana events, calls
  `give_feedback` on Arc against Sendero's canonical NFT, source-tagged
  `chain='sol'`.
- Use Gateway-based message transfer where possible for sub-second
  propagation; fall back to indexer poll otherwise.

### Phase 6 — x402 + nanopayments routing

- Ed25519 signer adapter in `packages/auth/src/dispatch-auth.ts`.
- `MeterEvent` settlement routes by `tenant.primaryChain`.
- Document in `/docs/security` (recipe section).

## Anti-patterns / footguns

- **DON'T** allow `Tenant.primaryChain` to mutate after creation.
  Cross-chain migration means draining wallets + re-minting NFTs.
  Ship that as a separate dedicated migrate-tenant flow if ever
  needed.
- **DON'T** bake chain into URLs or stable references. Use
  `tenant.primaryChain` always; never embed `arc-` or `sol-` prefixes
  in tenant slugs or trip ids.
- **DON'T** re-implement Gateway primitives. Use
  `packages/circle/src/unified-gateway.ts` for both sides.
- **DON'T** introduce Solana-specific UI components. Render USDC
  amounts, addresses, tx hashes via channel-render generic primitives;
  the only chain-aware piece is the block-explorer URL.

## Open questions (lock before Phase 1)

1. **Solana program upgrade authority.** Anchor programs ship with an
   upgrade authority (defaults to deployer). Mirror Arc's UUPS pattern
   by setting upgrade authority to a Sendero-controlled multisig
   (Squads / Circle DCW)?
2. **Agent Registry CPI from `complete_trip`.** Phase 4 needs the
   tenant Sendero agent NFT id to give_feedback against. Cache
   `OnchainIdentity.agentId` on the agency at provisioning time so the
   `complete_trip` CPI doesn't need a registry lookup.
3. **Devnet faucet automation.** Solana devnet faucet + Circle USDC
   devnet faucet need scripted seeding for end-to-end tests. Add to
   `apps/app/scripts/_local/`?
