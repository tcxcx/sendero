# Phase-11b — Invoicing + Bills Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship booking invoices (fired from workflow after settle_booking) and platform bills (month-end Vercel cron) with PDF/HTML rendering, Vercel Blob storage, JWT-signed public viewer, email delivery with PDF attachment.

**Architecture:** Port desk-v1's `@bu/invoice` (React-PDF + HTML templates + utilities) into new `@sendero/invoicing` with Sendero brand colors + Inter/JetBrains Mono fonts deployed to Vercel Blob. New Prisma models (`Invoice`, `InvoiceLineItem`, `InvoicePayment`, `InvoiceSequence`) + Tenant/MeterEvent/Booking additions. Two flows: booking invoice (workflow step after `settle_booking`) and platform bill (Vercel cron grouping MeterEvents). Public viewer at `/invoice/[token]` via JWT; authenticated download at `/api/invoices/[id]/pdf`.

**Tech Stack:** Bun 1.3.10, `@react-pdf/renderer`, `qrcode`, `jose` (JWT), `date-fns`, `@vercel/blob`, Prisma, zod, existing `@sendero/notifications` (Resend), Next.js App Router (Node runtime).

**Baseline:** Current branch `feat/phase-11-invoicing` past phase-11a (52 commits past main plus all recent phase-11b/c1/c2 specs). Spec file: `docs/superpowers/specs/2026-04-20-phase-11b-invoicing-design.md`.

**Conventions observed:**
- Tools return encoded calls, never submit on-chain (caller owns submission)
- Amounts stored as BigInt micro-USD (6-decimal precision)
- Commits use conventional prefix + `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>` trailer
- Pre-commit hook may fail on pre-existing `@sendero/docs` fumadocs errors — use `--no-verify` per plan authorization
- Test runner: `bun test`

---

## File structure

**New package — `packages/invoicing/`:**

- `package.json` — deps: `@react-pdf/renderer`, `qrcode`, `jose`, `date-fns`, `@vercel/blob`, `zod`
- `src/index.ts` — re-exports + `renderToBuffer`
- `src/token.ts` — JWT sign/verify
- `src/fonts-server.ts` — `pdfFontPaths` constants
- `src/assets/fonts/*.ttf` — Inter + JetBrains Mono committed TTFs
- `src/templates/types.ts` — Template + TemplateProps types
- `src/templates/pdf/index.tsx` — Document root (React-PDF)
- `src/templates/pdf/components/{meta,line-items,summary,payment-details,qr-code,note,description,editor-content}.tsx`
- `src/templates/pdf/theme.ts` — Sendero color tokens for PDF
- `src/templates/html/index.tsx` — HTML template (email + viewer)
- `src/templates/html/components/*.tsx`
- `src/templates/format.tsx` — Prisma `Invoice` → `TemplateProps`
- `src/utils/{calculate,number,transform,default,public-url,logo}.ts`
- `src/utils/calculate.test.ts`, `number.test.ts`, `token.test.ts`
- `__fixtures__/sample-invoice.json`

**Schema:**
- `packages/database/prisma/schema.prisma` — new models + additions

**App routes:**
- `apps/app/app/api/cron/generate-platform-bills/route.ts`
- `apps/app/app/invoice/[token]/page.tsx`
- `apps/app/app/api/invoices/[id]/pdf/route.ts`

**Tool + workflow:**
- `packages/tools/src/generate-booking-invoice.ts`
- `packages/tools/src/index.ts` — register
- `packages/workflows/src/catalog.ts` — append step to `bookFlightWorkflow` + `guestPrefundWorkflow`

**Notifications:**
- `packages/notifications/src/invoice-email.ts` — new
- `packages/notifications/src/index.ts` — export `sendInvoice`

**Env + health:**
- `packages/env/src/validate.ts` — require `INVOICE_SIGNING_SECRET`, `BLOB_READ_WRITE_TOKEN`
- `apps/app/app/api/health/route.ts` — surface new booleans
- `apps/app/vercel.json` — add `crons` entry

**Scripts:**
- `scripts/deploy-invoice-fonts.ts`
- `scripts/smoke-invoice-booking.ts`
- `scripts/smoke-invoice-platform-bill.ts`
- `scripts/smoke-invoice-pdf-render.ts`
- `package.json` — scripts: `deploy:fonts`, `smoke:invoice-booking`, `smoke:invoice-platform-bill`, `smoke:invoice-pdf-render`

---

## Sequencing

- **Epic 1** (Tasks 1-2) — schema + migration
- **Epic 2** (Tasks 3-7) — `@sendero/invoicing` package scaffolding + utilities + tests
- **Epic 3** (Tasks 8-11) — fonts: commit TTFs, deploy script, `fonts-server.ts`
- **Epic 4** (Tasks 12-17) — PDF template port
- **Epic 5** (Tasks 18-20) — HTML template port
- **Epic 6** (Tasks 21-22) — Email delivery (`sendInvoice` + Resend attachment)
- **Epic 7** (Tasks 23-25) — API routes: PDF download, public viewer
- **Epic 8** (Tasks 26-28) — `generate_booking_invoice` tool + workflow catalog edits
- **Epic 9** (Tasks 29-30) — Platform bill cron + vercel.json crons
- **Epic 10** (Tasks 31-32) — Env + health
- **Epic 11** (Tasks 33-35) — Smoke tests

---

## Epic 1 — Schema + migration

### Task 1: Add Prisma models + Tenant/MeterEvent/Booking additions

**Files:**
- Modify: `packages/database/prisma/schema.prisma`

- [ ] **Step 1: Add `InvoiceKind` + `InvoiceStatus` enums at the top of the schema near other enums**

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

- [ ] **Step 2: Add `Invoice` model before `model NanopayBatch`**

```prisma
model Invoice {
  id                String        @id @default(cuid())
  tenantId          String
  kind              InvoiceKind
  status            InvoiceStatus @default(draft)

  number            String
  issuedAt          DateTime?     @db.Timestamptz(6)
  dueAt             DateTime?     @db.Timestamptz(6)
  paidAt            DateTime?     @db.Timestamptz(6)

  fromName          String
  fromAddress       Json?
  fromTaxId         String?
  fromLogoUrl       String?

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

  template          Json

  bookingId         String?       @unique

  periodStart       DateTime?     @db.Timestamptz(6)
  periodEnd         DateTime?     @db.Timestamptz(6)

  cfdiRef           String?

  pdfBlobUrl        String?
  pdfRenderedAt     DateTime?     @db.Timestamptz(6)

  publicToken       String        @unique

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
```

- [ ] **Step 3: Add `InvoiceLineItem`, `InvoicePayment`, `InvoiceSequence` models**

```prisma
model InvoiceLineItem {
  id             String   @id @default(cuid())
  invoiceId      String
  position       Int
  description    String
  quantity       Decimal  @default(1) @db.Decimal(12, 4)
  unitPriceMicro BigInt
  amountMicro    BigInt
  sourceKind     String?
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
  method        String
  txHash        String?
  reference     String?

  invoice       Invoice  @relation(fields: [invoiceId], references: [id], onDelete: Cascade)

  @@index([invoiceId, paidAt])
  @@map("invoice_payments")
}

model InvoiceSequence {
  tenantId    String
  year        Int
  nextSeq     Int      @default(1)

  @@id([tenantId, year])
  @@map("invoice_sequences")
}
```

- [ ] **Step 4: Add fields to `Tenant` model (inside the existing `model Tenant { ... }`)**

Insert these fields near the other scalar columns:

```prisma
  legalName             String?
  billingContactEmail   String?
  billingAddress        Json?
  taxId                 String?
  brandLogoUrl          String?
  brandColors           Json?

  invoices              Invoice[]
```

- [ ] **Step 5: Add `invoiceRef` to `MeterEvent` (inside existing model)**

```prisma
  invoiceRef    String?
  @@index([tenantId, status, invoiceRef])
```

- [ ] **Step 6: Add `invoice` relation to `Booking` (inside existing model)**

```prisma
  invoice       Invoice?
```

- [ ] **Step 7: Format**

```bash
cd packages/database && bunx prisma format && cd ../..
```

Expected: reformatted in place, no errors.

- [ ] **Step 8: Commit**

```bash
git add packages/database/prisma/schema.prisma
git commit --no-verify -m "$(cat <<'EOF'
feat(phase-11b): schema — Invoice/LineItem/Payment/Sequence + Tenant billing

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 2: Generate + apply migration

- [ ] **Step 1: Generate delta migration**

```bash
cd packages/database
TS=$(date -u +%Y%m%d%H%M%S)
MIG_DIR="prisma/migrations/${TS}_phase_11b_invoicing"
mkdir -p "$MIG_DIR"
bunx prisma migrate diff \
  --from-schema-datasource prisma/schema.prisma \
  --to-schema-datamodel prisma/schema.prisma \
  --script > "$MIG_DIR/migration.sql"
cat "$MIG_DIR/migration.sql"
cd ../..
```

Expected: SQL containing `CREATE TYPE "InvoiceKind"`, `CREATE TYPE "InvoiceStatus"`, `CREATE TABLE "invoices"`, `CREATE TABLE "invoice_line_items"`, `CREATE TABLE "invoice_payments"`, `CREATE TABLE "invoice_sequences"`, and `ALTER TABLE "tenants" ADD COLUMN`s, `ALTER TABLE "meter_events" ADD COLUMN "invoiceRef"`, plus unique + indexes.

- [ ] **Step 2: Apply**

```bash
cd packages/database
bunx prisma migrate deploy
bun run db:generate
cd ../..
```

Expected: "Applied migration…" and "Generated Prisma Client".

- [ ] **Step 3: Typecheck**

```bash
bun run typecheck 2>&1 | tail -10
```

Expected: zero new errors.

- [ ] **Step 4: Commit**

```bash
git add packages/database/prisma/migrations
git commit --no-verify -m "feat(phase-11b): migration — invoicing tables + tenant billing fields

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Epic 2 — `@sendero/invoicing` package scaffolding + utilities

### Task 3: Package scaffolding

**Files:**
- Create: `packages/invoicing/package.json`
- Create: `packages/invoicing/tsconfig.json`
- Create: `packages/invoicing/src/index.ts` (stub)

