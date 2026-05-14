# Gateway v5 — Interim Plan (Q2 2026, pre-Circle-1271)

> Status: scoping draft.
> Branch: `tcxcx/gateway-v5-migration-review`.
> Source: `~/coding-dojo/sendero/docs/gateway-wallet-port-design.md`
> (canonical port doc, 1437 lines + Appendix C addendum, 2026-05-12).
> Decision: ship Tracks A + D-scoped + substrate. Defer Track B
> until Circle confirms EIP-1271 on Gateway burn intents. Sendero
> remains custodian-of-record during this phase.

## 1. Scope

**In:**

- Double-entry journal + intent state machine + signing audit
  + pre-sign compliance gate (port doc Sections 4.5 + 4.6).
- GCP KMS rewrap of `TenantGatewaySigner` + `UserGatewaySigner`,
  plain per-tenant CMK, software tier.
- Confidential Space attestation gating decrypt for the
  API-key-authed privileged signing path only (`settlement` /
  `treasury` / `*` scopes in `packages/auth/src/dispatch-auth.ts`).
- Drop platform-EOA fallback at `packages/circle/src/gateway.ts:478, 676`.
- Split `SENDERO_SOLANA_PLATFORM_PRIVATE_KEY` into purpose-scoped keys.
- Pre-wire `SmartAccount1271Principal` type stub.

**Out (deferred to post-1271 phase):**

- Track B: passkey MSCA + delegate registration + escape hatch UI.
- Per-tenant IAM Conditions + Workload Identity Federation.
- Squads V4 vault pre-fund replacing JIT-drip Solana gas.
- Full B2B2B authority matrix (port doc 4.7) — corporate-account
  + traveler-trip wallet kinds.

**Explicit non-goal:** this phase does not change custody
classification. Sendero remains custodian / CASP / MSB. The interim
hardens the trust surface and ships the fintech substrate. The
classification change is gated on Circle 1271.

## 2. Sequence

Nine steps. Each ships independently. Order chosen so SigningEvent
+ JournalEntry are recording before any KMS migration touches a
signer.

### Step 1 — JournalEntry table + write-through (shadow)

Independent of any custody change. Lands the bookkeeping authority
for "what does the tenant own."

Schema per port doc 4.5. Postgres trigger asserts
`SUM(debit) == SUM(credit)` per `transaction_id` at COMMIT.

Write sites:

- `packages/tools/src/confirm-booking.ts` (vendor + agency + fee legs)
- `packages/tools/src/settle-booking.ts`
- `packages/circle/src/gateway-deposit-core.ts` (inbound deposit leg)
- `packages/circle/src/gateway-sweep.ts` (DCW → Gateway sweep leg)
- `packages/circle/src/unified-gateway.ts::transferViaGateway`
  (spend + bridge legs)

Shadow for 14 days: write both old and new representation; nightly
reconciler asserts agreement before flipping journal to authority.

Backfill: derive historical legs from `MeterEvent` + Circle webhook
history.

**Ship gate:** zero reconciliation breaks for 14 consecutive days
on prod.

### Step 2 — GatewayTransferIntent state machine (read-only first)

Wraps existing `transferViaGateway` call sites. Records every state
transition that already happens in-line. Feature flag off — state
machine is observability only.

States per port doc 4.5: `prepared → burn_signed → burn_attested
→ mint_submitted → mint_confirmed | mint_failed_retriable |
mint_failed_terminal`.

Seed: `spendWithMintRetry` (Phase 4.5, shipped 2026-05-11) is the
in-process burn-attest-replay-mint pattern. This step persists the
attestation between burn and mint so process death recovers via
cron, not just in-process retry.

Cron: `apps/app/app/api/cron/gateway-intent-reconcile/route.ts`.
Polls rows stuck >5min in `burn_signed` / `burn_attested` /
`mint_submitted`. Retries next state or routes to
`mint_failed_terminal` with Slack alert to the customer-support
channel (reuse `apps/app/lib/platform-wallet-alerts.ts` pattern).

**Ship gate:** flip per-tenant flag after one week of clean shadow
data.

### Step 3 — SigningEvent table

One row per signature, including cache hits. Schema per port doc 4.5.

Write sites:

- `packages/circle/src/gateway-signer.ts::getTenantSigner` — every
  decrypt AND every cache hit.
- User-scope branch at `gateway-signer.ts:480` currently early-
  returns, leaving user-scope signer decrypts unaudited. This step
  closes that gap.
- `packages/circle/src/gateway-signer.ts::getUserSigner` (mirror).
- `TenantSolanaGatewaySigner` (Phase 4.5).

`WalletAccessLog` stays as a denormalized dashboard index but is no
longer the authoritative record.

