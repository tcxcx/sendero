# Phase-11c1 — Auth Infra + Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Install Clerk properly with multi-tenant Organizations, custom roles, custom session claims, webhook-driven Prisma sync, and post-auth wallet provisioning. Ship `/sign-in`, `/sign-up`, `/onboarding` pages using prebuilt Clerk components + a Tailwind-powered `<UserDetails/>` visualizer.

**Architecture:** New `@sendero/auth` package mirrors next-forge's thin-curation pattern (provider, middleware, components, claims, webhooks). Clerk is the identity + membership source-of-truth; webhooks idempotently upsert Prisma `User`/`Tenant`/`Membership` rows and trigger Circle wallet provisioning via `@sendero/circle`. Pull Tailwind adoption forward from 11c2.

**Tech Stack:** Bun, `@clerk/nextjs`, `@clerk/themes`, `svix`, `tailwindcss@4`, `@tailwindcss/postcss`, Prisma, existing `@sendero/circle` + `@sendero/database`. Next.js App Router, Node runtime.

**Baseline:** 11b plan landed first (provides schema migration infrastructure pattern). Branch `feat/phase-11-invoicing`. Spec: `docs/superpowers/specs/2026-04-20-phase-11c1-auth-infra-design.md`.

**Conventions:** same as 11b — conventional commits, `--no-verify` for known fumadocs typecheck hook, `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`.

---

## File structure

**New package `packages/auth/`:**
- `package.json` — deps: `@clerk/nextjs`, `@clerk/themes`, `@clerk/types`
- `src/index.ts`, `client.ts`, `server.ts`, `proxy.ts`, `provider.tsx`
- `src/roles.ts`, `src/claims.ts`, `src/webhooks.ts`
- `src/components/sign-in.tsx`, `sign-up.tsx`, `org-switcher.tsx`, `user-button.tsx`
- `src/components/user-details.tsx` — visualizer (Clerk demo-panel pattern)

**Schema:**
- `packages/database/prisma/schema.prisma` — add `Wallet` model, `User.clerkUserId`, `Tenant.clerkOrgId`, `Membership.clerkMembershipId`

**App changes:**
- `apps/app/proxy.ts` (replaces any existing middleware.ts)
- `apps/app/app/layout.tsx` — wrap in `SenderoAuthProvider` + globals.css
- `apps/app/app/page.tsx` — landing w/ `<Show>` CTAs
- `apps/app/app/sign-in/[[...sign-in]]/page.tsx`
- `apps/app/app/sign-up/[[...sign-up]]/page.tsx`
- `apps/app/app/onboarding/layout.tsx`
- `apps/app/app/onboarding/page.tsx`
- `apps/app/app/onboarding/choose-org/page.tsx`
- `apps/app/app/app/profile/page.tsx` (interim)
- `apps/app/app/app/debug/clerk/page.tsx` (dev-only)
- `apps/app/app/api/webhooks/clerk/route.ts`
- `apps/app/app/api/cron/retry-wallet-provision/route.ts`
- `apps/app/components/app-header.tsx`
- `apps/app/tailwind.config.ts`, `postcss.config.mjs`
- `apps/app/app/globals.css` — `@tailwind` directives + minimal custom classes

**`@sendero/circle` extension:**
- `packages/circle/src/provision-tenant-wallet.ts`
- `packages/circle/src/provision-tenant-wallet.test.ts`
- `packages/circle/src/index.ts` — export

**Env + health:**
- `packages/env/src/validate.ts` — add 3 Clerk keys
- `apps/app/app/api/health/route.ts` — surface Clerk + webhook
- `apps/app/vercel.json` — retry-wallet-provision cron

**Docs + smoke:**
- `docs/clerk-setup.md`
- `scripts/smoke-clerk-webhook.ts`
- `scripts/smoke-auth-onboarding.ts`

---

## Sequencing

- **Epic 1** (Tasks 1-2) — schema + migration
- **Epic 2** (Tasks 3-8) — `@sendero/auth` package scaffolding + claims + roles + webhooks
- **Epic 3** (Tasks 9-10) — `provisionTenantWallet` in `@sendero/circle`
- **Epic 4** (Tasks 11-12) — Tailwind setup
- **Epic 5** (Tasks 13-15) — `SenderoAuthProvider` + proxy.ts + RootLayout wrap
- **Epic 6** (Tasks 16-20) — sign-in, sign-up, onboarding pages + `<AppHeader/>`
- **Epic 7** (Tasks 21-22) — `<UserDetails/>` visualizer + profile/debug routes
- **Epic 8** (Tasks 23-25) — Clerk webhook route + dispatcher + retry cron
- **Epic 9** (Tasks 26-27) — env validation + health
- **Epic 10** (Tasks 28-29) — smokes + Clerk Dashboard runbook

---

## Epic 1 — Schema + migration

### Task 1: Add Wallet model + Clerk mapping columns

**Files:**
- Modify: `packages/database/prisma/schema.prisma`

- [ ] **Step 1: Add `Wallet` model near `model NanopayBatch`**

```prisma
model Wallet {
  id                    String   @id @default(cuid())
  tenantId              String
  clerkOrgId            String?
  address               String   @unique
  kind                  String
  chain                 String
  circleWalletSetId     String?
  circleWalletId        String?
  createdAt             DateTime @default(now()) @db.Timestamptz(6)
  updatedAt             DateTime @updatedAt       @db.Timestamptz(6)

  tenant                Tenant   @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  @@index([tenantId, kind])
  @@map("wallets")
}
```

- [ ] **Step 2: Add `clerkUserId` to `User`, `clerkOrgId` to `Tenant`, `clerkMembershipId` to `Membership`, `wallets` relation to `Tenant`**

Find each model and append the field(s):

```prisma
model User {
  // existing...
  clerkUserId       String?   @unique
}

model Tenant {
  // existing (including phase-11b billing fields)...
  clerkOrgId        String?   @unique
  wallets           Wallet[]
}

model Membership {
  // existing...
  clerkMembershipId String?   @unique
}
```

- [ ] **Step 3: Format + commit**

