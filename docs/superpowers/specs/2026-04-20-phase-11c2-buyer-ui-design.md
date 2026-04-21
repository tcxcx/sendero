# Phase-11c2 — Buyer UI screens

**Date:** 2026-04-20
**Branch:** feat/phase-11-invoicing
**Baseline:** phase-11a complete; phase-11b spec approved; phase-11c1 spec approved (Clerk auth + Tailwind in place; `@sendero/auth`, `<UserDetails/>` visualizer, protected middleware)
**Prereq for:** phase-11d (UI polish, full Clerk component palette, ⌘K cmdk, etc.)
**Source material:**
- desk-v1 `@bu/ui` — design-system package shape with subpath exports + Storybook
- desk-v1 `apps/app/src/components/sheets/invoice-create` — sheet-based form pattern
- shadcn preset `b3HaJzRpbc` (user's custom registry config)

## Problem

Phase-11c1 installs auth + onboarding shell. The visible buyer product still doesn't exist — no way to prefund a trip from the UI, view invoices, or edit tenant settings. 11c2 fills in the core buyer surfaces behind the Clerk gate, migrates existing `/admin/spend` + `/admin/caps` into the protected route group, and establishes `@sendero/ui` as the monorepo's shared design system so future apps (docs, marketing, help) can adopt the same primitives.

## Scope

### In

- New `@sendero/ui` package — shadcn primitives + utilities + Tailwind config + globals.css; subpath exports (mirrors desk-v1's `@bu/ui`)
- Shadcn CLI init inside the package: `bunx --bun shadcn@latest init --preset b3HaJzRpbc --template next`
- Buyer UI routes under `apps/app/app/(app)/*`:
  - `/app` — dashboard home (recent trips + unpaid invoices summary)
  - `/app/trips` — list + "New trip" sheet (opens via `?sheet=new`)
  - `/app/trips/[id]` — trip detail
  - `/app/billing/invoices` — list with filters
  - `/app/billing/invoices/[id]` — detail (native HTML render + PDF download button)
  - `/app/spend` — migrated from `/admin/spend`
  - `/app/caps` — migrated from `/admin/caps`
  - `/app/settings/billing` — billing contact + tax id form
  - `/app/settings/branding` — logo + brand colors (agency tier only)
  - `/app/settings/profile` — moved from `/app/profile` (from 11c1)
  - `/app/debug/clerk` — dev-only `<UserDetails/>` (from 11c1)
- App shell: `AppHeader` + `Sidebar` + `PageHeader`
- Prefund sheet + form (zod-validated, calls existing `POST /api/guest/invite`)
- Invoice list + detail (reads phase-11b `Invoice` model)
- Settings forms (Billing, Branding, Profile) with server actions
- Role/tier enforcement via Clerk `auth.protect()` + custom tier gate
- Legacy `/admin/spend` + `/admin/caps` → 301 redirect to new paths
- Wire `apps/storybook` to `@sendero/ui` (publishes to `sendero-arc-storybook` project)

### Out (deferred)

- `⌘K` command palette → phase-11d
- Rich empty-state illustrations → phase-11d polish
- Client-side TanStack Table (sticky columns, multi-sort) → phase-11d
- Cohort CSV upload full-page wizard → phase-12 (agency white-label)
- Real-time trip status updates via Liveblocks → phase-11d
- Embedded PDF viewer inline on invoice detail page (download-only in 11c2)
- Duffel itinerary fancy card on trip detail → phase-11d (v1 shows raw Duffel ref)
- Admin retry actions for failed invoices/batches via UI → CLI-only in v1
- Team-member invite UI → ships with Clerk `<OrganizationProfile/>` in phase-11d
- In-browser userOp signer for on-chain `prefund_trip` calls → already out of 11c1 scope, stays out
- Migration of `apps/docs` / `apps/marketing` / `apps/help` to `@sendero/ui` primitives — can adopt later

## Architecture

### `@sendero/ui` package

```
packages/ui/
├── package.json                              — subpath exports per component, sideEffects: false
├── components.json                           — shadcn config, aliases point at src/components
├── tailwind.config.ts                        — Sendero tokens (preset b3HaJzRpbc); exported for apps
├── postcss.config.js                         — @tailwindcss/postcss v4
├── tsconfig.json
├── src/
│   ├── globals.css                          — @tailwind base/components/utilities + Sendero layer
│   ├── utils/
│   │   └── cn.ts                            — clsx + tailwind-merge (port desk-v1 verbatim)
│   ├── hooks/
│   │   └── use-toast.ts                     — shadcn toast hook
│   ├── components/                          — shadcn primitives (generated + hand-curated)
│   │   ├── button.tsx, table.tsx, dialog.tsx, sheet.tsx,
│   │   ├── form.tsx, input.tsx, textarea.tsx, select.tsx, label.tsx, checkbox.tsx,
│   │   ├── card.tsx, badge.tsx, tabs.tsx, skeleton.tsx, alert.tsx, separator.tsx,
│   │   ├── dropdown-menu.tsx, tooltip.tsx, popover.tsx,
│   │   ├── toast.tsx, sonner.tsx,
│   │   └── ... (whatever preset b3HaJzRpbc adds on init)
│   └── stories/                              — Storybook stories per component
│       ├── button.stories.tsx, table.stories.tsx, sheet.stories.tsx, ...
└── .storybook/ (optional — storybook app consumes these; may live in apps/storybook instead)
```

**`components.json`:**

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "default",
  "rsc": true,
  "tsx": true,
  "tailwind": {
    "config": "tailwind.config.ts",
    "css": "src/globals.css",
    "baseColor": "neutral",
    "cssVariables": true,
    "prefix": ""
  },
  "aliases": {
    "components": "@sendero/ui/components",
    "utils": "@sendero/ui/cn",
    "ui": "@sendero/ui"
  }
}
```

**`package.json` exports** (pattern from desk-v1):

```json
{
  "name": "@sendero/ui",
  "private": true,
  "type": "module",
  "sideEffects": ["**/*.css"],
  "exports": {
    "./globals.css": "./src/globals.css",
    "./tailwind.config": "./tailwind.config.ts",
    "./cn": "./src/utils/cn.ts",
    "./hooks/use-toast": "./src/hooks/use-toast.ts",
    "./button": "./src/components/button.tsx",
    "./sheet": "./src/components/sheet.tsx",
    "./table": "./src/components/table.tsx",
    "./dialog": "./src/components/dialog.tsx",
    "./form": "./src/components/form.tsx",
    "./input": "./src/components/input.tsx",
    "./textarea": "./src/components/textarea.tsx",
    "./select": "./src/components/select.tsx",
    "./label": "./src/components/label.tsx",
    "./checkbox": "./src/components/checkbox.tsx",
    "./card": "./src/components/card.tsx",
    "./badge": "./src/components/badge.tsx",
    "./tabs": "./src/components/tabs.tsx",
    "./skeleton": "./src/components/skeleton.tsx",
    "./alert": "./src/components/alert.tsx",
    "./separator": "./src/components/separator.tsx",
    "./dropdown-menu": "./src/components/dropdown-menu.tsx",
    "./tooltip": "./src/components/tooltip.tsx",
    "./popover": "./src/components/popover.tsx",
    "./toast": "./src/components/toast.tsx",
    "./sonner": "./src/components/sonner.tsx"
  }
}
```

Each new component added later appends one line to `exports`.

### Init workflow (one-time, documented in `docs/shadcn-setup.md`)

```bash
cd packages/ui
bunx --bun shadcn@latest init --preset b3HaJzRpbc --template next
# The preset applies Sendero tokens (#fb542b primary, Geist fonts, neutral base)
# Answers: tsx yes, globals.css path src/globals.css, tailwind config tailwind.config.ts
# Installs: class-variance-authority, clsx, tailwind-merge, lucide-react, tailwindcss-animate

bunx --bun shadcn@latest add button table dialog sheet form input textarea select \
  label checkbox card badge tabs skeleton alert separator dropdown-menu tooltip \
  popover sonner
```

After init, manually:
1. Convert `components.json aliases.components` to point at `src/components` (package-internal, not `@/components`)
2. Add subpath entry per component in `package.json` `exports` map
3. Export the package from `apps/app/package.json` deps as `@sendero/ui: workspace:*`
4. Port `cn.ts` verbatim from desk-v1

### Apps consumption

**`apps/app/app/layout.tsx`** (11c1 wires ClerkProvider; 11c2 adds UI globals):

```tsx
import '@sendero/ui/globals.css';                 // new in 11c2 — replaces inline styles over time
import { SenderoAuthProvider } from '@sendero/auth';
// ... existing ClerkLoaded/Loading/Failed wrapping from 11c1
```

**`apps/app/tailwind.config.ts`**:

```ts
import uiConfig from '@sendero/ui/tailwind.config';

export default {
  presets: [uiConfig],
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    '../../packages/ui/src/**/*.{ts,tsx}',
  ],
};
```

Component usage:

```tsx
import { Button } from '@sendero/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@sendero/ui/sheet';
import { cn } from '@sendero/ui/cn';
```

### `apps/storybook` wiring

- `apps/storybook/.storybook/preview.ts` imports `@sendero/ui/globals.css`
- `apps/storybook/.storybook/main.ts` glob: `'../../../packages/ui/src/stories/**/*.stories.@(ts|tsx)'`
- Storybook tailwind config presets `@sendero/ui/tailwind.config`
- `vercel.json` at `apps/storybook` already configured in bootstrap; each push to `development` or `main` rebuilds the site

### Route structure (protected `(app)` route group)

```
apps/app/app/
├── layout.tsx                                — ClerkProvider wrap (11c1) + globals.css (11c2)
├── page.tsx                                  — landing page (public)
├── sign-in/[[...sign-in]]/page.tsx          — 11c1
├── sign-up/[[...sign-up]]/page.tsx          — 11c1
├── onboarding/…                             — 11c1
├── g/…                                       — guest claim (public)
├── invoice/[token]/page.tsx                  — 11b public viewer
├── admin/                                    — DEPRECATED — 301 redirects
│   ├── spend/page.tsx                        — redirect to /app/spend
│   └── caps/page.tsx                         — redirect to /app/caps
└── (app)/                                    — protected route group
    ├── layout.tsx                            — <AppHeader/> + <Sidebar/> + <main>{children}</main>
    ├── page.tsx                              — /app — dashboard home
    ├── trips/
    │   ├── page.tsx                          — list + "?sheet=new" opens PrefundSheet
    │   └── [id]/page.tsx                     — trip detail
    ├── billing/
    │   └── invoices/
    │       ├── page.tsx                      — list with filters
    │       └── [id]/page.tsx                 — detail + PDF download button
    ├── spend/page.tsx                        — migrated from /admin/spend
    ├── caps/page.tsx                         — migrated from /admin/caps
    ├── settings/
    │   ├── layout.tsx                        — <SettingsNav/> + content pane
    │   ├── billing/page.tsx
    │   ├── branding/page.tsx                 — gate: org:admin AND tier in [business, enterprise]
    │   └── profile/page.tsx                  — moved from /app/profile in 11c1
    └── debug/
        └── clerk/page.tsx                    — dev-only; notFound() in prod