- [ ] **Step 1: Create `packages/invoicing/package.json`**

```json
{
  "name": "@sendero/invoicing",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "sideEffects": false,
  "main": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts",
    "./token": "./src/token.ts",
    "./fonts-server": "./src/fonts-server.ts",
    "./calculate": "./src/utils/calculate.ts",
    "./number": "./src/utils/number.ts",
    "./transform": "./src/utils/transform.ts",
    "./public-url": "./src/utils/public-url.ts",
    "./default": "./src/utils/default.ts",
    "./templates/types": "./src/templates/types.ts",
    "./templates/pdf": "./src/templates/pdf/index.tsx",
    "./templates/html": "./src/templates/html/index.tsx",
    "./templates/format": "./src/templates/format.tsx"
  },
  "dependencies": {
    "@react-pdf/renderer": "^4.3.0",
    "@vercel/blob": "^0.23.0",
    "date-fns": "^4.1.0",
    "jose": "^6.1.1",
    "qrcode": "^1.5.4",
    "zod": "^3.25.76"
  },
  "devDependencies": {
    "@types/qrcode": "^1.5.5"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "jsx": "react-jsx",
    "outDir": "./dist",
    "rootDir": "./src",
    "lib": ["ES2022", "DOM"]
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "**/*.test.ts", "**/*.test.tsx"]
}
```

- [ ] **Step 3: Create stub `src/index.ts`**

```typescript
export { renderToBuffer, renderToStream } from '@react-pdf/renderer';
```

- [ ] **Step 4: Install**

```bash
bun install 2>&1 | tail -5
```

Expected: installed successfully (fumadocs postinstall error is known + non-blocking).

- [ ] **Step 5: Commit**

```bash
git add packages/invoicing
git commit --no-verify -m "feat(phase-11b): @sendero/invoicing package scaffolding

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 4: `token.ts` — JWT sign/verify

**Files:**
- Create: `packages/invoicing/src/token.ts`
- Create: `packages/invoicing/src/token.test.ts`

- [ ] **Step 1: Write tests first**

```typescript
// packages/invoicing/src/token.test.ts
import { test, expect } from 'bun:test';
import { signInvoiceToken, verifyInvoiceToken } from './token';

const SECRET = 'test_secret_at_least_32_bytes_long_for_hs256';

test('signInvoiceToken + verifyInvoiceToken round-trip', async () => {
  const token = await signInvoiceToken({ iid: 'inv_123', tenantId: 't_abc' }, SECRET);
  const payload = await verifyInvoiceToken(token, SECRET);
  expect(payload.iid).toBe('inv_123');
  expect(payload.tenantId).toBe('t_abc');
});

test('verifyInvoiceToken rejects tampered token', async () => {
  const token = await signInvoiceToken({ iid: 'inv_123', tenantId: 't_abc' }, SECRET);
  const tampered = token.slice(0, -4) + 'XXXX';
  await expect(verifyInvoiceToken(tampered, SECRET)).rejects.toThrow();
});

test('verifyInvoiceToken rejects wrong secret', async () => {
  const token = await signInvoiceToken({ iid: 'inv_123', tenantId: 't_abc' }, SECRET);
  await expect(verifyInvoiceToken(token, 'different_secret_at_least_32_bytes_x')).rejects.toThrow();
});

test('signInvoiceToken throws when secret missing', async () => {
  // @ts-expect-error — intentional
  await expect(signInvoiceToken({ iid: 'x', tenantId: 'y' }, '')).rejects.toThrow();
});
```

- [ ] **Step 2: Implement `token.ts`**

```typescript
// packages/invoicing/src/token.ts
import { SignJWT, jwtVerify } from 'jose';

export interface InvoiceTokenPayload {
  iid: string;
  tenantId: string;
}

function secretKey(secret: string): Uint8Array {
  if (!secret || secret.length < 16) {
    throw new Error('invoice signing secret must be at least 16 characters');
  }
  return new TextEncoder().encode(secret);
}

export async function signInvoiceToken(
  payload: InvoiceTokenPayload,
  secret: string
): Promise<string> {
  return await new SignJWT(payload as unknown as Record<string, unknown>)
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuedAt()
    .sign(secretKey(secret));
}

export async function verifyInvoiceToken(
  token: string,
  secret: string
): Promise<InvoiceTokenPayload> {
  const { payload } = await jwtVerify(token, secretKey(secret), {
    algorithms: ['HS256'],
  });
  if (typeof payload.iid !== 'string' || typeof payload.tenantId !== 'string') {
    throw new Error('invalid invoice token payload');
  }
  return { iid: payload.iid, tenantId: payload.tenantId };
}
```

- [ ] **Step 3: Run tests**

```bash
cd packages/invoicing && bun test src/token.test.ts 2>&1 | tail -10 && cd ../..
```

Expected: 4 pass.

- [ ] **Step 4: Commit**

```bash
git add packages/invoicing/src/token.ts packages/invoicing/src/token.test.ts
git commit --no-verify -m "feat(phase-11b): invoice JWT token sign + verify

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 5: `utils/number.ts` — micro-USD ↔ decimal

**Files:**
- Create: `packages/invoicing/src/utils/number.ts`
- Create: `packages/invoicing/src/utils/number.test.ts`

- [ ] **Step 1: Tests**

```typescript
import { test, expect } from 'bun:test';
import { microToDecimal, decimalToMicro, formatMoney } from './number';

test('microToDecimal', () => {
  expect(microToDecimal(1_000_000n)).toBe('1.000000');
  expect(microToDecimal(0n)).toBe('0.000000');
  expect(microToDecimal(1n)).toBe('0.000001');
});

test('decimalToMicro', () => {
  expect(decimalToMicro('1.00')).toBe(1_000_000n);
  expect(decimalToMicro('0.000001')).toBe(1n);
  expect(decimalToMicro('1350.50')).toBe(1_350_500_000n);
});

test('formatMoney', () => {
  expect(formatMoney(1_350_500_000n, 'USD', 'en-US')).toBe('$1,350.50');
  expect(formatMoney(0n, 'USD', 'en-US')).toBe('$0.00');
  expect(formatMoney(100n, 'USD', 'en-US')).toBe('$0.00'); // rounds to 2dp
});

test('formatMoney respects locale', () => {
  const formatted = formatMoney(1_350_500_000n, 'EUR', 'de-DE');
  // Accept any valid EUR formatting for de-DE
  expect(formatted).toMatch(/1\.350,50/);
});
```

- [ ] **Step 2: Implement**

```typescript
// packages/invoicing/src/utils/number.ts
export function microToDecimal(micro: bigint): string {
  const whole = micro / 1_000_000n;
  const frac = micro % 1_000_000n;
  return `${whole}.${frac.toString().padStart(6, '0')}`;
}

export function decimalToMicro(dec: string): bigint {
  const [whole, frac = ''] = dec.split('.');
  const fracPadded = (frac + '000000').slice(0, 6);
  return BigInt(whole) * 1_000_000n + BigInt(fracPadded);
}

export function formatMoney(micro: bigint, currency: string, locale: string): string {
  const asNumber = Number(micro) / 1_000_000;
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
  }).format(asNumber);
}
```

- [ ] **Step 3: Run tests**

```bash
cd packages/invoicing && bun test src/utils/number.test.ts && cd ../..
```

Expected: 4 pass.

- [ ] **Step 4: Commit**

```bash
git add packages/invoicing/src/utils/number.ts packages/invoicing/src/utils/number.test.ts
git commit --no-verify -m "feat(phase-11b): utils/number — micro↔decimal + formatMoney

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 6: `utils/calculate.ts` — subtotal/tax/vat/discount

**Files:**
- Create: `packages/invoicing/src/utils/calculate.ts`
- Create: `packages/invoicing/src/utils/calculate.test.ts`

- [ ] **Step 1: Tests**

```typescript
import { test, expect } from 'bun:test';
import { calculateTotals } from './calculate';

test('single line item, no tax/vat/discount', () => {
  const out = calculateTotals({
    lineItems: [{ quantity: 1, unitPriceMicro: 1_000_000_000n }],
  });
  expect(out.subtotalMicro).toBe(1_000_000_000n);
  expect(out.totalMicro).toBe(1_000_000_000n);
});

test('multiple items', () => {
  const out = calculateTotals({
    lineItems: [
      { quantity: 2, unitPriceMicro: 500_000_000n },
      { quantity: 3, unitPriceMicro: 100_000_000n },
    ],
  });
  expect(out.subtotalMicro).toBe(1_300_000_000n);
  expect(out.totalMicro).toBe(1_300_000_000n);
});

test('with tax + vat + discount', () => {
  const out = calculateTotals({
    lineItems: [{ quantity: 1, unitPriceMicro: 1_000_000_000n }],
    taxRate: 0.08,
    vatRate: 0.2,
    discountMicro: 100_000_000n,
  });
  expect(out.subtotalMicro).toBe(1_000_000_000n);
  expect(out.discountMicro).toBe(100_000_000n);
  // taxable base after discount = 900_000_000
  expect(out.taxAmountMicro).toBe(72_000_000n);  // 900 * 0.08
  expect(out.vatAmountMicro).toBe(180_000_000n); // 900 * 0.2
  expect(out.totalMicro).toBe(1_152_000_000n);   // 900 + 72 + 180
});

test('fractional quantities', () => {
  const out = calculateTotals({
    lineItems: [{ quantity: 2.5, unitPriceMicro: 100_000_000n }],
  });
  expect(out.subtotalMicro).toBe(250_000_000n);
});
```

- [ ] **Step 2: Implement**

```typescript
// packages/invoicing/src/utils/calculate.ts

export interface LineItemInput {
  quantity: number;
  unitPriceMicro: bigint;
}

export interface CalculatedTotals {
  subtotalMicro: bigint;
  discountMicro: bigint;
  taxAmountMicro: bigint;
  vatAmountMicro: bigint;
  totalMicro: bigint;
}

/**
 * Amounts are stored in BigInt micro-USD. Rate inputs are floats (0.08 = 8%).
 * Rounding: truncate to nearest micro (floor). For presentation-grade rounding,
 * apply the rule at the display layer, not here.
 */
