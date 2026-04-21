# Phase-11c1 — Auth Infrastructure + Onboarding

**Date:** 2026-04-20
**Branch:** feat/phase-11-invoicing
**Baseline:** phase-11a complete; phase-11b spec approved (schema lands in 11b's plan)
**Prereq for:** phase-11c2 (buyer UI), phase-11d (UI polish), phase-12 (agency white-label)
**Source material:**
- `/Users/criptopoeta/Downloads/next-forge-main/packages/auth` — thin Clerk curation layer
- `/Users/criptopoeta/coding-dojo/desk-v1/apps/app/src/app/api/team-wallet/route.ts` — Circle walletSet + wallet provisioning
- `/Users/criptopoeta/coding-dojo/desk-v1/apps/app/src/app/api/onboarding/route.ts` — onboarding progress shape
- Clerk MCP (`https://mcp.clerk.com/mcp`) + Clerk docs on Organizations, session tasks, custom session claims

## Problem

Sendero has no real authentication. `/admin/spend` and `/admin/caps` pages rely on query-param `?tenantId=` with an env fallback; anyone with the tenantId can read. Phase-11c1 installs real Clerk auth, wires multi-tenant Organizations, and provisions Arc wallets automatically when a new Organization is created. This is the prereq for buyer-admin-gated screens (11c2) and agency-white-label settings (11d, phase-12).

No visible UI surface ships in 11c1 beyond `/sign-in`, `/sign-up`, `/onboarding`, and the header `<UserButton/>` + `<OrganizationSwitcher/>`. The actual trips/billing/settings screens land in 11c2.

## Scope

### In

- New `@sendero/auth` package mirroring next-forge's `packages/auth` (provider, middleware, components, keys)
- `ClerkProvider` wrapping `apps/app/app/layout.tsx` (plus other apps as they wire auth in future — out of scope here)
- `apps/app/proxy.ts` with `clerkMiddleware()` + route matchers
- Clerk Dashboard configuration (documented as `docs/clerk-setup.md`): enable Organizations, membership required, custom roles, custom session claims, webhook endpoint
- Custom Organization roles: `org:admin` (buyer-admin, creator role), `org:member` (traveler/employee), `org:finance` (invoice viewer)
- Custom session claims: `metadata` (from user public metadata) + `org_metadata` (from org public metadata)
- Clerk webhook handler at `apps/app/app/api/webhooks/clerk/route.ts` (signature-verified via `svix`) handling: `organization.created`, `organization.updated`, `organization.deleted`, `user.created`, `user.updated`, `organizationMembership.created/updated/deleted`
- Schema additions: `User.clerkUserId`, `Tenant.clerkOrgId`, `Membership.clerkMembershipId` (mapping tables — idempotent sync)
- `@sendero/circle` extension with `provisionTenantWallet({ tenantId })` — ports desk-v1's walletSet + wallets creation pattern
- Session task `choose-organization` (Clerk built-in) — users must pick/create an Org after sign-up
- Custom session task `provision-wallet` — runs after Organization creation, creates Arc wallet via Circle, stamps `Organization.publicMetadata.arcWalletAddress` + `onboardingComplete=true`
- Onboarding page `/onboarding` — shows provisioning progress, auto-advances once wallet is ready
- Sign-in/sign-up pages at `/sign-in/[[...sign-in]]` + `/sign-up/[[...sign-up]]` wrapping prebuilt `<SignIn/>` + `<SignUp/>` with Sendero theming
- Header component `apps/app/components/app-header.tsx` with `<OrganizationSwitcher/>` + `<UserButton/>` + `<Show when=...>` CTAs
- Loading/error states on the root layout via `<ClerkLoaded/>`, `<ClerkLoading/>`, `<ClerkDegraded/>`, `<ClerkFailed/>`
- `<UserDetails/>` visualizer component (port of Clerk's demo-panel pattern) at `packages/auth/src/components/user-details.tsx` — shown on `/onboarding` during wallet provisioning + on `/app/profile` as a dev/demo surface. Uses `useUser` + `useSession` + `useOrganization` client hooks with pointer-annotated rows. Annotations (`<PointerC/>`) hidden in production via a `showPointers` prop (defaults to `process.env.NEXT_PUBLIC_CLERK_DEMO_MODE === '1'`)
- **Tailwind adoption** pulled forward from 11c2 so `<UserDetails/>` + Clerk components render as-intended. `@tailwindcss/postcss` + minimal `tailwind.config.js` + `@tailwind` directives in `globals.css`. Existing `/g`, `/admin`, `/onboarding` inline-style pages remain untouched (mixed-mode is fine; Tailwind utilities don't collide with CSSProperties)
- Tests: unit (role-check helpers, session-claim typings), integration (sign-up → org create → wallet provision → onboardingComplete flips)

### Out (in phase-11c2 / 11d / later)

- `/app/trips/*`, `/app/billing/*`, `/app/settings/*` page UI — 11c2
- Agency white-label branding settings (logoUrl, brandColors) — phase-12 scope, schema ships with 11b
- Tailwind + shadcn adoption — defer to 11c2 (paired with first real UI screens)
- API keys feature (`<APIKeys/>` component, `clerkClient.apiKeys.*`) — deferred; not needed for v1 flows
- Verified Domains auto-invite — deferred; agencies + corporates set up invitations manually
- Enterprise SSO / SAML — deferred to enterprise sales stage
- Multi-factor authentication — deferred; can be enabled via Clerk Dashboard without code changes once infra is in place
- Migration of existing `/admin/spend` + `/admin/caps` pages to Clerk gating — tag-along with 11c2 when Tailwind adoption happens
- Clerk Billing (subscriptions) — out of scope; Sendero uses nanopay batches + phase-11b invoices
- Personal Accounts — disabled from the start; every user must belong to an Organization

## Architecture

### `@sendero/auth` package shape

Mirror next-forge verbatim with Sendero's aesthetic substituted:

```
packages/auth/
├── package.json                  — deps: @clerk/nextjs, @clerk/themes, @clerk/types
├── src/
│   ├── index.ts                  — re-exports
│   ├── client.ts                 — export * from '@clerk/nextjs'
│   ├── server.ts                 — import 'server-only'; export * from '@clerk/nextjs/server'
│   ├── proxy.ts                  — export { clerkMiddleware as authMiddleware } from '@clerk/nextjs/server'
│   ├── provider.tsx              — SenderoAuthProvider wraps <ClerkProvider> with appearance/theme
│   ├── roles.ts                  — role constants + hasRole(auth, role) helper + type guards
│   ├── webhooks.ts               — Clerk webhook verifier + event handler registry
│   ├── claims.ts                 — TypeScript augmentation for CustomJwtSessionClaims
│   └── components/
│       ├── sign-in.tsx           — SenderoSignIn wraps <SignIn/> with hidden header
│       ├── sign-up.tsx           — SenderoSignUp wraps <SignUp/> with hidden header
│       ├── org-switcher.tsx      — SenderoOrgSwitcher wraps <OrganizationSwitcher/> with custom routes
│       └── user-button.tsx       — SenderoUserButton wraps <UserButton/> with custom user-profile URL
```

`provider.tsx` skeleton (follows next-forge pattern, styled for Sendero):

```tsx
'use client';
import { ClerkProvider } from '@clerk/nextjs';
import type { ComponentProps } from 'react';

type Props = ComponentProps<typeof ClerkProvider>;

export function SenderoAuthProvider(props: Props) {
  return (
    <ClerkProvider
      {...props}
      appearance={{
        variables: {
          colorPrimary: '#fb542b',      // Sendero orange, matches /g page + invoice PDF
          colorText: '#0b0b0b',
          colorBackground: '#ffffff',
          fontFamily: 'var(--font-geist-sans)',
          fontFamilyButtons: 'var(--font-geist-sans)',
          borderRadius: '0.25rem',
        },
        elements: {
          formButtonPrimary: 'bg-[#fb542b] hover:bg-[#d13d18] text-white',
          card: 'shadow-none border border-neutral-200',
          organizationSwitcherTrigger: 'px-3 py-2',
          organizationPreviewMainIdentifier: 'font-medium',
        },
        layout: {
          privacyPageUrl: 'https://sendero.travel/privacy',
          termsPageUrl: 'https://sendero.travel/terms',
          helpPageUrl: 'https://sendero.travel/help',
        },
      }}
    />
  );
}
```

### Middleware (proxy.ts)

Follows Clerk Next.js 15+ convention (rename `middleware.ts` → `proxy.ts`):

```ts
// apps/app/proxy.ts
import { clerkMiddleware, createRouteMatcher } from '@sendero/auth/server';
import { NextRequest, NextResponse } from 'next/server';

const isPublicRoute = createRouteMatcher([
  '/',                         // landing
  '/g(.*)',                    // guest claim (self-auth via URL fragment)
  '/invoice/(.*)',             // public invoice viewer (JWT-gated)
  '/sign-in(.*)',
  '/sign-up(.*)',
  '/api/webhooks/(.*)',        // Duffel, Clerk, etc. — their own signature verification
  '/api/cron/(.*)',            // CRON_SECRET Bearer auth
  '/api/health',
  '/api/guest/claimed',        // guest submits post-claim; no session yet
]);

const isOnboardingRoute = createRouteMatcher(['/onboarding(.*)', '/tasks(.*)']);

export default clerkMiddleware(async (auth, req: NextRequest) => {
  const { isAuthenticated, sessionClaims, orgId, redirectToSignIn } = await auth();

  // Let public routes through untouched.
  if (isPublicRoute(req)) return NextResponse.next();

  // Unauthenticated on a protected route → sign-in.
  if (!isAuthenticated) return redirectToSignIn({ returnBackUrl: req.url });

  // Onboarding/tasks are allowed while incomplete; everything else requires onboardingComplete.
  if (isOnboardingRoute(req)) return NextResponse.next();

  if (!sessionClaims?.org_metadata?.onboardingComplete) {
    return NextResponse.redirect(new URL('/onboarding', req.url));
  }

  // Orgs are mandatory — if somehow the user has no active org, send them to pick one.
  if (!orgId) return NextResponse.redirect(new URL('/onboarding/choose-org', req.url));

  return NextResponse.next();
});

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
};
```

### Root layout

```tsx
// apps/app/app/layout.tsx
import { SenderoAuthProvider } from '@sendero/auth';
import { ClerkLoaded, ClerkLoading, ClerkFailed } from '@sendero/auth/client';
import './globals.css';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <SenderoAuthProvider
          signInFallbackRedirectUrl="/onboarding"
          signUpFallbackRedirectUrl="/onboarding"
          taskUrls={{
            'choose-organization': '/onboarding/choose-org',
          }}
        >
          <ClerkLoading>
            <div className="boot-splash">Loading…</div>
          </ClerkLoading>
          <ClerkLoaded>{children}</ClerkLoaded>
          <ClerkFailed>
            <div className="boot-splash boot-splash--error">
              Sign-in service unavailable. Please try again shortly.
            </div>
          </ClerkFailed>
        </SenderoAuthProvider>
      </body>
    </html>
  );
}
```

### Multi-tenant data model

**Clerk is the source of truth for identity + membership.** Prisma mirrors the parts we need for business logic (Tenant policies, spend caps, trips, bookings, invoices).

Mapping:

- `Clerk User.id` (`user_xxx`) → `Prisma User.clerkUserId` (unique)
- `Clerk Organization.id` (`org_xxx`) → `Prisma Tenant.clerkOrgId` (unique)
- `Clerk OrganizationMembership.id` (`orgmem_xxx`) → `Prisma Membership.clerkMembershipId` (unique)
- `Organization.publicMetadata.tenantId = <cuid>` — backward link from Clerk to Prisma (redundant but cheap)
- `Organization.publicMetadata.arcWalletAddress = 0x…` — Sendero's wallet provisioned by our system
- `Organization.publicMetadata.onboardingComplete = boolean` — gate for middleware
- `Organization.privateMetadata.circleWalletSetId = wset_…` — Circle SDK reference (not client-visible)
- `Organization.privateMetadata.circleWalletId = wallet_…` — Circle SDK reference
- `User.publicMetadata.preferredChannelId` — optional, for routing guest chats

Sync direction:

- **Clerk → Sendero**: webhook-driven. Clerk is the write path for users, orgs, memberships; webhooks upsert Prisma rows.
- **Sendero → Clerk**: one-way for wallet provisioning. After provisioning, we `clerkClient.organizations.updateOrganizationMetadata({ publicMetadata: { arcWalletAddress, onboardingComplete: true } })`.

Role mapping:

| Clerk role       | Prisma Membership.role | Permissions summary                          |
|------------------|------------------------|----------------------------------------------|
| `org:admin`      | `agency_admin`         | full tenant admin, spend caps, invoices, branding |
| `org:finance`    | `finance`              | read invoices, spend dashboard, no booking actions |
| `org:member`     | `traveler`             | book trips, view own trips, no tenant settings |

**Note:** Prisma `Role` enum already has `agency_admin | finance | traveler | guest`. `guest` stays unused by Clerk (guests don't sign in via Clerk — they use the Peanut-style URL-fragment claim flow from phase-7).

### Custom session claims

In the Clerk Dashboard → Sessions → Customize session token, add:

```json
{
  "metadata": "{{user.public_metadata}}",
  "org_metadata": "{{org.public_metadata}}"
}
```

TypeScript augmentation in `packages/auth/src/claims.ts`:

```ts
export {};

declare global {
  interface CustomJwtSessionClaims {
    metadata?: {
      preferredChannelId?: string;
    };
    org_metadata?: {
      tenantId?: string;
      arcWalletAddress?: `0x${string}`;
      onboardingComplete?: boolean;
    };
  }
}
```

**Size budget** — ~1.2KB cap on cookie-stored claims. Our claim payload (one tenantId cuid + one address hex + one boolean + optional channelId) stays well under 200 bytes. Safe.

### Clerk webhook handler

`apps/app/app/api/webhooks/clerk/route.ts`:

1. Verify svix signature using `CLERK_WEBHOOK_SECRET`
2. Dedupe via the existing `WebhookEvent` table (provider: `'clerk'`)
3. Dispatch to handlers in `packages/auth/src/webhooks.ts`:

| Event                           | Handler                                                    |
|---------------------------------|------------------------------------------------------------|
| `user.created`                  | upsert `User` row; link `clerkUserId`                      |
| `user.updated`                  | sync email/displayName                                     |
| `user.deleted`                  | soft-delete `User` (preserve booking history)              |
| `organization.created`          | upsert `Tenant` row; trigger `provisionTenantWallet({ tenantId })` in-process; on success, write back `publicMetadata: { tenantId, arcWalletAddress, onboardingComplete: true }` |
| `organization.updated`          | sync `displayName`, `slug`                                 |
| `organization.deleted`          | soft-delete Tenant + cascade-disable memberships           |
| `organizationMembership.created` | upsert `Membership` row with role mapping                 |
| `organizationMembership.updated` | sync role changes                                         |
| `organizationMembership.deleted` | set `Membership.status = 'removed'`                       |

**Idempotency:** every handler is idempotent by `clerk*Id` unique keys. Svix webhooks can arrive out-of-order; handlers must cope (e.g., `organizationMembership.created` may land before `organization.created` — upsert `Tenant` on-the-fly if missing).

### Wallet provisioning

Port desk-v1's `apps/app/src/app/api/team-wallet/route.ts` pattern into `packages/sendero-circle/src/provision-tenant-wallet.ts`:

```ts
export async function provisionTenantWallet(args: {
  tenantId: string;
  clerkOrgId: string;
}): Promise<{ walletSetId: string; walletId: string; address: `0x${string}` }> {
  const circle = createCircleSdk();

  // 1. Check existing — idempotent retry-safe
  const existing = await prisma.wallet.findFirst({ where: { tenantId: args.tenantId } });
  if (existing) {
    return {
      walletSetId: existing.circleWalletSetId!,
      walletId: existing.circleWalletId!,
      address: existing.address as `0x${string}`,
    };
  }

  // 2. Create walletSet named `tenant-${tenantId}`
  const wsRes = await circle.createWalletSet({ name: `tenant-${args.tenantId}` });
  const walletSetId = wsRes.data!.walletSet.id;

  // 3. Create wallet inside the set on Arc Testnet
  const wRes = await circle.createWallets({
    walletSetId,
    blockchains: ['ARC-TESTNET'],
    count: 1,
    accountType: 'SCA',           // smart contract account for gasless txs
  });
  const wallet = wRes.data!.wallets[0];

  // 4. Persist to Prisma Wallet table (new model — see Schema section)
  await prisma.wallet.create({
    data: {
      tenantId: args.tenantId,
      clerkOrgId: args.clerkOrgId,
      address: wallet.address,
      kind: 'treasury',
      chain: 'ARC-TESTNET',
      circleWalletSetId: walletSetId,
      circleWalletId: wallet.id,
    },
  });

  return {
    walletSetId,
    walletId: wallet.id,
    address: wallet.address as `0x${string}`,
  };
}
```

Called from the `organization.created` webhook handler. On transient Circle API failure (rate limit, network), the handler catches + schedules a retry via a new `/api/cron/retry-wallet-provision` cron (5-min interval, reads Organizations whose `publicMetadata.onboardingComplete !== true` and retries). Until the cron succeeds, the user is parked on `/onboarding` (middleware enforces).

### Onboarding pages

`apps/app/app/onboarding/layout.tsx` — redirects to `/app` if already complete:

```tsx
import { auth } from '@sendero/auth/server';
import { redirect } from 'next/navigation';

export default async function OnboardingLayout({ children }: { children: React.ReactNode }) {
  const { sessionClaims } = await auth();
  if (sessionClaims?.org_metadata?.onboardingComplete === true) redirect('/app');
  return <>{children}</>;
}
```

`apps/app/app/onboarding/page.tsx` — main onboarding UI. Shows three states alongside the `<UserDetails/>` visualizer (user sees their live Clerk data throughout the flow, reinforcing "you are signed in"):

1. **No Organization** — render `<OrganizationList hidePersonal afterCreateOrganizationUrl="/onboarding" />`. `<UserDetails/>` shows user + session; organization section is hidden.
2. **Organization exists, wallet provisioning in flight** — polling state: "Provisioning Arc wallet…" with a 2s interval `useOrganization().organization.reload()` check on `org_metadata.arcWalletAddress`. `<UserDetails/>` now renders the organization section too; a pending indicator badge shows "Wallet: provisioning…".
3. **All complete** — button "Enter Sendero" → `router.push('/app')`. `<UserDetails/>` shows full context including `organization.publicMetadata.arcWalletAddress`.

### `<UserDetails/>` visualizer

Ported from the canonical Clerk demo pattern (with Sendero-specific extensions):

```
packages/auth/src/components/user-details.tsx
```

Structure:

- `Row` — two-column `<desc>/<value>` row; optional children render to the right
- `PointerC` — annotated label showing the exact Clerk field name (e.g., `user.emailAddresses[0].emailAddress`). Hidden when `showPointers={false}`.
- `<UserDetails showPointers={bool} extraSections?={...}>` — returns a panel containing:
  - Avatar + name block (from `user.imageUrl`, `user.firstName`, `user.lastName`)
  - User details (email, last signed in, joined on, user ID)
  - Session details (session ID, status, last active, expiration)
  - Organization details (org ID, name, members count, pending invitations) — rendered only when `organization` is present
  - **Sendero extension:** Wallet details row-group — `arcWalletAddress`, `circleWalletSetId`, `onboardingComplete` status. Rendered only when `org_metadata.arcWalletAddress` is populated.

`showPointers` default:
- Development (`NODE_ENV !== 'production'`): `true` → useful for eng demo
- Production: `false` unless `NEXT_PUBLIC_CLERK_DEMO_MODE === '1'` is set (lets us demo on prod preview URLs for the hackathon submission)

Used in three places:

- `/onboarding` — hero panel during provisioning (showPointers=true in dev, false in prod)
- `/app/profile` — canonical user profile page (phase-11d will upgrade this to Clerk's `<UserProfile/>` with embedded `<APIKeys/>` tab; 11c1 ships with `<UserDetails/>` as interim)
- `/app/debug/clerk` (dev-only route) — full visualizer for ad-hoc debugging; never renders in prod builds (`if (process.env.NODE_ENV === 'production') notFound();`)

`apps/app/app/onboarding/choose-org/page.tsx` — explicit org-picker for the `choose-organization` session task; renders `<OrganizationList hidePersonal afterCreateOrganizationUrl="/onboarding" afterSelectOrganizationUrl="/onboarding" />`.

### Sign-in / Sign-up pages

`apps/app/app/sign-in/[[...sign-in]]/page.tsx`:

```tsx
import { SenderoSignIn } from '@sendero/auth/components/sign-in';

export default function SignInPage() {
  return (
    <main className="auth-layout">
      <SenderoSignIn />
    </main>
  );
}
```

Same shape for `sign-up/[[...sign-up]]/page.tsx`.

Env:
```
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up
NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL=/onboarding
NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL=/onboarding
```

### App header

`apps/app/components/app-header.tsx` — shown on authenticated shell (rendered from `(app)/layout.tsx`, which 11c2 will create). Exposed from 11c1 so the onboarding pages can reuse it.

```tsx
import { Show } from '@sendero/auth/client';
import { SenderoOrgSwitcher, SenderoUserButton } from '@sendero/auth/components';

export function AppHeader() {
  return (
    <header className="app-header">
      <a href="/" className="brand">
        <span className="mark" /> Sendero
      </a>
      <div className="right">
        <Show when="signed-in">
          <SenderoOrgSwitcher afterSelectOrganizationUrl="/app" afterCreateOrganizationUrl="/onboarding" />
          <SenderoUserButton userProfileUrl="/app/profile" />
        </Show>
        <Show when="signed-out">
          <a href="/sign-in" className="link">Sign in</a>
          <a href="/sign-up" className="cta">Get started</a>
        </Show>
      </div>
    </header>
  );
}
```

Note: inline styles for 11c1 — Tailwind migration happens in 11c2 when real pages land. `globals.css` grows by ~50 lines (header + auth-layout + boot-splash) but that's bounded.

## Schema

New models in `packages/database/prisma/schema.prisma`:

```prisma
model Wallet {
  id                    String   @id @default(cuid())
  tenantId              String
  clerkOrgId            String?  // denormalized for webhook convenience
  address               String   @unique          // 0x-prefixed hex, lowercase
  kind                  String                    // 'treasury' | 'agent_operator' | 'custody'
  chain                 String                    // 'ARC-TESTNET' | future chains
  circleWalletSetId     String?
  circleWalletId        String?
  createdAt             DateTime @default(now()) @db.Timestamptz(6)
  updatedAt             DateTime @updatedAt       @db.Timestamptz(6)

  tenant                Tenant   @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  @@index([tenantId, kind])
  @@map("wallets")
}
```

Additions to existing models:

```prisma
model User {
  // existing fields...
  clerkUserId       String?   @unique   // sync target from Clerk webhook
}

model Tenant {
  // existing fields (including phase-11b billing additions)...
  clerkOrgId        String?   @unique   // sync target from Clerk webhook
  wallets           Wallet[]
}

model Membership {
  // existing fields...
  clerkMembershipId String?   @unique
}
```

Migration is forward-compatible — all new cols are nullable so the webhook backfills them as events arrive.

## Env additions

- `CLERK_SECRET_KEY` — required
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` — required
- `CLERK_WEBHOOK_SECRET` — required (svix signing secret from Clerk Dashboard)
- `NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in`
- `NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up`
- `NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL=/onboarding`
- `NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL=/onboarding`

Update `packages/sendero-env/src/validate.ts` to require the three first entries; the `NEXT_PUBLIC_CLERK_*` URL envs are declared in `.env.example` for DX but not blocked at validate.

## Clerk Dashboard setup (one-time, documented in `docs/clerk-setup.md`)

1. Enable Organizations → Membership required
2. Disable Personal Accounts (B2B only)
3. Allow user-created Organizations (for demo), limit 100/user
4. Organization slugs: enabled (for `/app/{orgSlug}` future routing if we want it in phase-11d)
5. Default role for new Org members: `org:member`
6. Creator role: `org:admin` (has Manage members + Delete + Read + Manage billing system permissions)
7. Custom role: `org:finance` (Read members + Read billing only)
8. Custom session claims (per the claims.ts types above)
9. Webhook endpoint: `https://<preview-url>/api/webhooks/clerk` + prod URL; subscribe to all `user.*`, `organization.*`, `organizationMembership.*` events
10. Sign-in options: Email (verification code), Google OAuth, passkeys (post-sign-up)
11. Session token duration: default 7 days

## Data flow — full sign-up to onboarding-complete

```
1. User visits /sign-up → SenderoSignUp → email + password (or Google OAuth)
2. Clerk creates User (no Org yet) → session task 'choose-organization' fires
3. Middleware sees isAuthenticated + sessionClaims.org_metadata.onboardingComplete !== true
   → redirects to /onboarding
4. /onboarding sees no active org → renders <OrganizationList hidePersonal afterCreateOrganizationUrl="/onboarding" />
5. User creates "Acme Travel" org in the OrganizationList UI
   → Clerk fires organization.created webhook
   → our handler upserts Tenant row (tenantId = new cuid), writes Organization.publicMetadata.tenantId
   → handler calls provisionTenantWallet(tenantId) → Circle createWalletSet + createWallets
   → on success: updateOrganizationMetadata({ publicMetadata: { tenantId, arcWalletAddress, onboardingComplete: true }})
   → handler also fires organizationMembership.created webhook separately for the creator (role=org:admin)
6. /onboarding polls useOrganization().organization.reload() every 2s; when org_metadata.onboardingComplete flips to true, shows "Enter Sendero" CTA
7. Clicking CTA → router.push('/app') → middleware now passes (onboardingComplete=true + orgId present) → user lands in app
```

Failure modes:

- **Circle API error during wallet provisioning** — webhook handler catches, logs, marks `Tenant.metadata.provisioningError = <msg>`. Does NOT flip onboardingComplete. A retry-cron `/api/cron/retry-wallet-provision` runs every 5min, picks up Organizations with `onboardingComplete != true`, retries up to 5 attempts, then pages Slack.
- **Webhook delivery failure** — svix retries with exponential backoff. Our handler is idempotent so repeat deliveries are no-ops.
- **User closes tab mid-provisioning** — next visit re-checks session claims, hits onboarding state machine at the correct step. No data loss.

## Session tasks

Clerk supports two built-in session tasks relevant here:

- `choose-organization` — handled by Clerk when Personal Accounts are disabled. We point `taskUrls['choose-organization'] = '/onboarding/choose-org'` so the UX matches our branding.
- `setup-mfa` — deferred; enable from Dashboard when we turn on MFA.

Wallet provisioning is **not a Clerk session task** — it's a custom server-driven step tracked via `org_metadata.onboardingComplete`. The middleware enforcement + `/onboarding` polling are our custom implementation. Clerk tasks are user-facing form flows; wallet provisioning is a silent server operation. Fold into Clerk tasks only if we later need user-facing config questions during provisioning.

## Error handling

- **Missing CLERK_SECRET_KEY** — `env:validate` fails loudly
- **Invalid svix signature on Clerk webhook** → 401
- **Org without corresponding Clerk webhook event** (someone creates Prisma Tenant manually) — flag in admin view; won't show in app since `/onboarding` forces the Clerk-mediated path
- **Wallet address collision** (hypothetical if Circle ever hands out a dupe — should never happen) — unique index kicks in; retry provision generates a new set
- **User with no active org (signed in, member of nothing)** — middleware redirects to `/onboarding/choose-org` where they can create or be invited
- **`useOrganization()` loading** — onboarding page shows spinner via `<ClerkLoading/>`

## Test plan

### Unit (Bun test)

- `packages/auth/src/roles.test.ts` — `hasRole` / `hasPermission` helpers against fixture `Auth` objects for each role
- `packages/auth/src/webhooks.test.ts` — signature verification against canned svix payloads (valid + tampered); event-dispatch routing
- `packages/sendero-circle/src/provision-tenant-wallet.test.ts` — idempotency (second call returns existing wallet), error handling when Circle SDK missing methods

### Integration (requires Clerk test instance, runs in CI + locally)

- `scripts/smoke-clerk-webhook.ts` — POST fabricated svix-signed `organization.created` event; assert Tenant row upsert + Wallet row exists
- `scripts/smoke-auth-onboarding.ts` — manual-gated E2E: create test user via Clerk Backend API, assert redirect to `/onboarding`, create org, assert middleware allows `/app` after polling flips onboardingComplete

### Manual gate (hackathon hygiene)

- Sign up a real test user; assert org creation + wallet provisioning happens within 10s
- Verify `OrganizationSwitcher` lets test user switch between two fixture orgs
- Verify `/api/webhooks/clerk` prod endpoint is listed in Clerk Dashboard, receives events, returns 200

## Files

### New

- `packages/auth/` — entire package (see Architecture)
- `packages/sendero-circle/src/provision-tenant-wallet.ts`
- `apps/app/proxy.ts` (replaces any existing middleware.ts; delete middleware.ts if present)
- `apps/app/app/sign-in/[[...sign-in]]/page.tsx`
- `apps/app/app/sign-up/[[...sign-up]]/page.tsx`
- `apps/app/app/onboarding/layout.tsx`
- `apps/app/app/onboarding/page.tsx`
- `apps/app/app/onboarding/choose-org/page.tsx`
- `apps/app/app/api/webhooks/clerk/route.ts`
- `apps/app/app/api/cron/retry-wallet-provision/route.ts`
- `apps/app/app/app/profile/page.tsx` — uses `<UserDetails/>`, showPointers=false
- `apps/app/app/app/debug/clerk/page.tsx` — dev-only `<UserDetails/>`, showPointers=true
- `apps/app/components/app-header.tsx`
- `packages/auth/src/components/user-details.tsx`
- `packages/database/prisma/migrations/<ts>_phase_11c1_auth_infra/migration.sql`
- `docs/clerk-setup.md` — runbook for Dashboard config
- `scripts/smoke-clerk-webhook.ts`
- `scripts/smoke-auth-onboarding.ts`

### Modified

- `apps/app/app/layout.tsx` — wrap in `SenderoAuthProvider`, add `<ClerkLoaded/>` states
- `apps/app/app/page.tsx` — landing page with `<Show when=signed-in>` CTAs to `/app`
- `apps/app/app/globals.css` — add `@tailwind base/components/utilities` directives + minimal custom classes (`.app-header`, `.auth-layout`, `.boot-splash`) that cohabit with Tailwind
- `apps/app/postcss.config.mjs` — add `@tailwindcss/postcss` plugin (new file if absent)
- `apps/app/tailwind.config.ts` — Sendero color tokens (`#fb542b` primary, neutral scale), Geist font family mapping
- `apps/app/package.json` — add `@clerk/nextjs`, `@clerk/themes`, `svix`, `@sendero/auth` workspace dep, `tailwindcss`, `@tailwindcss/postcss`
- `apps/app/vercel.json` — `crons: [{ path: '/api/cron/retry-wallet-provision', schedule: '*/5 * * * *' }]` added
- `packages/database/prisma/schema.prisma` — Wallet model, User.clerkUserId, Tenant.clerkOrgId, Membership.clerkMembershipId
- `packages/sendero-env/src/validate.ts` — require `CLERK_SECRET_KEY`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_WEBHOOK_SECRET`
- `apps/app/app/api/health/route.ts` — surface clerk + webhook booleans
- `packages/sendero-circle/src/index.ts` — export `provisionTenantWallet`
- `.env.example` — add Clerk keys + URL envs with inline docs

## Migration strategy for existing admin pages

The existing `/app/admin/spend` + `/app/admin/caps` pages use query-param `?tenantId=` and operate ungated. Do NOT touch them in 11c1 — they continue to work as a demo surface. 11c2 / 11d will rewrap them in the `(app)` route group and replace the query-param with `auth().orgId`.

Existing `apps/app/app/g/*` (guest claim) is explicitly public — middleware allowlists `/g(.*)`.

## Clerk MCP + skills

- Clerk MCP already added to `.claude.json`: `https://mcp.clerk.com/mcp`
- `npx skills add clerk/skills` — run once to pull Clerk's official skills into `~/.claude/skills/`

Implementation plan will reference Clerk MCP tools for programmatic dashboard configuration (roles, webhooks, session claims) so the setup is reproducible. Preferred over manual dashboard clicks.

## Rollout

Single PR extending `feat/phase-11-invoicing`. Merge sequencing within the PR:

1. Schema migration (Wallet model + clerkOrgId etc.)
2. `@sendero/auth` package (buildable in isolation)
3. `provisionTenantWallet` in `@sendero/circle`
4. Webhook route + proxy.ts + RootLayout wrap
5. Sign-in / sign-up / onboarding pages
6. Cron retry endpoint
7. Env validate updates + health route surface
8. Smoke tests

Deploy to preview, hit the preview URL from a browser, sign up a test user, verify the full chain. Promote to prod only after live sign-up works.

## Risks / open questions

- **Clerk free-tier MRO limit** (100 Organizations in production) — fine for hackathon + early customers; monitor via Clerk Dashboard analytics
- **Circle SDK initialization cost** — `createCircleSdk()` on every webhook firing could be slow. Mitigation: cache the SDK client at module scope, reuse across invocations
- **Middleware latency** — every request runs `auth()` + session-claim lookup. Clerk's session token caching keeps this sub-ms typically; budget 10ms per request
- **Test account cleanup** — Clerk test orgs accumulate; add a nightly cron in dev (optional, out of scope here) to delete test-*  orgs older than 7d
- **Org deletion cascade** — if a Clerk org is deleted, we soft-delete the Tenant (cannot hard-delete because of settlement/invoice audit trail). Clerk dashboard operators need to be aware that deleting an org doesn't nuke financial records
- **Pre-existing WhatsApp onboarding** (`apps/app/app/onboarding/*` stubs?) — spot-check before landing; phase-6 mentioned "onboarding" in commit logs. If stubs exist, replace them with the Clerk flow; if they drive a separate path (WA invite claim), keep them at `/onboarding/whatsapp/*` and carve out

## Deferred to phase-11d (reminders)

Phase-11d picks up UI polish + heavier Clerk component usage:

- Upgrade `/app/profile` from `<UserDetails/>` visualizer to Clerk's full `<UserProfile/>` embedded component (passwords, MFA, connected accounts, passkeys, API keys tab)
- `<OrganizationProfile/>` page at `/app/settings/org` (embedded) with API keys tab (once APIKeys feature is enabled — currently deferred)
- Evolve `<UserDetails/>` itself — richer wallet section (balance, tx history), membership matrix (all orgs user belongs to), drop the demo-pointer annotations by default in prod
- `<AuthenticateWithRedirectCallback/>` route `/sign-in/sso-callback` for custom OAuth flows (if we add Google/GitHub/etc. as post-sign-up options)
- `<RedirectToTasks/>` wrapper on `(app)/layout.tsx` as a belt-and-suspenders for users whose session somehow bypassed middleware redirection
- Tailwind + shadcn adoption for all pages (coordinated with 11c2's first real screens)
- Theme polish — appearance variables + elements map refinement, consistent with invoice PDF + /g page
- Verified Domains UI for agency tenants (auto-invite employees @acme.com)
- MFA onboarding (`<TaskSetupMFA/>` + Clerk dashboard toggle)
- `<OrganizationList/>` richer surface for power users managing multiple orgs

## Decision log

- 2026-04-20 — user confirmed: Option A full Clerk install + multi-tenant Orgs
- 2026-04-20 — user confirmed: follow next-forge `packages/auth` pattern + Clerk prebuilt components
- 2026-04-20 — user confirmed: post-auth wallet provisioning follows desk-v1's `/api/team-wallet` shape, ported to `@sendero/circle`
- 2026-04-20 — user confirmed: split phase-11c into 11c1 (auth infra) + 11c2 (UI screens) + 11d (UI polish with full Clerk component palette)
- 2026-04-20 — decision: Personal Accounts DISABLED (B2B only); membership required
- 2026-04-20 — decision: `choose-organization` session task routed to `/onboarding/choose-org`; wallet provisioning is a custom server-driven step (not a Clerk session task)
- 2026-04-20 — decision: Clerk webhooks are source-of-truth writer for User/Tenant/Membership Prisma rows; idempotent upsert by `clerk*Id`
- 2026-04-20 — user confirmed: port the Clerk `<UserDetails/>` visualizer pattern (with `PointerC` annotations) into `@sendero/auth/components/user-details.tsx`; use on `/onboarding`, `/app/profile`, and `/app/debug/clerk` (dev-only)
- 2026-04-20 — decision: pull Tailwind adoption from 11c2 into 11c1 so `<UserDetails/>` + future Clerk component skins render as-intended. Existing inline-style pages stay untouched (mixed-mode is fine)