```

### Feature components — `apps/app/components/`

Composition of `@sendero/ui` primitives. NOT exported to other apps.

```
apps/app/components/
├── app-shell/
│   ├── app-header.tsx                       — brand + <OrganizationSwitcher/> + <UserButton/> + <Show/>
│   ├── sidebar.tsx                          — flat nav: Trips · Invoices · Spend · Caps · Settings
│   └── page-header.tsx                      — title + optional actions slot
├── trips/
│   ├── trips-table.tsx                      — columns: id · summary · budget · status · claimed by · created · actions
│   ├── trip-detail-card.tsx                 — metadata + escrow state + booking list
│   ├── trip-status-badge.tsx                — <Badge/> variant per TripStatus
│   └── prefund-sheet/
│       ├── prefund-sheet.tsx                — <Sheet/> wrapper, opens via ?sheet=new query param
│       ├── prefund-form.tsx                 — <Form/> + zod schema + POST /api/guest/invite
│       └── prefund-success.tsx              — renders guestLink + claimCode (if 2FA) + onchainCalls preview
├── invoices/
│   ├── invoices-table.tsx                   — columns: number · kind · status · total · issued · due · actions
│   ├── invoice-detail-view.tsx              — native HTML render of line items + totals + payments
│   ├── invoice-filters.tsx                  — status + kind + period dropdowns, URL-driven
│   ├── invoice-status-badge.tsx             — <Badge/> variant per InvoiceStatus
│   └── download-pdf-button.tsx              — <Button/> → fetch('/api/invoices/[id]/pdf') → blob download
├── settings/
│   ├── settings-nav.tsx                     — submenu: Billing · Branding · Profile (debug nested in dev)
│   ├── billing-settings-form.tsx            — <Form/> legalName + billingContactEmail + billingAddress + taxId
│   └── branding-settings-form.tsx           — logo upload (Vercel Blob) + <ColorPicker/> (port from desk-v1)
├── spend/
│   └── spend-dashboard.tsx                  — migrated, shadcn <Card/> + <Table/>
├── caps/
│   ├── caps-list.tsx                        — shadcn <Table/>
│   └── caps-form.tsx                        — migrated upsert-cap form
└── shared/
    ├── page-pagination.tsx                  — ?page= query-driven, Prev/Next
    └── empty-state.tsx                      — simple text + CTA <Button/>