export function calculateTotals(args: {
  lineItems: LineItemInput[];
  taxRate?: number;
  vatRate?: number;
  discountMicro?: bigint;
}): CalculatedTotals {
  const taxRate = args.taxRate ?? 0;
  const vatRate = args.vatRate ?? 0;
  const discountMicro = args.discountMicro ?? 0n;

  const subtotalMicro = args.lineItems.reduce((acc, li) => {
    const q = BigInt(Math.round(li.quantity * 10_000)) * li.unitPriceMicro / 10_000n;
    return acc + q;
  }, 0n);

  const taxableBase = subtotalMicro - discountMicro;

  // bigint math on floats: convert float to bps (integer) to avoid precision issues
  const taxBps = BigInt(Math.round(taxRate * 10_000));
  const vatBps = BigInt(Math.round(vatRate * 10_000));

  const taxAmountMicro = taxableBase * taxBps / 10_000n;
  const vatAmountMicro = taxableBase * vatBps / 10_000n;

  const totalMicro = taxableBase + taxAmountMicro + vatAmountMicro;

  return {
    subtotalMicro,
    discountMicro,
    taxAmountMicro,
    vatAmountMicro,
    totalMicro,
  };
}
```

- [ ] **Step 3: Run**

```bash
cd packages/invoicing && bun test src/utils/calculate.test.ts && cd ../..
```

Expected: 4 pass.

- [ ] **Step 4: Commit**

```bash
git add packages/invoicing/src/utils/calculate.ts packages/invoicing/src/utils/calculate.test.ts
git commit --no-verify -m "feat(phase-11b): utils/calculate — subtotal/tax/vat/discount math

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 7: `utils/public-url.ts` + `utils/default.ts` + `utils/transform.ts` (stubs)

**Files:**
- Create: `packages/invoicing/src/utils/public-url.ts`
- Create: `packages/invoicing/src/utils/default.ts`
- Create: `packages/invoicing/src/utils/transform.ts`

- [ ] **Step 1: `public-url.ts` (port from desk-v1)**

```typescript
const DEFAULT_APP_URL = 'https://sendero.travel';

function normalizeBaseUrl(baseUrl?: string | null): string {
  const candidate = (baseUrl ?? '').trim();
  if (!candidate) return DEFAULT_APP_URL;
  try {
    const parsed = new URL(candidate);
    return parsed.origin.replace(/\/+$/, '');
  } catch {
    return DEFAULT_APP_URL;
  }
}

export function buildPublicInvoiceUrl(token: string, baseUrl?: string | null): string {
  const safeToken = String(token ?? '').trim();
  const origin = normalizeBaseUrl(baseUrl);
  return `${origin}/invoice/${encodeURIComponent(safeToken)}`;
}
```

- [ ] **Step 2: `default.ts` — default Template labels for Sendero**

```typescript
import type { Template } from '../templates/types';

export function defaultTemplate(overrides: Partial<Template> = {}): Template {
  return {
    logo_url: '',
    from_label: 'From',
    customer_label: 'Bill to',
    invoice_no_label: 'Invoice',
    issue_date_label: 'Issued',
    due_date_label: 'Due',
    amount_due_label: 'Amount due',
    date_format: 'MMM d, yyyy',
    payment_label: 'Payment',
    note_label: 'Notes',
    terms_label: 'Terms',
    description_label: 'Description',
    quantity_label: 'Qty',
    price_label: 'Price',
    total_label: 'Total',
    total_summary_label: 'Total',
    subtotal_label: 'Subtotal',
    subtotal: 0,
    tax_label: 'Tax',
    vat_label: 'VAT',
    tax_rate: 0,
    vat_rate: 0,
    locale: 'en-US',
    timezone: 'UTC',
    include_decimals: true,
    include_units: false,
    include_qr: true,
    include_vat: false,
    include_tax: false,
    include_discount: false,
    discount_label: 'Discount',
    title: 'Invoice',
    ...overrides,
  };
}
```

- [ ] **Step 3: `transform.ts` — Prisma → TemplateProps**

```typescript
import type { Invoice, InvoiceLineItem, Tenant } from '@sendero/database';
import type { TemplateProps, Template } from '../templates/types';
import { defaultTemplate } from './default';
import { microToDecimal } from './number';
import { buildPublicInvoiceUrl } from './public-url';

export function invoiceToTemplateProps(args: {
  invoice: Invoice & { lineItems: InvoiceLineItem[] };
  tenant?: Pick<Tenant, 'brandLogoUrl' | 'brandColors'> | null;
  baseUrl?: string;
}): TemplateProps {
  const tpl: Template = {
    ...defaultTemplate(args.invoice.template as Partial<Template>),
    logo_url: args.tenant?.brandLogoUrl ?? args.invoice.fromLogoUrl ?? '',
  };

  return {
    invoice: {
      id: args.invoice.id,
      number: args.invoice.number,
      status: args.invoice.status,
      issuedAt: args.invoice.issuedAt ?? args.invoice.createdAt,
      dueAt: args.invoice.dueAt,
      from: {
        name: args.invoice.fromName,
        address: args.invoice.fromAddress,
        taxId: args.invoice.fromTaxId,
        logoUrl: tpl.logo_url,
      },
      to: {
        name: args.invoice.toName,
        email: args.invoice.toEmail,
        address: args.invoice.toAddress,
        taxId: args.invoice.toTaxId,
      },
      currency: args.invoice.currency,
      lineItems: args.invoice.lineItems.map(li => ({
        position: li.position,
        description: li.description,
        quantity: Number(li.quantity),
        unitPrice: microToDecimal(li.unitPriceMicro),
        amount: microToDecimal(li.amountMicro),
      })),
      subtotal: microToDecimal(args.invoice.subtotalMicro),
      discount: microToDecimal(args.invoice.discountMicro),
      taxRate: Number(args.invoice.taxRate),
      taxAmount: microToDecimal(args.invoice.taxAmountMicro),
      vatRate: Number(args.invoice.vatRate),
      vatAmount: microToDecimal(args.invoice.vatAmountMicro),
      total: microToDecimal(args.invoice.totalMicro),
    },
    template: tpl,
    publicUrl: buildPublicInvoiceUrl(args.invoice.publicToken, args.baseUrl),
  };
}
```

- [ ] **Step 4: Create `templates/types.ts` (minimal for now; fills in with PDF template in Epic 4)**

```typescript
// packages/invoicing/src/templates/types.ts

export interface Template {
  logo_url?: string;
  from_label: string;
  customer_label: string;
  invoice_no_label: string;
  issue_date_label: string;
  due_date_label: string;
  amount_due_label?: string;
  date_format: string;
  payment_label: string;
  note_label: string;
  terms_label?: string;
  description_label: string;
  quantity_label: string;
  price_label: string;
  total_label: string;
  total_summary_label: string;
  tax_label: string;
  vat_label: string;
  tax_rate: number;
  vat_rate: number;
  locale: string;
  timezone: string;
  include_decimals: boolean;
  include_units: boolean;
  include_qr: boolean;
  include_vat: boolean;
  include_tax: boolean;
  title: string;
  subtotal_label: string;
  subtotal: number;
  include_discount: boolean;
  discount_label: string;
}

export interface TemplateProps {
  invoice: {
    id: string;
    number: string;
    status: string;
    issuedAt: Date;
    dueAt: Date | null;
    from: {
      name: string;
      address: unknown;
      taxId: string | null;
      logoUrl: string;
    };
    to: {
      name: string;
      email: string;
      address: unknown;
      taxId: string | null;
    };
    currency: string;
    lineItems: Array<{
      position: number;
      description: string;
      quantity: number;
      unitPrice: string;
      amount: string;
    }>;
    subtotal: string;
    discount: string;
    taxRate: number;
    taxAmount: string;
    vatRate: number;
    vatAmount: string;
    total: string;
  };
  template: Template;
  publicUrl: string;
}
```

- [ ] **Step 5: Typecheck + commit**

```bash
bun run typecheck 2>&1 | tail -10
git add packages/invoicing/src/utils packages/invoicing/src/templates/types.ts
git commit --no-verify -m "feat(phase-11b): utils/public-url + default + transform + template types

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

Expected: 0 new errors.

---

## Epic 3 — Fonts: commit TTFs + deploy to Vercel Blob

### Task 8: Download font files + commit

**Files:**
- Create: `packages/invoicing/src/assets/fonts/inter-{regular,medium,semibold,bold,italic}.ttf`
- Create: `packages/invoicing/src/assets/fonts/jetbrains-mono-{regular,bold}.ttf`
- Create: `packages/invoicing/src/assets/fonts/LICENSES.md`

- [ ] **Step 1: Download fonts**

Inter: download from https://rsms.me/inter/inter.zip → extract `.ttf` files from `Inter Desktop/` → place as:
- `inter-regular.ttf` (Inter-Regular.ttf)
- `inter-medium.ttf` (Inter-Medium.ttf)
- `inter-semibold.ttf` (Inter-SemiBold.ttf)
- `inter-bold.ttf` (Inter-Bold.ttf)
- `inter-italic.ttf` (Inter-Italic.ttf)

JetBrains Mono: from https://github.com/JetBrains/JetBrainsMono/releases → extract:
- `jetbrains-mono-regular.ttf` (JetBrainsMono-Regular.ttf)
- `jetbrains-mono-bold.ttf` (JetBrainsMono-Bold.ttf)

All seven files go in `packages/invoicing/src/assets/fonts/`.

- [ ] **Step 2: Add `LICENSES.md`**

```markdown
# Fonts

## Inter
Copyright © 2016-2024 The Inter Project Authors. Licensed under the SIL Open Font License, Version 1.1.
https://github.com/rsms/inter/blob/master/LICENSE.txt

## JetBrains Mono
Copyright 2020 The JetBrains Mono Project Authors. Licensed under the SIL Open Font License, Version 1.1.
https://github.com/JetBrains/JetBrainsMono/blob/master/OFL.txt
```

- [ ] **Step 3: Verify files exist + sizes**

```bash
ls -lh packages/invoicing/src/assets/fonts/
```

Expected: 7 TTF files, each ~100-300KB, plus LICENSES.md.

- [ ] **Step 4: Commit**

```bash
git add packages/invoicing/src/assets/fonts
git commit --no-verify -m "feat(phase-11b): commit Inter + JetBrains Mono TTFs for invoice PDF

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 9: `scripts/deploy-invoice-fonts.ts`

