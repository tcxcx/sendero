# Phase-11a — Close the loop

**Date:** 2026-04-20
**Branch:** feat/phase-11-invoicing
**Baseline:** commit 52418ab (phase-10)
**Prereq for:** phase-11b (invoicing) — reads real settlement state
**Gap refs:** B1, B2, B3, B4 from `docs/superpowers/research/2026-04-20-platform-gap-analysis.md`

## Problem

Three blockers prevent a production billing cycle:

1. **Settlement is synthetic.** `packages/billing/src/batch.ts:134` returns fake tx hashes. No real USDC moves for tenant platform usage.
2. **Booking lifecycle half-closed.** Workflow catalog references `confirm_duffel` / `settle_split` / post-Duffel flow but the tools don't exist. After `commitBooking` on-chain, the escrow → vendor fan-out never runs. Duffel-failure path is unwritten.
3. **No webhook ingress for Duffel.** Today `book_flight` would need to block synchronously on Duffel ticketing. That's slow and brittle.

Phase-11a closes all three so phase-11b can issue invoices that reflect real on-chain state.

## Scope

### In scope

- **Flow 1 — Real nanopay batch transfer** (gap B1)
- **Flow 2 — Webhook-driven booking settlement** (gaps B2, B3)
- **Duffel failure / cancel path** (gap B4)
- Duffel webhook ingress with HMAC verify + idempotency
- Three new MCP tools: `confirm_duffel`, `settle_booking`, `cancel_booking`
- Workflow edits: insert pause + branch after `commit` in `bookFlightWorkflow` + `guestPrefundWorkflow`
- Schema additions: `WebhookEvent`, `Booking.duffelOrderId`, `NanopayBatch.retryCount`

### Out of scope (punted)

- Invoice model / PDF generation → phase-11b
- Buyer UI for prefund → phase-11c
- Agency markup / end-client ledger → phase-12
- Generic `@sendero/webhooks` package (next-forge style central receiver) — keep per-provider pattern until 3+ providers justify the refactor
- Manual "retry batch" UI — CLI + Slack alert for v1
- Webhook replay / backfill

## Architecture

### Flow 1 — Nanopay batch settlement

```
Cron (hourly, Vercel) → /api/cron/settle-nanopay-batches
  → for each tenant with open MeterEvents:
    → open NanopayBatch (status='pending')
    → claim + mark 'settling'
    → call @sendero/nanopayments.transferUSDC(
         from: treasuryMSCA,
         to: senderoTreasuryAddress,
         amount: sum(meterEvents.priceMicroUsdc),
         token: USDC,
         chain: arc,
       )
    → on success: status='settled', txHash=<real>
    → on failure: retryCount++, leave status='settling' unless retryCount >= 3
    → retryCount === 3 → status='failed', fire Slack alert
```

**Key changes vs today:**

- `packages/billing/src/batch.ts:makeSettleFn()` — swap synthetic return for real `transferUSDC` call
- `packages/sendero-nanopayments/src/index.ts` — ensure `transferUSDC(from, to, amount, token, chain)` helper exists; submits via treasury MSCA userOp, paymaster-sponsored
- `NanopayBatch.retryCount` column added; increment on failure
- `packages/slack/src/alerts.ts` (new or extend existing) — `fireBatchFailedAlert(batchId, tenantId, reason)` posts to ops channel

### Flow 2 — Booking settlement (webhook-driven)

```
agent: book_flight workflow
  → search → policy → hold → reserve → commit
  → PAUSE (reason='external_event', via='duffel_order_ticketed')
                             ↑
Duffel webhook ─────────────┤
  POST /api/webhooks/duffel
    1. verify HMAC-SHA256 signature (DUFFEL_WEBHOOK_SECRET)
    2. parse + normalize event
    3. dedupe via WebhookEvent.externalId upsert
    4. lookup Booking by duffelOrderId
    5. status === 'ticketed'  → resumeRun(runId, { status: 'ticketed', duffelOrderHash })
       status === 'failed' | 'cancelled' → resumeRun(runId, { status: 'failed' })

  → resumed workflow branch:
      status='ticketed': confirm_duffel → settle_booking → [optional settle_split for multi-leg commission]
      status='failed':   cancel_booking → (escrow sweepUnspent refunds buyer)
```

### Webhook route shape (next-forge pattern, per-provider)

`apps/app/app/api/webhooks/duffel/route.ts`:

```ts
// verify → parse → dedupe → dispatch
export async function POST(req: NextRequest) {
  const raw = await req.text();
  const sig = req.headers.get('x-duffel-signature');
  if (!verifyDuffelSignature(raw, sig, env.duffelWebhookSecret())) {
    return new Response('unauthorized', { status: 401 });
  }
  const event = parseDuffelWebhook(raw);
  const stored = await recordWebhookEvent({
    provider: 'duffel',
    externalId: event.id,          // dedupe key
    eventType: event.type,
    payload: event,
  });
  if (stored.alreadyProcessed) return new Response('ok', { status: 200 });

  const booking = await prisma.booking.findUnique({ where: { duffelOrderId: event.orderId } });
  if (!booking) return new Response('booking not found', { status: 404 });

  await dispatchDuffelEvent({ event, booking });

  await markWebhookEventProcessed(stored.id);
  return new Response('ok', { status: 200 });
}
```

`packages/sendero-duffel/src/webhook.ts` (new):

- `verifyDuffelSignature(rawBody, signature, secret) → boolean`
- `parseDuffelWebhook(rawBody) → DuffelWebhookEvent`
- `DuffelWebhookEvent` type — `{ id, type: 'order.created' | 'order.updated', orderId, status: 'ticketed' | 'failed' | 'cancelled' | 'pending', raw }`

### New tools (MCP)

Each returns encoded on-chain call; caller submits via their MSCA userOp (same pattern as existing tools in `packages/tools/src/guest-escrow.ts`).

**`confirm_duffel`**
- Input: `bookingId`, `duffelOrderHash` (keccak256 of canonical Duffel order JSON), `escrowAddress?`
- Output: encoded `escrow.confirmDuffel(bookingId, duffelOrderHash)` call
- Caller: operator MSCA (agent wallet)

**`settle_booking`**
- Input: `bookingId`, `escrowAddress?`
- Output: encoded `escrow.settleBooking(bookingId)` call
- Behavior: on-chain releases `vendorAmount` to vendor address + `feeAmount` to operator. Single-tx split.
- Caller: operator MSCA

**`cancel_booking`**
- Input: `bookingId`, `reason` (enum: 'duffel_failed' | 'policy_reject' | 'buyer_cancel'), `escrowAddress?`
- Output: array of encoded calls — `escrow.cancelBooking(bookingId)` plus `escrow.sweepUnspent(tripId)` to refund the reserved USDC back to buyer
- Caller: operator MSCA

### Workflow catalog edits

`packages/workflows/src/catalog.ts` — both `bookFlightWorkflow` and `guestPrefundWorkflow`:

After existing `commit` step, insert:

```ts
{ kind: 'pause', id: 'await_duffel_ticket',
  reason: 'external_event',
  payload: { via: 'duffel_order_ticketed' },
  timeoutMs: 48 * 60 * 60 * 1000 },  // 48h SLA; timeout → cancel branch
{ kind: 'branch', id: 'duffel_gate',
  when: $('await_duffel_ticket.status'), equals: 'ticketed',
  then: [
    { kind: 'tool', id: 'confirm', tool: 'confirm_duffel', ... },
    { kind: 'tool', id: 'settle', tool: 'settle_booking', ... },
    // optional: settle_split for multi-way commission if tenant has >1 payee
  ],
  otherwise: [
    { kind: 'tool', id: 'cancel', tool: 'cancel_booking',
      args: { bookingId: $('reserve.bookingId'), reason: 'duffel_failed' } },
  ],
}
```

The old `settle_split` step remains usable but only runs inside `then` when multi-way commission is configured — single-vendor + single-fee case is fully handled by `settle_booking`'s on-chain split.

### Schema deltas

```prisma
model WebhookEvent {
  id           String   @id @default(uuid()) @db.Uuid
  receivedAt   DateTime @default(now()) @db.Timestamptz(6)
  processedAt  DateTime? @db.Timestamptz(6)
  provider     String    // 'duffel' | 'slack' | 'whatsapp'
  externalId   String    // provider-supplied event id (dedupe key)
  eventType    String
  payload      Json
  @@unique([provider, externalId])
  @@index([provider, processedAt])
}

model Booking {
  // existing columns...
  duffelOrderId String? @unique   // nullable until Duffel confirms; set at commit time
}

model NanopayBatch {
  // existing columns...
  retryCount   Int @default(0)
  lastError    String?
}
```

### Idempotency

- `WebhookEvent.@@unique([provider, externalId])` — second delivery returns 200 OK without re-processing
- `resumeRun` is already idempotent by run id (existing behavior for Slack approvals)
- `settle_booking` + `cancel_booking` on-chain calls revert on double-send — treat revert as success-equivalent in webhook handler

