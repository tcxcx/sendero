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
