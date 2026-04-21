# Phase-11d — UI Polish + Clerk Component Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Iterate on 11c1 + 11c2 surfaces to polish the buyer experience: swap `<UserDetails/>` for full `<UserProfile/>`, add `<OrganizationProfile/>` for team invites, wire `<RedirectToTasks/>` + `<AuthenticateWithRedirectCallback/>`, adopt cmdk command palette, upgrade trips/invoices to client-side TanStack Table, apply agency brand colors to PDF renders, add Verified Domains UI, and enable MFA task onboarding.

**Architecture:** Additive iteration — no new packages, no new major surfaces. Each task either upgrades an existing 11c2 component, enables a previously-deferred Clerk component, or adds a polish feature. Runs in a dedicated PR per epic so each improvement lands independently.

**Tech Stack:** Clerk components (`<UserProfile/>`, `<OrganizationProfile/>`, `<RedirectToTasks/>`, `<AuthenticateWithRedirectCallback/>`, `<TaskSetupMFA/>`), shadcn cmdk, `@tanstack/react-table`, Liveblocks, `lucide-react` (already installed), existing `@sendero/ui` + `@sendero/auth`.

**Baseline:** 11b + 11c1 + 11c2 shipped. Branch `feat/phase-11d-polish` (new branch; small, independent improvements).

**Conventions:** same as prior plans. Each epic can merge independently behind a feature flag if needed.

---

## File structure

No new packages. Additions + modifications only:

- `apps/app/app/(app)/settings/profile/page.tsx` — upgrade to `<UserProfile/>`
- `apps/app/app/(app)/settings/org/page.tsx` — new, `<OrganizationProfile/>`
- `apps/app/app/(app)/layout.tsx` — wrap with `<RedirectToTasks/>`
- `apps/app/app/sign-in/sso-callback/page.tsx` — `<AuthenticateWithRedirectCallback/>`
- `apps/app/components/cmdk/command-palette.tsx`
- `apps/app/components/cmdk/use-command-palette.ts`
- `apps/app/components/trips/trips-table-client.tsx` — TanStack version
- `apps/app/components/invoices/invoices-table-client.tsx` — TanStack version
- `apps/app/components/trips/trip-realtime-status.tsx` — Liveblocks
- `apps/app/components/trips/duffel-itinerary-card.tsx`
- `apps/app/components/shared/illustrations/*.tsx` — empty-state illustrations
- `apps/app/components/admin/retry-button.tsx` + associated routes
- `packages/invoicing/src/templates/pdf/index.tsx` — accept brand-color overrides
- `apps/app/app/(app)/settings/branding/preview.tsx` — re-render preview with new colors live

---

## Sequencing

- **Epic 1** — `<UserProfile/>` upgrade (replaces interim `<UserDetails/>` on profile page)
- **Epic 2** — `<OrganizationProfile/>` for team/invite management
- **Epic 3** — `<RedirectToTasks/>` + `<AuthenticateWithRedirectCallback/>` safety nets
- **Epic 4** — cmdk command palette (`⌘K`)
- **Epic 5** — Client-side TanStack Table upgrades
- **Epic 6** — Brand colors applied to invoice PDF rendering
- **Epic 7** — Liveblocks real-time trip status
- **Epic 8** — Duffel itinerary fancy card
- **Epic 9** — Empty-state illustrations
- **Epic 10** — Admin retry actions (invoices, batches, wallet provisioning)
- **Epic 11** — Verified Domains UI + MFA task

Each epic is independent and can ship in its own PR.

---

## Epic 1 — `<UserProfile/>` upgrade

### Task 1: Replace `<UserDetails/>` with `<UserProfile/>`

**Files:**
- Modify: `apps/app/app/(app)/settings/profile/page.tsx`

- [ ] **Step 1:**

```tsx
import { UserProfile } from '@clerk/nextjs';

export default function ProfilePage() {
  return (
    <main className="flex justify-center p-6">
      <UserProfile
        appearance={{
          elements: {
            rootBox: 'w-full max-w-4xl',
            card: 'shadow-none border border-neutral-200',
          },
        }}
      />
    </main>
  );
}
```

- [ ] **Step 2: Move `<UserDetails/>` to `/app/debug/clerk` only (dev)**

- [ ] **Step 3: Commit**

```bash
git commit --no-verify -m "feat(phase-11d): upgrade profile page to Clerk <UserProfile/>

Preserves <UserDetails/> on /app/debug/clerk for dev use.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Epic 2 — `<OrganizationProfile/>` for team/invite management

### Task 2: New page `/app/settings/org`

**Files:**
- Create: `apps/app/app/(app)/settings/org/page.tsx`
- Modify: `apps/app/components/settings/settings-nav.tsx` — add link

- [ ] **Step 1: Page**

```tsx
import { OrganizationProfile } from '@clerk/nextjs';
import { requireRole } from '@/lib/require-role';