No fund risk. Forensics improvement is immediate.

### Step 4 — ComplianceDecision in `log_only` mode

Schema per port doc 4.6. Write site is every call to
`transferViaGateway` + `confirm_booking` + `settle_booking`.

Provider integration deferred. `log_only` writes a synthetic
decision (`provider: 'none'`, `sanctionsResult: 'allow'`,
`riskScore: 0`) so the type contract is enforceable today and
provider can swap in later without changing call sites.

Provider selection (Sumsub / Notabene / TRM / Chainalysis KYT)
gated on first paying TMC's jurisdiction. Port doc open question #2.

**Ship gate:** every value-moving tool writes a
`complianceDecisionId` on its journal entry. Type-enforced via
`Principal.sign` signature.

### Step 5 — KMS rewrap, two-column, canary tenant

The only step with non-trivial fund risk. Procedure from port doc
Section 8 step 5.

Schema additions on `TenantGatewaySigner` + `UserGatewaySigner`:

- `kek_provider` enum (`'env-v1'` | `'kms-v1'`).
- `new_envelope` bytea (KMS-wrapped DEK ciphertext).

Migration job: `apps/app/scripts/_local/migrate-kek-to-kms.ts`.
Reads each row under env-KEK, re-encrypts under KMS-wrapped DEK,
writes `new_envelope`, sets `kek_provider = 'kms-v1'`, bumps
`kek_version` to the KMS key version. Atomic per row, idempotent
via compare-and-swap on `kek_provider`.

Read path is dual: `gateway-signer.ts::getTenantSigner` reads
`kek_provider` first, falls back to env-KEK only during migration
window.

Canary tenant: **TBD — open item for founder** (see §4). Likely
Sendero's own internal ops tenant for 48h soak under live traffic.

GCP setup (one-time):

```bash
gcloud kms keyrings create sendero-tenants --location us
# per-tenant on organization.created webhook:
gcloud kms keys create tenant-<id> \
  --keyring sendero-tenants --location us \
  --purpose encryption --rotation-period 90d
```

**Per-tenant IAM Condition + Workload Identity Federation NOT in
this step.** 1271-conditional — plain `cryptoKeyDecrypter` role on
the keyring for the runtime service account, with Cloud Audit Log
review sufficing for now. If 1271 ships, custodial signing becomes
a minority path and per-tenant IAM yak-shaving is wasted effort.

Rollout: canary 48h → 5% → 25% → 100% → 7-day soak → retire
env-KEK code path → 30-day grace → drop `encrypted_private_key`
column.

**Ship gate:** 7-day clean soak at 100% with zero cross-tenant
decrypts in audit logs.

### Step 6 — Drop platform-EOA fallback

After step 5 cuts over, delete `signer ?? treasuryAccount()` at
`packages/circle/src/gateway.ts:478, 676`. Type-mandatory `signer`.

Every call site picks a Principal explicitly. Compiler enforces no
silent platform-signing path.

Caller-identity verification: `transferViaGateway` asserts
`signer.tenantId === ctx.tenantId` at runtime via SigningEvent
preflight. Prevents a caller from passing another tenant's
explicit signer.

### Step 7 — Split `SENDERO_SOLANA_PLATFORM_PRIVATE_KEY`

One PR per consumer. Each migrates to its own KMS-wrapped key.

- `@sendero/metaplex` → `SOLANA_MINTER` (mint-only key).
- `@sendero/nanopayments` → `SOLANA_NANOPAY_SIGNER`.
- `packages/circle/src/unified-gateway.ts::ensureSolanaGas` →
  `SOLANA_GAS_FUNDER` (rate-limited per address per day).

Old env key kept readable for 30 days as safety net, then removed.

JIT-drip itself stays — Squads pre-fund (Track C) is deferred.
Just the key isolation lands now.

### Step 8 — Confidential Space for API-key privileged signing

Scope-narrowed Track D. Only the `/api/agent/dispatch` path where
`scopesRequireSignature()` returns true (caller has `settlement` /
`treasury` / `*` scope, per
`packages/auth/src/dispatch-auth.ts`) routes through Confidential
Space. Hot-path consumer signing stays on plain KMS from step 5.

Workload: dedicated Cloud Run service (or Cloud Run + GKE workload
identity-federated job) running the signing logic. Container image
is content-addressable; CI publishes digest.

KMS policy: CMK release gated on attestation token naming the
registered image digest.