```

## Route-by-route design

### `/app` (dashboard home)

Server-rendered. Three summary cards:

- **Active trips** — count + top 3 rows from TripsTable (click → `/app/trips`)
- **Unpaid invoices** — count + dollar total from Invoices where status ∈ [issued, overdue]
- **Month-to-date spend** — sum of MeterEvents this month, links to `/app/spend`

All queries tenant-scoped via `auth().orgId → Tenant.clerkOrgId`.

### `/app/trips`

Server-rendered list:

- `<PageHeader>` title "Trips" with action `<Button onClick={openSheet}>New trip</Button>` (actually wraps a `<Link href="?sheet=new" />` — server-safe)
- Filters: `<InvoiceFilters/>`-style dropdowns for status + traveler + date range
- `<TripsTable>` with columns, pagination
- `<PrefundSheet/>` rendered always; controlled by URL param `?sheet=new` via `useSearchParams` — auto-opens when the param is set, closes navigates back to `/app/trips`

Empty state: "No trips yet. Create one with the **New trip** button."

### `/app/trips/[id]`

- Trip metadata card: id (truncated + copy), tripSummary, budgetUsdc, expiresAt, claimCode (masked for privacy), status badge
- Escrow state: reserved / committed / settled / available — sourced from on-chain reads via ponder OR cached in DB from prior webhook resumes
- Booking list: each booking row shows kind, vendor, totalUsd, PNR, status, linked invoice (if any)
- Actions: **Cancel trip** (admin only, confirms), **Email guest link** (resends), **Open public claim URL** (copy to clipboard)

### `/app/billing/invoices`

Server-rendered list with filters + pagination.

- `<PageHeader>` title "Invoices"
- `<InvoiceFilters>` — status multi-select, kind dropdown (booking / platform_bill / credit_note), period (this month / last month / YTD / custom date range)
- `<InvoicesTable>` — clickable rows → detail

Empty state: "No invoices yet."

### `/app/billing/invoices/[id]`

- Meta header: number, kind, status badge, issuedAt, dueAt (if unpaid), total
- Issuer block (from\*) + Recipient block (to\*) in two-column card
- `<InvoiceLineItems>` shadcn Table
- Totals block (subtotal, tax, vat, discount, total)
- Payments list (if any)
- `<DownloadPdfButton/>` — primary CTA; "View public URL" link secondary
- `<CopyPublicUrlButton/>` — copies `https://sendero.travel/invoice/<token>` to clipboard

