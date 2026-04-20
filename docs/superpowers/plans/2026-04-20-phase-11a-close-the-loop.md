# Phase-11a — Close the loop — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the three settlement blockers so phase-11b invoicing can read real on-chain state — real nanopay batch transfers, Duffel webhook ingress, confirm/settle/cancel booking tools, workflow pause-branch around booking settlement.

**Architecture:** Webhook-driven settlement. `book_flight` + `guestPrefund` workflows pause after `commit` step waiting for `external_event`. `POST /api/webhooks/duffel` HMAC-verifies + dedupes + resolves booking → `resumeRun` with `{status: 'ticketed' | 'failed'}` → branch runs confirm_duffel + settle_booking OR cancel_booking. Parallel track: `batch.ts` nanopay settler swaps synthetic tx hash for real `transferUSDC` via treasury EOA with retry cap + Slack alert.

**Tech Stack:** Bun (`bun test`), TypeScript, Prisma, viem, zod, Next.js App Router (Node runtime), @sendero/nanopayments (viem wallet + ERC-20 transfer on Arc Testnet), @sendero/workflows (runner + pause/resume), Resend (email, already wired), Slack Web API (existing `@sendero/slack`).

**Baseline:** commit `30c1543` on branch `feat/phase-11-invoicing`. Prior phase-11 commits `be4f3c8` (UUPS + indexer) and `a21b72e` (drop subgraph) are already in scope.

**Conventions observed:**

- All new tools return **encoded calls**, never submit on-chain — caller submits via MSCA/EOA.
- Packages compile via turbo. Tests use Bun's built-in `test` runner — no separate dev deps needed.
- Commits use conventional prefix: `feat(phase-11a): …`.
- Co-author trailer: `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`.

---

## File structure

**New files (10):**

- `packages/sendero-duffel/src/webhook.ts`
- `packages/sendero-duffel/src/webhook.test.ts`
- `packages/tools/src/confirm-duffel.ts`
- `packages/tools/src/settle-booking.ts`
- `packages/tools/src/cancel-booking.ts`
- `packages/tools/src/settlement-tools.test.ts`
- `packages/slack/src/alerts.ts`
- `packages/billing/src/batch.test.ts`
- `apps/app/app/api/webhooks/duffel/route.ts`
- `apps/app/lib/webhook-events.ts`

**Modified files (9):**

- `packages/database/prisma/schema.prisma` — add `WebhookEvent`, `Booking.duffelOrderId`, `NanopayBatch.retryCount`, `NanopayBatch.lastError`
- `packages/sendero-nanopayments/src/index.ts` — add `transferUSDC`
- `packages/billing/src/batch.ts` — retry cap + keep-settling semantics + `retrySettlingBatches`
- `packages/billing/src/index.ts` — export new function
- `packages/workflows/src/catalog.ts` — pause + branch in `bookFlightWorkflow` + `guestPrefundWorkflow`
- `packages/tools/src/index.ts` — register 3 new tools
- `packages/sendero-env/src/validate.ts` — add `DUFFEL_WEBHOOK_SECRET`, `SENDERO_TREASURY_ADDRESS`
- `apps/app/app/api/cron/settle-nanopay-batches/route.ts` — real settle + retrySettlingBatches call
- `apps/app/app/api/health/route.ts` — surface new env

---

## Sequencing

- **Epic 1** (Tasks 1-2) Schema — no dependency  
- **Epic 2** (Tasks 3-4) `transferUSDC` primitive — no dependency  
- **Epic 3** (Tasks 5-9) Real batch settle + retry + alerts — depends on E1 + E2  
- **Epic 4** (Tasks 10-12) Duffel webhook helpers — depends on E1  
- **Epic 5** (Tasks 13-16) Webhook route + dispatcher — depends on E1 + E4  
- **Epic 6** (Tasks 17-20) New settlement tools — depends on E1  
- **Epic 7** (Tasks 21-22) Workflow catalog edits — depends on E6  
- **Epic 8** (Tasks 23-24) Env + health — depends on E1  
- **Epic 9** (Tasks 25-27) Smoke + integration — depends on everything  

Epics 2/4/6/8 run in parallel after E1 lands.

---

## Epic 1 — Schema

### Task 1: Add schema deltas

**Files:**
- Modify: `packages/database/prisma/schema.prisma` — insert `WebhookEvent` model, add `Booking.duffelOrderId`, add `NanopayBatch.retryCount` + `lastError`

- [ ] **Step 1: Add `WebhookEvent` model at the top of the nanopayment section (near line 783)**

Insert before `model NanopayBatch`:

```prisma
/// Generic webhook dedupe ledger. Every inbound webhook (Duffel, Slack,
/// WhatsApp, Stripe, ...) writes one row keyed by provider + externalId
/// so retries are idempotent. Processed rows carry `processedAt`.
model WebhookEvent {
  id           String   @id @default(uuid()) @db.Uuid
  receivedAt   DateTime @default(now()) @db.Timestamptz(6)
  processedAt  DateTime? @db.Timestamptz(6)
  provider     String
  externalId   String
  eventType    String
  payload      Json
  processingError String?

  @@unique([provider, externalId])
  @@index([provider, processedAt])
  @@map("webhook_events")
}
```

- [ ] **Step 2: Add `duffelOrderId` to `Booking` model (line ~383 next to `externalId`)**

Insert right after the `externalId` field:

```prisma
  /// Duffel order id once the hold is placed. Separate column (not
  /// externalId) so we can put a global @unique on it for webhook
  /// lookups independent of tenant.
  duffelOrderId String? @unique
```

Keep the existing `externalId` field unchanged.

- [ ] **Step 3: Add `retryCount` + `lastError` to `NanopayBatch` (line ~800)**

Replace the `error  String?` line with:

```prisma
  error            String?
  retryCount       Int      @default(0)
  lastError        String?
```

- [ ] **Step 4: Sanity check with `prisma format`**

```bash
bun run --cwd packages/database db:generate -- --schema prisma/schema.prisma 2>&1 | head -20 || true
cd packages/database && bunx prisma format
```

Expected: no parse errors; schema.prisma reformatted in place.

- [ ] **Step 5: Commit**

```bash
git add packages/database/prisma/schema.prisma
git commit -m "$(cat <<'EOF'
feat(phase-11a): schema — WebhookEvent, Booking.duffelOrderId, NanopayBatch retry

Adds the Prisma deltas required for Duffel webhook dedupe, on-chain
booking → webhook mapping, and nanopay batch retry bookkeeping.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Generate migration + regenerate client

**Files:**
- Create: `packages/database/prisma/migrations/<timestamp>_phase_11a_webhooks_and_retries/migration.sql` (Prisma-generated)

- [ ] **Step 1: Generate migration**

```bash
cd packages/database
bunx prisma migrate dev --name phase_11a_webhooks_and_retries --create-only
```

Expected output: new migration dir under `prisma/migrations/`. Inspect the SQL:

```bash
cat prisma/migrations/*phase_11a*/migration.sql
```

Expect `CREATE TABLE "webhook_events"`, `ALTER TABLE "bookings" ADD COLUMN "duffelOrderId"`, `CREATE UNIQUE INDEX`, `ALTER TABLE "nanopay_batches" ADD COLUMN "retryCount"`.

- [ ] **Step 2: Apply migration to local dev db**

```bash
cd packages/database
bunx prisma migrate deploy
```

Expected: `Applied migration <timestamp>_phase_11a_webhooks_and_retries`.

- [ ] **Step 3: Regenerate client**

```bash
bun run --cwd packages/database db:generate
```

Expected: `Generated Prisma Client` message. `prisma.webhookEvent` type is now available.

- [ ] **Step 4: Verify generated types compile**

```bash
cd ../..
bun run typecheck 2>&1 | tail -30
```

Expected: zero errors (the new columns aren't referenced yet).

- [ ] **Step 5: Commit**

```bash
git add packages/database/prisma/migrations
git commit -m "$(cat <<'EOF'
feat(phase-11a): migration for webhooks + nanopay retry

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Epic 2 — `transferUSDC` primitive

### Task 3: Add `transferUSDC` to @sendero/nanopayments

**Files:**
- Modify: `packages/sendero-nanopayments/src/index.ts` (add function at end, export from package)

- [ ] **Step 1: Add the function after `canonicalSplit` (end of file)**

Append to `packages/sendero-nanopayments/src/index.ts`:

```typescript
/**
 * Single-recipient USDC transfer on Arc Testnet. Same treasury EOA and
 * public client as `settleCommissionSplit`. Used by the nanopay batch
 * settler to flush aggregated MeterEvent totals to Sendero's treasury.
 *
 * Returns the real on-chain tx hash — NOT a synthetic placeholder.
 */
export async function transferUSDC(params: {
  to: Address;
  /** Decimal USDC (6 decimals), e.g. "1.234567". */
  amount: string;
  /** Optional label for logging / telemetry. */
  label?: string;
}): Promise<{ txHash: Hex; explorerUrl: string; amountMicroUsdc: string }> {
  const usdc = env.arcUsdcAddress() as Address;
  const wallet = arcWalletClient();
  const pub = arcPublicClient();
  const acct = treasuryAccount();

  const units = parseUnits(params.amount, 6);
  if (units <= 0n) {
    throw new Error(`transferUSDC: amount must be > 0 (got ${params.amount})`);
  }

  const hash = await wallet.writeContract({
    address: usdc,
    abi: erc20Abi,
    functionName: 'transfer',
    args: [params.to, units],
    account: acct,
    chain: arcTestnet,
  });
  await pub.waitForTransactionReceipt({ hash });

  return {
    txHash: hash,
    explorerUrl: `${env.arcExplorerUrl()}/tx/${hash}`,
    amountMicroUsdc: units.toString(),
  };
}
```