**Files:**
- Create: `scripts/deploy-invoice-fonts.ts`
- Modify: `package.json` — add `deploy:fonts` script

- [ ] **Step 1: Write script**

```typescript
#!/usr/bin/env bun
/**
 * Uploads invoice PDF fonts to Vercel Blob. Idempotent — re-running overwrites
 * in place. On success, prints the resulting URLs; commit them into
 * packages/invoicing/src/fonts-server.ts.
 *
 * Usage:
 *   export BLOB_READ_WRITE_TOKEN=...  # or have it in .env.local
 *   bun run deploy:fonts
 */

import { put } from '@vercel/blob';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const FONTS = [
  'inter-regular.ttf',
  'inter-medium.ttf',
  'inter-semibold.ttf',
  'inter-bold.ttf',
  'inter-italic.ttf',
  'jetbrains-mono-regular.ttf',
  'jetbrains-mono-bold.ttf',
];

async function main() {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    console.error('✗ BLOB_READ_WRITE_TOKEN not set');
    process.exit(1);
  }

  const here = dirname(fileURLToPath(import.meta.url));
  const fontsDir = join(here, '..', 'packages', 'invoicing', 'src', 'assets', 'fonts');

  const urls: Record<string, string> = {};
  for (const name of FONTS) {
    const buf = await readFile(join(fontsDir, name));
    const result = await put(`fonts/invoice/${name}`, buf, {
      access: 'public',
      addRandomSuffix: false,
      allowOverwrite: true,
      token,
    });
    urls[name] = result.url;
    console.log(`✓ ${name} → ${result.url}`);
  }

  console.log('\nPaste these into packages/invoicing/src/fonts-server.ts:');
  console.log(JSON.stringify(urls, null, 2));
}

main().catch(err => {
  console.error('deploy failed:', err);
  process.exit(1);
});
```

- [ ] **Step 2: Add to `package.json` root scripts**

```json
    "deploy:fonts": "bun run scripts/deploy-invoice-fonts.ts"
```

- [ ] **Step 3: Run (requires `BLOB_READ_WRITE_TOKEN` env set)**

```bash
bun run deploy:fonts 2>&1 | tail -20
```

Expected: 7 `✓` lines with URLs. Copy the printed JSON for the next task.

If the token isn't set, skip the run and continue to Task 10 using placeholder URLs; operator runs the deploy script once before first PDF render.

- [ ] **Step 4: Commit**

```bash
git add scripts/deploy-invoice-fonts.ts package.json
git commit --no-verify -m "feat(phase-11b): scripts/deploy-invoice-fonts → Vercel Blob

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 10: `fonts-server.ts` — font path constants + local fallback

**Files:**
- Create: `packages/invoicing/src/fonts-server.ts`

- [ ] **Step 1: Implement**

```typescript
// packages/invoicing/src/fonts-server.ts
// URLs populated by scripts/deploy-invoice-fonts.ts → Vercel Blob. Stable once set.

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const FONT_BASE = process.env.INVOICE_FONT_BASE_URL ?? 'https://PLACEHOLDER-RUN-DEPLOY-FONTS.blob.vercel-storage.com/fonts/invoice';

function localFallback(name: string): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, 'assets', 'fonts', name);
}

function fontPath(name: string): string {
  // Prefer the deployed URL (resolvable by @react-pdf in Node + serverless).
  // If FONT_BASE looks like a placeholder, use local file path for dev.
  if (FONT_BASE.includes('PLACEHOLDER')) return localFallback(name);
  return `${FONT_BASE}/${name}`;
}

export const pdfFontPaths = {
  inter: {
    regular:  fontPath('inter-regular.ttf'),
    medium:   fontPath('inter-medium.ttf'),
    semibold: fontPath('inter-semibold.ttf'),
    bold:     fontPath('inter-bold.ttf'),
    italic:   fontPath('inter-italic.ttf'),
  },
  jetbrainsMono: {
    regular: fontPath('jetbrains-mono-regular.ttf'),
    bold:    fontPath('jetbrains-mono-bold.ttf'),
  },
} as const;
```

After running `deploy:fonts` (Task 9), **replace** `https://PLACEHOLDER-…` with the real Blob base URL in this file (`https://<hash>.public.blob.vercel-storage.com/fonts/invoice` — the prefix up to `/fonts/invoice`, no trailing slash).

- [ ] **Step 2: Commit**

```bash
git add packages/invoicing/src/fonts-server.ts
git commit --no-verify -m "feat(phase-11b): fonts-server with Vercel Blob URLs + local fallback

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 11: Add `INVOICE_FONT_BASE_URL` + `INVOICE_SIGNING_SECRET` + `BLOB_READ_WRITE_TOKEN` to env

- [ ] **Step 1: Add entries in `packages/env/src/validate.ts`**

Append to the `REQUIRED` array:

```typescript
  {
    name: 'INVOICE_SIGNING_SECRET',
    scope: 'invoicing',
    hint: '32+ char secret for signing invoice public URL JWTs; generate: node -e "console.log(require(\'node:crypto\').randomBytes(32).toString(\'base64url\'))"',
  },
  {
    name: 'BLOB_READ_WRITE_TOKEN',
    scope: 'invoicing',
    hint: 'Vercel Blob token — auto-provisioned by Marketplace Blob integration on arc-web',
  },
```

- [ ] **Step 2: Verify validate**

```bash
bun run env:validate 2>&1 | tail -10
```

Expected: either all-green (if envs set) or gap report listing the two. Populate them in `.env.local`:

```bash
echo "INVOICE_SIGNING_SECRET=$(node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))")" >> .env.local
```

For `BLOB_READ_WRITE_TOKEN`: add the Blob Marketplace integration to the `arc-web` Vercel project, then `vercel env pull apps/app/.env.local` and copy the value into root `.env.local`. Or paste manually from the Vercel dashboard.

- [ ] **Step 3: Commit**

```bash
git add packages/env/src/validate.ts
git commit --no-verify -m "chore(phase-11b): require INVOICE_SIGNING_SECRET + BLOB_READ_WRITE_TOKEN

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Epic 4 — PDF template port

### Task 12: Create theme + Document shell

**Files:**
- Create: `packages/invoicing/src/templates/pdf/theme.ts`
- Create: `packages/invoicing/src/templates/pdf/index.tsx`

- [ ] **Step 1: Theme**

```typescript
// packages/invoicing/src/templates/pdf/theme.ts
export const theme = {
  colors: {
    primary:  '#fb542b',
    text:     '#0b0b0b',
    muted:    '#555555',
    border:   '#e9e3da',
    subtle:   '#f5f2ee',
    accent:   '#b34b2e',
  },
  sizes: {
    base: 10,
    small: 9,
    label: 8,
    heading: 16,
    huge: 24,
  },
  fonts: {
    sans: 'Inter',
    sansBold: 'Inter-Bold',
    sansMedium: 'Inter-Medium',
    sansSemibold: 'Inter-SemiBold',
    mono: 'JetBrainsMono',
    monoBold: 'JetBrainsMono-Bold',
  },
  spacing: (n: number) => n * 4, // 4pt grid
};
```

- [ ] **Step 2: Document root**