### `/app/spend` (migrated)

Port `apps/app/app/admin/spend/page.tsx` verbatim but:

- Remove query-param `?tenantId=` — always uses `auth().orgId → Tenant`
- Replace inline CSS with shadcn Card + Table
- Same data: tenant spend summary + recent NanopayBatches

### `/app/caps` (migrated)

Port `apps/app/app/admin/caps/page.tsx` + `actions.ts`:

- `auth.protect({ role: 'org:admin' })` at top of page
- Upsert form uses shadcn `<Form/>` + zod + `useFormStatus`
- List of existing caps in shadcn Table

### `/app/settings/billing`

Server component loads Tenant. `<BillingSettingsForm/>` shadcn form with:

- `legalName` (text)
- `billingContactEmail` (email)
- `billingAddress` — nested inputs: line1, line2, city, region, postalCode, country (shadcn `<Select/>` of ISO codes)
- `taxId` (text) — helper label "RFC (MX), VAT (EU), EIN (US)"

Server action `updateTenantBillingAction(data)`:

1. `auth.protect({ role: 'org:admin' })`
2. Zod parse
3. Prisma update
4. `clerkClient.organizations.updateOrganization({ publicMetadata: { legalName, taxId } })` — keep session claims fresh
5. `revalidatePath('/app/settings/billing')`
6. Return `{ ok: true }` → toast