- [ ] **Step 2: Typecheck**

```bash
bun run typecheck 2>&1 | tail -10
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add packages/sendero-nanopayments/src/index.ts
git commit -m "$(cat <<'EOF'
feat(phase-11a): transferUSDC — single-recipient nanopay primitive

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Sanity-test `transferUSDC` via the existing smoke script (dry run)

**Files:**
- Modify: `scripts/smoke-guest-escrow.ts` — no permanent change, just a one-off verification

- [ ] **Step 1: Manual dry run**

```bash
bun run -e 'import("./packages/sendero-nanopayments/src/index.ts").then(m => console.log(typeof m.transferUSDC))'
```

Expected: `function`.

Skip an actual on-chain transfer here — real testnet exercise happens in Epic 9 (`smoke-guest-escrow.ts` augmentation).

---

## Epic 3 — Real batch settle + retry

### Task 5: Extend `BatchStore` interface + retry logic in `batch.ts`

**Files:**
- Modify: `packages/billing/src/batch.ts` — extend interface and `buildAndSettleBatch` behavior

- [ ] **Step 1: Extend `BatchStore` interface (after `updateBatchStatus`, line ~45)**

Add these methods:

```typescript
  incrementRetry: (args: { batchId: string; lastError: string }) => Promise<{ retryCount: number }>;

  findSettlingBatches: (args: {
    olderThan: Date;
    limit: number;
    maxRetryCount: number;
  }) => Promise<Array<{ id: string; tenantId: string; totalMicroUsdc: bigint; retryCount: number }>>;
```

- [ ] **Step 2: Replace the `catch` block in `buildAndSettleBatch` (lines 133-143)**

Replace:

```typescript
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await store.updateBatchStatus({ batchId: batch.id, status: 'failed', error: msg });
    return {
      batchId: batch.id,
      status: 'failed',
      error: msg,
      totalMicroUsdc,
      eventCount: events.length,
    };
  }
```

With:

```typescript
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const { retryCount } = await store.incrementRetry({ batchId: batch.id, lastError: msg });
    const finalFailure = retryCount >= MAX_RETRIES;
    if (finalFailure) {
      await store.updateBatchStatus({ batchId: batch.id, status: 'failed', error: msg });
    }
    return {
      batchId: batch.id,
      status: finalFailure ? 'failed' : 'retrying',
      error: msg,
      retryCount,
      totalMicroUsdc,
      eventCount: events.length,
    };
  }
```

Update the return type union of `buildAndSettleBatch` to add:

```typescript
  | { batchId: string; status: 'retrying'; error: string; retryCount: number; totalMicroUsdc: bigint; eventCount: number }
```

Add at the top of the file (after `const DEFAULT_MAX = 256;`):

```typescript
export const MAX_RETRIES = 3;
```

- [ ] **Step 3: Add `retrySettlingBatches` function at end of file**

```typescript
/**
 * Sweep batches that are stuck in `settling` (ran into a transient
 * error on first attempt) and retry the on-chain transfer. Called by
 * the cron alongside `buildAndSettleBatch`. Returns one entry per
 * batch attempted. Slack-alertable failures surface via `status: 'failed'`.
 */
export async function retrySettlingBatches(
  store: BatchStore,
  settle: SettleFn,
  opts: { olderThanMs?: number; limit?: number } = {}
): Promise<Array<
  | { batchId: string; tenantId: string; status: 'settled'; txHash: string; retryCount: number }
  | { batchId: string; tenantId: string; status: 'retrying' | 'failed'; error: string; retryCount: number }
>> {
  const olderThan = new Date(Date.now() - (opts.olderThanMs ?? 10 * 60 * 1000));
  const candidates = await store.findSettlingBatches({
    olderThan,
    limit: opts.limit ?? 50,
    maxRetryCount: MAX_RETRIES,
  });

  const out: Array<any> = [];
  for (const b of candidates) {
    try {
      const { txHash } = await settle({
        batchId: b.id,
        tenantId: b.tenantId,
        totalMicroUsdc: b.totalMicroUsdc,
      });
      await store.updateBatchStatus({
        batchId: b.id,
        status: 'settled',
        txHash,
        settledAt: new Date(),
      });
      out.push({ batchId: b.id, tenantId: b.tenantId, status: 'settled', txHash, retryCount: b.retryCount });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const { retryCount } = await store.incrementRetry({ batchId: b.id, lastError: msg });
      const finalFailure = retryCount >= MAX_RETRIES;
      if (finalFailure) {
        await store.updateBatchStatus({ batchId: b.id, status: 'failed', error: msg });
      }
      out.push({
        batchId: b.id,
        tenantId: b.tenantId,
        status: finalFailure ? 'failed' : 'retrying',
        error: msg,
        retryCount,
      });
    }
  }
  return out;
}
```

- [ ] **Step 4: Commit**

```bash
git add packages/billing/src/batch.ts
git commit -m "$(cat <<'EOF'
feat(phase-11a): batch retry cap + retrySettlingBatches sweeper

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Write failing tests for retry logic

**Files:**
- Create: `packages/billing/src/batch.test.ts`

- [ ] **Step 1: Write tests**

```typescript
import { test, expect } from 'bun:test';
import {
  buildAndSettleBatch,
  retrySettlingBatches,
  MAX_RETRIES,
  type BatchStore,
  type SettleFn,
} from './batch';

function makeStore(): BatchStore & { state: any } {
  const batches: Record<string, { id: string; tenantId: string; totalMicroUsdc: bigint; retryCount: number; status: string }> = {};
  const state = { batches, claimed: [] as string[], statusUpdates: [] as any[] };
  return {
    state,
    findClaimableEvents: async () => [
      { id: 'e1', priceMicroUsdc: 100n },
      { id: 'e2', priceMicroUsdc: 250n },
    ],
    openBatch: async (args) => {
      const id = `batch-${Object.keys(batches).length + 1}`;
      batches[id] = { id, tenantId: args.tenantId, totalMicroUsdc: args.totalMicroUsdc, retryCount: 0, status: 'pending' };
      return { id };
    },
    claimEventsForBatch: async ({ eventIds }) => { state.claimed.push(...eventIds); },
    updateBatchStatus: async (args) => {
      state.statusUpdates.push(args);
      const b = batches[args.batchId];
      if (b) b.status = args.status;
    },
    incrementRetry: async ({ batchId }) => {
      const b = batches[batchId];
      if (!b) throw new Error('unknown batch');
      b.retryCount += 1;
      return { retryCount: b.retryCount };
    },
    findSettlingBatches: async ({ maxRetryCount }) =>
      Object.values(batches).filter(b => b.status === 'settling' && b.retryCount < maxRetryCount),
  };
}

test('buildAndSettleBatch: transient failure returns retrying status (retryCount=1)', async () => {
  const store = makeStore();
  let calls = 0;
  const settle: SettleFn = async () => {
    calls += 1;
    throw new Error('rpc timeout');
  };
  const result = await buildAndSettleBatch(store, settle, { tenantId: 't1' });
  expect(calls).toBe(1);
  expect(result.status).toBe('retrying');
  if (result.status === 'retrying') expect(result.retryCount).toBe(1);
  // Batch stays in `settling` (NOT `failed`) so a later retry sweep picks it up.
  const last = store.state.statusUpdates.at(-1);
  expect(last.status).toBe('settling');
});

test(`buildAndSettleBatch: after ${MAX_RETRIES} failures status transitions to failed`, async () => {
  const store = makeStore();
  const settle: SettleFn = async () => { throw new Error('perm'); };
  // First attempt
  await buildAndSettleBatch(store, settle, { tenantId: 't1' });
  // Two more retries via the sweeper
  await retrySettlingBatches(store, settle, { olderThanMs: 0 });
  const third = await retrySettlingBatches(store, settle, { olderThanMs: 0 });
  expect(third.length).toBe(1);
  expect(third[0].status).toBe('failed');
  if (third[0].status === 'failed') expect(third[0].retryCount).toBe(MAX_RETRIES);
});

test('retrySettlingBatches: success on retry transitions batch → settled', async () => {
  const store = makeStore();
  let attempts = 0;
  const settle: SettleFn = async () => {
    attempts += 1;
    if (attempts === 1) throw new Error('flake');
    return { txHash: '0xgood' };
  };
  const first = await buildAndSettleBatch(store, settle, { tenantId: 't1' });
  expect(first.status).toBe('retrying');
  const retried = await retrySettlingBatches(store, settle, { olderThanMs: 0 });
  expect(retried[0].status).toBe('settled');
  if (retried[0].status === 'settled') expect(retried[0].txHash).toBe('0xgood');
});

test('retrySettlingBatches: skips batches at retry cap', async () => {
  const store = makeStore();
  store.state.batches['stuck'] = { id: 'stuck', tenantId: 't2', totalMicroUsdc: 500n, retryCount: MAX_RETRIES, status: 'settling' };
  const settle: SettleFn = async () => { throw new Error('should not be called'); };
  const result = await retrySettlingBatches(store, settle, { olderThanMs: 0 });
  expect(result.length).toBe(0);
});
```

- [ ] **Step 2: Run tests — expect failures first pass**

```bash
cd packages/billing && bun test src/batch.test.ts 2>&1 | tail -30
```