```tsx
// packages/invoicing/src/templates/pdf/index.tsx
import { Document, Font, Page, StyleSheet, View } from '@react-pdf/renderer';
import { pdfFontPaths } from '../../fonts-server';
import type { TemplateProps } from '../types';
import { theme } from './theme';
import { Meta } from './components/meta';
import { LineItems } from './components/line-items';
import { Summary } from './components/summary';
import { Note } from './components/note';
import { QRCode } from './components/qr-code';
import { PaymentDetails } from './components/payment-details';

// Register fonts once at module load.
try {
  Font.register({ family: 'Inter', src: pdfFontPaths.inter.regular });
  Font.register({ family: 'Inter-Medium', src: pdfFontPaths.inter.medium });
  Font.register({ family: 'Inter-SemiBold', src: pdfFontPaths.inter.semibold });
  Font.register({ family: 'Inter-Bold', src: pdfFontPaths.inter.bold });
  Font.register({ family: 'Inter-Italic', src: pdfFontPaths.inter.italic });
  Font.register({ family: 'JetBrainsMono', src: pdfFontPaths.jetbrainsMono.regular });
  Font.register({ family: 'JetBrainsMono-Bold', src: pdfFontPaths.jetbrainsMono.bold });
} catch (err) {
  // Font registration is best-effort; react-pdf falls back to Helvetica if any fail.
  console.warn('[invoicing/pdf] font registration warning:', err);
}

const styles = StyleSheet.create({
  page: {
    padding: theme.spacing(12),
    fontFamily: theme.fonts.sans,
    fontSize: theme.sizes.base,
    color: theme.colors.text,
    backgroundColor: '#ffffff',
  },
  sectionSpacer: { height: theme.spacing(8) },
});

export function InvoicePdf(props: TemplateProps) {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Meta {...props} />
        <View style={styles.sectionSpacer} />
        <LineItems {...props} />
        <View style={styles.sectionSpacer} />
        <Summary {...props} />
        <View style={styles.sectionSpacer} />
        {props.template.include_qr && <QRCode url={props.publicUrl} />}
        <PaymentDetails {...props} />
        <Note {...props} />
      </Page>
    </Document>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/invoicing/src/templates/pdf/theme.ts packages/invoicing/src/templates/pdf/index.tsx
git commit --no-verify -m "feat(phase-11b): PDF Document shell + font registration + Sendero theme

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 13-17: PDF components (Meta, LineItems, Summary, Note, PaymentDetails, QRCode)

**Files (create each):**
- `packages/invoicing/src/templates/pdf/components/meta.tsx`
- `packages/invoicing/src/templates/pdf/components/line-items.tsx`
- `packages/invoicing/src/templates/pdf/components/summary.tsx`
- `packages/invoicing/src/templates/pdf/components/note.tsx`
- `packages/invoicing/src/templates/pdf/components/payment-details.tsx`
- `packages/invoicing/src/templates/pdf/components/qr-code.tsx`

Port verbatim from `/Users/criptopoeta/coding-dojo/desk-v1/packages/invoice/src/templates/pdf/components/*`. Each file is ~30-80 lines. Replace hardcoded colors with `theme.colors.*` imports. Replace Poppins font family strings with `theme.fonts.*`.

Key per-component pattern:

```tsx
// packages/invoicing/src/templates/pdf/components/meta.tsx
import { Image, StyleSheet, Text, View } from '@react-pdf/renderer';
import type { TemplateProps } from '../../types';
import { theme } from '../theme';

const styles = StyleSheet.create({
  container: { flexDirection: 'row', justifyContent: 'space-between' },
  logo: { width: 56, height: 56 },
  block: { flex: 1 },
  label: {
    fontFamily: theme.fonts.mono,
    fontSize: theme.sizes.label,
    color: theme.colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: theme.spacing(1),
  },
  value: { fontFamily: theme.fonts.sans, fontSize: theme.sizes.base, marginBottom: theme.spacing(2) },
  title: { fontFamily: theme.fonts.sansBold, fontSize: theme.sizes.huge, marginBottom: theme.spacing(2) },
  number: { fontFamily: theme.fonts.mono, fontSize: theme.sizes.base },
});

export function Meta({ invoice, template }: TemplateProps) {
  const issuedFmt = new Intl.DateTimeFormat(template.locale, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(invoice.issuedAt);

  return (
    <View style={styles.container}>
      <View style={styles.block}>
        {invoice.from.logoUrl ? <Image src={invoice.from.logoUrl} style={styles.logo} /> : null}
        <Text style={styles.label}>{template.from_label}</Text>
        <Text style={styles.value}>{invoice.from.name}</Text>
        {invoice.from.taxId ? <Text style={styles.value}>{invoice.from.taxId}</Text> : null}
      </View>
      <View style={styles.block}>
        <Text style={styles.title}>{template.title}</Text>
        <Text style={styles.label}>{template.invoice_no_label}</Text>
        <Text style={styles.number}>{invoice.number}</Text>
        <Text style={styles.label}>{template.issue_date_label}</Text>
        <Text style={styles.value}>{issuedFmt}</Text>
      </View>
      <View style={styles.block}>
        <Text style={styles.label}>{template.customer_label}</Text>
        <Text style={styles.value}>{invoice.to.name}</Text>
        <Text style={styles.value}>{invoice.to.email}</Text>
        {invoice.to.taxId ? <Text style={styles.value}>{invoice.to.taxId}</Text> : null}
      </View>
    </View>
  );
}
```

Use this as a template for the remaining components — each is a similar shape of `<View>` + `<Text>` + `StyleSheet.create` using the theme. `line-items.tsx` renders a table (header row + body rows), `summary.tsx` renders the totals block, `note.tsx` renders invoice notes (from `invoice.metadata.note` if present), `payment-details.tsx` renders payment legs (from `invoice.payments`, if passed through), `qr-code.tsx` uses `qrcode` to generate a data URL and renders it as an `<Image>`.

**`qr-code.tsx`** — the one non-trivial component:

```tsx
import { Image, StyleSheet, View } from '@react-pdf/renderer';
import QRCodeUtil from 'qrcode';
import { useEffect, useState } from 'react';

const styles = StyleSheet.create({
  container: { alignItems: 'flex-end' },
  img: { width: 72, height: 72 },
});

export function QRCode({ url }: { url: string }) {
  // React-PDF renders synchronously; pre-compute the data URL at module scope
  // OR pass a precomputed dataUrl down. For simplicity: compute at render time
  // using a workaround — renderToBuffer awaits async children.
  // Actually @react-pdf doesn't support hooks; compute at the caller and pass down.
  return (
    <View style={styles.container}>
      <Image src={url} style={styles.img} />
    </View>
  );
}
```

**Important correction:** React-PDF doesn't run hooks. The QR code data URL must be precomputed before rendering. Update `InvoicePdf` to accept a precomputed `qrDataUrl` or compute it inside the render flow via an async helper. Simplest:

```tsx
// Revise templates/pdf/index.tsx signature
export async function renderInvoicePdfBuffer(props: TemplateProps): Promise<Buffer> {
  const qrDataUrl = await QRCodeUtil.toDataURL(props.publicUrl, { width: 144 });
  const { renderToBuffer } = await import('@react-pdf/renderer');
  return await renderToBuffer(<InvoicePdfInner {...props} qrDataUrl={qrDataUrl} />);
}
```

And `<InvoicePdfInner>` accepts `qrDataUrl` + passes it to `<QRCode dataUrl={qrDataUrl}/>`.

Do this correction in Task 17 (below).

- [ ] **Task 13**: `meta.tsx` — port + commit
- [ ] **Task 14**: `line-items.tsx` + `summary.tsx` — port + commit
- [ ] **Task 15**: `note.tsx` + `payment-details.tsx` — port + commit
- [ ] **Task 16**: `qr-code.tsx` — port + commit (expects `dataUrl` prop, not URL)

### Task 17: Async `renderInvoicePdfBuffer` + smoke render test

**Files:**
- Modify: `packages/invoicing/src/templates/pdf/index.tsx`
- Create: `packages/invoicing/__fixtures__/sample-invoice.json`
- Create: `packages/invoicing/src/templates/pdf/render.test.ts`

- [ ] **Step 1: Refactor `index.tsx`**

```tsx
import QRCodeUtil from 'qrcode';
import { renderToBuffer } from '@react-pdf/renderer';
// ... existing imports

function InvoicePdf({ qrDataUrl, ...props }: TemplateProps & { qrDataUrl: string }) {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Meta {...props} />
        <View style={styles.sectionSpacer} />
        <LineItems {...props} />
        <View style={styles.sectionSpacer} />
        <Summary {...props} />
        <View style={styles.sectionSpacer} />
        {props.template.include_qr && <QRCode dataUrl={qrDataUrl} />}
        <PaymentDetails {...props} />
        <Note {...props} />
      </Page>
    </Document>
  );
}

export async function renderInvoicePdfBuffer(props: TemplateProps): Promise<Buffer> {
  const qrDataUrl = props.template.include_qr
    ? await QRCodeUtil.toDataURL(props.publicUrl, { width: 144, margin: 1 })
    : '';
  return await renderToBuffer(<InvoicePdf qrDataUrl={qrDataUrl} {...props} />);
}

export { InvoicePdf };
```

Update `qr-code.tsx` prop signature: `export function QRCode({ dataUrl }: { dataUrl: string }) { return <Image src={dataUrl} ... /> }`.

- [ ] **Step 2: Create fixture**

```json
// packages/invoicing/__fixtures__/sample-invoice.json
{
  "invoice": {
    "id": "inv_test",
    "number": "INV-2026-001",
    "status": "issued",
    "issuedAt": "2026-04-20T00:00:00Z",
    "dueAt": null,
    "from": {
      "name": "Sendero Travel",
      "address": null,
      "taxId": null,
      "logoUrl": ""
    },
    "to": {
      "name": "Acme Corp",
      "email": "billing@acme.com",
      "address": null,
      "taxId": null
    },
    "currency": "USD",
    "lineItems": [
      { "position": 1, "description": "SFO → LHR · 2026-04-25", "quantity": 1, "unitPrice": "1350.500000", "amount": "1350.500000" }
    ],
    "subtotal": "1350.500000",
    "discount": "0.000000",
    "taxRate": 0,
    "taxAmount": "0.000000",
    "vatRate": 0,
    "vatAmount": "0.000000",
    "total": "1350.500000"
  },
  "template": {
    "from_label": "From",
    "customer_label": "Bill to",
    "invoice_no_label": "Invoice",
    "issue_date_label": "Issued",
    "due_date_label": "Due",
    "date_format": "MMM d, yyyy",
    "payment_label": "Payment",
    "note_label": "Notes",
    "description_label": "Description",
    "quantity_label": "Qty",
    "price_label": "Price",
    "total_label": "Total",
    "total_summary_label": "Total",
    "subtotal_label": "Subtotal",
    "subtotal": 0,
    "tax_label": "Tax",
    "vat_label": "VAT",
    "tax_rate": 0,
    "vat_rate": 0,
    "locale": "en-US",
    "timezone": "UTC",
    "include_decimals": true,
    "include_units": false,
    "include_qr": true,
    "include_vat": false,
    "include_tax": false,
    "include_discount": false,
    "discount_label": "Discount",
    "title": "Invoice"
  },
  "publicUrl": "https://sendero.travel/invoice/test-token"
}
```

- [ ] **Step 3: Render test**

```typescript
// packages/invoicing/src/templates/pdf/render.test.ts
import { test, expect } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { renderInvoicePdfBuffer } from './index';

test('renders sample invoice to a non-empty PDF buffer with %PDF magic', async () => {
  const fixture = JSON.parse(
    await readFile(new URL('../../../__fixtures__/sample-invoice.json', import.meta.url), 'utf8')
  );
  // Parse issuedAt back into Date
  fixture.invoice.issuedAt = new Date(fixture.invoice.issuedAt);
  const buf = await renderInvoicePdfBuffer(fixture);
  expect(buf.length).toBeGreaterThan(1000); // a real PDF is > 1KB
  expect(buf.subarray(0, 4).toString('ascii')).toBe('%PDF');
});
```

- [ ] **Step 4: Run**

```bash
cd packages/invoicing && bun test src/templates/pdf/render.test.ts 2>&1 | tail -10 && cd ../..
```

Expected: 1 pass.

- [ ] **Step 5: Commit**

```bash
git add packages/invoicing
git commit --no-verify -m "feat(phase-11b): async renderInvoicePdfBuffer + QR precompute + render test

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Epic 5 — HTML template port

### Task 18-20: HTML shell + components + format entry

**Files:**
- Create: `packages/invoicing/src/templates/html/index.tsx`
- Create: `packages/invoicing/src/templates/html/format.tsx`
- Create: `packages/invoicing/src/templates/html/components/{meta,line-items,summary,note,qr-code}.tsx`

Pattern mirrors the PDF components but using HTML primitives (div/span/table). Styles inline (for email clients) using camelCase `style={{}}` attributes matching the PDF theme.

**`index.tsx`** skeleton:

```tsx
import type { TemplateProps } from '../types';
import { Meta } from './components/meta';
import { LineItems } from './components/line-items';
import { Summary } from './components/summary';
import { Note } from './components/note';
import { QRCode } from './components/qr-code';

export function InvoiceHtml(props: TemplateProps) {
  return (
    <div style={{
      fontFamily: '-apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", Arial, sans-serif',
      color: '#0b0b0b',
      background: '#ffffff',
      maxWidth: 720,
      margin: '0 auto',
      padding: '40px 16px',
    }}>
      <Meta {...props} />
      <div style={{ height: 32 }} />
      <LineItems {...props} />
      <div style={{ height: 32 }} />
      <Summary {...props} />
      {props.template.include_qr && <QRCode url={props.publicUrl} />}
      <Note {...props} />
    </div>
  );
}

export function renderInvoiceHtml(props: TemplateProps): string {
  const { renderToStaticMarkup } = require('react-dom/server');
  return `<!doctype html><html><body>${renderToStaticMarkup(InvoiceHtml(props))}</body></html>`;
}
```

Each component mirrors its PDF twin — copy the inline-style patterns. `qr-code.tsx` for HTML uses `<img src="data:..." />` with `qrcode` precomputed (the server-side renderer can await before handing off).

- [ ] **Task 18**: HTML `index.tsx` + `meta.tsx` — commit
- [ ] **Task 19**: HTML `line-items.tsx` + `summary.tsx` + `note.tsx` — commit
- [ ] **Task 20**: HTML `qr-code.tsx` + `format.tsx` + export from package — commit

After task 20, `packages/invoicing/src/index.ts` exports:

```typescript
export { renderToBuffer, renderToStream } from '@react-pdf/renderer';
export { InvoicePdf, renderInvoicePdfBuffer } from './templates/pdf';
export { InvoiceHtml, renderInvoiceHtml } from './templates/html';
export * from './token';
export * from './utils/public-url';
export * from './utils/calculate';
export * from './utils/number';
export * from './utils/default';
export * from './utils/transform';
```

---

## Epic 6 — Email delivery

### Task 21: `packages/notifications/src/invoice-email.ts`

**Files:**
- Create: `packages/notifications/src/invoice-email.ts`
- Modify: `packages/notifications/src/index.ts` — add `sendInvoice`

- [ ] **Step 1: Write `invoice-email.ts`**

```typescript
// packages/notifications/src/invoice-email.ts
import type { TemplateProps } from '@sendero/invoicing/templates/types';

export interface InvoiceEmailContent {
  invoice: TemplateProps['invoice'];
  publicUrl: string;
  supportEmail?: string;
}

export function renderInvoiceEmail(c: InvoiceEmailContent): { subject: string; html: string; text: string } {
  const amount = c.invoice.total;
  const support = c.supportEmail ?? 'hello@sendero.travel';
  const subject = `Sendero · Invoice ${c.invoice.number} · $${amount}`;

  const html = `<!doctype html>
<html><body style="margin:0;padding:0;background:#f5f2ee;font-family:-apple-system,BlinkMacSystemFont,Inter,'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 16px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid #e9e3da;border-radius:20px;padding:40px;text-align:left;">
        <tr><td style="padding-bottom:24px;">
          <div style="font-size:14px;letter-spacing:0.18em;text-transform:uppercase;color:#b34b2e;font-weight:700;">Sendero · Arc</div>
        </td></tr>
        <tr><td style="font-size:24px;font-weight:700;padding-bottom:16px;">Invoice ${c.invoice.number}</td></tr>
        <tr><td style="color:#555;font-size:16px;line-height:1.6;">
          Hi ${escapeHtml(c.invoice.to.name)},<br><br>
          Your invoice for <strong>$${amount}</strong> is attached. View online:
        </td></tr>
        <tr><td style="padding:24px 0;">
          <a href="${c.publicUrl}" style="display:inline-block;background:#fb542b;color:#fff;padding:14px 24px;border-radius:12px;text-decoration:none;font-weight:600;">View invoice</a>
        </td></tr>
        <tr><td style="color:#8a8a8a;font-size:12px;line-height:1.6;">
          Questions? Reply to this email or contact ${support}.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

  const text = `Invoice ${c.invoice.number}

Hi ${c.invoice.to.name},

Your invoice for $${amount} is attached. View online: ${c.publicUrl}

Questions? ${support}`;

  return { subject, html, text };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? c));
}
```

- [ ] **Step 2: Add `sendInvoice` to `packages/notifications/src/index.ts`**

Check the existing `createNotifier` pattern in this file; add a new method:

```typescript
sendInvoice: async (
  to: string,
  args: InvoiceEmailContent & { pdfBuffer: Buffer; pdfFilename?: string }
): Promise<{ ok: boolean; id?: string; error?: string }> => {
  if (!notificationsConfigured()) {
    return { ok: false, error: 'notifications not configured' };
  }
  const { subject, html, text } = renderInvoiceEmail(args);
  const client = new Resend(process.env.RESEND_API_KEY!);
  try {
    const result = await client.emails.send({
      from: process.env.SENDERO_EMAIL_FROM!,
      to,
      subject,
      html,
      text,
      attachments: [
        {
          filename: args.pdfFilename ?? `${args.invoice.number}.pdf`,
          content: args.pdfBuffer,
        },
      ],
    });
    return { ok: true, id: result.data?.id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
},
```

Import `renderInvoiceEmail` + `InvoiceEmailContent` at top of file.

- [ ] **Step 3: Typecheck + commit**

```bash
bun run typecheck 2>&1 | tail -5
git add packages/notifications
git commit --no-verify -m "feat(phase-11b): @sendero/notifications sendInvoice — PDF attachment

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 22: Add `@sendero/invoicing` as peer dep of `@sendero/notifications`

**Files:**
- Modify: `packages/notifications/package.json`

- [ ] Add `"@sendero/invoicing": "workspace:*"` to `peerDependencies`. Run `bun install`. Commit.

---

## Epic 7 — API routes

### Task 23: `/api/invoices/[id]/pdf` download route

**Files:**
- Create: `apps/app/app/api/invoices/[id]/pdf/route.ts`

- [ ] **Step 1: Write route**

```typescript
import { type NextRequest, NextResponse } from 'next/server';
import { auth } from '@sendero/auth/server';
import { prisma } from '@sendero/database';
import { put } from '@vercel/blob';
import { renderInvoicePdfBuffer, invoiceToTemplateProps } from '@sendero/invoicing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { orgId, isAuthenticated } = await auth();
  if (!isAuthenticated) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const invoice = await prisma.invoice.findUnique({
    where: { id },
    include: { lineItems: true, tenant: { select: { clerkOrgId: true, brandLogoUrl: true, brandColors: true } } },
  });
  if (!invoice) return new NextResponse(null, { status: 404 });
  if (invoice.tenant.clerkOrgId !== orgId) return new NextResponse(null, { status: 404 });

  if (invoice.pdfBlobUrl) {
    return NextResponse.redirect(invoice.pdfBlobUrl);
  }

  const props = invoiceToTemplateProps({
    invoice,
    tenant: invoice.tenant,
    baseUrl: process.env.NEXT_PUBLIC_APP_URL,
  });

  const buf = await renderInvoicePdfBuffer(props);

  const { url } = await put(
    `invoices/${invoice.tenantId}/${invoice.id}.pdf`,
    buf,
    { access: 'public', addRandomSuffix: false, allowOverwrite: true, contentType: 'application/pdf' }
  );

  await prisma.invoice.update({
    where: { id: invoice.id },
    data: { pdfBlobUrl: url, pdfRenderedAt: new Date() },
  });

  return new NextResponse(buf, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${invoice.number}.pdf"`,
    },
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/app/app/api/invoices
git commit --no-verify -m "feat(phase-11b): /api/invoices/[id]/pdf — signed download + Blob cache

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 24: `/invoice/[token]` public viewer

**Files:**
- Create: `apps/app/app/invoice/[token]/page.tsx`

- [ ] **Step 1: Write page**

```tsx
import { notFound } from 'next/navigation';
import { prisma } from '@sendero/database';
import { verifyInvoiceToken, invoiceToTemplateProps, InvoiceHtml } from '@sendero/invoicing';
import { env } from '@sendero/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default async function PublicInvoicePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const secret = env.invoiceSigningSecret?.() ?? process.env.INVOICE_SIGNING_SECRET;
  if (!secret) notFound();

  let payload;
  try {
    payload = await verifyInvoiceToken(token, secret);
  } catch {
    notFound();
  }

  const invoice = await prisma.invoice.findUnique({
    where: { id: payload.iid },
    include: { lineItems: true, tenant: { select: { brandLogoUrl: true, brandColors: true } } },
  });
  if (!invoice || invoice.tenantId !== payload.tenantId) notFound();

  const props = invoiceToTemplateProps({
    invoice,
    tenant: invoice.tenant,
    baseUrl: process.env.NEXT_PUBLIC_APP_URL,
  });

  // Mark viewed
  if (invoice.status === 'sent') {
    await prisma.invoice.update({ where: { id: invoice.id }, data: { status: 'viewed' } });
  }

  return (
    <main>
      <InvoiceHtml {...props} />
      <div style={{ textAlign: 'center', padding: 24 }}>
        <a
          href={`/api/invoices/${invoice.id}/pdf?token=${encodeURIComponent(token)}`}
          style={{
            display: 'inline-block',
            background: '#fb542b',
            color: '#fff',
            padding: '12px 24px',
            borderRadius: 12,
            textDecoration: 'none',
            fontWeight: 600,
          }}
        >
          Download PDF
        </a>
      </div>
    </main>
  );
}
```

Note: the PDF download from the public viewer needs its own token-validated path since it bypasses Clerk. Add a token-aware branch inside the `/api/invoices/[id]/pdf` route (or a separate `/api/invoices/public/[token]/pdf` route). Easier: pass `?token=...` + check it as a fallback auth method.

- [ ] **Step 2: Revise `/api/invoices/[id]/pdf` to accept `?token=` as alt auth**

In `route.ts`, before the Clerk auth() check:

```typescript
const url = new URL(_req.url);
const tokenParam = url.searchParams.get('token');
if (tokenParam) {
  const secret = process.env.INVOICE_SIGNING_SECRET!;
  try {
    const payload = await verifyInvoiceToken(tokenParam, secret);
    if (payload.iid !== id) return new NextResponse(null, { status: 404 });
    // Token valid — skip Clerk auth
    return await serveInvoicePdf(id, null);
  } catch {
    return new NextResponse(null, { status: 404 });
  }
}

// Fall through to Clerk auth for authenticated buyer-admin flow
```

Extract the shared PDF serve logic into a helper `serveInvoicePdf(id, tenantGuard)`.

- [ ] **Step 3: Commit**

```bash
git add apps/app/app/invoice apps/app/app/api/invoices
git commit --no-verify -m "feat(phase-11b): /invoice/[token] viewer + token-auth PDF download

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 25: `publicToken` signing helper + test

**Files:**
- Modify: `packages/invoicing/src/token.ts` — no change needed
- Verify route handlers use it correctly

- [ ] Sanity curl test after the dev server is running. Defer actual invocation to Epic 11 smoke tests.

---

## Epic 8 — `generate_booking_invoice` tool + workflow

### Task 26: Tool implementation

**Files:**
- Create: `packages/tools/src/generate-booking-invoice.ts`

- [ ] **Step 1: Write tool**

```typescript
import { z } from 'zod';
import { prisma } from '@sendero/database';
import { put } from '@vercel/blob';
import {
  calculateTotals,
  decimalToMicro,
  renderInvoicePdfBuffer,
  invoiceToTemplateProps,
  signInvoiceToken,
  defaultTemplate,
} from '@sendero/invoicing';
import { createNotifier, notificationsConfigured } from '@sendero/notifications';
import type { ToolDef } from './types';

const hex32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/);

const input = z.object({
  bookingId: hex32,
  settleTxHash: z.string().optional(),
});

export const generateBookingInvoiceTool: ToolDef = {
  name: 'generate_booking_invoice',
  description:
    'Issue a booking invoice after settle_booking. Creates Invoice + LineItem rows, renders PDF to Vercel Blob, signs public token, emails the traveler. Idempotent on bookingId (unique).',
  inputSchema: input,
  jsonSchema: {
    type: 'object',
    required: ['bookingId'],
    properties: {
      bookingId: { type: 'string' },
      settleTxHash: { type: 'string' },
    },
  },
  async handler(raw) {
    const parsed = input.parse(raw);

    // Find the booking (note: Booking.id is cuid, not hex32 — the workflow may pass
    // escrow bookingId (hex32) which won't match Booking.id. For 11b, look up via
    // Booking.externalId OR a dedicated column. Assume for now externalId contains
    // the escrow bookingId hex.)
    const booking = await prisma.booking.findFirst({
      where: { externalId: parsed.bookingId },
      include: {
        tenant: true,
        trip: { include: { createdBy: true } },
      },
    });
    if (!booking) {
      throw new Error(`booking_not_found: no Booking with externalId=${parsed.bookingId}`);
    }

    // Idempotency: if invoice already exists for this booking, return it
    const existing = await prisma.invoice.findUnique({ where: { bookingId: booking.id } });
    if (existing) {
      return {
        invoiceId: existing.id,
        number: existing.number,
        alreadyExisted: true,
      };
    }

    const totalUsd = booking.totalUsd.toString();
    const totalMicro = decimalToMicro(totalUsd);

    // Sequence
    const year = new Date().getFullYear();
    const seq = await prisma.invoiceSequence.upsert({
      where: { tenantId_year: { tenantId: booking.tenantId, year } },
      create: { tenantId: booking.tenantId, year, nextSeq: 2 },
      update: { nextSeq: { increment: 1 } },
      select: { nextSeq: true },
    });
    const number = `INV-${year}-${(seq.nextSeq - 1).toString().padStart(4, '0')}`;

    // Line item
    const description = `Trip · ${booking.kind}${booking.pnr ? ` · PNR ${booking.pnr}` : ''}`;

    // Placeholder publicToken — signed after we have the id
    const draft = await prisma.invoice.create({
      data: {
        tenantId: booking.tenantId,
        kind: 'booking',
        status: 'paid',
        number,
        issuedAt: new Date(),
        paidAt: new Date(),
        fromName: booking.tenant.legalName ?? booking.tenant.displayName ?? 'Sendero Travel',
        fromAddress: booking.tenant.billingAddress ?? null,
        fromTaxId: booking.tenant.taxId ?? null,
        fromLogoUrl: booking.tenant.brandLogoUrl ?? null,
        toName: booking.trip.createdBy?.displayName ?? 'Guest traveler',
        toEmail: booking.trip.createdBy?.email ?? 'unknown@example.com',
        currency: 'USD',
        subtotalMicro: totalMicro,
        totalMicro,
        template: defaultTemplate(),
        bookingId: booking.id,
        publicToken: 'PENDING',
        lineItems: {
          create: [
            {
              position: 1,
              description,
              quantity: 1,
              unitPriceMicro: totalMicro,
              amountMicro: totalMicro,
              sourceKind: 'booking',
              sourceRef: booking.id,
            },
          ],
        },
        payments: parsed.settleTxHash
          ? {
              create: [
                {
                  amountMicro: totalMicro,
                  method: 'escrow_settle',
                  txHash: parsed.settleTxHash,
                },
              ],
            }
          : undefined,
      },
      include: { lineItems: true, tenant: true },
    });

    // Sign token + persist
    const secret = process.env.INVOICE_SIGNING_SECRET;
    if (!secret) throw new Error('INVOICE_SIGNING_SECRET not set');
    const token = await signInvoiceToken({ iid: draft.id, tenantId: booking.tenantId }, secret);

    // Render PDF + upload
    const props = invoiceToTemplateProps({
      invoice: { ...draft, publicToken: token },
      tenant: draft.tenant,
      baseUrl: process.env.NEXT_PUBLIC_APP_URL,
    });
    const buf = await renderInvoicePdfBuffer(props);
    const { url: pdfBlobUrl } = await put(
      `invoices/${draft.tenantId}/${draft.id}.pdf`,
      buf,
      { access: 'public', addRandomSuffix: false, allowOverwrite: true, contentType: 'application/pdf' }
    );

    const final = await prisma.invoice.update({
      where: { id: draft.id },
      data: { publicToken: token, pdfBlobUrl, pdfRenderedAt: new Date(), status: 'sent' },
    });

    // Email — fire-and-forget; failure recorded in metadata
    if (notificationsConfigured() && draft.toEmail) {
      const notifier = createNotifier();
      const emailResult = await notifier.sendInvoice(draft.toEmail, {
        invoice: props.invoice,
        publicUrl: props.publicUrl,
        pdfBuffer: buf,
      });
      if (!emailResult.ok) {
        await prisma.invoice.update({
          where: { id: draft.id },
          data: { metadata: { emailError: emailResult.error ?? 'unknown' } },
        });
      }
    }

    return {
      invoiceId: final.id,
      number: final.number,
      publicUrl: props.publicUrl,
      pdfBlobUrl,
      alreadyExisted: false,
    };
  },
};
```

- [ ] **Step 2: Commit**

```bash
git add packages/tools/src/generate-booking-invoice.ts
git commit --no-verify -m "feat(phase-11b): generate_booking_invoice tool

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 27: Register in `tools/index.ts`

- [ ] Add to imports + toolList + re-export (mirrors Epic 6 pattern from phase-11a plan).

```bash
git commit --no-verify -m "chore(phase-11b): register generate_booking_invoice in tools registry"
```

### Task 28: Append workflow step after `settle_escrow`

**Files:**
- Modify: `packages/workflows/src/catalog.ts`

- [ ] Append to both `bookFlightWorkflow.duffel_gate.then` and `guestPrefundWorkflow.duffel_gate.then` — after `settle_escrow` tool step:

```typescript
        {
          kind: 'tool',
          id: 'invoice',
          tool: 'generate_booking_invoice',
          label: 'Issue booking invoice',
          args: {
            bookingId: $('reservation.bookingId'),
            settleTxHash: $('settle_escrow.txHash'),
          },
        },
```

- [ ] Commit.

---

## Epic 9 — Platform bill cron

### Task 29: `/api/cron/generate-platform-bills` route

**Files:**
- Create: `apps/app/app/api/cron/generate-platform-bills/route.ts`

- [ ] **Step 1: Write route**

```typescript
import { type NextRequest, NextResponse } from 'next/server';
import { prisma } from '@sendero/database';
import { put } from '@vercel/blob';
import { renderInvoicePdfBuffer, invoiceToTemplateProps, signInvoiceToken, defaultTemplate } from '@sendero/invoicing';
import { createNotifier, notificationsConfigured } from '@sendero/notifications';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (expected && req.headers.get('authorization') !== `Bearer ${expected}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  // Period: first day of prior month → first day of this month
  const now = new Date();
  const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const periodEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

  const tenants = await prisma.meterEvent.findMany({
    where: { status: 'paid', invoiceRef: null, at: { gte: periodStart, lt: periodEnd } },
    select: { tenantId: true },
    distinct: ['tenantId'],
    take: 500,
  });

  const results: unknown[] = [];
  for (const { tenantId } of tenants) {
    if (!tenantId) continue;
    try {
      const r = await generateForTenant(tenantId, periodStart, periodEnd);
      results.push(r);
    } catch (err) {
      results.push({ tenantId, error: err instanceof Error ? err.message : String(err) });
    }
  }

  return NextResponse.json({ period: { periodStart, periodEnd }, results });
}

async function generateForTenant(tenantId: string, periodStart: Date, periodEnd: Date) {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) return { tenantId, outcome: 'tenant_missing' };

  const events = await prisma.meterEvent.findMany({
    where: { tenantId, status: 'paid', invoiceRef: null, at: { gte: periodStart, lt: periodEnd } },
    select: { id: true, toolName: true, priceMicroUsdc: true },
  });
  if (events.length === 0) return { tenantId, outcome: 'empty' };

  // Group by toolName
  const groups = new Map<string, { count: number; totalMicro: bigint }>();
  for (const e of events) {
    const g = groups.get(e.toolName) ?? { count: 0, totalMicro: 0n };
    g.count += 1;
    g.totalMicro += e.priceMicroUsdc;
    groups.set(e.toolName, g);
  }

  const lineItems = Array.from(groups.entries()).map(([toolName, g], idx) => ({
    position: idx + 1,
    description: `${toolName} · ${g.count} calls`,
    quantity: g.count,
    unitPriceMicro: g.count > 0 ? g.totalMicro / BigInt(g.count) : 0n,
    amountMicro: g.totalMicro,
    sourceKind: 'meter_event',
    sourceRef: toolName,
  }));

  const totalMicro = Array.from(groups.values()).reduce((acc, g) => acc + g.totalMicro, 0n);

  // Sequence
  const year = now().getFullYear();
  const seq = await prisma.invoiceSequence.upsert({
    where: { tenantId_year: { tenantId, year } },
    create: { tenantId, year, nextSeq: 2 },
    update: { nextSeq: { increment: 1 } },
    select: { nextSeq: true },
  });
  const number = `INV-${year}-${(seq.nextSeq - 1).toString().padStart(4, '0')}`;

  // Tier logic
  const isNet30 = tenant.billingTier === 'business' || tenant.billingTier === 'enterprise';
  const issuedAt = new Date();
  const dueAt = isNet30 ? new Date(issuedAt.getTime() + 30 * 24 * 60 * 60 * 1000) : issuedAt;

  // Look up payments: for prepaid tiers, find NanopayBatches covering these events
  let paymentsData: { amountMicro: bigint; method: string; txHash: string | null }[] = [];
  if (!isNet30) {
    const batchIds = Array.from(
      new Set(
        (await prisma.meterEvent.findMany({
          where: { id: { in: events.map(e => e.id) }, settlementRef: { not: null } },
          select: { settlementRef: true },
        })).map(e => e.settlementRef).filter((r): r is string => !!r)
      )
    );
    const batches = await prisma.nanopayBatch.findMany({
      where: { id: { in: batchIds } },
      select: { id: true, totalMicroUsdc: true, txHash: true },
    });
    paymentsData = batches.map(b => ({
      amountMicro: b.totalMicroUsdc,
      method: 'nanopay_batch',
      txHash: b.txHash,
    }));
  }

  const draft = await prisma.invoice.create({
    data: {
      tenantId,
      kind: 'platform_bill',
      status: isNet30 ? 'issued' : 'paid',
      number,
      issuedAt,
      dueAt,
      paidAt: isNet30 ? null : issuedAt,
      fromName: 'Sendero Travel',
      fromAddress: null,
      toName: tenant.legalName ?? tenant.displayName,
      toEmail: tenant.billingContactEmail ?? '',
      toAddress: tenant.billingAddress,
      toTaxId: tenant.taxId,
      currency: 'USD',
      subtotalMicro: totalMicro,
      totalMicro,
      template: defaultTemplate(),
      periodStart,
      periodEnd,
      publicToken: 'PENDING',
      lineItems: { create: lineItems },
      payments: { create: paymentsData },
    },
    include: { lineItems: true, tenant: true },
  });

  // Stamp MeterEvents
  await prisma.meterEvent.updateMany({
    where: { id: { in: events.map(e => e.id) } },
    data: { invoiceRef: draft.id },
  });

  // Token + PDF + email
  const secret = process.env.INVOICE_SIGNING_SECRET;
  if (!secret) throw new Error('INVOICE_SIGNING_SECRET not set');
  const token = await signInvoiceToken({ iid: draft.id, tenantId }, secret);

  const props = invoiceToTemplateProps({
    invoice: { ...draft, publicToken: token },
    tenant: draft.tenant,
    baseUrl: process.env.NEXT_PUBLIC_APP_URL,
  });
  const buf = await renderInvoicePdfBuffer(props);
  const { url: pdfBlobUrl } = await put(
    `invoices/${tenantId}/${draft.id}.pdf`,
    buf,
    { access: 'public', addRandomSuffix: false, allowOverwrite: true, contentType: 'application/pdf' }
  );
  await prisma.invoice.update({
    where: { id: draft.id },
    data: { publicToken: token, pdfBlobUrl, pdfRenderedAt: new Date() },
  });

  if (notificationsConfigured() && draft.toEmail) {
    const notifier = createNotifier();
    const emailResult = await notifier.sendInvoice(draft.toEmail, {
      invoice: props.invoice,
      publicUrl: props.publicUrl,
      pdfBuffer: buf,
    });
    if (!emailResult.ok) {
      await prisma.invoice.update({
        where: { id: draft.id },
        data: { metadata: { emailError: emailResult.error ?? 'unknown' } },
      });
    }
  }

  return {
    tenantId,
    outcome: 'invoiced',
    invoiceId: draft.id,
    number,
    totalMicro: totalMicro.toString(),
    eventCount: events.length,
    tier: tenant.billingTier,
  };
}

function now(): Date { return new Date(); }
```

- [ ] **Step 2: Commit**

### Task 30: `vercel.json` crons entry

**Files:**
- Modify: `apps/app/vercel.json`

- [ ] Add a `"crons"` block (if not present) and include:

```json
  "crons": [
    { "path": "/api/cron/generate-platform-bills", "schedule": "0 2 1 * *" },
    { "path": "/api/cron/settle-nanopay-batches", "schedule": "0 * * * *" },
    { "path": "/api/cron/retry-wallet-provision", "schedule": "*/5 * * * *" }
  ]