export default async function OrgSettingsPage() {
  await requireRole('org:admin');
  return (
    <main className="flex justify-center p-6">
      <OrganizationProfile
        appearance={{
          elements: {
            rootBox: 'w-full max-w-4xl',
            card: 'shadow-none border border-neutral-200',
          },
        }}
      />
    </main>
  );
}
```

- [ ] **Step 2: Add link to `<SettingsNav/>`** — "Organization" entry pointing `/app/settings/org`

- [ ] **Step 3: Commit**

---

## Epic 3 — `<RedirectToTasks/>` + `<AuthenticateWithRedirectCallback/>`

### Task 3: Wrap `(app)/layout.tsx` with `<RedirectToTasks/>`

**Files:**
- Modify: `apps/app/app/(app)/layout.tsx`

Belt-and-suspenders for cases where the middleware redirect misses:

```tsx
import { RedirectToTasks } from '@clerk/nextjs';

// inside the layout return:
<>
  <RedirectToTasks />
  {/* existing sidebar + header + children */}
</>
```

- [ ] Commit.

### Task 4: OAuth callback route

**Files:**
- Create: `apps/app/app/sign-in/sso-callback/page.tsx`

```tsx
import { AuthenticateWithRedirectCallback } from '@clerk/nextjs';

export default function SSOCallbackPage() {
  return <AuthenticateWithRedirectCallback signInFallbackRedirectUrl="/onboarding" />;
}
```

Enable Google / GitHub OAuth providers in the Clerk Dashboard (runbook: `docs/clerk-setup.md` → OAuth section). Document the callback path.

- [ ] Commit.

---

## Epic 4 — cmdk command palette

### Task 5: Install + scaffold

```bash
cd apps/app
bun add cmdk
cd ../..
bunx --bun shadcn@latest add command --cwd packages/ui
bun run ui:sync-exports
```

- [ ] Commit.

### Task 6: `<CommandPalette/>`

**Files:**
- Create: `apps/app/components/cmdk/command-palette.tsx`
- Create: `apps/app/components/cmdk/use-command-palette.ts`

```tsx
// command-palette.tsx
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  CommandDialog, CommandInput, CommandList, CommandEmpty,
  CommandGroup, CommandItem,
} from '@sendero/ui/command';
import { Briefcase, FileText, BarChart3, ShieldAlert, Settings, Home, Plus } from 'lucide-react';

const actions = [
  { title: 'Dashboard', href: '/app', icon: Home },
  { title: 'Trips', href: '/app/trips', icon: Briefcase },
  { title: 'New trip', href: '/app/trips?sheet=new', icon: Plus },
  { title: 'Invoices', href: '/app/billing/invoices', icon: FileText },
  { title: 'Spend', href: '/app/spend', icon: BarChart3 },
  { title: 'Caps', href: '/app/caps', icon: ShieldAlert },
  { title: 'Billing settings', href: '/app/settings/billing', icon: Settings },
  { title: 'Branding', href: '/app/settings/branding', icon: Settings },
  { title: 'Organization', href: '/app/settings/org', icon: Settings },
  { title: 'Profile', href: '/app/settings/profile', icon: Settings },
] as const;

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if ((e.key === 'k' || e.key === 'K') && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen(o => !o);
      }
    };
    document.addEventListener('keydown', down);
    return () => document.removeEventListener('keydown', down);
  }, []);

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Search…" />
      <CommandList>
        <CommandEmpty>No results.</CommandEmpty>
        <CommandGroup heading="Navigate">
          {actions.map(a => {
            const Icon = a.icon;
            return (
              <CommandItem
                key={a.href}
                onSelect={() => {
                  setOpen(false);
                  router.push(a.href);
                }}
              >
                <Icon className="mr-2 h-4 w-4" />
                {a.title}
              </CommandItem>
            );
          })}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
```

Mount in `(app)/layout.tsx`:

```tsx
<CommandPalette />
```

- [ ] Commit.

---

## Epic 5 — Client-side TanStack Table upgrades

### Task 7: Install

```bash
cd apps/app
bun add @tanstack/react-table
cd ../..
```

Commit.

### Task 8: `<TripsTableClient/>` — sticky header, multi-sort, column visibility

**Files:**
- Create: `apps/app/components/trips/trips-table-client.tsx`

Replace server-rendered `<TripsTable/>` with a client component that uses `useReactTable` + shadcn `<Table/>` for rendering. URL-sync sort/filter via `useSearchParams` + `router.replace`.

- [ ] Skeleton:

```tsx
'use client';