```bash
cd packages/database && bunx prisma format && cd ../..
git add packages/database/prisma/schema.prisma
git commit --no-verify -m "feat(phase-11c1): schema — Wallet model + clerk mapping columns

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 2: Generate + apply migration

- [ ] Same pattern as 11b Task 2:

```bash
cd packages/database
TS=$(date -u +%Y%m%d%H%M%S)
MIG_DIR="prisma/migrations/${TS}_phase_11c1_auth_infra"
mkdir -p "$MIG_DIR"
bunx prisma migrate diff \
  --from-schema-datasource prisma/schema.prisma \
  --to-schema-datamodel prisma/schema.prisma \
  --script > "$MIG_DIR/migration.sql"
bunx prisma migrate deploy
bun run db:generate
cd ../..
git add packages/database/prisma/migrations
git commit --no-verify -m "feat(phase-11c1): migration — wallets + clerk mapping cols

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Epic 2 — `@sendero/auth` package

### Task 3: Package scaffold

**Files:**
- Create: `packages/auth/package.json`, `tsconfig.json`, `src/index.ts`

- [ ] **Step 1: `package.json`**

```json
{
  "name": "@sendero/auth",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "sideEffects": false,
  "main": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts",
    "./client": "./src/client.ts",
    "./server": "./src/server.ts",
    "./proxy": "./src/proxy.ts",
    "./provider": "./src/provider.tsx",
    "./roles": "./src/roles.ts",
    "./claims": "./src/claims.ts",
    "./webhooks": "./src/webhooks.ts",
    "./components/sign-in": "./src/components/sign-in.tsx",
    "./components/sign-up": "./src/components/sign-up.tsx",
    "./components/org-switcher": "./src/components/org-switcher.tsx",
    "./components/user-button": "./src/components/user-button.tsx",
    "./components/user-details": "./src/components/user-details.tsx"
  },
  "dependencies": {
    "@clerk/nextjs": "^6.15.0",
    "@clerk/themes": "^2.2.0",
    "@clerk/types": "^4.54.0",
    "svix": "^1.38.0"
  },
  "peerDependencies": {
    "react": "^19",
    "react-dom": "^19"
  }
}
```

- [ ] **Step 2: `tsconfig.json`**

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "jsx": "react-jsx",
    "rootDir": "./src",
    "lib": ["ES2022", "DOM"]
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: `src/index.ts`** (re-export everything convenient)

```typescript
export * from './client';
export * from './server';
export * from './roles';
export * from './claims';
export { SenderoAuthProvider } from './provider';
```

- [ ] **Step 4: Install + commit**

```bash
bun install 2>&1 | tail -3
git add packages/auth
git commit --no-verify -m "feat(phase-11c1): @sendero/auth package scaffold

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 4: `client.ts` + `server.ts` + `proxy.ts`

**Files:**
- Create: `packages/auth/src/client.ts`, `server.ts`, `proxy.ts`

- [ ] **Step 1:**

```typescript
// client.ts
export * from '@clerk/nextjs';
```

```typescript
// server.ts
import 'server-only';
export * from '@clerk/nextjs/server';
```

```typescript
// proxy.ts
export { clerkMiddleware as authMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
```

- [ ] **Step 2: Commit**

```bash
git add packages/auth/src/client.ts packages/auth/src/server.ts packages/auth/src/proxy.ts
git commit --no-verify -m "feat(phase-11c1): auth package client/server/proxy re-exports

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 5: `provider.tsx` — SenderoAuthProvider

**Files:**
- Create: `packages/auth/src/provider.tsx`

- [ ] **Step 1:**

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
          colorPrimary: '#fb542b',
          colorText: '#0b0b0b',
          colorBackground: '#ffffff',
          fontFamily: 'var(--font-geist-sans)',
          fontFamilyButtons: 'var(--font-geist-sans)',
          borderRadius: '0.25rem',
        },
        elements: {
          formButtonPrimary:
            'bg-[#fb542b] hover:bg-[#d13d18] text-white',
          card: 'shadow-none border border-neutral-200',
          organizationSwitcherTrigger: 'px-3 py-2',
          organizationPreviewMainIdentifier: 'font-medium',
        },
        layout: {
          privacyPageUrl: 'https://sendero.travel/privacy',
          termsPageUrl: 'https://sendero.travel/terms',
          helpPageUrl: 'https://sendero.travel/help',
        },
        ...(props.appearance ?? {}),
      }}
    />
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/auth/src/provider.tsx
git commit --no-verify -m "feat(phase-11c1): SenderoAuthProvider — ClerkProvider w/ Sendero theme

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 6: `claims.ts` — TypeScript augmentation

**Files:**
- Create: `packages/auth/src/claims.ts`

- [ ] **Step 1:**

```typescript
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

- [ ] **Step 2: Commit**

### Task 7: `roles.ts` — role constants + helpers

**Files:**
- Create: `packages/auth/src/roles.ts`
- Create: `packages/auth/src/roles.test.ts`

- [ ] **Step 1: Tests**

```typescript
import { test, expect } from 'bun:test';
import { mapClerkRoleToPrisma, ROLES } from './roles';

test('mapClerkRoleToPrisma', () => {
  expect(mapClerkRoleToPrisma('org:admin')).toBe('agency_admin');
  expect(mapClerkRoleToPrisma('org:finance')).toBe('finance');
  expect(mapClerkRoleToPrisma('org:member')).toBe('traveler');
});

test('mapClerkRoleToPrisma returns traveler for unknown role', () => {
  expect(mapClerkRoleToPrisma('org:random')).toBe('traveler');
});

test('ROLES constants', () => {
  expect(ROLES.ADMIN).toBe('org:admin');
  expect(ROLES.FINANCE).toBe('org:finance');
  expect(ROLES.MEMBER).toBe('org:member');
});
```

- [ ] **Step 2: Implement**

```typescript
export const ROLES = {
  ADMIN: 'org:admin',
  FINANCE: 'org:finance',
  MEMBER: 'org:member',
} as const;

export type ClerkRole = typeof ROLES[keyof typeof ROLES];

export type PrismaRole = 'agency_admin' | 'finance' | 'traveler' | 'guest';

