# Phase-11b — Invoicing + Bills

**Date:** 2026-04-20
**Branch:** feat/phase-11-invoicing
**Baseline:** phase-11a complete (52 commits past main, all 9 epics verified on-chain)
**Prereq for:** phase-11c (buyer UI consumes Invoice + Tenant billing fields)
**Source material:** `/Users/criptopoeta/coding-dojo/desk-v1/packages/invoice` — full React-PDF + HTML + OG template stack

## Problem

Phase-11a settles escrow on-chain but issues no receipt. Phase-11b needs to produce two types of legal/audit-grade invoices:

1. **Booking invoice** — sent to the traveler/buyer after Duffel ticketing. Blended total (agency markup invisible). PDF attached to confirmation email + public-URL link.
2. **Platform bill** — monthly roll-up of tenant's MeterEvent usage (agent calls, search fees, etc.). NET-30 for agency tier, prepaid receipt for free/pro tiers. PDF emailed to billing contact.

Both reuse desk-v1's invoice template aesthetic (verbatim layout, Sendero brand colors, Sendero fonts), store on Vercel Blob, expose signed `/invoice/<token>` public viewer.

## Scope

### In

- `@sendero/invoicing` package — port desk-v1's `@bu/invoice` with Sendero fonts + colors
- Prisma schema: `Invoice`, `InvoiceLineItem`, `InvoicePayment`, `InvoiceSequence` + `Tenant` billing fields
- Booking invoice: new workflow step `generate_booking_invoice` fires after `settle_booking`
- Platform bill: new Vercel cron `/api/cron/generate-platform-bills` runs monthly
- Public invoice viewer `/invoice/[token]` (JWT-guarded, no auth)
- Signed PDF download `/api/invoices/[id]/pdf` (Clerk buyer-admin gated)
- Email delivery via existing `@sendero/notifications` (extended with `sendInvoice` + PDF attachment)
- Font assets: Inter + JetBrains Mono uploaded to Vercel Blob, stable URLs hardcoded in `fonts-server.ts`
- Tier-based payment semantics (NET-30 vs prepaid receipt)

### Out (deferred)

- EU VAT reverse-charge logic — schema ready, rendering stubbed (v1.1)
- CFDI XML generation — `cfdiRef` column ready, Mexico tax authority filing deferred
- US sales tax — skipped, no US tax compliance in v1
- `/app/billing/invoices` admin UI — phase-11c owns UI work
- Credit-note / refund-invoice generation — schema supports (`kind: 'credit_note'`) but flow not wired
- Multi-currency rendering beyond USD — schema has `currency` column, renderer hardcodes USD
- Tax report / payroll / payout variants — not relevant for travel
- Retry/dunning automation for overdue invoices — manual follow-up via `/app/billing` view

## Architecture

### Package shape — `packages/invoicing/`

Mirror desk-v1's `@bu/invoice` with Sendero-specific adaptations:

```
packages/invoicing/
├── package.json                     — deps: @react-pdf/renderer, qrcode, jose, date-fns, @vercel/blob
├── src/
│   ├── index.ts                     — re-exports + renderToBuffer
│   ├── token.ts                     — JWT sign/verify (jose); INVOICE_SIGNING_SECRET
│   ├── fonts-server.ts              — pdfFontPaths constants (Vercel Blob URLs) + local fallback
│   ├── assets/fonts/                — Inter + JetBrains Mono TTFs (committed)
│   ├── templates/
│   │   ├── types.ts                 — Template, TemplateProps (port from desk-v1)
│   │   ├── pdf/
│   │   │   ├── index.tsx            — Document root (port verbatim; swap fonts + colors)
│   │   │   ├── components/
│   │   │   │   ├── meta.tsx         — issuer/recipient block
│   │   │   │   ├── line-items.tsx   — table
│   │   │   │   ├── summary.tsx      — subtotal/tax/vat/total rows
│   │   │   │   ├── payment-details.tsx
│   │   │   │   ├── qr-code.tsx      — encodes public URL
│   │   │   │   ├── note.tsx
│   │   │   │   ├── description.tsx
│   │   │   │   └── editor-content.tsx  — Tiptap richtext renderer
│   │   │   └── format.tsx           — Prisma Invoice → <Document/> props
│   │   └── html/
│   │       ├── index.tsx            — email body + public viewer
│   │       ├── components/          — mirror PDF component names, rendered as HTML
│   │       └── format.tsx
│   └── utils/
│       ├── calculate.ts             — subtotal + tax + vat + discount (port verbatim)
│       ├── transform.ts             — Prisma Invoice + Tenant + lineItems → TemplateProps
│       ├── default.ts               — default Template (Sendero labels, en-US locale)
│       ├── public-url.ts            — buildPublicInvoiceUrl(token, baseUrl)
│       ├── logo.ts                  — tenant logo URL resolver (agency white-label)
│       └── number.ts                — micro-USD ↔ decimal formatting
└── __fixtures__/                    — sample Invoice + LineItem JSON for testing
```