### `/app/settings/branding` (agency tier only)

Gate at layout level:

```tsx
const { orgId, has } = await auth();
const tenant = await prisma.tenant.findUnique({ where: { clerkOrgId: orgId }, select: { billingTier: true } });
if (!has({ role: 'org:admin' }) || !['business', 'enterprise'].includes(tenant.billingTier)) {
  return <Alert variant="destructive">Branding settings are available on Business + Enterprise tiers. <a href="/app/settings/billing">Upgrade</a></Alert>;
}
```

Form:

- **Logo upload** — `<input type="file">` → server action → `@vercel/blob.put('/tenants/<id>/logo.png', file, { access: 'public' })` → store URL in `Tenant.brandLogoUrl`
- **Brand colors** — three color pickers (primary, secondary, accent). Port minimal color picker or reuse a shadcn community component; hex input fallback. Persists to `Tenant.brandColors`
- Preview panel shows how the invoice would look with these colors applied (re-renders `@sendero/invoicing/templates/html` with these overrides)

### `/app/settings/profile`

`<UserDetails showPointers={false} extraSections={['wallet']}/>` from 11c1. Thin server-shell, client component renders live Clerk data.

## Role / tier gating

Implemented at the **page-level** via `await auth.protect({ role })` (redirects to `/app` with a toast) or custom `<Alert/>` fallback for tier gates.

| Route | Role gate | Tier gate |
|-------|-----------|-----------|
| `/app` | any active org | — |
| `/app/trips` | any | — |
| `/app/trips/new` (sheet) | `org:admin` OR `org:member` | — |
| `/app/trips/[id]` | any | — |
| `/app/trips/[id]` cancel action | `org:admin` | — |
| `/app/billing/invoices` | `org:admin` OR `org:finance` | — |
| `/app/spend` | `org:admin` OR `org:finance` | — |
| `/app/caps` | `org:admin` | — |
| `/app/caps` upsert | `org:admin` | — |
| `/app/settings/billing` | `org:admin` | — |
| `/app/settings/branding` | `org:admin` | `business` OR `enterprise` |
| `/app/settings/profile` | any | — |
| `/app/debug/clerk` | any | `process.env.NODE_ENV !== 'production'` |

Sidebar + header hide links the user lacks role for (soft gate — aesthetic). Backend `auth.protect()` is the hard gate (security).

## Data flow

### Prefund sheet submission

```
User clicks "New trip" on /app/trips → ?sheet=new
  → <PrefundSheet/> renders via search-params effect
  → <PrefundForm/> (client component) with zod schema:
      { budgetUsdc, guestEmail, guestName?, tripSummary?, expiresInDays, require2fa }
  → Submit → POST /api/guest/invite (existing from phase-10)
  → Response { tripId, guestLink, claimCode?, onchainCalls, invite: {ok} }
  → <PrefundSuccess/> shows:
      - "Invite sent to <email>" (if email delivery ok)
      - "Guest link (copy + share): <guestLink>"
      - "Claim code (share separately): <claimCode>" (if 2FA)
      - "Next: submit onchain calls via Circle Modular Wallet" + <pre> with {onchainCalls}
  → "Done" button → router.push('/app/trips') → list refreshes, new row appears with status=pending_claim
```