export function mapClerkRoleToPrisma(clerkRole: string): PrismaRole {
  switch (clerkRole) {
    case ROLES.ADMIN: return 'agency_admin';
    case ROLES.FINANCE: return 'finance';
    case ROLES.MEMBER: return 'traveler';
    default: return 'traveler';
  }
}
```

- [ ] **Step 3: Run + commit**

```bash
cd packages/auth && bun test src/roles.test.ts && cd ../..
git add packages/auth/src/roles.ts packages/auth/src/roles.test.ts
git commit --no-verify -m "feat(phase-11c1): roles — Clerk ↔ Prisma role mapping

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 8: `webhooks.ts` — svix verifier + event dispatcher

**Files:**
- Create: `packages/auth/src/webhooks.ts`
- Create: `packages/auth/src/webhooks.test.ts`

- [ ] **Step 1: Tests**

```typescript
import { test, expect } from 'bun:test';
import { Webhook } from 'svix';
import { verifyClerkWebhook } from './webhooks';

const SECRET = 'whsec_dGVzdC1zZWNyZXQtZm9yLWNsZXJrLXdlYmhvb2tzLWF0LWxlYXN0LTMyLWJ5dGVz';

function signPayload(body: string) {
  const wh = new Webhook(SECRET);
  const id = 'msg_' + Date.now();
  const timestamp = Math.floor(Date.now() / 1000);
  const toSign = `${id}.${timestamp}.${body}`;
  // Simpler: use Webhook.sign if available; otherwise simulate by crafting headers via wh.sign
  const sig = wh.sign(id, new Date(timestamp * 1000), body);
  return {
    'svix-id': id,
    'svix-timestamp': String(timestamp),
    'svix-signature': sig,
  };
}

test('verifyClerkWebhook accepts valid signature', () => {
  const body = JSON.stringify({ type: 'user.created', data: { id: 'user_123' } });
  const headers = signPayload(body);
  const event = verifyClerkWebhook(body, headers, SECRET);
  expect(event.type).toBe('user.created');
});

test('verifyClerkWebhook rejects tampered body', () => {
  const body = JSON.stringify({ type: 'user.created', data: { id: 'user_123' } });
  const headers = signPayload(body);
  expect(() => verifyClerkWebhook(body + 'x', headers, SECRET)).toThrow();
});
```

- [ ] **Step 2: Implement**

```typescript
import { Webhook } from 'svix';

export interface ClerkWebhookEvent {
  type: string;
  data: Record<string, unknown>;
}

export function verifyClerkWebhook(
  rawBody: string,
  headers: { 'svix-id'?: string; 'svix-timestamp'?: string; 'svix-signature'?: string; [k: string]: string | undefined },
  secret: string
): ClerkWebhookEvent {
  const wh = new Webhook(secret);
  const event = wh.verify(rawBody, {
    'svix-id': headers['svix-id'] ?? '',
    'svix-timestamp': headers['svix-timestamp'] ?? '',
    'svix-signature': headers['svix-signature'] ?? '',
  }) as ClerkWebhookEvent;
  return event;
}
```

- [ ] **Step 3: Run + commit**