**Sendero-specific changes from desk-v1 port:**

- **Colors** — `#fb542b` primary (matches /g page), `#0b0b0b` text, `#e9e3da` borders, `#555` muted, `#b34b2e` accent. Derived once in `templates/pdf/theme.ts`, used throughout components.
- **Fonts** — Inter (Regular/Medium/SemiBold/Bold/Italic) + JetBrains Mono (Regular/Bold) replace Poppins + Knicknack.
- **Logo** — agency tenants render `Tenant.brandLogoUrl`; direct Sendero invoices render built-in Sendero mark.
- **Default labels** — English only in v1; desk-v1's multi-locale Template type carried forward in schema for future enablement.
- **Drop out-of-scope exports** — remove `payroll-pdf`, `payout-invoice-pdf`, `tax-report-pdf`, `report`, `report-html` from the port. Those can come later if needed.

### Surfaces outside the package

- `apps/app/app/api/cron/generate-platform-bills/route.ts` — month-end cron; new `crons` entry in `apps/app/vercel.json`
- `apps/app/app/invoice/[token]/page.tsx` — public HTML viewer (Node runtime, no auth, token verified inline via `@sendero/invoicing/token`)
- `apps/app/app/api/invoices/[id]/pdf/route.ts` — signed download; Clerk org-role-gated to buyer-admin + tenant-match; streams from Vercel Blob
- `packages/tools/src/generate-booking-invoice.ts` — new MCP tool, invoked from workflow as the last step after `settle_booking`
- `packages/notifications/src/invoice-email.ts` — new template (HTML) + `sendInvoice(to, { pdfBuffer, publicUrl, ... })` that attaches PDF
- `scripts/deploy-invoice-fonts.ts` — one-time bootstrap: uploads `packages/invoicing/src/assets/fonts/*.ttf` to Vercel Blob, patches `fonts-server.ts` with resulting URLs, commits the change

## Schema

New enums:

```prisma
enum InvoiceKind {
  booking
  platform_bill
  credit_note
}

enum InvoiceStatus {
  draft
  issued
  sent
  viewed
  paid
  overdue
  void
}
```

New models:

```prisma
model Invoice {
  id                String        @id @default(cuid())
  tenantId          String
  kind              InvoiceKind
  status            InvoiceStatus @default(draft)

  /// INV-{YYYY}-{per-tenant sequence}. Immutable once issued.
  number            String
  issuedAt          DateTime?     @db.Timestamptz(6)
  dueAt             DateTime?     @db.Timestamptz(6)
  paidAt            DateTime?     @db.Timestamptz(6)

  /// Issuer — snapshotted from Tenant at issuance time (invoices are legal documents; source of truth is the invoice, not live tenant data).
  fromName          String
  fromAddress       Json?
  fromTaxId         String?
  fromLogoUrl       String?

  /// Recipient.
  toName            String
  toEmail           String
  toAddress         Json?
  toTaxId           String?

  currency          String        @default("USD") @db.Char(3)
  subtotalMicro     BigInt        @default(0)
  discountMicro     BigInt        @default(0)
  taxRate           Decimal       @default(0) @db.Decimal(7, 4)
  taxAmountMicro    BigInt        @default(0)
  vatRate           Decimal       @default(0) @db.Decimal(7, 4)
  vatAmountMicro    BigInt        @default(0)
  totalMicro        BigInt        @default(0)

  /// Template metadata (labels, locale, flags) — mirrors desk-v1 Template type.
  template          Json

  /// Booking-invoice only.
  bookingId         String?       @unique

  /// Platform-bill only.
  periodStart       DateTime?     @db.Timestamptz(6)
  periodEnd         DateTime?     @db.Timestamptz(6)

  /// Optional external tax-authority reference (CFDI UUID for Mexico, etc.).
  cfdiRef           String?

  /// Vercel Blob URL of the rendered PDF (set after first render).
  pdfBlobUrl        String?
  pdfRenderedAt     DateTime?     @db.Timestamptz(6)

  /// JWT for the public /invoice/<token> link. Signed, no expiry.
  publicToken       String        @unique

  /// Free-form error / metadata slot (emailError, renderError, etc.).
  metadata          Json?

  createdAt         DateTime      @default(now()) @db.Timestamptz(6)
  updatedAt         DateTime      @updatedAt       @db.Timestamptz(6)

  tenant            Tenant        @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  booking           Booking?      @relation(fields: [bookingId], references: [id], onDelete: SetNull)
  lineItems         InvoiceLineItem[]
  payments          InvoicePayment[]

  @@unique([tenantId, number])
  @@index([tenantId, status, createdAt])
  @@index([kind, periodStart])
  @@map("invoices")
}

model InvoiceLineItem {
  id             String   @id @default(cuid())
  invoiceId      String
  position       Int
  description    String
  quantity       Decimal  @default(1) @db.Decimal(12, 4)
  unitPriceMicro BigInt
  amountMicro    BigInt
  sourceKind     String?          // 'booking' | 'meter_event' | 'manual'
  sourceRef      String?

  invoice        Invoice  @relation(fields: [invoiceId], references: [id], onDelete: Cascade)

  @@index([invoiceId, position])
  @@map("invoice_line_items")
}

model InvoicePayment {
  id            String   @id @default(cuid())
  invoiceId     String
  paidAt        DateTime @default(now()) @db.Timestamptz(6)
  amountMicro   BigInt
  method        String   // 'nanopay_batch' | 'stripe' | 'manual' | 'escrow_settle'
  txHash        String?
  reference     String?

  invoice       Invoice  @relation(fields: [invoiceId], references: [id], onDelete: Cascade)

  @@index([invoiceId, paidAt])
  @@map("invoice_payments")
}

model InvoiceSequence {
  tenantId    String
  year        Int
  nextSeq     Int @default(1)

  @@id([tenantId, year])
  @@map("invoice_sequences")
}
```

Additions to existing `Tenant`:

```prisma
  /// Invoice contact + issuer metadata. Snapshot-source for each new Invoice's from* fields.
  legalName             String?
  billingContactEmail   String?
  billingAddress        Json?
  taxId                 String?
  brandLogoUrl          String?
  brandColors           Json?     // { primary, secondary, accent } — agency white-label
```

Addition to existing `MeterEvent`:

```prisma
  /// Invoice this event was rolled up into (platform_bill). NULL until billed.
  invoiceRef    String?
  @@index([tenantId, status, invoiceRef])   // supports cron "find unbilled events for tenant" query
```

Addition to existing `Booking`:

```prisma
  invoice       Invoice?
```

**Conventions:**

