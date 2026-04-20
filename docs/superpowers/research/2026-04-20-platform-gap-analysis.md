# Sendero × Arc — platform gap analysis

**Date:** 2026-04-20  
**Baseline commit:** 52418ab (phase-10: AI Gateway fallbacks + guest invite email+OTP)  
**Branch:** feat/phase-11-invoicing (no commits)  
**Method:** 3 parallel Explore agents — corporate buyer path, traveler/guest path, agency + ops path.

## Executive summary

The system is deeper than the commit history implies: prefund → claim → search → book → commit is wired end-to-end in code (tools, escrow v1.1, email, passkey, paymaster). **Three structural gaps prevent a real production cycle**, and phase-11 as scoped ("invoicing") can't ship without them:

1. **Settlement is synthetic** — `batch.ts` still returns fake tx hashes (Phase 4 TODO). No real USDC moves. An invoice reading `paid=true` would be a lie.
2. **Booking lifecycle is half-closed** — `confirm_duffel` + `settle_booking` tools are referenced in `packages/workflows/src/catalog.ts` but the files don't exist. Commit succeeds on-chain, but the escrow → vendor fan-out never runs. Duffel failure / refund path is also unwritten.
3. **No buyer-facing surface for prefunding** — the corporate UI page that calls `POST /api/guest/invite` doesn't exist. Today the only way to fund a trip is MCP / Slack / curl. Demo-critical.

Phase-11 (invoicing) should absorb items 1 + 2 + billing-contact fields, or it will fail review.

---

## Severity-tagged inventory

### 🔴 Blockers for phase-11 ship

| # | Gap | Location | Fix |
|---|---|---|---|
| B1 | Batch settlement uses synthetic tx hashes — no real USDC transfer | `apps/app/app/api/cron/settle-nanopay-batches/route.ts:134`, `packages/billing/src/batch.ts` | Wire `packages/sendero-nanopayments` real transfer via treasury MSCA |
| B2 | `confirm_duffel` tool missing | referenced in `packages/workflows/src/catalog.ts:55-70`, file absent in `packages/tools/src/` | Implement tool: accept duffelOrderHash → encode `confirmDuffel` onchain call |
| B3 | `settle_booking` tool missing | same | Implement: reads booking state, encodes `settleBooking`, triggers vendor payout + commission fan-out |
| B4 | Duffel refund/cancel path absent | no file covers failed/cancelled order | Add `cancel_booking` tool + escrow release; workflow branch for Duffel error |
| B5 | No Invoice / InvoiceLineItem Prisma models | `packages/database/prisma/schema.prisma` | Port BUFI schema (confirmed in Supabase project `cmrpdkvogpxyneidmtnu`: `invoices`, `invoice_templates`, `invoice_products`, `invoice_customer_comments`, `invoice_team_comments`, `invoices_recurring`, `bills`) |
| B6 | No PDF generator, no QR lib, no Vercel Blob, no Vercel cron in vercel.json | whole repo | Add `@react-pdf/renderer` + `qrcode` + `@vercel/blob` + crons block |
| B7 | `Tenant` has no `billingContactEmail` / `billingAddress` / `taxId` | schema.prisma | Add columns; update agency + corporate onboarding |
| B8 | No buyer UI to prefund a trip | missing page `apps/app/app/trips/new` (or similar) | Form → POST `/api/guest/invite`; list view of active trips |

### 🟠 Important (reshape phase-11 or next phase)