**Known gap:** `/api/guest/invite` returns encoded calls but doesn't submit. In-browser userOp signing UX is deferred (phase-11d + Circle Modular Wallets SDK integration). For v1, the success state explicitly shows the calls; an advanced user / backend cron submits them. Good enough for hackathon demo; the text makes the boundary explicit.

### Invoice PDF download

```
User clicks <DownloadPdfButton/> on /app/billing/invoices/[id]
  → Button onClick → fetch('/api/invoices/<id>/pdf')
  → Route handler (new in 11b):
      1. auth() → verify tenant match via Invoice.tenantId
      2. If Invoice.pdfBlobUrl present → redirect to signed Blob URL (short TTL)
         Else → render PDF on-demand via @sendero/invoicing, persist to Blob, return URL
  → Browser downloads invoice-<number>.pdf
```

### Billing settings save

```
Submit <BillingSettingsForm/>
  → Server action updateTenantBillingAction(data):
      1. auth.protect({ role: 'org:admin' })
      2. Zod parse (typed errors return inline)
      3. prisma.tenant.update({ where: { clerkOrgId: orgId }, data })
      4. clerkClient.organizations.updateOrganization({ organizationId: orgId, publicMetadata: {...} })
      5. revalidatePath('/app/settings/billing')
      6. return { ok: true }
  → Toast "Settings saved"
  → Form resets dirty state
```

## Pagination + filtering

All list pages use URL-encoded server-rendered pagination:

```
/app/trips?page=2&status=claimed&traveler=jane%40acme.com
```

Helper: `parseListQuery(searchParams: { page?, per?, status?, ... })` returns `{ skip, take, where }` for Prisma.

`<PagePagination/>` component shows `< Prev | 1 2 3 4 ... | Next >` + `per-page` select. All links are `<a>` (server-navigated, no JS).

Per-page default: 25; max 100.

Sort via clickable column headers → `?sort=-createdAt`.

## Error handling

- **Server component Prisma error** → React `error.tsx` boundary per route group → shows `<Alert variant="destructive">` with retry link
- **Form validation error** → inline zod messages (shadcn `<FormMessage/>` component)
- **Server action error** → return `{ error }` → client shows toast via sonner
- **403 (role gate)** → `<Alert/>` in the page, soft CTA to contact admin; hard gate is `auth.protect()` which redirects
- **404 (cross-tenant resource)** → generic `notFound()` — don't leak existence
- **Vercel Blob failure on logo upload** → inline error in branding form, no schema mutation happens
- **Dashboard crash fallback** → `loading.tsx` + `error.tsx` boundaries per route group

## Test plan

### Unit (Bun test)

- `packages/ui/src/utils/cn.test.ts` — port desk-v1's tests
- `apps/app/components/trips/prefund-form.test.ts` — zod schema validation edge cases (invalid email, budget formats)
- `apps/app/components/invoices/invoice-filters.test.ts` — URL param parsing
- `apps/app/lib/parse-list-query.test.ts` — pagination + filter parsing

### Integration (Playwright against preview)

- `e2e/prefund-flow.spec.ts` — sign in → open sheet → submit → verify trip row appears
- `e2e/invoice-detail.spec.ts` — navigate to invoice, click download, verify PDF blob arrives
- `e2e/settings-save.spec.ts` — update billing contact email, verify DB + Clerk org metadata updated
- `e2e/role-gate.spec.ts` — sign in as `org:member` user, verify `/app/settings/billing` shows forbidden alert; sign in as `org:admin`, verify it loads

### Storybook

- Every `@sendero/ui` component has one story covering default + variants
- Published to `sendero-arc-storybook` Vercel project on merge to `development`

### Manual gate