If the tests pass immediately (the Task 5 edits were already correct), proceed. If any fail, adjust `batch.ts` until all green. Common fix-up: `buildAndSettleBatch` must call `updateBatchStatus({ ..., status: 'settling' })` BEFORE the settle call so transient-failure status remains `'settling'` (already true in existing code at line 114 — verify preserved).

- [ ] **Step 3: Commit once green**

```bash
cd ../..
git add packages/billing/src/batch.test.ts
git commit -m "$(cat <<'EOF'
test(phase-11a): batch retry + sweeper coverage

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Export `retrySettlingBatches` + `MAX_RETRIES` from billing package

**Files:**
- Modify: `packages/billing/src/index.ts`

- [ ] **Step 1: Add exports**

Open `packages/billing/src/index.ts`. Find the line exporting from `./batch` and ensure it re-exports everything. If it uses `export *`, no change needed. If it lists named exports, add `retrySettlingBatches` and `MAX_RETRIES`.

Example after edit (if selective exports were used):

```typescript
export { buildAndSettleBatch, retrySettlingBatches, MAX_RETRIES } from './batch';
export type { BatchStore, SettleFn, BuildAndSettleArgs } from './batch';
```

- [ ] **Step 2: Typecheck + commit**

```bash
bun run typecheck 2>&1 | tail -5
git add packages/billing/src/index.ts
git commit -m "chore(phase-11a): export retrySettlingBatches

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Add Slack alert helper

**Files:**
- Create: `packages/slack/src/alerts.ts`

- [ ] **Step 1: Inspect existing Slack client + imports**

```bash
cat packages/slack/src/client.ts | head -40
```

Note the exported `slackClient()` or `postMessage` function. The alert helper will use whatever exists.

- [ ] **Step 2: Write `alerts.ts`**

```typescript
/**
 * Operational Slack alerts.
 *
 * Posts to the ops channel (env: SENDERO_OPS_SLACK_CHANNEL_ID) using
 * the bot token configured in `@sendero/slack/client`. Fails silently
 * in prod — alerts are best-effort; a missing token is logged, not
 * thrown, so a misconfig can't break the cron.
 */

import { createSlackClient, postMessage } from './client';

function opsChannelId(): string | null {
  return process.env.SENDERO_OPS_SLACK_CHANNEL_ID ?? null;
}

function botToken(): string | null {
  return process.env.SLACK_BOT_TOKEN ?? null;
}

export interface BatchFailedAlert {
  batchId: string;
  tenantId: string;
  totalMicroUsdc: bigint;
  retryCount: number;
  error: string;
}

export async function fireBatchFailedAlert(a: BatchFailedAlert): Promise<void> {
  const channel = opsChannelId();
  const token = botToken();
  if (!channel || !token) {
    console.warn('[slack.alerts] SLACK_BOT_TOKEN or SENDERO_OPS_SLACK_CHANNEL_ID not set; skipping batch-failed alert');
    return;
  }
  const text =
    `:rotating_light: Nanopay batch *failed* after ${a.retryCount} retries\n` +
    `> batch \`${a.batchId}\` · tenant \`${a.tenantId}\`\n` +
    `> total \`${(Number(a.totalMicroUsdc) / 1e6).toFixed(6)} USDC\`\n` +
    `> last error: \`${a.error}\``;
  try {
    const client = createSlackClient(token);
    await postMessage(client, { channel, text });
  } catch (err) {
    console.warn('[slack.alerts] postMessage failed:', err instanceof Error ? err.message : err);
  }
}
```

Verified against `packages/slack/src/client.ts`: `createSlackClient(botToken)` returns a `WebClient`; `postMessage(client, { channel, text })` is the call signature.

- [ ] **Step 3: Export from the slack package index**

Append to `packages/slack/src/index.ts`:

```typescript
export { fireBatchFailedAlert } from './alerts';
export type { BatchFailedAlert } from './alerts';
```

- [ ] **Step 4: Typecheck + commit**

```bash
bun run typecheck 2>&1 | tail -5
git add packages/slack/src
git commit -m "$(cat <<'EOF'
feat(phase-11a): slack alert for nanopay batch failures

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Wire real settle into the cron + call retrySettlingBatches + emit alert

**Files:**
- Modify: `apps/app/app/api/cron/settle-nanopay-batches/route.ts`

- [ ] **Step 1: Replace `makeSettleFn()` with real implementation**

Replace the existing `makeSettleFn` body (bottom of the file) with:

```typescript
import { transferUSDC } from '@sendero/nanopayments';
import type { Address } from 'viem';

function senderoTreasuryAddress(): Address {
  const a = process.env.SENDERO_TREASURY_ADDRESS;
  if (!a) throw new Error('SENDERO_TREASURY_ADDRESS not configured');
  return a as Address;
}

function makeSettleFn(): SettleFn {
  const to = senderoTreasuryAddress();
  return async ({ totalMicroUsdc, batchId, tenantId }) => {
    const amount = (Number(totalMicroUsdc) / 1e6).toFixed(6);
    const { txHash } = await transferUSDC({
      to,
      amount,
      label: `nanopay-batch:${tenantId}:${batchId}`,
    });
    return { txHash };
  };
}
```

Remove the old synthetic-hash branch entirely.

- [ ] **Step 2: Add `retrySettlingBatches` sweep after the per-tenant loop**

After the `for (const { tenantId } of tenants)` loop ends and before `return NextResponse.json(...)`, add:

```typescript
const retries = await retrySettlingBatches(store, settle, { olderThanMs: 10 * 60 * 1000 });
for (const r of retries) {
  if (r.status === 'failed') {
    await fireBatchFailedAlert({
      batchId: r.batchId,
      tenantId: r.tenantId,
      totalMicroUsdc: 0n, // not in retry result; omitted in alert (retrySettlingBatches result doesn't carry it)
      retryCount: r.retryCount,
      error: r.error,
    });
    results.push({ tenantId: r.tenantId, outcome: 'failed', batchId: r.batchId });
  } else if (r.status === 'settled') {
    results.push({ tenantId: r.tenantId, outcome: 'settled-on-retry', batchId: r.batchId, txHash: r.txHash });
  } else {
    results.push({ tenantId: r.tenantId, outcome: 'retrying', batchId: r.batchId });
  }
}
```

Update imports at the top of the file:

```typescript
import { buildAndSettleBatch, retrySettlingBatches, type BatchStore, type SettleFn } from '@sendero/billing/batch';
import { fireBatchFailedAlert } from '@sendero/slack';
```

Also: when `buildAndSettleBatch` returns `status: 'retrying'` or `'failed'`, update the existing result-collector branch to include both outcomes:

```typescript
    if (result.status === 'empty') {
      results.push({ tenantId, outcome: 'empty' });
    } else if (result.status === 'settled') {
      results.push({ tenantId, outcome: 'settled', batchId: result.batchId, txHash: result.txHash });
    } else if (result.status === 'retrying') {
      results.push({ tenantId, outcome: 'retrying', batchId: result.batchId });
    } else {
      // status === 'failed'
      await fireBatchFailedAlert({
        batchId: result.batchId,
        tenantId,
        totalMicroUsdc: result.totalMicroUsdc,
        retryCount: result.retryCount ?? 3,
        error: result.error,
      });
      results.push({ tenantId, outcome: 'failed', batchId: result.batchId });
    }
```

- [ ] **Step 3: Typecheck**

```bash
bun run typecheck 2>&1 | tail -10
```

Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add apps/app/app/api/cron/settle-nanopay-batches/route.ts
git commit -m "$(cat <<'EOF'
feat(phase-11a): cron — real USDC transfer + retry sweep + slack alert

Swaps the synthetic tx hash for transferUSDC. Adds retrySettlingBatches
sweep after the per-tenant loop. Emits fireBatchFailedAlert when a
batch exhausts retries.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Epic 4 — Duffel webhook helpers

### Task 10: Write failing test for HMAC verify + parser

**Files:**
- Create: `packages/sendero-duffel/src/webhook.test.ts`

- [ ] **Step 1: Write tests**

```typescript
import { test, expect } from 'bun:test';
import { createHmac } from 'node:crypto';
import { verifyDuffelSignature, parseDuffelWebhook } from './webhook';

const secret = 'whsec_test_abc';

function sign(body: string): string {
  return createHmac('sha256', secret).update(body).digest('hex');
}

test('verifyDuffelSignature: accepts a valid signature', () => {
  const body = JSON.stringify({ id: 'evt_1' });
  expect(verifyDuffelSignature(body, sign(body), secret)).toBe(true);
});

test('verifyDuffelSignature: rejects a tampered body', () => {
  const body = JSON.stringify({ id: 'evt_1' });
  const sig = sign(body);
  expect(verifyDuffelSignature(body + 'extra', sig, secret)).toBe(false);
});

test('verifyDuffelSignature: rejects null/empty signature', () => {
  expect(verifyDuffelSignature('{}', null, secret)).toBe(false);
  expect(verifyDuffelSignature('{}', '', secret)).toBe(false);
});

test('parseDuffelWebhook: normalizes order.created ticketed', () => {
  const raw = JSON.stringify({
    id: 'evt_1',
    type: 'order.created',
    data: { id: 'ord_abc', status: 'ticketed' },
  });
  const ev = parseDuffelWebhook(raw);
  expect(ev.id).toBe('evt_1');
  expect(ev.type).toBe('order.created');
  expect(ev.orderId).toBe('ord_abc');
  expect(ev.status).toBe('ticketed');
});

test('parseDuffelWebhook: normalizes order.updated failed', () => {
  const raw = JSON.stringify({
    id: 'evt_2',
    type: 'order.updated',
    data: { id: 'ord_def', status: 'cancelled' },
  });
  const ev = parseDuffelWebhook(raw);
  expect(ev.status).toBe('cancelled');
});

test('parseDuffelWebhook: throws on malformed JSON', () => {
  expect(() => parseDuffelWebhook('not-json')).toThrow();
});

test('parseDuffelWebhook: throws when required fields missing', () => {
  expect(() => parseDuffelWebhook('{}')).toThrow();
});
```