```bash
cd packages/auth && bun test src/webhooks.test.ts && cd ../..
git add packages/auth/src/webhooks.ts packages/auth/src/webhooks.test.ts
git commit --no-verify -m "feat(phase-11c1): svix Clerk webhook verifier

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Epic 3 — `provisionTenantWallet`

### Task 9: Implementation

**Files:**
- Create: `packages/circle/src/provision-tenant-wallet.ts`
- Modify: `packages/circle/src/index.ts` — export

- [ ] **Step 1: Inspect existing SDK factory**

```bash
grep -n "createCircleSdk\|createWalletSet\|createWallets" packages/circle/src/*.ts | head -10
```

Adapt the function below to the actual Circle SDK exports available in this repo.

- [ ] **Step 2: Write function**

```typescript
import { prisma } from '@sendero/database';
// Adapt to actual path:
import { createCircleSdk } from './client';

export interface ProvisionTenantWalletArgs {
  tenantId: string;
  clerkOrgId: string;
}

export interface ProvisionTenantWalletResult {
  walletSetId: string;
  walletId: string;
  address: `0x${string}`;
  alreadyExisted: boolean;
}

export async function provisionTenantWallet(
  args: ProvisionTenantWalletArgs
): Promise<ProvisionTenantWalletResult> {
  // 1. Idempotent — return existing if any
  const existing = await prisma.wallet.findFirst({
    where: { tenantId: args.tenantId, kind: 'treasury' },
  });
  if (existing) {
    return {
      walletSetId: existing.circleWalletSetId ?? '',
      walletId: existing.circleWalletId ?? '',
      address: existing.address as `0x${string}`,
      alreadyExisted: true,
    };
  }

  const circle = createCircleSdk();

  // 2. Create walletSet
  const wsRes = await circle.createWalletSet({ name: `tenant-${args.tenantId}` });
  const walletSetId = wsRes.data?.walletSet?.id;
  if (!walletSetId) throw new Error('circle walletSet creation returned no id');

  // 3. Create wallet on Arc Testnet
  const wRes = await circle.createWallets({
    walletSetId,
    blockchains: ['ARC-TESTNET'],
    count: 1,
    accountType: 'SCA',
  });
  const wallet = wRes.data?.wallets?.[0];
  if (!wallet?.address) throw new Error('circle wallet creation returned no address');

  // 4. Persist
  await prisma.wallet.create({
    data: {
      tenantId: args.tenantId,
      clerkOrgId: args.clerkOrgId,
      address: wallet.address.toLowerCase(),
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
    alreadyExisted: false,
  };
}
```

- [ ] **Step 3: Export from `src/index.ts`** + commit

```bash
git add packages/circle/src
git commit --no-verify -m "feat(phase-11c1): provisionTenantWallet — Circle walletSet + wallet

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 10: Mocked unit test for idempotency

**Files:**
- Create: `packages/circle/src/provision-tenant-wallet.test.ts`

- [ ] **Step 1: Skeleton**

Mock Circle SDK + Prisma at the test level. Assert that a second call to `provisionTenantWallet(sameArgs)` doesn't call `createWalletSet` again. This test requires a local mock of `createCircleSdk` — use `mock.module` from `bun:test` or refactor `provisionTenantWallet` to accept an injected SDK factory for testability.

Refactor recommended: change function signature to accept `opts?: { sdk?: CircleSdk }`. Then the test passes a mock SDK directly, no module mocking needed.

Runner takes: first call expects 1 `createWalletSet` + 1 `createWallets`. Second call expects 0 of each.

- [ ] **Step 2: Commit**

---

## Epic 4 — Tailwind setup

### Task 11: Install Tailwind v4 + PostCSS in apps/app

**Files:**
- Create: `apps/app/postcss.config.mjs`
- Create: `apps/app/tailwind.config.ts`
- Modify: `apps/app/package.json` — add deps
- Modify: `apps/app/app/globals.css` — add `@tailwind` directives

- [ ] **Step 1: Install**

```bash
cd apps/app
bun add -D tailwindcss @tailwindcss/postcss
cd ../..
```

- [ ] **Step 2: `postcss.config.mjs`**

```js
export default {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};
```

- [ ] **Step 3: `tailwind.config.ts`**

```ts
import type { Config } from 'tailwindcss';

export default {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    '../../packages/auth/src/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        primary: '#fb542b',
      },
      fontFamily: {
        sans: ['var(--font-geist-sans)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-geist-mono)', 'ui-monospace', 'monospace'],
      },
    },
  },
} satisfies Config;
```

- [ ] **Step 4: Update `apps/app/app/globals.css`** — prepend:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

Keep existing custom styles below the directives.

- [ ] **Step 5: Typecheck + commit**

```bash
bun run typecheck 2>&1 | tail -5
git add apps/app/postcss.config.mjs apps/app/tailwind.config.ts apps/app/app/globals.css apps/app/package.json
git commit --no-verify -m "feat(phase-11c1): Tailwind 4 setup in apps/app

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 12: Install Clerk + svix deps in apps/app

```bash
cd apps/app
bun add @clerk/nextjs @clerk/themes svix @sendero/auth@workspace:*
cd ../..
git add apps/app/package.json bun.lock
git commit --no-verify -m "chore(phase-11c1): install Clerk + svix + @sendero/auth"
```

---

## Epic 5 — Middleware + RootLayout wrap

### Task 13: `proxy.ts` middleware

**Files:**
- Create: `apps/app/proxy.ts`
- Delete: `apps/app/middleware.ts` (if exists)

- [ ] **Step 1: Write `proxy.ts`**

```typescript
import { clerkMiddleware, createRouteMatcher } from '@sendero/auth/server';
import { NextRequest, NextResponse } from 'next/server';

const isPublicRoute = createRouteMatcher([
  '/',
  '/g(.*)',
  '/invoice/(.*)',
  '/sign-in(.*)',
  '/sign-up(.*)',
  '/api/webhooks/(.*)',
  '/api/cron/(.*)',
  '/api/health',
  '/api/guest/claimed',
]);

const isOnboardingRoute = createRouteMatcher(['/onboarding(.*)', '/tasks(.*)']);

export default clerkMiddleware(async (auth, req: NextRequest) => {
  const { isAuthenticated, sessionClaims, orgId, redirectToSignIn } = await auth();

  if (isPublicRoute(req)) return NextResponse.next();
  if (!isAuthenticated) return redirectToSignIn({ returnBackUrl: req.url });
  if (isOnboardingRoute(req)) return NextResponse.next();

  if (!sessionClaims?.org_metadata?.onboardingComplete) {
    return NextResponse.redirect(new URL('/onboarding', req.url));
  }
  if (!orgId) {
    return NextResponse.redirect(new URL('/onboarding/choose-org', req.url));
  }
  return NextResponse.next();
});

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
};
```

- [ ] **Step 2: Commit**

### Task 14: Wrap RootLayout in `SenderoAuthProvider`

**Files:**
- Modify: `apps/app/app/layout.tsx`

- [ ] **Step 1: Update**

```tsx
import type { Metadata, Viewport } from 'next';
import Script from 'next/script';
import { NuqsAdapter } from 'nuqs/adapters/next/app';
import { SenderoAuthProvider } from '@sendero/auth';
import { ClerkLoaded, ClerkLoading, ClerkFailed } from '@sendero/auth/client';
import './globals.css';

export const metadata: Metadata = {
  title: 'Sendero × Arc · AI Travel Agent',
  // ... existing fields stay
};

export const viewport: Viewport = { width: 1400, initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&family=Geist+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <SenderoAuthProvider
          signInFallbackRedirectUrl="/onboarding"
          signUpFallbackRedirectUrl="/onboarding"
          taskUrls={{ 'choose-organization': '/onboarding/choose-org' }}
        >
          <ClerkLoading>
            <div className="p-8 text-sm text-neutral-500">Loading…</div>
          </ClerkLoading>
          <ClerkLoaded>
            <NuqsAdapter>{children}</NuqsAdapter>
          </ClerkLoaded>
          <ClerkFailed>
            <div className="p-8 text-sm text-red-600">
              Sign-in service unavailable. Please try again shortly.
            </div>
          </ClerkFailed>
        </SenderoAuthProvider>
      </body>
    </html>
  );
}
```

- [ ] **Step 2: Commit**

### Task 15: Landing page + `<Show>` CTAs

**Files:**
- Modify: `apps/app/app/page.tsx`

- [ ] Update landing page to include `<Show when="signed-in">Go to app →</Show>` / `<Show when="signed-out">Sign in / Sign up</Show>` buttons. Use `import { Show } from '@sendero/auth/client';`. Keep existing Hero content. Commit.

---

## Epic 6 — Auth + onboarding pages + header

### Task 16: Sign-in page

**Files:**
- Create: `apps/app/app/sign-in/[[...sign-in]]/page.tsx`
- Create: `packages/auth/src/components/sign-in.tsx`

- [ ] **Step 1: Wrapper component**

```tsx
// packages/auth/src/components/sign-in.tsx
import { SignIn } from '@clerk/nextjs';

export function SenderoSignIn() {
  return (
    <SignIn
      appearance={{
        elements: {
          header: 'hidden',
          card: 'shadow-none border border-neutral-200',
        },
      }}
    />
  );
}
```

- [ ] **Step 2: Page**

```tsx
// apps/app/app/sign-in/[[...sign-in]]/page.tsx
import { SenderoSignIn } from '@sendero/auth/components/sign-in';

export default function SignInPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-8">
      <SenderoSignIn />
    </main>
  );
}
```

- [ ] **Step 3: Commit**

### Task 17: Sign-up page

Same shape. Commit.

### Task 18: Onboarding layout + pages

**Files:**
- Create: `apps/app/app/onboarding/layout.tsx`
- Create: `apps/app/app/onboarding/page.tsx`
- Create: `apps/app/app/onboarding/choose-org/page.tsx`

- [ ] **Step 1: Layout (redirects if complete)**

```tsx
import { auth } from '@sendero/auth/server';
import { redirect } from 'next/navigation';

export default async function OnboardingLayout({ children }: { children: React.ReactNode }) {
  const { sessionClaims } = await auth();
  if (sessionClaims?.org_metadata?.onboardingComplete === true) redirect('/app');
  return <>{children}</>;
}
```

- [ ] **Step 2: Main page — uses `<OrganizationList/>` + client-side polling**

```tsx
'use client';

import { OrganizationList, useOrganization } from '@clerk/nextjs';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

export default function OnboardingPage() {
  const { organization, isLoaded } = useOrganization();
  const router = useRouter();
  const [polling, setPolling] = useState(false);

  useEffect(() => {
    if (!organization) return;
    const publicMetadata = (organization.publicMetadata ?? {}) as { onboardingComplete?: boolean; arcWalletAddress?: string };
    if (publicMetadata.onboardingComplete === true) {
      router.push('/app');
      return;
    }
    setPolling(true);
    const interval = setInterval(() => {
      organization.reload();
    }, 2000);
    return () => clearInterval(interval);
  }, [organization, router]);

  if (!isLoaded) return <div className="p-8">Loading…</div>;

  if (!organization) {
    return (
      <main className="mx-auto max-w-xl p-8">
        <h1 className="text-2xl font-semibold mb-4">Welcome to Sendero</h1>
        <p className="text-neutral-600 mb-6">Create or select an organization to continue.</p>
        <OrganizationList hidePersonal afterCreateOrganizationUrl="/onboarding" afterSelectOrganizationUrl="/onboarding" />
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-xl p-8 text-center">
      <h1 className="text-2xl font-semibold mb-4">Provisioning {organization.name}…</h1>
      <p className="text-neutral-600 mb-6">Setting up your Arc treasury wallet. This takes a few seconds.</p>
      <div className="animate-pulse text-xs font-mono text-neutral-500">polling {polling ? '●' : '○'}</div>
    </main>
  );
}
```

- [ ] **Step 3: Choose-org page**

```tsx
'use client';

import { OrganizationList } from '@clerk/nextjs';

export default function ChooseOrgPage() {
  return (
    <main className="mx-auto max-w-xl p-8">
      <h1 className="text-2xl font-semibold mb-4">Choose an organization</h1>
      <OrganizationList hidePersonal afterCreateOrganizationUrl="/onboarding" afterSelectOrganizationUrl="/onboarding" />
    </main>
  );
}
```

- [ ] **Step 4: Commit**

### Task 19: `<AppHeader/>`

**Files:**
- Create: `apps/app/components/app-header.tsx`

- [ ] **Step 1:**

```tsx
'use client';

import { OrganizationSwitcher, UserButton, Show } from '@clerk/nextjs';
import Link from 'next/link';

export function AppHeader() {
  return (
    <header className="flex items-center justify-between px-6 py-4 border-b border-neutral-200">
      <Link href="/" className="flex items-center gap-2">
        <span className="block h-3 w-3 bg-[#fb542b]" />
        <span className="font-mono text-sm uppercase tracking-wide">Sendero</span>
      </Link>
      <div className="flex items-center gap-3">
        <Show when="signed-in">
          <OrganizationSwitcher afterSelectOrganizationUrl="/app" afterCreateOrganizationUrl="/onboarding" />
          <UserButton userProfileUrl="/app/profile" />
        </Show>
        <Show when="signed-out">
          <Link href="/sign-in" className="text-sm text-neutral-700 hover:text-black">
            Sign in
          </Link>
          <Link
            href="/sign-up"
            className="rounded bg-[#fb542b] px-4 py-2 text-sm text-white hover:bg-[#d13d18]"
          >
            Get started
          </Link>
        </Show>
      </div>
    </header>
  );
}
```

- [ ] **Step 2: Commit**

### Task 20: Package `SenderoOrgSwitcher` + `SenderoUserButton` wrappers in `@sendero/auth/components`

- [ ] Thin wrappers around Clerk prebuilts with default props for Sendero URLs. Commit.

---

## Epic 7 — `<UserDetails/>` + profile/debug routes

### Task 21: Port `<UserDetails/>` to `@sendero/auth/components/user-details.tsx`

**Files:**
- Create: `packages/auth/src/components/user-details.tsx`

- [ ] **Step 1: Port verbatim from the user's paste**, parameterizing `showPointers` and adding a Sendero extensions block for wallet details.

```tsx
'use client';

import { useOrganization, useSession, useUser } from '@clerk/nextjs';

interface UserDetailsProps {
  showPointers?: boolean;
  extraSections?: Array<'wallet'>;
}

function Row({
  desc, value, children,
}: { desc: string; value: string; children?: React.ReactNode }) {
  return (
    <div className="h-8.5 grid grid-cols-2 items-center relative">
      <span className="text-xs font-semibold block shrink-0">{desc}</span>
      <span className="text-xs text-[#7D7D7E] font-mono block relative">
        <span className="block truncate w-full">{value}</span>
        {children}
      </span>
    </div>
  );
}

function PointerC({ label, show }: { label: string; show: boolean }) {
  if (!show) return null;
  return (
    <div className="absolute w-fit flex items-center gap-5 top-1/2 -translate-y-1/2 left-full">
      <div className="relative">
        <div className="h-px bg-[#BFBFC4] w-26" />
        <div className="size-1 bg-[#BFBFC4] rotate-45 absolute right-0 top-1/2 -translate-y-1/2" />
      </div>
      <div className="font-mono text-xs bg-black px-1.5 py-1 rounded-md text-white">
        {label}
      </div>
    </div>
  );
}

function formatDate(date: Date) {
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
function formatDateWithNumbers(date: Date) {
  return date.toLocaleString('en-US', {
    month: 'numeric', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true,
  });
}

export function UserDetails({ showPointers: showPointersProp, extraSections = [] }: UserDetailsProps) {
  const { user } = useUser();
  const { session } = useSession();
  const { organization } = useOrganization();

  const showPointers = showPointersProp ?? (process.env.NEXT_PUBLIC_CLERK_DEMO_MODE === '1' || process.env.NODE_ENV !== 'production');

  if (!user || !session) return null;

  const orgMeta = (organization?.publicMetadata ?? {}) as { arcWalletAddress?: string; onboardingComplete?: boolean };

  return (
    <div className="p-16 rounded-lg border border-[#EDEDED] bg-[#F1F1F2] relative">
      <div className="p-8 rounded-xl bg-white shadow-[0_5px_15px_rgba(0,0,0,0.08),0_15px_35px_-5px_rgba(25,28,33,0.2)] ring-1 ring-gray-950/5 max-w-100">
        <div className="flex flex-col items-center gap-2 mb-6">
          <div className="w-full relative flex justify-center">
            <img src={user.imageUrl} alt="" className="size-20 rounded-full" />
            {showPointers && (
              <div className="absolute w-fit flex items-center gap-5 top-1/2 -translate-x-2.5 -translate-y-1/2 left-full">
                <div className="relative">
                  <div className="h-px bg-[#BFBFC4] w-26" />
                  <div className="size-1 bg-[#BFBFC4] rotate-45 absolute right-0 top-1/2 -translate-y-1/2" />
                </div>
                <div className="font-mono text-xs bg-black px-1.5 py-1 rounded-md text-white">user.imageUrl</div>
              </div>
            )}
          </div>
          {user.firstName && user.lastName ? (
            <h1 className="text-[1.0625rem] font-semibold relative w-full text-center">
              {user.firstName} {user.lastName}
            </h1>
          ) : <div className="h-4" />}
        </div>

        <div className="px-2.5 bg-[#FAFAFB] rounded-lg divide-y divide-[#EEEEF0]">
          <Row desc="Email" value={user.emailAddresses[0]?.emailAddress ?? ''}>
            <PointerC label="user.emailAddresses[0].emailAddress" show={showPointers} />
          </Row>
          {user.lastSignInAt && <Row desc="Last signed in" value={formatDate(user.lastSignInAt)}>
            <PointerC label="user.lastSignInAt" show={showPointers} />
          </Row>}
          {user.createdAt && <Row desc="Joined on" value={formatDate(user.createdAt)}>
            <PointerC label="user.createdAt" show={showPointers} />
          </Row>}
          <Row desc="User ID" value={user.id}>
            <PointerC label="user.id" show={showPointers} />
          </Row>
        </div>

        <h2 className="mt-6 mb-4 text-[0.9375rem] font-semibold">Session details</h2>
        <div className="px-2.5 bg-[#FAFAFB] rounded-lg divide-y divide-[#EEEEF0]">
          <Row desc="Session ID" value={session.id}>
            <PointerC label="session.id" show={showPointers} />
          </Row>
          <Row desc="Status" value={session.status}>
            <PointerC label="session.status" show={showPointers} />
          </Row>
          <Row desc="Last active" value={formatDateWithNumbers(session.lastActiveAt)}>
            <PointerC label="session.lastActiveAt" show={showPointers} />
          </Row>
          <Row desc="Session expiration" value={formatDateWithNumbers(session.expireAt)}>
            <PointerC label="session.expireAt" show={showPointers} />
          </Row>
        </div>

        {organization && (
          <>
            <h2 className="mt-6 mb-4 text-[0.9375rem] font-semibold">Organization details</h2>
            <div className="px-2.5 bg-[#FAFAFB] rounded-lg divide-y divide-[#EEEEF0]">
              <Row desc="Organization ID" value={organization.id}>
                <PointerC label="organization.id" show={showPointers} />
              </Row>
              <Row desc="Name" value={organization.name}>
                <PointerC label="organization.name" show={showPointers} />
              </Row>
              <Row desc="Members" value={String(organization.membersCount)}>
                <PointerC label="organization.membersCount" show={showPointers} />
              </Row>
              <Row desc="Pending invitations" value={String(organization.pendingInvitationsCount)}>
                <PointerC label="organization.pendingInvitationsCount" show={showPointers} />
              </Row>
            </div>
          </>
        )}

        {organization && extraSections.includes('wallet') && (
          <>
            <h2 className="mt-6 mb-4 text-[0.9375rem] font-semibold">Wallet</h2>
            <div className="px-2.5 bg-[#FAFAFB] rounded-lg divide-y divide-[#EEEEF0]">
              <Row desc="Arc address" value={orgMeta.arcWalletAddress ?? '(provisioning…)'}>
                <PointerC label="org.publicMetadata.arcWalletAddress" show={showPointers} />
              </Row>
              <Row desc="Onboarding" value={orgMeta.onboardingComplete ? 'complete' : 'pending'}>
                <PointerC label="org.publicMetadata.onboardingComplete" show={showPointers} />
              </Row>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

### Task 22: `/app/profile` + `/app/debug/clerk` routes

**Files:**
- Create: `apps/app/app/app/profile/page.tsx`
- Create: `apps/app/app/app/debug/clerk/page.tsx`

- [ ] **Step 1: Profile page**

```tsx
import { UserDetails } from '@sendero/auth/components/user-details';

export default function ProfilePage() {
  return (
    <main className="p-8">
      <UserDetails showPointers={false} extraSections={['wallet']} />
    </main>
  );
}
```

- [ ] **Step 2: Debug page**

```tsx
import { notFound } from 'next/navigation';
import { UserDetails } from '@sendero/auth/components/user-details';

export default function DebugClerkPage() {
  if (process.env.NODE_ENV === 'production') notFound();
  return (
    <main className="p-8">
      <UserDetails showPointers={true} extraSections={['wallet']} />
    </main>
  );
}
```

- [ ] **Step 3: Commit**

---

## Epic 8 — Clerk webhook + retry cron

### Task 23: `/api/webhooks/clerk` route

**Files:**
- Create: `apps/app/app/api/webhooks/clerk/route.ts`

- [ ] **Step 1: Write route**

```typescript
import { type NextRequest, NextResponse } from 'next/server';
import { verifyClerkWebhook } from '@sendero/auth/webhooks';
import { prisma } from '@sendero/database';
import { clerkClient } from '@sendero/auth/server';
import { provisionTenantWallet } from '@sendero/circle';
import { mapClerkRoleToPrisma } from '@sendero/auth/roles';
import { recordWebhookEvent, markWebhookEventProcessed } from '@/lib/webhook-events';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const secret = process.env.CLERK_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: 'not_configured' }, { status: 503 });

  const raw = await req.text();
  const headers = {
    'svix-id': req.headers.get('svix-id') ?? undefined,
    'svix-timestamp': req.headers.get('svix-timestamp') ?? undefined,
    'svix-signature': req.headers.get('svix-signature') ?? undefined,
  };

  let event;
  try {
    event = verifyClerkWebhook(raw, headers, secret);
  } catch (err) {
    return NextResponse.json({ error: 'invalid_signature' }, { status: 401 });
  }

  const externalId = (headers['svix-id'] ?? `${event.type}-${Date.now()}`);
  const stored = await recordWebhookEvent({
    provider: 'clerk',
    externalId,
    eventType: event.type,
    payload: event,
  });
  if (stored.alreadyProcessed) return NextResponse.json({ ok: true, deduped: true });

  let error: string | undefined;
  try {
    await dispatch(event);
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
    console.error('[webhooks/clerk]', event.type, error);
  }

  await markWebhookEventProcessed(stored.id, error);
  if (error) return NextResponse.json({ error }, { status: 500 });
  return NextResponse.json({ ok: true });
}

async function dispatch(event: { type: string; data: any }) {
  switch (event.type) {
    case 'user.created': return onUserCreated(event.data);
    case 'user.updated': return onUserUpdated(event.data);
    case 'organization.created': return onOrganizationCreated(event.data);
    case 'organization.updated': return onOrganizationUpdated(event.data);
    case 'organizationMembership.created': return onMembershipCreated(event.data);
    case 'organizationMembership.updated': return onMembershipUpdated(event.data);
    case 'organizationMembership.deleted': return onMembershipDeleted(event.data);
  }
}

async function onUserCreated(data: any) {
  await prisma.user.upsert({
    where: { clerkUserId: data.id },
    create: {
      clerkUserId: data.id,
      email: data.email_addresses?.[0]?.email_address ?? null,
      displayName: `${data.first_name ?? ''} ${data.last_name ?? ''}`.trim() || null,
    },
    update: {
      email: data.email_addresses?.[0]?.email_address ?? undefined,
    },
  });
}

async function onUserUpdated(data: any) {
  await prisma.user.update({
    where: { clerkUserId: data.id },
    data: {
      email: data.email_addresses?.[0]?.email_address ?? undefined,
      displayName: `${data.first_name ?? ''} ${data.last_name ?? ''}`.trim() || undefined,
    },
  });
}

async function onOrganizationCreated(data: any) {
  const tenant = await prisma.tenant.upsert({
    where: { clerkOrgId: data.id },
    create: {
      clerkOrgId: data.id,
      slug: data.slug ?? data.id.toLowerCase(),
      displayName: data.name ?? data.id,
      billingTier: 'free',
    },
    update: { displayName: data.name ?? undefined, slug: data.slug ?? undefined },
  });

  try {
    const result = await provisionTenantWallet({ tenantId: tenant.id, clerkOrgId: data.id });
    const client = await clerkClient();
    await client.organizations.updateOrganization(data.id, {
      publicMetadata: {
        tenantId: tenant.id,
        arcWalletAddress: result.address,
        onboardingComplete: true,
      },
    });
  } catch (err) {
    await prisma.tenant.update({
      where: { id: tenant.id },
      data: { metadata: { provisioningError: err instanceof Error ? err.message : String(err) } },
    });
    throw err;  // surface via webhook 500 → svix retries
  }
}

async function onOrganizationUpdated(data: any) {
  await prisma.tenant.update({
    where: { clerkOrgId: data.id },
    data: {
      displayName: data.name ?? undefined,
      slug: data.slug ?? undefined,
    },
  });
}

async function onMembershipCreated(data: any) {
  const tenant = await prisma.tenant.findUnique({ where: { clerkOrgId: data.organization.id } });
  const user = await prisma.user.findUnique({ where: { clerkUserId: data.public_user_data.user_id } });
  if (!tenant || !user) return; // out-of-order delivery — svix retries

  await prisma.membership.upsert({
    where: { clerkMembershipId: data.id },
    create: {
      clerkMembershipId: data.id,
      tenantId: tenant.id,
      userId: user.id,
      role: mapClerkRoleToPrisma(data.role),
      status: 'active',
    },
    update: { role: mapClerkRoleToPrisma(data.role), status: 'active' },
  });
}

async function onMembershipUpdated(data: any) {
  await prisma.membership.update({
    where: { clerkMembershipId: data.id },
    data: { role: mapClerkRoleToPrisma(data.role) },
  });
}

async function onMembershipDeleted(data: any) {
  await prisma.membership.update({
    where: { clerkMembershipId: data.id },
    data: { status: 'removed' },
  });
}
```

- [ ] **Step 2: Commit**

### Task 24: `apps/app/lib/webhook-events.ts` helper

If not already present from phase-11a Epic 5, port:

```typescript
import { prisma } from '@sendero/database';

export async function recordWebhookEvent(args: {
  provider: string; externalId: string; eventType: string; payload: unknown;
}) {
  const existing = await prisma.webhookEvent.findUnique({
    where: { provider_externalId: { provider: args.provider, externalId: args.externalId } },
    select: { id: true, processedAt: true },
  });
  if (existing) return { id: existing.id, alreadyProcessed: existing.processedAt !== null };
  const row = await prisma.webhookEvent.create({
    data: {
      provider: args.provider, externalId: args.externalId, eventType: args.eventType,
      payload: args.payload as object,
    },
    select: { id: true },
  });
  return { id: row.id, alreadyProcessed: false };
}

export async function markWebhookEventProcessed(id: string, error?: string) {
  await prisma.webhookEvent.update({
    where: { id },
    data: { processedAt: new Date(), processingError: error ?? null },
  });
}
```

(Likely already exists from phase-11a; skip if present.)

### Task 25: Retry cron

**Files:**
- Create: `apps/app/app/api/cron/retry-wallet-provision/route.ts`
- Modify: `apps/app/vercel.json` — add cron entry

```typescript
import { type NextRequest, NextResponse } from 'next/server';
import { prisma } from '@sendero/database';
import { clerkClient } from '@sendero/auth/server';
import { provisionTenantWallet } from '@sendero/circle';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (expected && req.headers.get('authorization') !== `Bearer ${expected}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  // Find tenants with no wallet or missing onboardingComplete metadata.
  const candidates = await prisma.tenant.findMany({
    where: { clerkOrgId: { not: null }, wallets: { none: {} } },
    select: { id: true, clerkOrgId: true },
    take: 50,
  });

  const results = [];
  for (const c of candidates) {
    if (!c.clerkOrgId) continue;
    try {
      const result = await provisionTenantWallet({ tenantId: c.id, clerkOrgId: c.clerkOrgId });
      const client = await clerkClient();
      await client.organizations.updateOrganization(c.clerkOrgId, {
        publicMetadata: { tenantId: c.id, arcWalletAddress: result.address, onboardingComplete: true },
      });
      results.push({ tenantId: c.id, outcome: 'provisioned' });
    } catch (err) {
      results.push({ tenantId: c.id, outcome: 'failed', error: err instanceof Error ? err.message : String(err) });
    }
  }
  return NextResponse.json({ results });
}
```

- [ ] Add to `apps/app/vercel.json` crons:

```json
  { "path": "/api/cron/retry-wallet-provision", "schedule": "*/5 * * * *" }