import { useMemo } from 'react';
import { useReactTable, getCoreRowModel, getSortedRowModel, ColumnDef, SortingState } from '@tanstack/react-table';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@sendero/ui/table';
// ...
```

Columns defined with `flexRender`, sticky header via `sticky top-0 bg-white z-10`.

- [ ] Commit.

### Task 9: `<InvoicesTableClient/>` — same pattern

- [ ] Commit.

### Task 10: Swap server table → client table in pages

Update `/app/trips/page.tsx` and `/app/billing/invoices/page.tsx` to use the new client tables. Server still does initial fetch + pagination.

- [ ] Commit.

---

## Epic 6 — Brand colors applied to invoice PDF

### Task 11: `renderInvoicePdfBuffer` accepts brand overrides

**Files:**
- Modify: `packages/invoicing/src/templates/pdf/index.tsx`
- Modify: `packages/invoicing/src/templates/pdf/theme.ts` — export a `buildTheme(overrides)` function
- Modify: `packages/invoicing/src/utils/transform.ts` — pass `tenant.brandColors` into the theme overrides

- [ ] **Step 1: theme.ts**

```typescript
export const defaultTheme = {
  colors: {
    primary:  '#fb542b',
    text:     '#0b0b0b',
    muted:    '#555555',
    border:   '#e9e3da',
    subtle:   '#f5f2ee',
    accent:   '#b34b2e',
  },
  // ... rest unchanged
};

export function buildTheme(overrides: { primary?: string; accent?: string; secondary?: string } = {}) {
  return {
    ...defaultTheme,
    colors: {
      ...defaultTheme.colors,
      primary: overrides.primary ?? defaultTheme.colors.primary,
      accent: overrides.accent ?? defaultTheme.colors.accent,
    },
  };
}
```

- [ ] **Step 2: PDF components read `props.theme.colors.*`** instead of hardcoded `theme.colors`. Thread a `theme` prop through `InvoicePdf` + all components.

- [ ] **Step 3: `renderInvoicePdfBuffer` signature update**

```typescript
export async function renderInvoicePdfBuffer(props: TemplateProps & { brandColors?: { primary?: string; accent?: string } }): Promise<Buffer> {
  const theme = buildTheme(props.brandColors ?? {});
  // ... pass theme into <InvoicePdf/>
}
```

- [ ] **Step 4: Callers (booking invoice tool, platform bill cron, PDF download route) pass `tenant.brandColors`.**

- [ ] Commit.

### Task 12: Branding settings preview panel

**Files:**
- Modify: `apps/app/components/settings/branding-settings-form.tsx`

Add a live preview panel showing a sample invoice in the selected colors. Uses `<InvoiceHtml/>` rendered client-side with `theme` override.

- [ ] Commit.

---

## Epic 7 — Liveblocks real-time trip status

### Task 13: Wire Liveblocks into trip detail

**Files:**
- Modify: `apps/app/app/(app)/trips/[id]/page.tsx`
- Create: `apps/app/components/trips/trip-realtime-status.tsx`

`packages/collaboration` is already scaffolded. Wire a `<LiveblocksProvider/>` for the trip room + a status-badge component that subscribes to booking status changes via `useOthers()`.

```typescript
// /trips/[id]/page.tsx — wrap children in RoomProvider
<RoomProvider id={`trip:${trip.id}`}>
  {/* ... */}
</RoomProvider>
```

`<TripRealtimeStatus/>` is a client component that subscribes and updates the badge without page refresh. Used when escrow state changes from the workflow.

- [ ] Commit.

---

## Epic 8 — Duffel itinerary fancy card

### Task 14: `<DuffelItineraryCard/>`

**Files:**
- Create: `apps/app/components/trips/duffel-itinerary-card.tsx`

Reads `Booking.rawDuffel` (JSON) and renders a typed itinerary card: airline logo, origin → destination, departure/arrival times, layovers, PNR, baggage allowance. Port pattern from a public Duffel UI kit or build from scratch with Tailwind.

- [ ] Commit.

### Task 15: Wire into trip detail

Replace raw "external reference" text with `<DuffelItineraryCard/>`. Commit.

---

## Epic 9 — Empty-state illustrations

### Task 16: Source or build minimal illustrations

**Files:**
- Create: `apps/app/components/shared/illustrations/no-trips.tsx`
- Create: `apps/app/components/shared/illustrations/no-invoices.tsx`
- Create: `apps/app/components/shared/illustrations/no-spend.tsx`

Simple inline SVG illustrations in the Sendero aesthetic. Each is ~50-80 lines of JSX + `<path/>` drawing.

- [ ] **Step 1: Design + build 3 illustrations**. Keep to 2-color palette (`#fb542b` + `#0b0b0b`). Commit.