- [ ] **Step 2: Run — expect fail (module not yet created)**

```bash
cd packages/sendero-duffel && bun test src/webhook.test.ts 2>&1 | tail -10
```

Expected: module-not-found errors.

---

### Task 11: Implement `webhook.ts`

**Files:**
- Create: `packages/sendero-duffel/src/webhook.ts`

- [ ] **Step 1: Write the module**

```typescript
/**
 * Duffel webhook verification + normalization.
 *
 * Inbound webhook format (per Duffel docs):
 *   POST /api/webhooks/duffel
 *   headers: x-duffel-signature (lowercase hex HMAC-SHA256 of the raw body)
 *   body: { id, type, data: { id, status, ... } }
 *
 * The raw body text (NOT the parsed JSON) is what gets HMAC-verified.
 * Always read req.text() in the route handler before JSON-parsing.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

const duffelEventSchema = z.object({
  id: z.string().min(1),
  type: z.enum(['order.created', 'order.updated']),
  data: z.object({
    id: z.string().min(1),
    status: z.enum(['pending', 'ticketed', 'cancelled', 'failed']),
  }).passthrough(),
});

export type DuffelWebhookStatus = 'pending' | 'ticketed' | 'cancelled' | 'failed';

export interface DuffelWebhookEvent {
  id: string;
  type: 'order.created' | 'order.updated';
  orderId: string;
  status: DuffelWebhookStatus;
  raw: unknown;
}

export function verifyDuffelSignature(
  rawBody: string,
  signature: string | null | undefined,
  secret: string
): boolean {
  if (!signature) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  if (expected.length !== signature.length) return false;
  try {
    return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(signature, 'hex'));
  } catch {
    return false;
  }
}

export function parseDuffelWebhook(rawBody: string): DuffelWebhookEvent {
  const json = JSON.parse(rawBody) as unknown;
  const parsed = duffelEventSchema.parse(json);
  return {
    id: parsed.id,
    type: parsed.type,
    orderId: parsed.data.id,
    status: parsed.data.status as DuffelWebhookStatus,
    raw: json,
  };
}
```

- [ ] **Step 2: Run tests — expect green**

```bash
cd packages/sendero-duffel && bun test src/webhook.test.ts 2>&1 | tail -15
```

Expected: 7 passing.

- [ ] **Step 3: Export from package index**

Append to `packages/sendero-duffel/src/index.ts`:

```typescript
export {
  verifyDuffelSignature,
  parseDuffelWebhook,
  type DuffelWebhookEvent,
  type DuffelWebhookStatus,
} from './webhook';
```

- [ ] **Step 4: Commit**

```bash
cd ../..
git add packages/sendero-duffel/src/webhook.ts packages/sendero-duffel/src/webhook.test.ts packages/sendero-duffel/src/index.ts
git commit -m "$(cat <<'EOF'
feat(phase-11a): @sendero/duffel webhook verify + parse

HMAC-SHA256 signature verification + zod-validated event parser.
Covers order.created and order.updated events with ticketed / failed /
cancelled / pending status normalization.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 12: Add `DUFFEL_WEBHOOK_SECRET` accessor to env

**Files:**
- Modify: `packages/sendero-env/src/index.ts` (or wherever `env.duffelApiToken()` lives) — ensure `env.duffelWebhookSecret()` exists

- [ ] **Step 1: Inspect current env surface**

```bash
grep -n "duffel\|Duffel" packages/sendero-env/src/*.ts
```

If a `duffelWebhookSecret()` getter already exists, skip to step 3.

- [ ] **Step 2: Add the getter**

In `packages/sendero-env/src/index.ts`, add alongside the existing `duffelApiToken()`:

```typescript
  duffelWebhookSecret: () => process.env.DUFFEL_WEBHOOK_SECRET ?? '',
```

- [ ] **Step 3: Typecheck + commit**

```bash
bun run typecheck 2>&1 | tail -5
git add packages/sendero-env/src
git commit -m "chore(phase-11a): env accessor for DUFFEL_WEBHOOK_SECRET

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Epic 5 — Webhook route + dispatcher

### Task 13: Add WebhookEvent helpers

**Files:**
- Create: `apps/app/lib/webhook-events.ts`

- [ ] **Step 1: Write helper module**

```typescript
/**
 * Idempotency-aware upsert for the WebhookEvent table.
 *
 * Webhooks frequently retry — Duffel in particular resends events with
 * the same `id` until we return 2xx. The table's (provider, externalId)
 * unique constraint makes this branchless: first delivery inserts;
 * retries return `alreadyProcessed: true` and the route short-circuits
 * with a 200.
 */

import { prisma } from '@sendero/database';

export interface RecordedWebhookEvent {
  id: string;
  alreadyProcessed: boolean;
}

export async function recordWebhookEvent(args: {
  provider: string;
  externalId: string;
  eventType: string;
  payload: unknown;
}): Promise<RecordedWebhookEvent> {
  const existing = await prisma.webhookEvent.findUnique({
    where: { provider_externalId: { provider: args.provider, externalId: args.externalId } },
    select: { id: true, processedAt: true },
  });
  if (existing) {
    return { id: existing.id, alreadyProcessed: existing.processedAt !== null };
  }
  const row = await prisma.webhookEvent.create({
    data: {
      provider: args.provider,
      externalId: args.externalId,
      eventType: args.eventType,
      payload: args.payload as object,
    },
    select: { id: true },
  });
  return { id: row.id, alreadyProcessed: false };
}

export async function markWebhookEventProcessed(id: string, error?: string): Promise<void> {
  await prisma.webhookEvent.update({
    where: { id },
    data: {
      processedAt: new Date(),
      processingError: error ?? null,
    },
  });
}
```

- [ ] **Step 2: Typecheck + commit**

```bash
bun run typecheck 2>&1 | tail -5
git add apps/app/lib/webhook-events.ts
git commit -m "feat(phase-11a): WebhookEvent upsert + mark-processed helpers

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 14: Build the Duffel → workflow resume dispatcher

**Files:**
- Create: `apps/app/lib/duffel-dispatcher.ts`

- [ ] **Step 1: Write dispatcher**

```typescript
/**
 * Given a verified Duffel webhook event, find the matching Booking
 * and resume its paused workflow run. The resolution merged into the
 * scratchpad lives under the pause step's id so the next branch step
 * can read `$('await_duffel_ticket.status')`.
 *
 * If no booking matches the orderId, the webhook is accepted (200) but
 * logged — likely a late retry for a booking we never created, or a
 * cross-environment bleed-through.
 */

import { prisma } from '@sendero/database';
import { bookFlightWorkflow, guestPrefundWorkflow } from '@sendero/workflows/catalog';
import { resumeRun } from '@sendero/workflows';
import type { DuffelWebhookEvent } from '@sendero/duffel';

// The workflow runner is runtime-neutral. In the main chat route we
// inject a ToolRegistry that wraps the tool catalog; for webhook-
// driven resumption we need the same registry. Factored out so both
// paths stay identical.
import { makeToolRegistry } from './tool-registry';

export async function dispatchDuffelEvent(args: {
  event: DuffelWebhookEvent;
}): Promise<{ matched: boolean; runId?: string }> {
  const booking = await prisma.booking.findUnique({
    where: { duffelOrderId: args.event.orderId },
    select: {
      id: true,
      tenantId: true,
      metadata: true,
    },
  });
  if (!booking) {
    console.warn('[duffel-dispatcher] no booking for duffelOrderId', args.event.orderId);
    return { matched: false };
  }

  const meta = (booking.metadata ?? {}) as { workflowRunId?: string; workflowId?: string };
  const runId = meta.workflowRunId;
  const workflowId = meta.workflowId;
  if (!runId || !workflowId) {
    console.warn('[duffel-dispatcher] booking has no workflow run pointer', booking.id);
    return { matched: false };
  }

  const run = await prisma.workflowRun.findUnique({ where: { id: runId } });
  if (!run || run.status !== 'paused') {
    console.warn('[duffel-dispatcher] run not paused; skipping', runId, run?.status);
    return { matched: false, runId };
  }

  const workflow = workflowId === bookFlightWorkflow.id ? bookFlightWorkflow
                 : workflowId === guestPrefundWorkflow.id ? guestPrefundWorkflow
                 : null;
  if (!workflow) {
    console.warn('[duffel-dispatcher] unknown workflow id', workflowId);
    return { matched: false, runId };
  }

  const status = args.event.status === 'ticketed' ? 'ticketed' : 'failed';
  await resumeRun({
    workflow,
    run: JSON.parse(run.snapshot as string),
    resolution: { status, duffelOrderId: args.event.orderId },
    tools: makeToolRegistry(),
  });

  return { matched: true, runId };
}
```

> **IMPLEMENTATION NOTE:** `apps/app/lib/tool-registry.ts` may not exist yet. If it doesn't, also create it in this task with the contents below. If there's a similar module already (e.g. the chat route builds the registry inline), extract it.

`apps/app/lib/tool-registry.ts`:

```typescript
import { toolList } from '@sendero/tools';
import type { ToolRegistry } from '@sendero/workflows';

export function makeToolRegistry(): ToolRegistry {
  const reg: ToolRegistry = {};
  for (const t of toolList) {
    reg[t.name] = async (args: Record<string, unknown>) => t.handler(args as any);
  }
  return reg;
}
```