CI plumbing (port doc open question #10):

- Cloud Build with provenance attestation.
- Binary Authorization policy denying containers without signed CI
  attestation.
- SLSA-3 provenance bound to verifiable source commit.
- Two-person approval gate via Cloud Deploy on
  `attestedImageDigest` rotation.

`Principal` union additions (port doc Section 6):

```ts
| ConfidentialSpacePrincipal
```

`SigningEvent` rows for this path record `attestedImageDigest`
+ `slsaSourceCommit`.

Tenant-notify on digest rotation: email + dashboard event when the
digest bound to a tenant's signer changes. Reuse the
`notifyPlatformWalletLow` Slack-channel pattern.

**Ship gate:** end-to-end test from API-key request →
Confidential Space attestation → KMS decrypt → signature →
SigningEvent row with `attestedImageDigest` populated. Drill:
attempt digest rotation without two-person approval — must fail.

### Step 9 — Pre-wire `SmartAccount1271Principal` stub

One commit. Adds the type to the `Principal` union, all sign sites
fail with `NOT_YET_SUPPORTED`. Allows the post-1271 cutover to be
a single adapter PR plus the collapsed Track B work, not a rewrite
of consumer code.

```ts
| SmartAccount1271Principal
```

```ts
export interface SmartAccount1271Principal {
  kind: 'smart-account-1271';
  address: `0x${string}`;
  userId: string;
  credentialId: string;
}
```

## 3. Decision gates

| Gate | Trigger | Action |
|---|---|---|
| Pre-step-5 | JournalEntry shadow shows >0 reconciliation breaks/week | Stop. Root-cause divergence. Do not touch KEK while bookkeeping diverges. |
| Step-5 canary | Sign-path p99 latency >100ms under live traffic | Roll back to env-KEK. Investigate KMS cold-start. |
| Step-5 rollout | Any cross-tenant decrypt observed in audit logs | Stop. Per-tenant CMK isolation is not enforcing. Investigate. |
| Step-8 attestation | Image digest rotation without two-person approval succeeds | Stop. Binary Authorization is not enforcing. Audit policy. |
| 1271 confirmation | Corey confirms 1271 ships before 2026-09-30 | Begin Track B post-1271 design (collapsed shape per Appendix C). |
| 1271 deferral | Corey confirms 1271 not before 2027 | Expand Track A with per-tenant IAM Conditions + WIF. Begin Track B as workaround per original port doc Section 4. |

## 4. Open items requiring founder/legal input

1. **Canary tenant for KEK rewrap.** Sendero's ops tenant, an
   employee-only test tenant, or a low-volume paying TMC with
   consent? Port doc open question #12.
2. **Travel Rule provider.** Port doc open question #2. Selection
   gated by first paying TMC's jurisdiction.
3. **KMS region split.** EU tenants pinned to `europe` keyring vs
   `us`. Trivial at tenant create, painful to retrofit. Decide
   before step 5 rollout.
4. **Break-glass for KMS admin.** Steady state denies human
   `cryptoKeyDecrypter`. Incident response path needs definition.
   Port doc open question #11.
5. **Confidential Space day-one scope.** API-key privileged path
   only, or also tenant-treasury signing above $X threshold?
6. **Legal review of post-1271 software-provider classification.**
   Even with 1271, the precise wire (who is the initial owner of
   the MSCA factory? does Sendero ever hold ciphertext that
   decrypts to user signing material? does the bootstrap-then-
   revoke pattern survive legal scrutiny?) determines
   classification. Pre-engage counsel before Track B rollout.

## 5. Effort estimate (rough, 1 senior eng)

| Step | Eng-weeks |
|---|---|
| 1. JournalEntry + shadow | 2 |
| 2. Intent state machine | 2 |
| 3. SigningEvent | 1 |
| 4. ComplianceDecision (log_only) | 1 |
| 5. KMS rewrap + canary + rollout | 3 |
| 6. Drop platform-EOA fallback | 0.5 |
| 7. Split Sol platform key | 1 |
| 8. Confidential Space + CI plumbing | 4 |
| 9. 1271 Principal stub | 0.5 |
| **Total** | **~15 weeks** |

At ~3.5 months focused, this is the Q2-into-Q3 plan. The post-1271
Track B (collapsed) is a separate ~6-8 week effort once Corey
confirms.

## 6. References

- Port doc:
  `~/coding-dojo/sendero/docs/gateway-wallet-port-design.md`
  (1437 lines + Appendix C addendum, 2026-05-12).
- Centralization audit memory: `gateway_wallet_centralization_audit.md`.
- Phase 4.5 ship memory: `phase_4_5_sol_self_custody_shipped.md`.
- Current gateway code: `packages/circle/src/` (15 files),
  `apps/app/lib/gateway-*.ts`.
- Privileged-signing scope check:
  `packages/auth/src/dispatch-auth.ts::scopesRequireSignature`.
- Circle email thread: 1271 confirmation requested 2026-05-12;
  H1 2026 was Feb target.