| # | Gap | Location | Notes |
|---|---|---|---|
| I1 | Agency reseller markup — no tenant-level override | `packages/commission`, `Supplier.commissionBps` only | Add `Tenant.markupBps` or `AgencyMarkup` model, apply in `commit_booking` pricing |
| I2 | No end-client records for agency ("on behalf of") | schema.prisma | Add `Client` model or `Trip.endClientId` + beneficiary fields |
| I3 | No white-label branding config (logo, colors, from-address, domain) | `Tenant.metadata` has only `{kind, whatsappPhoneNumberId}` | Add `TenantBranding` model or first-class columns; settings UI |
| I4 | Admin has no RBAC | `apps/app/app/admin/*` | Clerk org role gate (`admin` / `finance`); test on prod before invoice data is exposed |
| I5 | No tenant-mgmt console for ops (create, suspend, change tier) | missing | Internal route gated by hard-coded Sendero org id |
| I6 | Soft-cap alert webhook never exercised | `packages/billing/caps.ts` | Wire default webhook to Slack ops channel |
| I7 | WhatsApp inbound → agent dispatch is TODO | `apps/app/app/api/webhooks/whatsapp/route.ts:10,172` | Blocker for WhatsApp traveler chat; phase-3 leftover |
| I8 | Slack inbound → agent dispatch is TODO | `apps/app/app/api/webhooks/slack/events/route.ts:93` | Same |
| I9 | Chat UI doesn't auto-load claimed trip context after /g redirect | `apps/app/components/chat-col.tsx` | Pass tripId via query, hydrate `store.ts` |
| I10 | Itinerary delivery missing — no PDF, no .ics, no post-booking email | `packages/notifications` covers only invite | Add `sendItinerary()` template + .ics generation; reuse the phase-11 PDF pipeline |
| I11 | Post-settle receipt missing | none | Fold into phase-11: "booking invoice" = PDF-emailed itinerary with escrow + commission disclosure |
| I12 | Duplicate-claim UX guard missing; relies on on-chain revert | `apps/app/app/g/page.tsx` | Pre-check via `/api/guest/claimed` GET |
| I13 | No cross-device passkey recovery (localStorage-only) | `packages/sendero-circle/src/modular-wallets.ts` | Post-hackathon |
| I14 | Guest invite NOT dispatched to WhatsApp / Slack DM (only email) | `prefundTripTool` returns link, no send routing for non-email channels | Add channel selector in tool + dispatcher |

### 🟡 Polish

- No stuck-batch detection UI / manual retry action
- Ponder indexer + subgraph exist but feed no dashboards and no alerts
- No Langfuse LLM trace wire-up (PostHog only)
- No incident playbooks (escrow pause, RPC outage, Duffel outage, LLM outage)
- No pre-expiry email reminder for unclaimed invites
- No wrong-OTP attempt counter / cool-down
- No policy audit-log UI (version tracking shipped, viewer missing)

---

## Operational fixes (track A)

These need no spec — just execute:

- **A1:** Bump `ARC_ESCROW_ADDRESS` env to v1.1 deploy `0x42B447Fe874CbC5cCD18a8Ab4Ffa2E297eb7F873` across local, preview, prod. Verify via `env:validate`.
- **A2:** Verify WhatsApp/Slack invite channels pass `guestEmail` to `prefund_trip` so OTP email always fires. If not, thread it through adapter.
- **A3:** Confirm ponder indexer is pointed at v1.1 `address` + `startBlock 38182687` in `apps/ponder/ponder.config.ts` and `subgraph/subgraph.yaml`.
- **A4:** Rotate operator key off treasury — generate dedicated operator EOA, run `SetOperator` forge script, update backend env.
- **A5:** Transfer escrow ownership to a Safe — `TransferOwnership` script is ready; pick Safe address.

---

## Reshaped phase-11 scope proposal

Phase-11 was scoped as "invoicing". Real scope to ship a production billing cycle:

**Phase-11a — "Close the loop"** (blockers B1-B4)
- Real nanopay transfer
- `confirm_duffel` + `settle_booking` + `cancel_booking` tools
- Duffel-failure escrow release workflow branch

**Phase-11b — "Invoicing + bills"** (blockers B5-B7, important I10-I11)
- Port BUFI `invoice_templates` + `invoices` schema to Prisma
- `@sendero/invoicing` package: HTML template, `@react-pdf/renderer`, QR code for verification, Vercel Blob storage
- Two invoice kinds: **booking invoice** (to buyer/end-client, blended total — answer A) and **platform bill** (to tenant, MeterEvent aggregation)
- Emails via existing `@sendero/notifications` pattern
- Vercel cron at month-end for platform bills
- Page: `/app/billing/invoices` gated by Clerk org role

**Phase-11c — "Buyer UI"** (blocker B8)
- `/app/trips/new` prefund form calling `POST /api/guest/invite`
- `/app/trips` list + detail (active, claimed, settled, cancelled)
- Tenant settings → billing contact + tax id + optional branding (agency tier only)

Agency-specific (I1-I3) can slip to phase-12 if time pressure — booking invoice hides markup (answer A) so the end-client invoice works without agency markup config; Sendero's platform bill to agency works as-is.

---

## What I recommend

1. Land **A1-A3** today (30 min).
2. Write the **phase-11 spec** folding in blockers B1-B8 + I10-I11.
3. Agency flow (I1-I3) = separate phase-12 spec later.

Open question before spec: **do phase-11a + 11b + 11c go in one PR or three?** I'd do three smaller PRs merged in order — 11a first so settlement is real before invoicing reads the state.