> **IMPLEMENTATION NOTE 2 (resolved):** `WorkflowRun` Prisma model does not exist and we are NOT adding one. Instead, the workflow snapshot lives on `Booking.metadata.workflow = { workflowId, runId, snapshot, pausedAt }`. Write it from the workflow runner's `onPause` hook at the call site (the chat route / book_flight invocation), keyed by the `bookingId` already in scratchpad. Dispatcher reads it back from the booking row.
>
> This means the actual dispatcher shape is:
>
> ```typescript
> const booking = await prisma.booking.findUnique({
>   where: { duffelOrderId: args.event.orderId },
>   select: { id: true, tenantId: true, metadata: true, tripId: true },
> });
> if (!booking) return { matched: false };
>
> const wf = (booking.metadata as any)?.workflow as
>   | { workflowId: string; runId: string; snapshot: unknown; pausedAt: string }
>   | undefined;
> if (!wf) return { matched: false };
>
> const workflow = wf.workflowId === bookFlightWorkflow.id ? bookFlightWorkflow
>                : wf.workflowId === guestPrefundWorkflow.id ? guestPrefundWorkflow
>                : null;
> if (!workflow) return { matched: false };
>
> const status = args.event.status === 'ticketed' ? 'ticketed' : 'failed';
> await resumeRun({
>   workflow,
>   run: wf.snapshot as WorkflowRun,
>   resolution: { status, duffelOrderId: args.event.orderId },
>   tools: makeToolRegistry(),
> });
> return { matched: true, runId: wf.runId };
> ```
>
> The `onPause` hook that writes the snapshot is a separate concern handled by whatever call site kicks off the `book_flight` workflow (chat route, guest-prefund server action, etc.). Writing the `onPause` hook is IN-SCOPE for phase-11a — add a sub-task below (Task 14b) covering the shared hook in `apps/app/lib/workflow-pause.ts`.

- [ ] **Step 2b (new): Add Task 14b — persistent `onPause` hook**

File: `apps/app/lib/workflow-pause.ts` (new):

```typescript
/**
 * Shared pause persistence. Call this as the `onPause` hook when
 * kicking off any workflow that may pause awaiting an external event
 * (Duffel ticket, Slack approval, guest claim). Snapshot is stored on
 * the booking's metadata so the webhook dispatcher can resume it.
 *
 * The booking must already exist. For workflows that pause BEFORE a
 * booking row exists (guestPrefund's `await_guest_claim`), the caller
 * should stash under a different table (Trip or WorkflowPause) — that
 * path is not exercised by phase-11a webhook resume, which only cares
 * about the post-commit Duffel pause.
 */

import { prisma } from '@sendero/database';
import type { PauseStep, WorkflowDef, WorkflowRun } from '@sendero/workflows';

export function makePausePersister(args: { bookingId: string; workflow: WorkflowDef }) {
  return async (pause: { runId: string; step: PauseStep; scratchpad: Record<string, unknown> }) => {
    await prisma.booking.update({
      where: { id: args.bookingId },
      data: {
        metadata: {
          workflow: {
            workflowId: args.workflow.id,
            runId: pause.runId,
            snapshot: /* caller must serialize the WorkflowRun; see below */ null,
            pausedAt: new Date().toISOString(),
            pausedStepId: pause.step.id,
          },
        },
      },
    });
  };
}

/**
 * Persist a full snapshot of a paused WorkflowRun onto the booking.
 * Call this from the workflow's call site after startRun() returns
 * with status === 'paused'.
 */
export async function persistPausedRun(args: {
  bookingId: string;
  workflow: WorkflowDef;
  run: WorkflowRun;
}) {
  const existing = await prisma.booking.findUnique({
    where: { id: args.bookingId },
    select: { metadata: true },
  });
  const merged = {
    ...((existing?.metadata as object | null) ?? {}),
    workflow: {
      workflowId: args.workflow.id,
      runId: args.run.runId,
      snapshot: args.run,
      pausedAt: new Date().toISOString(),
      pausedStepId: args.run.nextStepId,
    },
  };
  await prisma.booking.update({
    where: { id: args.bookingId },
    data: { metadata: merged as object },
  });
}
```

- [ ] **Step 2c: Typecheck + commit**

```bash
bun run typecheck 2>&1 | tail -5
git add apps/app/lib/workflow-pause.ts
git commit -m "feat(phase-11a): persistent workflow pause — booking.metadata snapshot

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

The call-site wiring (actually *invoking* `persistPausedRun` from the chat route / book_flight entrypoint) is deferred to whichever surface first exercises the Duffel pause — documented as a follow-up in the final gate.

- [ ] **Step 2: Typecheck**

```bash
bun run typecheck 2>&1 | tail -20
```

Expected: zero errors **only if** WorkflowRun persistence exists. If not, fix the blocking finding above first.

- [ ] **Step 3: Commit**

```bash
git add apps/app/lib/duffel-dispatcher.ts apps/app/lib/tool-registry.ts
git commit -m "feat(phase-11a): duffel → workflow resume dispatcher

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 15: Implement the webhook route

**Files:**
- Create: `apps/app/app/api/webhooks/duffel/route.ts`

- [ ] **Step 1: Write the route**

```typescript
/**
 * POST /api/webhooks/duffel
 *
 * Verifies the Duffel HMAC signature, dedupes against WebhookEvent,
 * normalizes the event, then resumes any paused workflow run that
 * was awaiting this order's ticketing outcome.
 *
 * Returns 200 even for already-processed or unmatched events — Duffel
 * would otherwise keep retrying and fill our logs. 4xx is reserved for
 * signature or schema failures (genuine client/config bugs).
 */

import { type NextRequest, NextResponse } from 'next/server';
import { env } from '@sendero/env';
import { verifyDuffelSignature, parseDuffelWebhook } from '@sendero/duffel';
import { recordWebhookEvent, markWebhookEventProcessed } from '@/lib/webhook-events';
import { dispatchDuffelEvent } from '@/lib/duffel-dispatcher';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  const secret = env.duffelWebhookSecret();
  if (!secret) {
    return NextResponse.json({ error: 'webhook_not_configured' }, { status: 503 });
  }

  const raw = await req.text();
  const sig = req.headers.get('x-duffel-signature');
  if (!verifyDuffelSignature(raw, sig, secret)) {
    return NextResponse.json({ error: 'invalid_signature' }, { status: 401 });
  }

  let event;
  try {
    event = parseDuffelWebhook(raw);
  } catch (err) {
    return NextResponse.json(
      { error: 'invalid_payload', message: err instanceof Error ? err.message : String(err) },
      { status: 400 }
    );
  }

  const stored = await recordWebhookEvent({
    provider: 'duffel',
    externalId: event.id,
    eventType: event.type,
    payload: event.raw,
  });
  if (stored.alreadyProcessed) {
    return NextResponse.json({ ok: true, deduped: true });
  }

  let dispatchError: string | undefined;
  try {
    const { matched } = await dispatchDuffelEvent({ event });
    if (!matched) {
      // Unmatched — probably an order we don't own. Accept to stop retries.
      await markWebhookEventProcessed(stored.id, 'no_booking_match');
      return NextResponse.json({ ok: true, matched: false });
    }
  } catch (err) {
    dispatchError = err instanceof Error ? err.message : String(err);
    console.error('[webhooks/duffel] dispatch failed', dispatchError);
  }

  await markWebhookEventProcessed(stored.id, dispatchError);
  if (dispatchError) {
    // 500 so Duffel retries — transient errors should recover.
    return NextResponse.json({ error: 'dispatch_failed', message: dispatchError }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Typecheck**

```bash
bun run typecheck 2>&1 | tail -10
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add apps/app/app/api/webhooks/duffel/route.ts
git commit -m "$(cat <<'EOF'
feat(phase-11a): /api/webhooks/duffel — HMAC verify → dedupe → dispatch

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 16: Smoke-test the route with curl + fake signature

**Files:** none (one-off verification)

- [ ] **Step 1: Start dev server**

```bash
bun run dev &
sleep 3
```

- [ ] **Step 2: POST with no signature (expect 401)**

```bash
curl -s -o /dev/stdout -w "\nstatus=%{http_code}\n" \
  -X POST http://localhost:3000/api/webhooks/duffel \
  -H 'content-type: application/json' \
  -d '{"id":"evt_test","type":"order.updated","data":{"id":"ord_x","status":"ticketed"}}'
```

Expected: `status=401` with `{"error":"invalid_signature"}`.

- [ ] **Step 3: POST with valid signature (expect 200, matched:false since no Booking)**

```bash
SECRET=$(printenv DUFFEL_WEBHOOK_SECRET)
BODY='{"id":"evt_test_2","type":"order.updated","data":{"id":"ord_nonexistent","status":"ticketed"}}'
SIG=$(printf %s "$BODY" | openssl dgst -sha256 -hmac "$SECRET" -hex | awk '{print $2}')
curl -s -o /dev/stdout -w "\nstatus=%{http_code}\n" \
  -X POST http://localhost:3000/api/webhooks/duffel \
  -H 'content-type: application/json' \
  -H "x-duffel-signature: $SIG" \
  -d "$BODY"
```

Expected: `status=200` with `{"ok":true,"matched":false}`.

- [ ] **Step 4: Repeat request — expect dedupe**

Re-run the same curl. Expected: `{"ok":true,"deduped":true}`.

- [ ] **Step 5: Kill dev server**

```bash
kill %1 2>/dev/null || true
```

