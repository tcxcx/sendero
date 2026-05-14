# Phase 5 — Production hardening runbook

The Phase 5 code change moves the Gateway-signer KEK from a raw env var
to a Google Cloud KMS-decrypted blob, adds an append-only audit log of
every key-material decrypt, and registers a cron that pulls Circle's
truth into our `GatewayTransferLog` rows whenever a transfer gets stuck.

The code is wired. The artifacts below are what an operator does the
day Phase 5 ships.

## Phase 5 scope

- **In scope**: KEK rotation via GCP KMS, audit logging of Gateway key
  decrypts, transfer-stuck reconcile cron, operator-triggered per-row
  reconcile, stale-sweep reaper.
- **Out of scope**: re-encrypting historical ciphertexts under a new
  KEK version. The KEK version field is in place but rotation is a
  follow-up — when the next KEK version lands, every existing
  `TenantGatewaySigner` row will need a re-encrypt-on-read pass.
- **Out of scope**: rotating the per-tenant DEK. DEK is HKDF-derived
  from KEK + tenant id, so a KEK rotation is the only rotation point.

## What automatically happens (no operator action)

- `getOrCreateGatewaySigner` and `getGatewaySigner` write a
  `WalletAccessLog` row on every cache miss. The cron-driven cache
  warmup keeps audit volume bounded by `cold starts × tenants × ops per
  cold start`, not `requests × tenants`.
- `loadKek(version)` caches the decrypted KEK in process memory keyed
  by version, so KMS hits are once per cold start per version.
- The reconcile cron runs every 10 minutes (`vercel.json`). It scans
  `GatewayTransferLog` rows in `attesting | minting` older than
  8 minutes and reaps `GatewayDepositLog` pending rows older than
  30 minutes.
- The per-row reconcile route is throttled to 30 seconds per row so
  operator-button spam can't outpace the cron.

## What the operator MUST do

### 1. Provision a Google Cloud KMS key

The KEK is a 32-byte random value, encrypted under a Cloud KMS crypto
key. Sendero's runtime decrypts the KEK on cold start using the
Vercel runtime's GCP service account.

```bash
# 1.1 Create a key ring (one-time, per environment).
gcloud kms keyrings create sendero-prod \
  --location=us \
  --project=sendero-prod

# 1.2 Create a software-backed crypto key inside it.
#     Use HSM (`--protection-level=hsm`) for mainnet.
gcloud kms keys create gateway-kek-v1 \
  --location=us \
  --keyring=sendero-prod \
  --purpose=encryption \
  --protection-level=software \
  --project=sendero-prod

# 1.3 Generate a 32-byte KEK locally and encrypt it under that key.
openssl rand 32 > /tmp/kek.bin

gcloud kms encrypt \
  --location=us \
  --keyring=sendero-prod \
  --key=gateway-kek-v1 \
  --plaintext-file=/tmp/kek.bin \
  --ciphertext-file=/tmp/kek.enc \
  --project=sendero-prod

# 1.4 Read the ciphertext into a base64 blob for the env var.
base64 -i /tmp/kek.enc

# 1.5 Wipe the plaintext immediately.
shred -u /tmp/kek.bin /tmp/kek.enc
```

### 2. Wire the runtime IAM

Vercel deployments call `cloudkms.cryptoKeyVersions.useToDecrypt` on
the key above. The runtime needs a service account with that role.

```bash
# 2.1 Create the service account.
gcloud iam service-accounts create sendero-runtime \
  --project=sendero-prod \
  --display-name="Sendero runtime KMS decryptor"

# 2.2 Grant decryptOnly on the specific crypto key (least-privilege).
gcloud kms keys add-iam-policy-binding gateway-kek-v1 \
  --location=us \
  --keyring=sendero-prod \
  --member="serviceAccount:sendero-runtime@sendero-prod.iam.gserviceaccount.com" \
  --role=roles/cloudkms.cryptoKeyDecrypter \
  --project=sendero-prod

# 2.3 Generate a JSON key for Vercel.
gcloud iam service-accounts keys create /tmp/sendero-runtime.json \
  --iam-account=sendero-runtime@sendero-prod.iam.gserviceaccount.com \
  --project=sendero-prod
```

### 3. Configure Vercel env vars

The Phase 5 code reads four env vars. Set all four in Vercel scoped to
**all preview** + **production** + **development** (no `--gitBranch`
filter — the branch-scope CLI quirk is documented in `lessons.md`).