```

- [ ] Commit.

---

## Epic 9 — Env + health

### Task 26: Env validation

Add to `packages/env/src/validate.ts`:

```typescript
  { name: 'CLERK_SECRET_KEY', scope: 'auth', hint: 'from Clerk dashboard' },
  { name: 'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', scope: 'auth', hint: 'from Clerk dashboard' },
  { name: 'CLERK_WEBHOOK_SECRET', scope: 'auth', hint: 'svix endpoint signing secret from Clerk dashboard' },
```

Commit.

### Task 27: Health surface

Add to `apps/app/app/api/health/route.ts`:

```typescript
    clerkSecretKey: !!process.env.CLERK_SECRET_KEY,
    clerkPublishableKey: !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
    clerkWebhookSecret: !!process.env.CLERK_WEBHOOK_SECRET,
```

Commit.

---

## Epic 10 — Smokes + runbook

### Task 28: `docs/clerk-setup.md`

Write a runbook covering:

- Create Clerk application → Organizations enabled → Membership required → Personal Accounts disabled
- Enable Organization slugs
- Create custom role `org:finance` with read-only permissions
- Default member role = `org:member`, Creator role = `org:admin`
- Customize session token: add `metadata: {{user.public_metadata}}`, `org_metadata: {{org.public_metadata}}`
- Add webhook endpoint: `https://<preview-url>/api/webhooks/clerk` + production URL; subscribe to `user.*`, `organization.*`, `organizationMembership.*`
- Copy secret → `CLERK_WEBHOOK_SECRET`
- Set env URLs: `NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in`, etc.