- Amounts in micro-USD (BigInt, 6-decimal precision) — matches existing `MeterEvent.priceMicroUsdc` + escrow convention. Renderer converts to decimal for display.
- `publicToken` is a JWT with `{ iid, tenantId }` claims signed by `INVOICE_SIGNING_SECRET`. Stateless verification in the public viewer — no DB lookup needed to reject tampered tokens. `@@unique` is defense-in-depth.
- `InvoiceSequence` guards per-tenant number uniqueness. Use `prisma.$transaction([findSeq, incrementSeq, createInvoice])` to avoid race.
- `InvoicePayment` is append-only. `Invoice.status` derived from presence of payment rows + `dueAt`:
  - `issued` + dueAt in future + no payment → `issued` / `sent` / `viewed`
  - `issued` + dueAt in past + no payment → `overdue`
  - any payment row summing to totalMicro → `paid`
  - status 'void' never auto-transitions (manual admin action only)
- `Booking.id @unique` on `Invoice.bookingId` prevents two booking invoices per booking.

## Fonts — deployed to Vercel Blob

**Committed at** `packages/invoicing/src/assets/fonts/`:

- Inter: Regular/400, Medium/500, SemiBold/600, Bold/700, Italic/400 (OFL license, safe to ship)
- JetBrains Mono: Regular/400, Bold/700 (OFL license)

**Bootstrap script** `scripts/deploy-invoice-fonts.ts`:

- Uses `@vercel/blob.put(path, buffer, { access: 'public', addRandomSuffix: false, allowOverwrite: true })`
- Target paths: `/fonts/invoice/inter-<weight>.ttf`, `/fonts/invoice/jetbrains-mono-<weight>.ttf`
- After upload: reads each returned URL, writes a patched `packages/invoicing/src/fonts-server.ts` with the constants, stages + commits the change
- Idempotent: re-running overwrites in-place (allowOverwrite), stable URLs (no random suffix)

**Runtime** — `packages/invoicing/src/fonts-server.ts`:

```typescript
const FONT_BASE = process.env.INVOICE_FONT_BASE_URL ?? 'https://<blob-host>/fonts/invoice';

export const pdfFontPaths = {
  inter: {
    regular:  `${FONT_BASE}/inter-regular.ttf`,
    medium:   `${FONT_BASE}/inter-medium.ttf`,
    semibold: `${FONT_BASE}/inter-semibold.ttf`,
    bold:     `${FONT_BASE}/inter-bold.ttf`,
    italic:   `${FONT_BASE}/inter-italic.ttf`,
  },
  jetbrainsMono: {
    regular: `${FONT_BASE}/jetbrains-mono-regular.ttf`,
    bold:    `${FONT_BASE}/jetbrains-mono-bold.ttf`,
  },
} as const;
```

Registered once per PDF render:

```typescript
Font.register({ family: 'Inter', src: pdfFontPaths.inter.regular });
Font.register({ family: 'Inter', src: pdfFontPaths.inter.bold, fontWeight: 'bold' });
// ... etc
```

Local-dev fallback (no Blob): `fonts-server.ts` detects absence of the deployed URL envar and points to local `import.meta.dir/assets/fonts/*.ttf` paths (React-PDF accepts both URLs and local file paths in Node runtime).

## PDF storage — Vercel Blob