```

(The other two crons may already exist from phase-11a / 11c1 — keep them.)

- [ ] Commit.

---

## Epic 10 — Env + health

### Task 31: Health surface

**Files:**
- Modify: `apps/app/app/api/health/route.ts`

- [ ] Add:

```typescript
    invoiceSigningSecret: !!process.env.INVOICE_SIGNING_SECRET,
    vercelBlob: !!process.env.BLOB_READ_WRITE_TOKEN,
```

Commit.

### Task 32: `env.invoiceSigningSecret()` accessor (if pattern is preferred)

- [ ] Add to `packages/env/src/index.ts`:

```typescript
  invoiceSigningSecret: () => process.env.INVOICE_SIGNING_SECRET ?? null,
```

Commit.

---

## Epic 11 — Smoke tests

### Task 33: `scripts/smoke-invoice-pdf-render.ts`

**Files:**
- Create: `scripts/smoke-invoice-pdf-render.ts`
- Modify: `package.json` — add `smoke:invoice-pdf` script

- [ ] Write a tiny wrapper that loads the fixture JSON + calls `renderInvoicePdfBuffer` and writes to `/tmp/sample-invoice.pdf`. Print size + first 4 bytes. Useful for eyeballing the PDF locally.

### Task 34: `scripts/smoke-invoice-booking.ts`

- [ ] Seeds a Tenant + Trip + Booking (with `externalId` set to a fake hex32 tripId), then imports + invokes `generateBookingInvoiceTool.handler({ bookingId })`. Asserts:
  - `Invoice` row exists with status=paid, bookingId matches
  - `InvoiceLineItem` count == 1
  - `InvoicePayment` row with method=escrow_settle if settleTxHash passed
  - `pdfBlobUrl` starts with `https://`
  - `fetch('/invoice/<token>')` returns 200 (needs dev server running; skip if not)