- Hackathon demo runthrough: sign up a fresh buyer → create tenant → fund a trip → see invoice issued after settle → download PDF → update branding on agency tenant → watch invoice HTML viewer reflect new colors

## Files

### New

- `packages/ui/` — entire package (package.json, components.json, tailwind.config.ts, postcss.config.js, src/*)
- `packages/ui/src/stories/*.stories.tsx` — one per primitive
- `docs/shadcn-setup.md` — runbook for the preset init + subpath export maintenance
- `apps/app/app/(app)/layout.tsx`
- `apps/app/app/(app)/page.tsx`
- `apps/app/app/(app)/trips/page.tsx`
- `apps/app/app/(app)/trips/[id]/page.tsx`
- `apps/app/app/(app)/billing/invoices/page.tsx`
- `apps/app/app/(app)/billing/invoices/[id]/page.tsx`
- `apps/app/app/(app)/spend/page.tsx`
- `apps/app/app/(app)/caps/page.tsx`
- `apps/app/app/(app)/settings/layout.tsx`
- `apps/app/app/(app)/settings/billing/page.tsx`
- `apps/app/app/(app)/settings/branding/page.tsx`
- `apps/app/app/(app)/settings/profile/page.tsx`
- `apps/app/app/(app)/debug/clerk/page.tsx`
- `apps/app/app/admin/spend/page.tsx` — redirect stub
- `apps/app/app/admin/caps/page.tsx` — redirect stub
- `apps/app/components/app-shell/{app-header,sidebar,page-header}.tsx`
- `apps/app/components/trips/{trips-table,trip-detail-card,trip-status-badge}.tsx`
- `apps/app/components/trips/prefund-sheet/{prefund-sheet,prefund-form,prefund-success}.tsx`
- `apps/app/components/invoices/{invoices-table,invoice-detail-view,invoice-filters,invoice-status-badge,download-pdf-button}.tsx`
- `apps/app/components/settings/{settings-nav,billing-settings-form,branding-settings-form}.tsx`
- `apps/app/components/spend/spend-dashboard.tsx`
- `apps/app/components/caps/{caps-list,caps-form}.tsx`
- `apps/app/components/shared/{page-pagination,empty-state}.tsx`
- `apps/app/app/api/invoices/[id]/pdf/route.ts` — if not already from 11b, add here
- `apps/app/app/api/tenants/settings/route.ts` OR server actions in `apps/app/app/(app)/settings/actions.ts`
- `apps/app/app/api/tenants/branding-logo/route.ts` — Vercel Blob upload handler
- `apps/app/lib/parse-list-query.ts`
- `apps/app/e2e/*.spec.ts`

### Modified

- `apps/app/app/layout.tsx` — import `@sendero/ui/globals.css`
- `apps/app/tailwind.config.ts` — presets `@sendero/ui/tailwind.config`
- `apps/app/package.json` — add `@sendero/ui: workspace:*`
- `apps/storybook/.storybook/*` — wire `@sendero/ui` + Sendero theme
- `apps/storybook/tailwind.config.ts` — presets `@sendero/ui/tailwind.config`
- `packages/sendero-env/src/validate.ts` — nothing new here (reuses 11c1's Clerk + 11b's invoicing envs)

### Touched but not heavily modified

- `apps/app/components/app-shell/*` — may reuse some existing header/dialog code from `apps/app/components/ui.tsx` (old pre-shadcn helpers); replace over time

## Schema

No new Prisma models in 11c2 — all reads/writes go against:

- `Trip`, `Booking` (existing)
- `Invoice`, `InvoiceLineItem`, `InvoicePayment` (phase-11b)
- `Tenant` (11b billing fields + 11c1 clerkOrgId)
- `MeterEvent`, `NanopayBatch`, `TenantSpendCap` (existing; spend + caps pages read)

## Rollout

Single PR on `feat/phase-11-invoicing` (or a dedicated `feat/phase-11c2-buyer-ui` branch if 11c1 hasn't merged yet — decide at execution time).

Merge order inside the PR:

1. `@sendero/ui` package bootstrap (init + subpath exports + cn + tailwind config)
2. `apps/storybook` wires up
3. `apps/app/(app)/layout.tsx` + `app-shell/*`
4. Settings routes + server actions
5. Trips list + detail + prefund sheet
6. Invoices list + detail + PDF download
7. Spend + Caps migration (redirect stubs for old paths)
8. E2E tests

Deploy to preview, validate the hackathon demo flow end-to-end, promote to prod together with 11c1 + 11b.

## Risks / open questions

- **shadcn preset `b3HaJzRpbc` compatibility** — the preset may target a specific shadcn CLI version. Document the exact CLI version that was used to init (pin `shadcn` devDep) so future adds stay consistent.
- **Subpath export churn** — every new component adds a `package.json` exports entry. Easy to forget. Add a post-add script `bun run scripts/sync-ui-exports.ts` that regenerates the exports map from the `src/components/` directory.
- **Tailwind content paths** — apps/app Tailwind config needs to include `../../packages/ui/src/**`; missing this means classes get purged. Verified in Storybook before landing.
- **Prefund sheet onchainCalls UX** — showing raw JSON is developer-grade. Phase-11d upgrades to a "Confirm with Circle Modular Wallet" button that actually signs + submits. Document the boundary clearly in the success state so demo viewers understand.
- **Storybook static output size** — 30 component stories = ~5MB build; fine for Vercel. If we grow to 100+, consider splitting into two Storybook apps (primitives vs features).
- **Brand colors applied to invoice PDF at render time** — phase-11b's PDF template uses hardcoded `#fb542b`. For agency white-label to show correctly in the preview panel, the template needs to accept color overrides from `Tenant.brandColors` — this is a small delta in phase-11b's transform.ts OR can be deferred to the phase-11d polish pass. Document as "agency branding previews show via the HTML template only in 11c2; PDF override comes in 11d or a phase-11b follow-up."
- **Legacy admin redirects** — 301 to `/app/spend` + `/app/caps`. If external dashboards / bookmarks linked to old URLs, they still work.

## Decision log

- 2026-04-20 — user confirmed: shadcn preset `b3HaJzRpbc`, `bunx --bun shadcn@latest init --preset b3HaJzRpbc --template next`, full component palette
- 2026-04-20 — user confirmed: components live in new `@sendero/ui` package (mirrors desk-v1's `@bu/ui`); subpath exports per component
- 2026-04-20 — user confirmed: prefund UX is a sheet (A), cohort upload wizard deferred to phase-12
- 2026-04-20 — user confirmed: invoice detail page is native HTML + PDF download button (B); no embedded viewer
- 2026-04-20 — user confirmed: `/admin/spend` + `/admin/caps` migrate to `(app)` route group in 11c2 with 301 redirects from old paths (A)
- 2026-04-20 — user confirmed: flat sidebar with Settings submenu (A); ⌘K cmdk deferred to 11d
- 2026-04-20 — decision: server-rendered pagination with URL-encoded filters; 25/page default, max 100; no client-side table in v1
- 2026-04-20 — decision: simple text + CTA empty states; illustrations deferred to 11d

## Deferred to phase-11d (reminders)

- ⌘K command palette using shadcn `cmdk`
- Rich empty-state illustrations
- Client-side TanStack Table with sticky columns + multi-sort + column visibility toggles
- Real-time trip status via Liveblocks (already scaffolded in `packages/collaboration`)
- Duffel itinerary fancy card on trip detail
- Admin retry actions for failed invoices / batches / wallet provisioning
- Team-member invite UI — Clerk `<OrganizationProfile/>` embedded at `/app/settings/org`
- Upgrade `/app/settings/profile` from `<UserDetails/>` to full Clerk `<UserProfile/>` with API keys tab
- `<RedirectToTasks/>` + `<AuthenticateWithRedirectCallback/>` for advanced auth flows
- Full prefund UX — in-browser userOp signing via Circle Modular Wallets SDK
- Brand color overrides applied to invoice PDF template (not just HTML preview)
- Verified Domains auto-invite UI
- MFA onboarding flow using `<TaskSetupMFA/>`
- Cohort CSV upload full-page wizard → phase-12