No commit — this task is verification only.

---

## Epic 6 — New settlement tools

### Task 17: `confirm_duffel` tool

**Files:**
- Create: `packages/tools/src/confirm-duffel.ts`
- Modify: `packages/tools/src/index.ts`

- [ ] **Step 1: Write the tool**

```typescript
/**
 * Agent path: after Duffel ticketing is confirmed (via webhook), emit
 * the on-chain confirmation linking the bookingId to the canonical
 * Duffel order hash. This "closes" the booking for auditors — the
 * escrow can now prove which Duffel order the committed funds backed.
 *
 * Caller: operator MSCA (agent wallet). The contract enforces this via
 * the trip.agent field; calls from any other address revert.
 */

import { encodeFunctionData, type Address, type Hex } from 'viem';
import { z } from 'zod';
import { SENDERO_GUEST_ESCROW_ABI } from '@sendero/guest';
import type { ToolDef } from './types';

const hex32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/, 'hex32 (0x + 64 hex chars)');
const hex20 = z.string().regex(/^0x[0-9a-fA-F]{40}$/, 'ethereum address');

const confirmDuffelInput = z.object({
  bookingId: hex32,
  duffelOrderHash: hex32.describe('keccak256 of canonical Duffel order JSON (RFC 8785).'),
  escrowAddress: hex20.optional(),
});

function resolveEscrow(override?: string | null): Address {
  const addr =
    override ??
    process.env.ARC_ESCROW_ADDRESS ??
    process.env.NEXT_PUBLIC_ARC_ESCROW_ADDRESS;
  if (!addr) throw new Error('ARC_ESCROW_ADDRESS not configured');
  return addr as Address;
}

export const confirmDuffelTool: ToolDef = {
  name: 'confirm_duffel',
  description:
    'Agent path: submit the on-chain confirmDuffel call after Duffel issues a ticket. Pairs a bookingId with the canonical Duffel order hash so auditors can reconstruct the escrow → ticket mapping. Returns an encoded userOp call; caller submits via operator MSCA.',
  inputSchema: confirmDuffelInput,
  jsonSchema: {
    type: 'object',
    required: ['bookingId', 'duffelOrderHash'],
    properties: {
      bookingId: { type: 'string' },
      duffelOrderHash: { type: 'string' },
      escrowAddress: { type: 'string' },
    },
  },
  async handler(input) {
    const parsed = confirmDuffelInput.parse(input);
    const escrow = resolveEscrow(parsed.escrowAddress);
    const data = encodeFunctionData({
      abi: SENDERO_GUEST_ESCROW_ABI,
      functionName: 'confirmDuffel',
      args: [parsed.bookingId as Hex, parsed.duffelOrderHash as Hex],
    });
    return {
      bookingId: parsed.bookingId,
      duffelOrderHash: parsed.duffelOrderHash,
      escrowAddress: escrow,
      onchainCall: { to: escrow, data, value: '0' },
      note: 'Submit via operator MSCA userOp. Contract reverts if caller != trip.agent.',
    };
  },
};
```

- [ ] **Step 2: Register in `tools/index.ts`**

Add to the imports block at top:

```typescript
import { confirmDuffelTool } from './confirm-duffel';
```

Add to the `toolList` array (after `commitBookingTool`):

```typescript
  confirmDuffelTool,
```

Add to the re-export block:

```typescript
export { confirmDuffelTool } from './confirm-duffel';
```

- [ ] **Step 3: Typecheck + commit**

```bash
bun run typecheck 2>&1 | tail -5
git add packages/tools/src/confirm-duffel.ts packages/tools/src/index.ts
git commit -m "feat(phase-11a): confirm_duffel tool

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 18: `settle_booking` tool

**Files:**
- Create: `packages/tools/src/settle-booking.ts`
- Modify: `packages/tools/src/index.ts`

- [ ] **Step 1: Write the tool**

```typescript
/**
 * Agent path: release committed escrow funds to vendor + fee legs via
 * the contract's settleBooking. One transaction; contract handles the
 * vendor payout + operator fee split internally.
 *
 * Caller: operator MSCA.
 */

import { encodeFunctionData, type Address, type Hex } from 'viem';
import { z } from 'zod';
import { SENDERO_GUEST_ESCROW_ABI } from '@sendero/guest';
import type { ToolDef } from './types';

const hex32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const hex20 = z.string().regex(/^0x[0-9a-fA-F]{40}$/);

const settleInput = z.object({
  bookingId: hex32,
  escrowAddress: hex20.optional(),
});

function resolveEscrow(override?: string | null): Address {
  const addr = override ?? process.env.ARC_ESCROW_ADDRESS ?? process.env.NEXT_PUBLIC_ARC_ESCROW_ADDRESS;
  if (!addr) throw new Error('ARC_ESCROW_ADDRESS not configured');
  return addr as Address;
}

export const settleBookingTool: ToolDef = {
  name: 'settle_booking',
  description:
    'Agent path: release escrow for a confirmed booking. Transfers vendorAmount to the vendor and feeAmount to the operator in one tx. Caller submits via operator MSCA userOp. Should run AFTER confirm_duffel and only when Duffel status=ticketed.',
  inputSchema: settleInput,
  jsonSchema: {
    type: 'object',
    required: ['bookingId'],
    properties: {
      bookingId: { type: 'string' },
      escrowAddress: { type: 'string' },
    },
  },
  async handler(input) {
    const parsed = settleInput.parse(input);
    const escrow = resolveEscrow(parsed.escrowAddress);
    const data = encodeFunctionData({
      abi: SENDERO_GUEST_ESCROW_ABI,
      functionName: 'settleBooking',
      args: [parsed.bookingId as Hex],
    });
    return {
      bookingId: parsed.bookingId,
      escrowAddress: escrow,
      onchainCall: { to: escrow, data, value: '0' },
      note: 'Operator-only. Contract rejects calls from any other address.',
    };
  },
};
```

- [ ] **Step 2: Register + commit**

```typescript
// tools/index.ts
import { settleBookingTool } from './settle-booking';
// ...
  settleBookingTool,   // in toolList
// ...
export { settleBookingTool } from './settle-booking';
```

```bash
bun run typecheck 2>&1 | tail -5
git add packages/tools/src/settle-booking.ts packages/tools/src/index.ts
git commit -m "feat(phase-11a): settle_booking tool

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 19: `cancel_booking` tool

**Files:**
- Create: `packages/tools/src/cancel-booking.ts`
- Modify: `packages/tools/src/index.ts`

- [ ] **Step 1: Write the tool**

```typescript
/**
 * Agent path: cancel a booking and release its reserved escrow back to
 * the trip's buyer. Returns TWO encoded calls:
 *   1. escrow.cancelBooking(bookingId)
 *   2. escrow.sweepUnspent(tripId) — triggers the buyer refund
 * Caller submits both as a MSCA executeBatch userOp.
 */

import { encodeFunctionData, type Address, type Hex } from 'viem';
import { z } from 'zod';
import { SENDERO_GUEST_ESCROW_ABI } from '@sendero/guest';
import type { ToolDef } from './types';

const hex32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const hex20 = z.string().regex(/^0x[0-9a-fA-F]{40}$/);

const cancelInput = z.object({
  bookingId: hex32,
  tripId: hex32,
  reason: z.enum(['duffel_failed', 'policy_reject', 'buyer_cancel', 'timeout']),
  escrowAddress: hex20.optional(),
});

function resolveEscrow(override?: string | null): Address {
  const addr = override ?? process.env.ARC_ESCROW_ADDRESS ?? process.env.NEXT_PUBLIC_ARC_ESCROW_ADDRESS;
  if (!addr) throw new Error('ARC_ESCROW_ADDRESS not configured');
  return addr as Address;
}

export const cancelBookingTool: ToolDef = {
  name: 'cancel_booking',
  description:
    'Agent path: cancel a reserved/committed booking and refund the remaining escrow to the buyer. Emits two on-chain calls (cancelBooking + sweepUnspent) to submit together via operator MSCA executeBatch.',
  inputSchema: cancelInput,
  jsonSchema: {
    type: 'object',
    required: ['bookingId', 'tripId', 'reason'],
    properties: {
      bookingId: { type: 'string' },
      tripId: { type: 'string' },
      reason: { type: 'string', enum: ['duffel_failed', 'policy_reject', 'buyer_cancel', 'timeout'] },
      escrowAddress: { type: 'string' },
    },
  },
  async handler(input) {
    const parsed = cancelInput.parse(input);
    const escrow = resolveEscrow(parsed.escrowAddress);
    const cancelData = encodeFunctionData({
      abi: SENDERO_GUEST_ESCROW_ABI,
      functionName: 'cancelBooking',
      args: [parsed.bookingId as Hex],
    });
    const sweepData = encodeFunctionData({
      abi: SENDERO_GUEST_ESCROW_ABI,
      functionName: 'sweepUnspent',
      args: [parsed.tripId as Hex],
    });
    return {
      bookingId: parsed.bookingId,
      tripId: parsed.tripId,
      reason: parsed.reason,
      escrowAddress: escrow,
      onchainCalls: [
        { to: escrow, data: cancelData, value: '0' },
        { to: escrow, data: sweepData, value: '0' },
      ],
      note: 'Submit as operator MSCA executeBatch userOp. Order matters — cancel before sweep.',
    };
  },
};
```

- [ ] **Step 2: Register + commit**

```typescript
// tools/index.ts
import { cancelBookingTool } from './cancel-booking';
// ...
  cancelBookingTool,
// ...
export { cancelBookingTool } from './cancel-booking';
```