```bash
# 3.1 KEK provider switch — flips encrypt/decrypt to KMS mode.
vercel env add SENDERO_KEK_PROVIDER production preview development
# Value: gcp-kms

# 3.2 KEK ciphertext (the base64 blob from step 1.4).
vercel env add SENDERO_KEK_CIPHERTEXT production preview development
# Value: <base64 blob>

# 3.3 KMS resource name pointing at the crypto key version.
vercel env add SENDERO_KEK_KMS_RESOURCE production preview development
# Value: projects/sendero-prod/locations/us/keyRings/sendero-prod/cryptoKeys/gateway-kek-v1

# 3.4 Service account JSON for the @google-cloud/kms client. Single
#     line, escape newlines, OR encode as base64 and decode at boot.
vercel env add GOOGLE_APPLICATION_CREDENTIALS_JSON production preview development
# Value: <contents of /tmp/sendero-runtime.json>
```

After all four are set, `shred -u /tmp/sendero-runtime.json`.

### 4. Verify the KMS path before disabling env mode

Run a smoke test against production with `SENDERO_KEK_PROVIDER=gcp-kms`
but the env-mode `SENDERO_KEK` ALSO set as a fallback. Confirm one
tenant's signer still decrypts correctly (any Gateway transfer or
balance call hits the path). When you've confirmed at least one
successful decrypt, remove `SENDERO_KEK` from Vercel:

```bash
vercel env rm SENDERO_KEK production
vercel env rm SENDERO_KEK preview
vercel env rm SENDERO_KEK development
```

The fallback removal is what closes the env-mode attack surface — until
you delete `SENDERO_KEK`, an attacker with read access to Vercel env
could still decrypt Gateway signers offline.

### 5. Confirm the audit log is recording

```sql
-- Recent decrypts across all tenants.
SELECT "tenantId", "callerSurface", "kekVersion", "context", "occurredAt"
FROM wallet_access_logs
ORDER BY "occurredAt" DESC
LIMIT 20;

-- Per-tenant decrypt cadence.
SELECT "tenantId", COUNT(*) AS decrypts, MAX("occurredAt") AS last
FROM wallet_access_logs
WHERE "occurredAt" > NOW() - INTERVAL '24 hours'
GROUP BY "tenantId"
ORDER BY decrypts DESC;

-- Suspicious traffic — surface=unknown means a caller forgot to plumb
-- caller context. Track these down so audit captures who touched what.
SELECT COUNT(*), DATE_TRUNC('hour', "occurredAt") AS hour
FROM wallet_access_logs
WHERE "callerSurface" = 'unknown'
  AND "occurredAt" > NOW() - INTERVAL '7 days'
GROUP BY hour
ORDER BY hour DESC;
```

### 6. Confirm the reconcile cron is running

```sql
-- Stuck transfers should drain. If `lastReconciledAt` is NULL on rows
-- older than 30 minutes the cron isn't running.
SELECT id, status, "createdAt", "lastReconciledAt", "circleTransferId"
FROM gateway_transfer_logs
WHERE status IN ('attesting','minting')
ORDER BY "createdAt" ASC
LIMIT 20;

-- Reaper should flip stale pending sweeps. Pre-cron there will be
-- pending rows older than 30min; post-cron they should all be `failed`.
SELECT status, COUNT(*) AS rows, MIN("createdAt") AS oldest
FROM gateway_deposit_logs
WHERE "createdAt" > NOW() - INTERVAL '7 days'
GROUP BY status;
```

Vercel cron logs surface under
`Project → Logs → Filter by Function Path = /api/cron/reconcile-gateway-transfers`.
The route returns `{ ok, transfers, sweeps, reconciled }` so the log
line shows the full summary.

### 7. Operator UI integration (optional, follow-up)

Wire a `Reconcile` button next to any `attesting` or `minting` row in
the operator dashboard. Button calls
`POST /api/gateway/transfer/<logId>/reconcile`. Disable the button for
30s after a click (response includes `retryAfterMs` when throttled).

This is intentionally a follow-up — the cron handles the autonomous
case and the per-row route is the manual escape hatch. UI work can
land in a separate PR.

## Disaster recovery

### KMS unavailable

`@google-cloud/kms` returns 5xx, IAM bound incorrectly, region outage.
The runtime fails closed: `loadKekFromKms` throws and every Gateway
signer decrypt errors out. `WalletAccessLog` continues to write because
those rows are written by callers that already decrypted (cache hits).

Mitigation:

1. Re-set `SENDERO_KEK` env var with the plaintext KEK (kept in a
   sealed offline backup).
2. Set `SENDERO_KEK_PROVIDER=env` to bypass KMS.
3. Redeploy. Existing process-cache decryption rides through the cold
   start.
4. Once KMS is back, set `SENDERO_KEK_PROVIDER=gcp-kms`, redeploy, and
   confirm one decrypt before deleting `SENDERO_KEK` again.