- First render of an Invoice's PDF uploads to `/invoices/<tenantId>/<invoiceId>.pdf` (public read, URL stored in `Invoice.pdfBlobUrl`)
- Subsequent requests return the stored URL (no re-render)
- Regeneration triggered explicitly — `POST /api/invoices/[id]/regenerate` admin route (out-of-scope for phase-11b, documented as operational lever)
- Public invoice viewer `/invoice/<token>` validates JWT, reads Invoice row, redirects to `pdfBlobUrl` for PDF download OR renders HTML template inline (user's choice — defaults to HTML inline render, PDF link separate button)

## Data flow — booking invoice

```
guestPrefundWorkflow / bookFlightWorkflow (after phase-11a resume):
  ... commit → await_duffel_ticket → duffel_gate.then → confirm_duffel → settle_booking
  → NEW: generate_booking_invoice (tool)

generate_booking_invoice handler:
  1. Load Booking + Trip + Tenant via Prisma
  2. Derive issuer snapshot from Tenant.legalName, taxId, billingAddress, brandLogoUrl
     → Agency tenant: agency branding. Direct Sendero buyer: Sendero defaults.
  3. Derive recipient from Booking.traveler (or Trip.buyerContact for corporate)
  4. Build one InvoiceLineItem: "<Trip summary> · <carrier PNR>" with blended total
     (future: itemize flight-fare / taxes / service fee from Duffel's order breakdown)
  5. Prisma transaction:
       - increment InvoiceSequence { tenantId, year: now.year }
       - create Invoice with number = INV-YYYY-<seq>
       - create InvoiceLineItem(s)
       - create InvoicePayment { method: 'escrow_settle', txHash: settleTx, amount: totalMicro }
       - set status = 'paid' (already settled on-chain)
  6. Render PDF via renderToBuffer(<InvoicePdf {...props} />)
  7. put to Vercel Blob → store pdfBlobUrl + pdfRenderedAt
  8. Sign publicToken via jose: { iid: invoice.id, tenantId }
  9. Email traveler via @sendero/notifications.sendInvoice({
       to: toEmail,
       invoice,
       pdfBuffer,
       publicUrl: buildPublicInvoiceUrl(publicToken)
     })
 10. Return { invoiceId, number, publicUrl, pdfBlobUrl }
```

## Data flow — platform bill

```
Vercel cron: 1st of month 02:00 UTC → GET /api/cron/generate-platform-bills
  Auth: Bearer ${CRON_SECRET}

For each Tenant with unbilled MeterEvents in prior month:
  1. Compute period: [startOfMonth(now - 1mo), startOfMonth(now)]
  2. Load MeterEvents where tenantId, status='paid', invoiceRef=NULL, at in period
  3. Group by toolName → { 'search_flights': 340, 'chat': 89, ... } (count + sum priceMicroUsdc)
  4. Tier-based logic (existing `BillingTier` enum: free | pro | business | enterprise):
       - NET-30 tier (Tenant.billingTier = 'business' or 'enterprise'):
           dueAt = issuedAt + 30 days
           status = 'issued'
           (buyer will pay via Stripe / bank / nanopay outside this flow)
       - Prepaid tier (free / pro, already settled via hourly nanopay batches):
           Look up NanopayBatch(es) covering these MeterEvents via MeterEvent.settlementRef
           Create InvoicePayment per batch: { method: 'nanopay_batch', txHash, amount }
           status = 'paid' (receipt, not bill)
  5. Render PDF + Blob upload + publicToken
  6. stamp MeterEvents: UPDATE meter_events SET invoiceRef = invoice.id WHERE id IN (...)
  7. Email Tenant.billingContactEmail via sendInvoice(...)
     Subject: "Sendero · Platform invoice #INV-2026-042 · $X.XX <due|paid>"
  8. Push results; one tenant's failure doesn't block the rest.
```

`vercel.json` addition at `apps/app/vercel.json`:

```json
  "crons": [
    { "path": "/api/cron/generate-platform-bills", "schedule": "0 2 1 * *" }
  ]
```

Existing `/api/cron/settle-nanopay-batches` schedule also added if not already present.

## Email delivery

`packages/notifications/src/invoice-email.ts` (new):

- `renderInvoiceEmail({ invoice, publicUrl })` — returns `{ subject, html, text }` using `@sendero/invoicing/templates/html`
- `sendInvoice(to, { invoice, pdfBuffer, publicUrl })` — Resend `emails.send` with `attachments: [{ filename: '<number>.pdf', content: pdfBuffer }]`, body includes public URL as a fallback link
- Fails-soft: on Resend error, returns `{ ok: false, error }`; caller stores in `Invoice.metadata.emailError`; doesn't crash the workflow / cron

## Error handling

- **Font fetch failure** — `Font.register` swallows individual font errors (pattern from desk-v1); render proceeds with system fallback. Logged at WARN.
- **PDF render failure** — entire `renderToBuffer` throws → caught in caller, `Invoice.status = 'draft'`, `metadata.renderError = <msg>`; surfaced in admin list. Retryable via `bun run scripts/retry-invoice-pdf.ts <id>`.
- **Vercel Blob upload failure** — transient: retried once inline; on second failure marks `Invoice.metadata.blobError`, keeps invoice in `issued` status with `pdfBlobUrl = NULL`. Public viewer falls through to inline HTML render (no PDF download link rendered).
- **Email send failure** — `InvoicePayment` already written; Invoice status stays `issued` (or `paid` for receipts); `metadata.emailError` stored. Admin re-sends via UI/CLI.
- **Duplicate generation** — enforced by `@@unique([tenantId, number])` + `Booking.id @unique`. Cron is idempotent-per-tenant-per-period via `where invoiceRef IS NULL` filter.
- **Invalid/expired public token** at `/invoice/<token>` → 404 (not 401, to avoid leaking invoice existence).
- **Tenant with no billingContactEmail** — platform-bill cron skips and logs WARN; surfaces in admin view as "config required".
- **Stripe / NET-30 overdue** — no automation in v1; manual dunning via `/app/billing` (phase-11c).

## Test plan

### Unit (Bun test)

- `packages/invoicing/src/utils/calculate.test.ts` — port desk-v1's tests; subtotal / discount / tax / vat math including rounding edge cases
- `packages/invoicing/src/utils/number.test.ts` — micro-USD ↔ decimal, locale formatting
- `packages/invoicing/src/token.test.ts` — JWT sign + verify; tampered payload rejected; missing secret throws
- `packages/invoicing/src/utils/transform.test.ts` — Prisma Invoice → TemplateProps shape + label resolution
- `packages/invoicing/src/utils/public-url.test.ts` — URL building, base URL normalization

### Integration (Bun test against live dev server + Neon)

- `scripts/smoke-invoice-booking.ts` — seeds Tenant + Trip + Booking with settlement, fires `generate_booking_invoice` tool, asserts:
  - Invoice row exists with status=paid
  - InvoiceLineItem count correct
  - InvoicePayment row matches settleTx
  - pdfBlobUrl resolves with content-type application/pdf
  - `/invoice/<token>` returns 200 with rendered HTML
- `scripts/smoke-invoice-platform-bill.ts` — seeds Tenant + 50 MeterEvents, hits cron, asserts:
  - One Invoice created per tenant with correct total
  - All MeterEvents stamped with invoiceRef
  - Agency tier: status=issued, dueAt=+30d. Free tier: status=paid, InvoicePayment exists
  - Email result captured (ok:true or metadata.emailError)
- `scripts/smoke-invoice-pdf-render.ts` — renders `__fixtures__/sample-invoice.json` → Buffer → asserts PDF magic bytes + page count

### Manual verification gate

- Render a booking invoice for a real Arc testnet booking (using Epic 9b's smoke-prepared Booking)
- Open `/invoice/<token>` in browser, inspect layout matches desk-v1 aesthetic with Sendero colors
- Download PDF, verify fonts embedded, QR code scans to public URL, QR URL round-trips

## Files

### New

- `packages/invoicing/` — entire package (see Architecture)
- `packages/database/prisma/migrations/<ts>_phase_11b_invoicing/migration.sql`
- `apps/app/app/api/cron/generate-platform-bills/route.ts`
- `apps/app/app/invoice/[token]/page.tsx`
- `apps/app/app/api/invoices/[id]/pdf/route.ts`
- `packages/tools/src/generate-booking-invoice.ts`
- `packages/notifications/src/invoice-email.ts`
- `scripts/deploy-invoice-fonts.ts`
- `scripts/smoke-invoice-booking.ts`
- `scripts/smoke-invoice-platform-bill.ts`
- `scripts/smoke-invoice-pdf-render.ts`

### Modified

- `packages/database/prisma/schema.prisma` — new models + Tenant / MeterEvent / Booking additions
- `packages/tools/src/index.ts` — register `generate_booking_invoice`
- `packages/workflows/src/catalog.ts` — append `generate_booking_invoice` step to `bookFlightWorkflow` + `guestPrefundWorkflow` after `settle_escrow`
- `packages/notifications/src/index.ts` — export `sendInvoice`
- `packages/env/src/validate.ts` — require `INVOICE_SIGNING_SECRET`, `BLOB_READ_WRITE_TOKEN`
- `apps/app/vercel.json` — `crons: [{ path: '/api/cron/generate-platform-bills', schedule: '0 2 1 * *' }]`
- `apps/app/app/api/health/route.ts` — surface new env booleans
- `package.json` — add `deploy:fonts`, `smoke:invoice-*` scripts

## Env additions

- `INVOICE_SIGNING_SECRET` — random 256-bit secret for JWT signing of public tokens. Generate once: `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"`.
- `BLOB_READ_WRITE_TOKEN` — auto-provisioned by Vercel Marketplace Blob integration on `arc-web`.
- `INVOICE_FONT_BASE_URL` (optional) — override the default Vercel Blob base URL for fonts (useful for local-dev with a mirror).

## Rollout

Single PR extending `feat/phase-11-invoicing`. Merge sequencing:

1. Land schema migration first (separate commit — reversible)
2. Land `@sendero/invoicing` package (buildable in isolation; tests green)
3. Bootstrap fonts: run `bun run deploy:fonts` once, commit the patched `fonts-server.ts`
4. Land email + tool + workflow edits
5. Land cron + public viewer + PDF download route
6. Land smoke tests; run against Neon + live dev server
7. Deploy to preview, validate with Epic 9's seed data; promote to prod alongside phase-11a

## Risks / open questions

- **Duffel hold tool output shape** — `Booking.totalUsd` is decimal with 2 places; we derive micro-USD by `× 1_000_000`. Ensure rounding matches existing `Booking.totalUsd` Decimal(12,2) without drift. Covered by `calculate.test.ts`.
- **React-PDF Node runtime memory** — large invoices (e.g. platform bill with 10k meter events grouped into 50 line items) render OK; very large ones might OOM on Vercel's 1024MB function limit. Mitigation: cap `lineItems.length` at 200 per invoice (group remainder under "Other · N calls"). Deferred unless observed.
- **JWT signing key rotation** — single secret; rotating it invalidates all existing public tokens. Multi-secret support (old + new, verify against either) deferred to v1.1 when rotation is actually needed.
- **Tenant multi-currency** — schema ready, renderer hardcodes USD. If agency operates in MXN, EUR: manual workaround (pre-convert to USD before issuing) until v1.1.
- **Invoice numbering across deploys** — `InvoiceSequence` is per-tenant-per-year; atomic increment inside a Prisma `$transaction` prevents duplicates. Still, catastrophic rollback (restore DB from pre-invoice backup) could cause sequence reuse. Out of scope — standard DB backup discipline applies.
- **PDF + email rate limits** — Resend has send limits; cron processes tenants sequentially, which caps burst. At scale (1000+ tenants), parallelize with a concurrency limit and respect Resend's quota.

## Decision log

- 2026-04-20 — user confirmed: port `@bu/invoice` template **verbatim** layout, swap colors + fonts only
- 2026-04-20 — user confirmed: agency markup **invisible** on booking invoice (blended total, answer A at scoping)
- 2026-04-20 — user confirmed: EU VAT **post-launch** — schema ready, logic not implemented
- 2026-04-20 — user confirmed: Mexico CFDI — store **cfdiRef only**, no XML generation or tax authority filing
- 2026-04-20 — user confirmed: Vercel Blob for PDF + font storage
- 2026-04-20 — user confirmed: Vercel cron for month-end (not Trigger.dev)
- 2026-04-20 — user confirmed: buyer-admin gated `/app/billing/invoices` page (phase-11c owns)
- 2026-04-20 — user confirmed: generate PDF on download + email; email carries attachment + public-URL link
- 2026-04-20 — user confirmed: Inter + JetBrains Mono, deployed to Vercel Blob for stable runtime URLs