Requires: `BLOB_READ_WRITE_TOKEN`, `INVOICE_SIGNING_SECRET`, `DATABASE_URL`, `RESEND_API_KEY` (optional — email failure tolerated).

### Task 35: `scripts/smoke-invoice-platform-bill.ts`

- [ ] Seeds a Tenant + 5 paid MeterEvents from prior month. Hits `GET /api/cron/generate-platform-bills` with `Authorization: Bearer ${CRON_SECRET}`. Asserts:
  - Response contains one `invoiced` result for the seeded tenant
  - `Invoice` row with `kind='platform_bill'` + non-null `periodStart/End`
  - All 5 MeterEvents have `invoiceRef` set
  - `status` = 'paid' for free/pro tier or 'issued' for business/enterprise

Requires dev server running on `:3010`.

---

## Final gate

```bash
bun run typecheck 2>&1 | tail -10
bun test packages/invoicing 2>&1 | tail -5
bun run deploy:fonts     # one-time, unless already done
bun run smoke:invoice-pdf
bun run smoke:invoice-booking      # dev server on :3010 + Neon
bun run smoke:invoice-platform-bill
```

Expected: zero type errors; all tests green; smokes end with `✓`.

---

## Self-review (author)

**Spec coverage:**
- `@sendero/invoicing` package port → Epic 2+4+5 ✓
- Prisma schema → Epic 1 ✓
- Font deploy to Vercel Blob → Epic 3 ✓
- Booking invoice flow → Epic 8 ✓
- Platform bill flow → Epic 9 ✓
- Public viewer + PDF download routes → Epic 7 ✓
- Email delivery with PDF attachment → Epic 6 ✓
- Env + health → Epic 10 ✓
- Tier-based payment semantics (NET-30 vs prepaid) → Task 29 ✓
- Smoke tests → Epic 11 ✓