### KEK leaked

Rotate immediately:

1. Generate a fresh KEK + GCP crypto key (`gateway-kek-v2`).
2. Re-encrypt every `TenantGatewaySigner` row — read with the old KEK
   (decrypt path), encrypt with the new KEK, persist with `kekVersion=2`.
3. Delete the old KMS crypto key version once the migration is complete.
4. Audit `wallet_access_logs` for the time window before discovery.

The migration script is a future deliverable; for now, the unique
`kekVersion` column means the runtime can support both versions in
parallel.

### Gateway transfer in `attesting` for >24h

Cron has been running for hours and the row hasn't moved. Likely
causes: Circle's relayer dropped the burn, the destination chain is
halted, or the row's `circleTransferId` was set to a UUID Circle
doesn't have on file (a race between our `INSERT` and Circle's `200`).

Manual triage:

```bash
# Confirm Circle has the transfer.
curl https://gateway-api-testnet.circle.com/v1/transfer/<circleTransferId>

# If 404 — the row was orphaned. Mark failed manually.
# If 200 — let the cron continue or trigger the per-row reconcile.
```

## Post-cutover hardening checklist

- [ ] All four env vars set in Vercel for production / preview / development.
- [ ] `SENDERO_KEK` removed from production after one successful KMS decrypt.
- [ ] `wallet_access_logs` showing rows within minutes of deploy.
- [ ] `gateway_transfer_logs.lastReconciledAt` advancing on every cron tick.
- [ ] Cron route returning HTTP 200 from Vercel logs (not 401).
- [ ] GCP IAM scoped to `cryptoKeyDecrypter` only (not `decrypterAndEncrypter`).
- [ ] Service account key file shredded from operator workstation.
- [ ] Backup KEK plaintext sealed offline (e.g. paper printout in a safe).
- [ ] Phase 6 ticket filed for KEK rotation + DEK re-encrypt-on-read.

## Step 5 — Per-row KMS envelope rewrap (canary path)

The Phase 5 base above wraps the **single account-wide KEK** under KMS. Step 5
adds a **per-row envelope** on every `tenant_gateway_signers` /
`user_gateway_signers` row so each signer's DEK is independently KMS-wrapped.
Two columns coexist during canary:

- `encryptedPrivateKey` — legacy env-mode ciphertext. Preserved as rollback.
- `newEnvelope` (BYTEA) — KMS-wrapped AES-GCM envelope. Populated by rewrap.

Runtime gate (`shouldReadKmsEnvelope` in `packages/circle/src/gateway-signer.ts`):
`kekProvider='kms-v1'` AND envelope present AND tenant/user opted in via
`SENDERO_GATEWAY_SIGNER_KMS_CANARY_TENANTS` / `..._CANARY_USERS` (or
`READ_MODE=all`). Non-opted-in rows fall back to env-mode decrypt of
`encryptedPrivateKey`. The dual-column design means rollback is `READ_MODE=off`
— no schema change needed.

### S5.1 Provision the canary KMS key

```bash
gcloud kms keyrings create sendero-tenants \
  --location=us \
  --project=<project>

gcloud kms keys create gateway-signer-canary \
  --location=us \
  --keyring=sendero-tenants \
  --purpose=encryption \
  --protection-level=software \
  --project=<project>

# Runtime needs encrypt+decrypt on the canary key (rewrap encrypts here too).
gcloud kms keys add-iam-policy-binding gateway-signer-canary \
  --location=us \
  --keyring=sendero-tenants \
  --member="serviceAccount:<runtime-sa>@<project>.iam.gserviceaccount.com" \
  --role=roles/cloudkms.cryptoKeyEncrypterDecrypter \
  --project=<project>
```

For production scale, switch to `--protection-level=hsm` and split keys per
tenant via `SENDERO_TENANT_GATEWAY_SIGNER_KMS_KEY_TEMPLATE` with `{tenantId}`.

### S5.2 Stage Vercel env vars (all-preview scope, no branch)

```bash
# Use the REST API per CLAUDE.md (CLI broken for bulk widening).
SENDERO_GATEWAY_SIGNER_KMS_KEY_RESOURCE=projects/<project>/locations/us/keyRings/sendero-tenants/cryptoKeys/gateway-signer-canary
SENDERO_GATEWAY_SIGNER_KMS_READ_MODE=canary             # default; can omit
SENDERO_GATEWAY_SIGNER_KMS_CANARY_TENANTS=<tenant-id>   # comma-sep, `*` for all
SENDERO_GATEWAY_SIGNER_KMS_CANARY_USERS=                # optional, same shape
```

Set on `production` + `preview` targets, no `gitBranch` filter.