Commit.

### Task 29: `scripts/smoke-clerk-webhook.ts`

Sign a fabricated `organization.created` event with svix + POST to `/api/webhooks/clerk`. Assert:
- Response 200
- `Tenant` row exists with the mock org id
- `Wallet` row exists (real Circle call — may skip if SMOKE_MODE=dry)

Register as `smoke:clerk-webhook` in `package.json`. Commit.

### Task 30: `scripts/smoke-auth-onboarding.ts`

Manual-gated — requires running dev server + valid Clerk test keys. Uses Clerk Backend API to create a test user + organization, then polls `/api/webhooks/clerk` activity (via DB) to verify the full chain. Register as `smoke:auth-onboarding`. Commit.

---

## Final gate

```bash
bun run typecheck 2>&1 | tail -5
bun test packages/auth 2>&1 | tail -5
bun test packages/circle 2>&1 | tail -5
bun run env:validate
bun run smoke:clerk-webhook
```

Expected: zero type errors, all tests pass, env all present, smoke ✓.

Manual verification: sign up a fresh user in the preview URL, verify `/onboarding` → org create → wallet provisioned → `/app` redirect → `<UserDetails/>` shows all fields including `arcWalletAddress`.

---

## Self-review

**Spec coverage:** @sendero/auth package (Epic 2) ✓; ClerkProvider in root layout (Epic 5) ✓; proxy.ts middleware (Epic 5) ✓; multi-tenant Orgs + mapping (Epic 1, 8) ✓; custom roles + session claims (Epic 2 Tasks 6-7) ✓; Clerk webhooks with svix verify + idempotent upsert (Epic 8) ✓; provisionTenantWallet (Epic 3) ✓; sign-in / sign-up / onboarding pages (Epic 6) ✓; `<UserDetails/>` (Epic 7) ✓; env + health (Epic 9) ✓; Clerk Dashboard runbook (Epic 10 Task 28) ✓.

**Placeholder scan:** Task 10 mocked test is described but not fully inlined — flagged as needing a refactor to accept injected SDK. Task 22 debug page is thin. Both acceptable.

**Type consistency:** `CustomJwtSessionClaims` augmentation reused across middleware + onboarding page. `mapClerkRoleToPrisma` shared between webhooks + test. `ProvisionTenantWalletResult` shape consistent across production + retry cron.

**Scope:** 30 tasks — reasonable for a foundational auth-infra phase.

## Open items

- Task 10 (mocked test) may require refactor of `provisionTenantWallet` signature. Acceptable to ship without and add in phase-11d.
- `@/lib/webhook-events` path assumes alias from phase-11a Epic 5 landed. If not, replace with relative path.
- `packages/database`'s `User.displayName` + `User.email` column names may differ from what webhook handlers assume — inspect before writing, adapt.