**Placeholder scan:** No TODOs / TBDs in task bodies. Tasks 13-15 describe a "port pattern" rather than inline every component's code (~200 LOC each); the plan explicitly points at desk-v1's source with the color/font substitutions required. Implementer copy-adapts verbatim — acceptable given the spec already covers the pattern in detail.

**Type consistency:** `TemplateProps`, `Template`, `LineItemInput` used consistently across tasks. `InvoiceKind` + `InvoiceStatus` enums match between schema and tool handler.

**Scope:** 35 tasks — larger than phase-11a's 27, but invoicing genuinely spans package creation + schema + two flows + public surface. Decomposition into 4 smaller PRs is possible at merge time if the subagent flow requests it.

## Open items for the implementer

- If `Booking.externalId` isn't currently used for escrow bookingId mapping, Task 26 needs a spec clarification. The phase-11a workflow edits use `reservation.bookingId` (escrow hex32) as the scratchpad reference; Prisma `Booking.id` is a cuid. Decide: (a) add `Booking.escrowBookingId` column to store the hex32 + use for lookup, or (b) repurpose `externalId` (currently Duffel order id). Recommend (a) — less coupling.
- Task 13-16 port is longer than the body suggests. Budget 2-3 hours per component for port + theme swap + visual QA.
- Brand colors on PDF — explicitly deferred to 11d per the 11c2 spec. Don't block on it here.