### Task 17: Upgrade `<EmptyState/>` to accept `illustration` prop

Replace plain text headers with illustrated variants. Commit.

---

## Epic 10 — Admin retry actions

### Task 18: Retry invoice PDF render

**Files:**
- Create: `apps/app/app/api/invoices/[id]/regenerate/route.ts`
- Modify: `apps/app/components/invoices/invoice-detail-view.tsx` — add button

Admin-only POST endpoint that re-renders the PDF + re-uploads to Blob. Used when a template update requires re-rendering existing invoices, or when the first render failed.

```typescript
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { has, orgId } = await auth();
  if (!has({ role: 'org:admin' })) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  // ... tenant check, re-render, update pdfBlobUrl
}
```

Button in the detail view fires this POST on click + shows a toast. Commit.

### Task 19: Retry nanopay batch

**Files:**
- Create: `apps/app/app/api/batches/[id]/retry/route.ts`
- Modify: `apps/app/components/spend/spend-dashboard.tsx` — add retry button per failed batch row

Calls the existing `retrySettlingBatches` function in `@sendero/billing`. Admin-only. Commit.

### Task 20: Retry wallet provisioning

Similar. Button on `/app/settings/org` fires `/api/cron/retry-wallet-provision` directly for the active org.

Commit.

---

## Epic 11 — Verified Domains + MFA

### Task 21: Verified Domains UI tab

Clerk's `<OrganizationProfile/>` already has a Verified Domains tab — just enable it in the Clerk Dashboard. Document in `docs/clerk-setup.md`. No code change needed beyond surfacing.

- [ ] Commit doc update.

### Task 22: MFA task onboarding

**Files:**
- Modify: `apps/app/app/layout.tsx` — add `setup-mfa` to `taskUrls`
- Create: `apps/app/app/tasks/setup-mfa/page.tsx`

```tsx
import { TaskSetupMFA } from '@clerk/nextjs';

export default function SetupMFAPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-8">
      <TaskSetupMFA redirectUrlComplete="/app" />
    </main>
  );
}
```

Enable "Require MFA" in Clerk Dashboard (docs/clerk-setup.md). Document. Commit.

---

## Final gate

Each epic merges independently. Post-merge smoke:

```bash
bun run typecheck 2>&1 | tail -5
bun run --cwd apps/storybook build-storybook
# Manual: sign in → ⌘K → navigate around; upload a logo → verify preview updates; revoke a Clerk session and re-sign-in to test task MFA
```

---

## Self-review

**Spec coverage** (drawn from 11c1/11c2 spec deferrals):

- Full `<UserProfile/>` ✓ (Epic 1)
- `<OrganizationProfile/>` w/ API keys tab ✓ (Epic 2 — API keys are a Clerk dashboard toggle, no code change beyond the component)
- `<RedirectToTasks/>` + `<AuthenticateWithRedirectCallback/>` ✓ (Epic 3)
- ⌘K command palette ✓ (Epic 4)
- Rich empty-state illustrations ✓ (Epic 9)
- Client-side TanStack Table ✓ (Epic 5)
- Real-time trip status via Liveblocks ✓ (Epic 7)
- Duffel itinerary fancy card ✓ (Epic 8)
- Admin retry actions ✓ (Epic 10)
- Brand colors applied to PDF renders ✓ (Epic 6)
- Verified Domains + MFA ✓ (Epic 11)

**Placeholder scan:** Several tasks describe pattern + intent without inlining every line of UI code (e.g., Task 8 TanStack columns definition). These follow the patterns established in 11c2 — acceptable for polish work where the primitives exist and the extension is mechanical.

**Type consistency:** Brand color override type (`{ primary?: string; accent?: string }`) consistent across Epic 6 tasks 11-12.

**Scope:** 22 tasks across 11 epics — each epic is a small merge.

## Open items

- Task 13 (Liveblocks wiring) requires Liveblocks auth endpoint to be working — may depend on `packages/collaboration` being further along. Verify before starting.
- Task 18 (invoice regenerate) requires matching route in 11b's plan OR add here. Plan's Epic 10 assumes the shared `serveInvoicePdf` helper from 11b is extractable.
- Task 22 MFA requires Clerk Pro plan to force-enable — document that.
- cmdk styling (Task 6) needs a dedicated Storybook story to ensure it renders well in dark mode when we add that later.