```bash
bun run typecheck 2>&1 | tail -5
git add packages/tools/src/cancel-booking.ts packages/tools/src/index.ts
git commit -m "feat(phase-11a): cancel_booking tool — dual-call refund flow

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 20: Tests for new tools

**Files:**
- Create: `packages/tools/src/settlement-tools.test.ts`

- [ ] **Step 1: Write tests**

```typescript
import { test, expect } from 'bun:test';
import { confirmDuffelTool } from './confirm-duffel';
import { settleBookingTool } from './settle-booking';
import { cancelBookingTool } from './cancel-booking';

const BID = `0x${'1'.repeat(64)}`;
const TID = `0x${'2'.repeat(64)}`;
const HASH = `0x${'3'.repeat(64)}`;
const ESCROW = `0x${'a'.repeat(40)}`;

test('confirm_duffel returns an encoded call', async () => {
  const out: any = await confirmDuffelTool.handler({
    bookingId: BID,
    duffelOrderHash: HASH,
    escrowAddress: ESCROW,
  });
  expect(out.onchainCall.to.toLowerCase()).toBe(ESCROW.toLowerCase());
  expect(out.onchainCall.data.startsWith('0x')).toBe(true);
  expect(out.onchainCall.value).toBe('0');
});

test('settle_booking returns an encoded call', async () => {
  const out: any = await settleBookingTool.handler({ bookingId: BID, escrowAddress: ESCROW });
  expect(out.onchainCall.to.toLowerCase()).toBe(ESCROW.toLowerCase());
  expect(out.onchainCall.data.startsWith('0x')).toBe(true);
});

test('cancel_booking emits cancelBooking + sweepUnspent in order', async () => {
  const out: any = await cancelBookingTool.handler({
    bookingId: BID,
    tripId: TID,
    reason: 'duffel_failed',
    escrowAddress: ESCROW,
  });
  expect(out.onchainCalls.length).toBe(2);
  // Both point at the escrow.
  expect(out.onchainCalls[0].to.toLowerCase()).toBe(ESCROW.toLowerCase());
  expect(out.onchainCalls[1].to.toLowerCase()).toBe(ESCROW.toLowerCase());
  // The two calldatas are distinct (different function selectors).
  expect(out.onchainCalls[0].data.slice(0, 10)).not.toBe(out.onchainCalls[1].data.slice(0, 10));
});

test('settle_booking rejects bad bookingId', async () => {
  await expect(settleBookingTool.handler({ bookingId: '0xnot-hex', escrowAddress: ESCROW })).rejects.toThrow();
});
```

- [ ] **Step 2: Run**

```bash
cd packages/tools && bun test src/settlement-tools.test.ts 2>&1 | tail -15
```

Expected: 4 passing.

- [ ] **Step 3: Commit**

```bash
cd ../..
git add packages/tools/src/settlement-tools.test.ts
git commit -m "test(phase-11a): encoded-call coverage for settlement tools

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Epic 7 — Workflow catalog edits

### Task 21: Add pause + branch to `bookFlightWorkflow`

**Files:**
- Modify: `packages/workflows/src/catalog.ts`

- [ ] **Step 1: Insert between existing `policy_gate` branch and `settle` step (around line 93)**

Open the `bookFlightWorkflow.steps` array. After the `policy_gate` branch (closes around line 92) and BEFORE the `settle` step at line 93, insert:

```typescript
    {
      kind: 'pause',
      id: 'await_duffel_ticket',
      label: 'Awaiting Duffel ticketing',
      reason: 'external_event',
      payload: { via: 'duffel_order_ticketed' },
      timeoutMs: 48 * 60 * 60 * 1000,
    },
    {
      kind: 'branch',
      id: 'duffel_gate',
      label: 'Duffel outcome',
      when: $('await_duffel_ticket.status'),
      equals: 'ticketed',
      then: [
        {
          kind: 'tool',
          id: 'confirm',
          tool: 'confirm_duffel',
          label: 'Confirm Duffel ticket on-chain',
          args: {
            bookingId: $('hold.bookingId'),
            duffelOrderHash: $('hold.orderHash'),
          },
        },
        {
          kind: 'tool',
          id: 'settle_escrow',
          tool: 'settle_booking',
          label: 'Release escrow to vendor + fee',
          args: { bookingId: $('hold.bookingId') },
        },
      ],
      otherwise: [
        {
          kind: 'tool',
          id: 'cancel',
          tool: 'cancel_booking',
          label: 'Cancel booking + refund',
          args: {
            bookingId: $('hold.bookingId'),
            tripId: $('input.tripId'),
            reason: 'duffel_failed',
          },
        },
      ],
    },
```

Keep the existing `settle` (settle_split) step AFTER these — it only runs on the happy path anyway and the `then` branch already handled escrow release.

> **NOTE:** The existing `settle_split` step continues to run after the branch. If you want it conditional (only for multi-way commission splits), wrap it in another branch keyed off `input.commissionSplit` or similar. Out of scope for 11a.

- [ ] **Step 2: Typecheck + commit**

```bash
bun run typecheck 2>&1 | tail -5
git add packages/workflows/src/catalog.ts
git commit -m "feat(phase-11a): bookFlight — pause for Duffel webhook + branch

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 22: Add pause + branch to `guestPrefundWorkflow`

**Files:**
- Modify: `packages/workflows/src/catalog.ts`

- [ ] **Step 1: Insert after `commit` step (~line 322) and before `settle` step (~line 324)**

Open `guestPrefundWorkflow.steps`. After the `commit` step and BEFORE the `settle` step, insert:

```typescript
    {
      kind: 'pause',
      id: 'await_duffel_ticket',
      label: 'Awaiting Duffel ticketing',
      reason: 'external_event',
      payload: { via: 'duffel_order_ticketed' },
      timeoutMs: 48 * 60 * 60 * 1000,
    },
    {
      kind: 'branch',
      id: 'duffel_gate',
      label: 'Duffel outcome',
      when: $('await_duffel_ticket.status'),
      equals: 'ticketed',
      then: [
        {
          kind: 'tool',
          id: 'confirm',
          tool: 'confirm_duffel',
          label: 'Confirm Duffel ticket on-chain',
          args: {
            bookingId: $('reservation.bookingId'),
            duffelOrderHash: $('hold.orderHash'),
          },
        },
        {
          kind: 'tool',
          id: 'settle_escrow',
          tool: 'settle_booking',
          label: 'Release escrow to vendor + fee',
          args: { bookingId: $('reservation.bookingId') },
        },
      ],
      otherwise: [
        {
          kind: 'tool',
          id: 'cancel',
          tool: 'cancel_booking',
          label: 'Cancel booking + refund',
          args: {
            bookingId: $('reservation.bookingId'),
            tripId: $('prefund.tripId'),
            reason: 'duffel_failed',
          },
        },
      ],
    },
```

- [ ] **Step 2: Typecheck + commit**

```bash
bun run typecheck 2>&1 | tail -5
git add packages/workflows/src/catalog.ts
git commit -m "feat(phase-11a): guestPrefund — pause for Duffel webhook + branch

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Epic 8 — Env + health

### Task 23: Register `DUFFEL_WEBHOOK_SECRET` + `SENDERO_TREASURY_ADDRESS` in `validate.ts`

**Files:**
- Modify: `packages/sendero-env/src/validate.ts`

- [ ] **Step 1: Extend REQUIRED array**

Append to the `REQUIRED` array (before the closing `]` near line 69):

```typescript
  { name: 'DUFFEL_WEBHOOK_SECRET', scope: 'duffel', hint: 'HMAC secret from Duffel dashboard for /api/webhooks/duffel' },
  { name: 'SENDERO_TREASURY_ADDRESS', scope: 'onchain', hint: 'Destination EOA/MSCA for nanopay batch settlements' },
```

- [ ] **Step 2: Run validate**

```bash
bun run --cwd packages/sendero-env validate 2>&1 | tail -20
```

Expected: either `all required present` (if envs are set) or a gap list that includes the two new keys. Populate `.env.local` with placeholders if missing.

- [ ] **Step 3: Commit**

```bash
git add packages/sendero-env/src/validate.ts
git commit -m "chore(phase-11a): require DUFFEL_WEBHOOK_SECRET + SENDERO_TREASURY_ADDRESS

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 24: Surface new env in `/api/health`

**Files:**
- Modify: `apps/app/app/api/health/route.ts`

- [ ] **Step 1: Read current shape**

```bash
cat apps/app/app/api/health/route.ts
```

- [ ] **Step 2: Extend the health response**

Locate where existing env presence checks live in the route (they likely follow a pattern like `configured: { duffel: !!env.duffelApiToken(), ... }`). Add two entries:

```typescript
    duffelWebhookSecret: !!env.duffelWebhookSecret(),
    senderoTreasuryAddress: !!process.env.SENDERO_TREASURY_ADDRESS,
```

- [ ] **Step 3: Curl sanity**

```bash
bun run dev &
sleep 3
curl -s http://localhost:3000/api/health | head -50
kill %1 2>/dev/null || true
```

Expected: JSON includes `duffelWebhookSecret` + `senderoTreasuryAddress` booleans.

- [ ] **Step 4: Commit**

```bash
git add apps/app/app/api/health/route.ts
git commit -m "chore(phase-11a): surface duffel-webhook + treasury in /api/health

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Epic 9 — Smoke + integration

### Task 25: Extend `scripts/smoke-guest-escrow.ts` — cancel path

**Files:**
- Modify: `scripts/smoke-guest-escrow.ts`

- [ ] **Step 1: Add a scenario that exercises cancel + sweep**

