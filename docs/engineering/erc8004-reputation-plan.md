# ERC-8004 dual reputation + validation — implementation plan

> Per-org **and** per-user on-chain identity, reputation, and validation, layered on the ERC-8004 contracts already deployed on Arc-Testnet. Atomic with wallet provisioning. Indexed via Circle Event Monitors → Postgres. Workflow-integrated 1-5 stars. Spam-defended via per-tenant policy.

## Locked principles (from user)

1. **Wallets are user-permanent**, NOT tenant-scoped. `Wallet` is already keyed `(userId, chainId, address)`. Confirmed CLEAN by code audit — one small bug (Clerk webhook doesn't merge by email when a guest later signs up).
2. **Both orgs and users get all three ERC-8004 surfaces** — identity, reputation, validation — provisioned atomically with the wallet.
3. **Reputation + validation are shareable** across the Sendero ecosystem — other tenants must be able to read.
4. **Stars 1-5** at workflow level, mapped to int128 score = stars × 20.
5. **Both parties** can rate / validate the other at any time during the trip lifecycle.
6. **Spam defense**: per-tenant `ReputationPolicy` (min stars, min trips, max dispute %, KYC/KYB required, enforcement=block|warn|allow).
7. **Index via Circle Event Monitors → Postgres**, drop Ponder for these events. Same pattern as NFT stamps.

## ERC-8004 contracts (Arc-Testnet, already deployed)

| Contract | Address |
|---|---|
| IdentityRegistry | `0x8004A818BFB912233c491871b3d84c89A494BD9e` |
| ReputationRegistry | `0x8004B663056A597Dffe9eCcC1965A193B7388713` |
| ValidationRegistry | `0x8004Cb1BF31DAf7788923b405b754f57acEB4272` |

Existing client: `packages/arc/src/identity.ts` — already exports `registerAgent`, `giveFeedback`, `getReputation`. Need to add: `requestValidation`, `submitValidationResponse`, `getValidationStatus`. Existing bootstrap script `scripts/bootstrap-agent.ts` mints Sendero's own agent NFT (#2286) — proves the pattern end-to-end.

## Wallet permanence — what's already true

Audit by Explore agent confirmed:
- ✅ `Wallet` keyed on `userId` only, no tenant filter anywhere
- ✅ `ensureTravelerWallet` idempotent on `(userId, provisioner)` via uuid-v5 from `sendero:wallet:dcw:${userId}`
- ✅ Cross-tenant traveler trips reuse the same `Wallet` row (Trip.travelerId is just User.id)
- ✅ Read paths never filter by tenantId
- ⚠️ **Bug**: Clerk webhook upserts on `clerkUserId` only — if a WhatsApp/Slack guest (provisional User row, no clerkUserId) later signs into Clerk with the same email, a NEW User is created and the original wallet is orphaned. Fix in commit 1.

## Schema additions

`packages/database/prisma/migrations/<ts>_onchain_reputation/migration.sql` + edits to `schema.prisma`:

```prisma
model OnchainIdentity {
  id              String   @id @default(cuid())
  kind            String   // 'org' | 'user'
  tenantId        String?  // populated when kind='org'
  userId          String?  // populated when kind='user'
  chainId         Int      // 5042002
  contract        String   // IdentityRegistry address
  agentId         String?  // uint256 decimal string; null while pending
  holderAddress   String   // owner EOA/SCA — CircleWallet.address (org) or Wallet.address (user)
  metadataUri     String
  mintTxHash      String?
  mintTxId        String?
  mintedAt        DateTime? @db.Timestamptz(6)
  status          String   @default("pending")  // pending|minted|failed
  cachedStars            Float?
  cachedFeedbackCount    Int   @default(0)
  cachedValidatorCount   Int   @default(0)
  cachedValidationCount  Int   @default(0)
  cachedAt               DateTime? @db.Timestamptz(6)
  createdAt       DateTime @default(now()) @db.Timestamptz(6)
  updatedAt       DateTime @updatedAt @db.Timestamptz(6)

  tenant   Tenant?              @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  user     User?                @relation(fields: [userId], references: [id], onDelete: Cascade)
  given    ReputationFeedback[] @relation("Rater")
  received ReputationFeedback[] @relation("Subject")
  validations ValidationCheck[]

  @@unique([contract, agentId])
  @@unique([kind, tenantId])    // app-layer enforces partial uniqueness
  @@unique([kind, userId])
  @@index([holderAddress])
  @@index([status])
  @@map("onchain_identities")
}

model ReputationFeedback {
  id             String   @id @default(cuid())
  subjectId      String
  fromIdentityId String?  // null when rater is off-platform / unresolved
  fromAddress    String
  score          Int      // on-chain int128, 0-100
  stars          Float    // score / 20, denormalized for queries
  tag            String?
  feedbackHash   String
  uri            String?
  txHash         String   @unique
  blockNumber    BigInt
  tripId         String?
  bookingId      String?
  createdAt      DateTime @default(now()) @db.Timestamptz(6)

  subject OnchainIdentity  @relation("Subject", fields: [subjectId], references: [id], onDelete: Cascade)
  from    OnchainIdentity? @relation("Rater",   fields: [fromIdentityId], references: [id], onDelete: SetNull)
  trip    Trip?    @relation(fields: [tripId], references: [id], onDelete: SetNull)
  booking Booking? @relation(fields: [bookingId], references: [id], onDelete: SetNull)

  @@index([subjectId, createdAt])
  @@index([fromIdentityId])
  @@map("reputation_feedback")
}

model ValidationCheck {
  id              String   @id @default(cuid())
  subjectId       String
  validatorAddress String
  requestUri      String
  requestHash     String   @unique
  requestTxHash   String
  responseScore   Int?     // 100=passed, 0=failed, null=pending
  responseTxHash  String?
  tag             String?
  createdAt       DateTime  @default(now()) @db.Timestamptz(6)
  resolvedAt      DateTime? @db.Timestamptz(6)

  subject OnchainIdentity @relation(fields: [subjectId], references: [id], onDelete: Cascade)
  @@index([subjectId])
  @@map("validation_checks")
}

model ReputationPolicy {
  id              String   @id @default(cuid())
  tenantId        String   @unique
  minStars        Float?   // null = no min
  minTripCount    Int?
  maxDisputeRatio Float?
  requireKyc      Boolean  @default(false)
  requireKyb      Boolean  @default(false)
  enforcement     String   @default("warn")  // block|warn|allow
  createdAt       DateTime @default(now()) @db.Timestamptz(6)
  updatedAt       DateTime @updatedAt @db.Timestamptz(6)

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  @@map("reputation_policies")
}
```

`Tenant` + `User` get back-relations to `OnchainIdentity[]`; `Trip` + `Booking` get `ReputationFeedback[]`.

## Provisioning — atomic wallet + identity (+ optional KYC validation kickoff)

New file `packages/arc/src/provision-identity.ts` exports `ensureOrgIdentity({ tenantId })` and `ensureUserIdentity({ userId })`. State machine mirrors `mintStampTool`:

1. Read existing `OnchainIdentity` for `(kind, subjectId)`. Return cached if `status='minted'`.
2. Resolve `holderAddress` (CircleWallet.address for org, Wallet.address for user). Bail if wallet missing.
3. Build deterministic metadata URI: `${APP_URL}/agents/${kind}/${id}/metadata.json` (no IPFS pin v1; URL is stable).
4. Upsert pending row.
5. Call existing `registerAgent({ ownerWalletAddress, ownerAddress: holderAddress, metadataURI })`.
6. On success: write `agentId`, `mintTxHash`, `status='minted'`. On failure: row stays `pending`; sweeper picks it up.

**Org path** — extend `apps/app/app/api/webhooks/clerk/route.ts::onOrganizationCreated`:
```ts
const result = await provisionTenantWallet({ tenantId, clerkOrgId });
await ensureOrgIdentity({ tenantId, holderAddress: result.address });
```

**User path** — extend `packages/tools/src/ensure-traveler-wallet.ts` after `prisma.wallet.create(...)`. Wrap in try/catch — wallet provisioning succeeds even if identity mint fails; sweeper retries.

**Sweeper** — new cron route `apps/app/app/api/cron/retry-identity-provision/route.ts`, every 5 min, picks 50 `status='pending' AND createdAt < now()-60s` rows. Add to `apps/app/vercel.json`.

**Optional KYC validation kickoff** — for orgs marked `requireKyb=true` in their `ReputationPolicy`, the provisioning hook also fires `requestValidation` with a `tag='kyb_required'` to a Sendero treasury validator. Check is `pending` until an off-platform validator (Persona/Sumsub adapter, future) submits the response. Users marked for KYC follow the same pattern.

## Validation — first-class on day one (per user clarification)

ValidationRegistry is NOT deferred. Both orgs and users have a `ValidationCheck` lifecycle:

- **Request**: agent owner (Sendero treasury for KYC/KYB; or any tenant for "I want to verify this counterparty before booking") calls `validationRequest(validator, agentId, requestURI, requestHash)`.
- **Response**: validator wallet calls `validationResponse(requestHash, response, responseURI, responseHash, tag)`. `100 = passed`, `0 = failed`.
- **Read**: `getValidationStatus(requestHash)` returns the verdict; we cache in `ValidationCheck` table.

New helpers in `packages/arc/src/identity.ts`:
- `requestValidation({ validatorWalletAddress, validatorAddress, agentId, requestURI, requestHash })`
- `submitValidationResponse({ validatorWalletAddress, requestHash, response, tag })`
- `getValidationStatus({ requestHash })` — public read

New tools in `packages/tools/src/`:
- `request_validation` — privileged, called by tenant or treasury
- `submit_validation_response` — privileged, called by the validator
- `read_validation` — public, returns the on-chain verdict + cache

Workflow trigger: when an org or user is provisioned with `requireKyc=true` / `requireKyb=true` in policy, the provisioning hook fires a validation request to the Sendero treasury validator. Without a passing validation, `reputationGate` blocks engagement.

## Reputation tools

Five new entries in `packages/tools/src/`:

| Tool | Scope | Purpose |
|---|---|---|
| `give_feedback` | privileged | Rate a counterparty 1-5 stars from your DCW. Self-rating guard. Meters $0.005. |
| `read_reputation` | public | Returns cached stars/count + recent feedback + optional policy verdict. |
| `request_validation` | privileged | Two-step ValidationRegistry kickoff. |
| `submit_validation_response` | privileged | Validator-side response. |
| `read_validation` | public | Status read for a `requestHash` or by subject. |

Self-rating guard: throw if rater's `agentId === subjectAgentId`. ERC-8004 enforces this on-chain too, but failing fast is cheaper than a reverted tx.

## Workflow integration — three insertion points

1. **Trip request (gating, no write)** — in `apps/app/app/api/agent/dispatch/route.ts`, call `reputationGate({ tenantId, counterpartyKind, counterpartyId })` BEFORE invoking booking tools. Returns `{ ok, violations, validationStatus }`. On `enforcement='block'` violation, short-circuit with a templated decline; on `'warn'`, log + continue.
2. **Mid-trip dispute** — `cancelBookingTool` and `trip-delay-replanner` queue a `give_feedback` call with `tag='dispute_opened'` and a low score when invoked under specific dispute codes. This is the only mid-trip write.
3. **Post-trip — mandatory bidirectional rating** — new WDK workflow `rate_counterparty` triggered from `settleBookingTool.handler` epilogue:
   - `agency_rates_user` step: prompts agency operator (or tenant agent) for stars 1-5, 72h SLA.
   - `user_rates_agency` step: prompts user via channel adapter, 72h SLA.
   - On answer: `give_feedback` from rater's wallet (cross-rating per §validator strategy).
   - On no-answer: defaults to 3 stars `tag='no_response'`, `metadata={ inferred: true }` for analyst filtering.

## Validator wallet strategy — cross-rating (option B)

**Each party uses their own DCW** (which owns their own ERC-8004 agent NFT) to rate the other party's agent. Sara's user-DCW (owner of agent #4711) rates Acme's agent #2286; Acme's tenant treasury (owner of #2286) rates Sara's #4711. ERC-8004's no-self-rating rule is satisfied trivially.

Why not Sendero-as-universal-validator: centralizes trust in one signer, breaks "shareable across the ecosystem", bottlenecks on one wallet's nonce. Cross-rating produces a true peer trust graph other tenants can independently inspect.

Gas: Circle Gas Station sponsors all DCW txns on Arc — no UX cost.

## Anti-spam policy enforcement

- **Config UI**: `apps/app/app/(authenticated)/dashboard/settings/reputation/page.tsx` — server component reading `ReputationPolicy`, form submitting to `/api/tenant/reputation-policy`.
- **Runtime gate**: extend `packages/tools/src/check-policy.ts` (already used for spend caps) with `reputationGate({ tenantId, counterpartyKind, counterpartyId })` returning `{ ok, violations: [{ rule, threshold, actual }], validationStatus }`.
- **Channel-adapter declines**: phrasing centralized in `packages/locale/src/reputation.ts`. WhatsApp / Slack / web get tone-appropriate refusals.

## Indexing — Circle Event Monitors → Postgres only

Drop Ponder for ERC-8004 events. Justification:
- The Stamps pattern is already proven in production at `apps/app/app/api/webhooks/circle/events/route.ts`.
- Ponder is an extra service with its own DB and ops surface.
- Circle Event Monitors give us push-on-event with `processDurableWebhook(externalId=notificationId)` idempotency.

**Events to register** (verify topic0 against actual deployed ABI before commit):
- IdentityRegistry: `Transfer(address,address,uint256)` — backfill `OnchainIdentity.agentId` from mint receipts.
- ReputationRegistry: confirm exact event signature from `scripts/check-reputation.ts` (currently empirical topic `0x6a4a6174…`).
- ValidationRegistry: `ValidationRequested` and `ValidationResponseSubmitted` (verify names + arg shape).

**New script**: `scripts/register-reputation-event-monitors.ts` (clone of stamps version).

**Webhook refactor**: `apps/app/app/api/webhooks/circle/events/route.ts` switches over a registry of `[STAMPS, IDENTITY, REPUTATION, VALIDATION]` → handler module. Refactor into `events/handlers/{stamps,identity,reputation,validation}.ts`.

`handleFeedbackGiven`:
1. Decode `{ subjectAgentId, validatorAddress, score, tag, feedbackHash }` from topics+data.
2. Resolve `subjectId` via `OnchainIdentity.findUnique({ contract_agentId })`.
3. Resolve `fromIdentityId` via validator address match against `OnchainIdentity.holderAddress` (null if external).
4. Insert `ReputationFeedback` (idempotent on `txHash`).
5. Recompute and write `OnchainIdentity.cached*` (write-on-event freshness).

`handleValidationRequested` / `handleValidationResponseSubmitted` keep `ValidationCheck` rows in sync.

## Public OG + dashboards

- `apps/app/app/agents/[kind]/[id]/page.tsx` — public profile, server-renders reputation card from `OnchainIdentity` + recent `ReputationFeedback`. URL slug uses Sendero id (tenantId/userId), stable across re-mints. `generateMetadata` for OG / Twitter card.
- `apps/app/app/agents/[kind]/[id]/metadata.json/route.ts` — the URI handed to `registerAgent`. Returns ERC-8004 agent metadata JSON.
- `apps/app/app/agents/[kind]/[id]/opengraph-image.tsx` — Next.js OG image with star rating + count, brand-themed.
- `apps/app/app/(authenticated)/dashboard/reputation/page.tsx` — own reputation, history, dispute counter, validation status.
- `apps/app/app/(authenticated)/dashboard/settings/reputation/page.tsx` — policy editor.

## Phasing — six commits, each ≤600 LOC / ≤20 files, typecheck-green

1. **Schema + sweeper foundation + Clerk-merge bug fix** (~280 LOC) — Prisma migration for `OnchainIdentity` + `ReputationFeedback` + `ValidationCheck` + `ReputationPolicy`. New `provision-identity.ts` with `ensureOrgIdentity` / `ensureUserIdentity` state machine. New cron route `retry-identity-provision`. Clerk webhook merge-by-email fix. Unit tests for state machine + merge.
2. **Provisioning hookup** (~220 LOC) — wire `ensureOrgIdentity` into `onOrganizationCreated`, `ensureUserIdentity` into `ensureTravelerWallet`. Public metadata route `/agents/[kind]/[id]/metadata.json`. Smoke test extending `smoke-clerk-webhook.ts`.
3. **Reputation + validation tools** (~480 LOC) — `give_feedback`, `read_reputation`, `request_validation`, `submit_validation_response`, `read_validation`. Self-rating guard. Scope wiring (`PRIVILEGED_TOOLS`). Registration in `packages/tools/src/index.ts`. Replace `rate-agent.ts` mock. Unit tests.
4. **Event Monitor + webhook handlers** (~520 LOC) — `register-reputation-event-monitors.ts`. Refactor `events/route.ts` into per-contract handler modules. `handleFeedbackGiven`, `handleIdentityTransfer`, `handleValidationRequested`, `handleValidationResponseSubmitted`. Cache writeback. Drop Ponder ERC-8004 entries (no-op delete).
5. **Workflow integration + policy gate** (~420 LOC) — `rate_counterparty` WDK workflow, hook into `settleBookingTool` epilogue. Extend `check-policy.ts` with `reputationGate`. Wire into `/api/agent/dispatch`. Channel-adapter templated declines.
6. **UI: public + dashboard** (~580 LOC) — `/agents/[kind]/[id]` public + OG image, `/dashboard/reputation`, `/dashboard/settings/reputation` editor. Storybook stories for the reputation card.

## Risks + open decisions

**Risks**
- Gas at scale (mainnet may not sponsor): batch post-trip rating pair into a single multicall if available; rate-limit to 1 rating per booking finalize.
- Latency on the rating-block path: cache-first reads (sub-50ms); 2s timeout with `{ ok: 'unknown' }` fallback for external counterparties.
- GDPR: on-chain rows immutable. Tombstone `metadataUri` is the only erasure lever — document in ToS.
- Sybil via cheap WhatsApp signups: enforce `minStars` only when `feedbackCount >= minTripCount`; novice pass-through with optional `requireKyc`.
- Atomic provisioning race: wallet commits, identity mint fails permanently. Sweeper needs a `failed` terminal state after N attempts, surfaced in admin UI.
- Rater identity not yet indexed when feedback arrives: webhook accepts null `fromIdentityId`; nightly job backfills by `fromAddress`.

**Open decisions before commit 1**
- Star → score mapping: `score = stars × 20` (1★=20…5★=100)? Or 1★ floor at 10 to leave a "credible failure" zone?
- Default `enforcement` for new `ReputationPolicy`: `'warn'` (recommended) or `'allow'` (zero friction at launch)?
- Should agencies also rate suppliers (Duffel airline, hotel) on-chain v1? Schema supports it; workflow doesn't yet.
- Treasury validator wallet for KYC/KYB requests: reuse Sendero existing treasury, or provision a dedicated `kyb-validator` DCW?

## Out-of-band blockers (need user, not me)

These can't be auto-looped — surface and wait:
1. **Vercel AI Gateway free credits restricted** → top-up OR mint `GOOGLE_GENERATIVE_AI_API_KEY` at aistudio.google.com.
2. **Vercel Blob store private** → provision a public store or redesign to signed-URL passthrough (breaks OG simplicity).
3. **Dev DB has no Trip→Traveler→DCW chain** → easiest path: log in as a `qa-logins.local.json` user, book a Duffel test flight end-to-end. That triggers `ensureTravelerWallet` and gives us a clean `(tripId, bookingId, dcwAddress)`.

These are independent of the reputation work — they block the *previous* stamp e2e test, not this plan.

## Critical files for implementation

- `packages/database/prisma/schema.prisma`
- `packages/arc/src/identity.ts`
- `packages/tools/src/ensure-traveler-wallet.ts`
- `packages/tools/src/rate-agent.ts` (replace mock)
- `apps/app/app/api/webhooks/clerk/route.ts`
- `apps/app/app/api/webhooks/circle/events/route.ts`
- `scripts/bootstrap-agent.ts` (proven pattern to lift from)
- `scripts/check-reputation.ts` (empirical event signature source)