### S5.3 Apply migration `20260512200000_add_gateway_signer_kms_envelopes`

Adds: `SignerKekProvider` enum, four columns per signer table
(`kekProvider`, `newEnvelope`, `kmsKeyResource`, `kmsKeyVersion`), CHECK
constraint requiring envelope + resource when `kekProvider != 'env-v1'`,
two `CREATE INDEX CONCURRENTLY` on `(kekProvider, updatedAt)`.

If the DB is migration-history-tracked (`_prisma_migrations` exists):
`bunx prisma migrate deploy`. If it's `prisma db push`-managed (no
history), apply the SQL via `psql`/raw `pg` statement-by-statement —
the CONCURRENT indexes must run outside any transaction.

### S5.4 Dry-run rewrap on canary

```bash
bun apps/app/scripts/migrate-kek-to-kms.ts --tenant <tenant-id>
```

The script:
1. Selects rows where `kekProvider='env-v1'`.
2. Decrypts via `SENDERO_KEK` (env mode) — needs the legacy KEK present
   even though we're moving to KMS.
3. Re-derives the account address from plaintext and refuses to write if
   it doesn't match the stored `address` (corruption guard).
4. Encrypts under the KMS key, then KMS-round-trip decrypts to verify.
5. In dry-run mode, prints `[kms-rewrap] prepared {…}` and exits.

### S5.5 Apply rewrap with compare-and-swap

```bash
bun apps/app/scripts/migrate-kek-to-kms.ts --tenant <tenant-id> --apply
```

The `UPDATE` is guarded by `WHERE kekProvider='env-v1' AND
encryptedPrivateKey=<unchanged> AND kekVersion=N` — any concurrent
writer wins and the script aborts with `count=1` expected.

For bulk: `--all-tenants --all-users --apply` (default `--limit 25`,
raise for larger fleets).

### S5.6 Deploy the runtime code that reads `newEnvelope`

The KMS read branch lives only in code that knows about `kekProvider`,
`newEnvelope`, and `decryptKmsEnvelope`. Deploy before activating the
canary list — otherwise the env-mode fallback still runs and the
rewrap is silently dormant.

### S5.7 Activate canary

Confirm post-deploy:

```sql
-- Should show the KMS key resource in signerKmsKeyVersion,
-- NOT 'env-v1', for the canary tenant.
SELECT "tenantId", "signerKmsKeyVersion", "occurredAt"
FROM wallet_access_logs
WHERE "tenantId" = '<canary-tenant>'
ORDER BY "occurredAt" DESC LIMIT 5;
```

Trigger a Gateway action (transfer, spend) on the canary tenant — the
cache miss writes a fresh log row. If the row reads `signerKmsKeyVersion
LIKE 'projects/%/cryptoKeyVersions/%'`, KMS decrypt is live.

### S5.8 Expand the canary

Two ways:

```bash
# Targeted — add tenant IDs incrementally.
SENDERO_GATEWAY_SIGNER_KMS_CANARY_TENANTS=ten_A,ten_B,ten_C
SENDERO_GATEWAY_SIGNER_KMS_CANARY_USERS=usr_X

# Full cutover — every kms-v1 row decrypts via KMS.
SENDERO_GATEWAY_SIGNER_KMS_READ_MODE=all
```

### S5.9 Rollback

```bash
# Force runtime to ignore KMS envelopes; env-mode runs again because
# encryptedPrivateKey is preserved on every row.
SENDERO_GATEWAY_SIGNER_KMS_READ_MODE=off
```

To fully rewind individual rows back to env-v1:

```sql
UPDATE tenant_gateway_signers
   SET "kekProvider" = 'env-v1',
       "newEnvelope" = NULL,
       "kmsKeyResource" = NULL,
       "kmsKeyVersion" = NULL
 WHERE "tenantId" = '<id>'
   AND "kekProvider" = 'kms-v1';
```

The CHECK constraint allows `env-v1 OR (envelope IS NOT NULL AND
resource IS NOT NULL)`, so resetting to `env-v1` with null envelope is
permitted.

### S5.10 Retire `SENDERO_KEK`

Only after `READ_MODE=all` is live AND every signer row is on
`kekProvider='kms-v1'`. Remove `SENDERO_KEK` from Vercel and the
`encryptedPrivateKey` column becomes cold storage (drop in a follow-up
migration). **Do not "rotate" `SENDERO_KEK` — there is no
re-encrypt-with-new-KEK path; the env-mode KEK only exists to decrypt
the pre-cutover ciphertexts.** If you need a fresh env-mode fallback
later, add `SENDERO_KEK_V2` alongside (the encryption package keys on
`kekVersion`).