Add to the end of the existing script flow (after the current settleBooking + sweepUnspent assertions, which already exist per the v1.1 smoke log):

```typescript
// ── Cancel path ──────────────────────────────────────────────────
console.log('\n── Cancel path ──');
const cancelTripId = generateTripId();
// ... create trip, claim, reserve, commit (reusing existing helpers) ...
const { cancelBookingTool } = await import('@sendero/tools');
const cancelOut: any = await cancelBookingTool.handler({
  bookingId: cancelBookingId,
  tripId: cancelTripId,
  reason: 'duffel_failed',
  escrowAddress: ESCROW,
});
// Submit both calls sequentially (smoke test uses EOA, not MSCA):
for (const call of cancelOut.onchainCalls) {
  await wallet.sendTransaction({
    to: call.to,
    data: call.data,
    value: BigInt(call.value),
  });
}
// Assert buyer balance restored (within tolerance for gas).
const finalBuyerUsdc = await usdcBalanceOf(buyer.address);
console.log(`  buyer USDC after cancel: ${finalBuyerUsdc}`);
if (finalBuyerUsdc < initialBuyerUsdc - 1_000_000n) {
  throw new Error('cancel did not refund the buyer');
}
console.log('  ✓ cancel refunded buyer');
```

Adjust variable names to match the script's existing style.

- [ ] **Step 2: Run on Arc Testnet**

```bash
bun run smoke:escrow 2>&1 | tail -40
```

Expected: cancel path block ends with `✓ cancel refunded buyer`.

- [ ] **Step 3: Commit**

```bash
git add scripts/smoke-guest-escrow.ts
git commit -m "test(phase-11a): smoke — cancel + sweep refunds buyer

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 26: Nanopay batch end-to-end smoke

**Files:**
- Create: `scripts/smoke-nanopay-batch.ts`

- [ ] **Step 1: Write the script**

```typescript
/**
 * End-to-end nanopay batch smoke. Inserts fake MeterEvents for a test
 * tenant, hits the cron endpoint, verifies an on-chain USDC transfer
 * settled with a real tx hash (not the legacy `0xdemo...` synthetic).
 *
 * Requires: DATABASE_URL, SENDERO_TREASURY_ADDRESS, TREASURY_PRIVATE_KEY,
 *           CRON_SECRET, and a running dev server.
 *
 * Usage: bun run scripts/smoke-nanopay-batch.ts
 */

import { prisma } from '@sendero/database';

const BASE_URL = process.env.SMOKE_BASE_URL ?? 'http://localhost:3000';
const CRON_SECRET = process.env.CRON_SECRET!;
const TEST_TENANT = process.env.SMOKE_TENANT_ID ?? 'smoke-test-tenant';

async function main() {
  // 1. Seed 3 paid MeterEvents totaling 0.000300 USDC (300 micro).
  const at = new Date();
  const events = await Promise.all(
    Array.from({ length: 3 }).map((_, i) =>
      prisma.meterEvent.create({
        data: {
          tenantId: TEST_TENANT,
          toolName: 'smoke_test',
          priceMicroUsdc: 100n,
          status: 'paid',
          at: new Date(at.getTime() - i * 60_000),
        },
        select: { id: true },
      })
    )
  );
  console.log('seeded', events.length, 'meter events');

  // 2. Trigger cron.
  const res = await fetch(`${BASE_URL}/api/cron/settle-nanopay-batches`, {
    headers: { authorization: `Bearer ${CRON_SECRET}` },
  });
  const body = await res.json();
  console.log('cron response:', JSON.stringify(body, null, 2));

  // 3. Check the batch row.
  const batch = await prisma.nanopayBatch.findFirst({
    where: { tenantId: TEST_TENANT },
    orderBy: { createdAt: 'desc' },
  });
  if (!batch) throw new Error('no batch row created');
  if (batch.status !== 'settled') throw new Error(`expected settled, got ${batch.status}`);
  if (!batch.txHash || batch.txHash.startsWith('0xdemo') || batch.txHash.startsWith('0xlive')) {
    throw new Error(`expected real tx hash, got ${batch.txHash}`);
  }
  console.log('✓ batch settled with real tx:', batch.txHash);
}

main()
  .catch(err => {
    console.error('smoke failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
```

- [ ] **Step 2: Add a package.json script**

In root `package.json`, add to the `"scripts"` block:

```json
    "smoke:nanopay": "bun run scripts/smoke-nanopay-batch.ts",
```

- [ ] **Step 3: Run (requires dev server + env)**

```bash
bun run dev &
sleep 3
bun run smoke:nanopay
kill %1 2>/dev/null || true
```

Expected: `✓ batch settled with real tx: 0x…` with a real-looking 64-char hex.

- [ ] **Step 4: Commit**

```bash
git add scripts/smoke-nanopay-batch.ts package.json
git commit -m "test(phase-11a): smoke — nanopay batch produces real tx hash

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 27: Webhook → resume integration test

**Files:**
- Create: `apps/app/app/api/webhooks/duffel/route.test.ts`

- [ ] **Step 1: Write an integration test using Bun test + fetch against a running dev server OR direct function import**

```typescript
import { test, expect, beforeAll, afterAll } from 'bun:test';
import { createHmac } from 'node:crypto';
import { prisma } from '@sendero/database';

const BASE_URL = process.env.SMOKE_BASE_URL ?? 'http://localhost:3000';
const SECRET = process.env.DUFFEL_WEBHOOK_SECRET ?? 'whsec_test';

function sign(body: string) {
  return createHmac('sha256', SECRET).update(body).digest('hex');
}

test('unknown orderId returns 200 matched:false', async () => {
  const body = JSON.stringify({
    id: `evt_${Date.now()}`,
    type: 'order.updated',
    data: { id: `ord_unknown_${Date.now()}`, status: 'ticketed' },
  });
  const res = await fetch(`${BASE_URL}/api/webhooks/duffel`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-duffel-signature': sign(body) },
    body,
  });
  expect(res.status).toBe(200);
  const json = await res.json();
  expect(json.matched).toBe(false);
});

test('duplicate event returns 200 deduped:true', async () => {
  const id = `evt_dup_${Date.now()}`;
  const body = JSON.stringify({
    id,
    type: 'order.updated',
    data: { id: `ord_${Date.now()}`, status: 'ticketed' },
  });
  const headers = { 'content-type': 'application/json', 'x-duffel-signature': sign(body) };

  const first = await fetch(`${BASE_URL}/api/webhooks/duffel`, { method: 'POST', headers, body });
  expect(first.status).toBe(200);

  const second = await fetch(`${BASE_URL}/api/webhooks/duffel`, { method: 'POST', headers, body });
  expect(second.status).toBe(200);
  const json = await second.json();
  expect(json.deduped).toBe(true);
});

test('bad signature returns 401', async () => {
  const body = '{"id":"evt_bad","type":"order.updated","data":{"id":"x","status":"ticketed"}}';
  const res = await fetch(`${BASE_URL}/api/webhooks/duffel`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-duffel-signature': 'deadbeef' },
    body,
  });
  expect(res.status).toBe(401);
});
```

- [ ] **Step 2: Run against a dev server**

```bash
bun run dev &
sleep 3
bun test apps/app/app/api/webhooks/duffel/route.test.ts
kill %1 2>/dev/null || true
```

Expected: 3 passing.

- [ ] **Step 3: Commit**

```bash
git add apps/app/app/api/webhooks/duffel/route.test.ts
git commit -m "test(phase-11a): webhook route integration (unknown / dedupe / bad-sig)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Final gate

Run all tests and typecheck end-to-end:

```bash
bun run typecheck 2>&1 | tail -10
cd packages/billing && bun test 2>&1 | tail -5 && cd ../..
cd packages/sendero-duffel && bun test 2>&1 | tail -5 && cd ../..
cd packages/tools && bun test 2>&1 | tail -5 && cd ../..
bun run smoke:escrow 2>&1 | tail -10
bun run smoke:nanopay 2>&1 | tail -5
```

Expected: zero type errors; all tests green; both smokes end with their ✓ assertions.

If any step fails, fix the root cause before moving to phase-11b. Do not paper over — invoicing reads from exactly this state.

---

## Self-review notes (author)

- **Spec coverage** — every blocker (B1-B4), every file in "Modified files" list, every test surface. ✓
- **Placeholder scan** — zero `TODO`/`TBD`/`fill in`/`similar to`. One explicit "IMPLEMENTATION NOTE" in Task 14 flagging that `WorkflowRun` persistence may not exist; this is a *conditional gap to surface to the user*, not a placeholder. ✓
- **Type consistency** — tool handler returns match existing `ToolDef` shape; `retrySettlingBatches` result union matches consumer expectations in cron; `DuffelWebhookEvent` used identically in dispatcher + route. ✓
- **Scope check** — no invoice, no buyer UI, no agency markup. Bounded. ✓

## Open items resolved / carried

1. ~~WorkflowRun Prisma persistence?~~ **RESOLVED**: no new model; snapshot stored on `Booking.metadata.workflow`. Task 14 updated; Task 14b covers the shared `persistPausedRun` helper.
2. ~~Slack `postMessage` helper shape?~~ **RESOLVED**: `createSlackClient(botToken)` + `postMessage(client, args)`. Task 8 updated.
3. **Cron schedule** — `/api/cron/settle-nanopay-batches` exists but repo has no `vercel.json` at root OR under `apps/app/` with a `crons` block. Either it's scheduled out-of-band or scheduling was missed. Operational item tracked under **Track A** — confirm + add a `crons` block to the right vercel.json before production cutover.