### Env additions

- `DUFFEL_WEBHOOK_SECRET` — HMAC secret from Duffel dashboard
- `SENDERO_TREASURY_ADDRESS` — destination for nanopay transfers (may already exist; verify)

Update `packages/sendero-env/src/validate.ts` + `apps/app/app/api/health/route.ts` to report both.

## Files

### New

- `packages/sendero-duffel/src/webhook.ts`
- `packages/tools/src/confirm-duffel.ts`
- `packages/tools/src/settle-booking.ts`
- `packages/tools/src/cancel-booking.ts`
- `apps/app/app/api/webhooks/duffel/route.ts`

### Modified

- `packages/tools/src/index.ts` — register 3 new tools
- `packages/workflows/src/catalog.ts` — add pause + branch to `bookFlightWorkflow` and `guestPrefundWorkflow`
- `packages/database/prisma/schema.prisma` — `WebhookEvent`, `Booking.duffelOrderId`, `NanopayBatch.retryCount`, `NanopayBatch.lastError`
- `packages/billing/src/batch.ts` — wire real `transferUSDC`, retry, circuit break
- `packages/sendero-nanopayments/src/index.ts` — ensure `transferUSDC` exists; add if not
- `packages/sendero-env/src/validate.ts` — new env keys
- `packages/slack/src/alerts.ts` — `fireBatchFailedAlert` (extend if file exists, create if not)
- `apps/app/app/api/health/route.ts` — surface webhook + treasury config
- Migration: `packages/database/prisma/migrations/YYYYMMDDHHMMSS_phase_11a/migration.sql`

## Test plan

### Unit

- `webhook.ts` — HMAC verify (valid, tampered, missing sig, wrong secret)
- `webhook.ts` — `parseDuffelWebhook` on sample payloads (ticketed, failed, cancelled, unknown)
- `batch.ts` — retry cap behavior (fail 2×, then success; fail 3× → `status='failed'` + alert call)
- `cancel_booking` — emits both `cancelBooking` + `sweepUnspent` calls in order

### Integration

- Full workflow — mock Duffel `hold` response, simulate webhook POST with valid signature, assert workflow resumes and settle tool fires
- Full workflow — simulate `status='failed'` webhook, assert cancel path runs and escrow refund tool fires
- Idempotency — same webhook event twice → single side-effect
- Expired pause — pause times out after 48h, `duffel_gate` falls through to cancel branch

### On-chain (Arc testnet, using existing smoke-test pattern)

Extend `scripts/smoke-guest-escrow.ts` to add:

- After step 8 (confirmDuffel + settleBooking already tested in v1.1 smoke), add cancel path test: create trip, claim, reserve, commit, then call `cancelBooking` + `sweepUnspent` and verify buyer balance restored.
- Add nanopay batch E2E: insert MeterEvent rows, trigger `/api/cron/settle-nanopay-batches`, assert on-chain USDC transfer from treasury MSCA to `SENDERO_TREASURY_ADDRESS`, assert `NanopayBatch.txHash` is real and status='settled'.

## Risks / open questions

- **Duffel webhook delivery reliability** — per Duffel docs, they retry with exponential backoff up to 24h. Our 48h pause timeout gives headroom; add a cron sweeper post-11a if we observe drops.
- **treasuryMSCA gas** — treasury MSCA needs USDC for Arc native gas. Assume paymaster sponsors agent operator calls but **treasury-originated transfers may not be sponsored**. Mitigation: pre-fund treasury MSCA with a gas float, monitor in `/api/health`. Document in deploy checklist.
- **settleBooking signer** — confirmed in contract v1.1: `settleBooking` is operator-only. Operator key must be rotated off treasury per Track A before this ships to prod.
- **Order hash computation** — `duffelOrderHash = keccak256(canonicalJSON(duffelOrder))`. We need to fix the canonicalization rule (JCS / RFC 8785) so the hash is reproducible for dispute/audit. Document in `packages/sendero-duffel/src/canonical.ts`.

## Rollout

Single PR. Merge to `feat/phase-11-invoicing` branch. Deploy to preview, run smoke test, promote to prod once:

- Track A1 (escrow v1.1 env bump) is done
- Track A4 (operator key rotation) is done — settleBooking is operator-only, can't risk treasury key compromise
- Duffel dashboard webhook endpoint configured + secret pasted into Vercel env
