# Sendero Admin App — spec

> Internal admin surface for Sendero (the platform), separate from the
> tenant-facing app at `apps/app`. Single Clerk-gated superadmin to
> start; expands to a small group as the platform team grows.

## Why a separate app

Three distinct reasons to keep this out of `apps/app`:

1. **Different audience.** Tenant users ⊥ Sendero ops. Embedding admin
   inside the tenant app means every Clerk session needs the
   superadmin check; mistake → tenant sees admin surfaces.
2. **Different deploy lifecycle.** Admin must be deployable
   independently from the tenant app — emergency contract upgrade
   shouldn't wait on a tenant-app build.
3. **Different secret blast radius.** The treasury multisig signing
   keys + contract upgrade authority *only* live in this app's Vercel
   project. Compromising `apps/app` doesn't reach treasury.

## Auth model — two-layer identity

Sendero is a **superorg** that operates multiple vertical AI agent
companies. Two scopes of identity, never one:

| Scope | Surface | Source of truth |
|---|---|---|
| **Platform** (Sendero-internal staff) | `apps/admin` cross-org views | `user.publicMetadata.platformRole` |
| **Org** (per-vertical tenant users) | `apps/app` tenant surfaces + per-org pages inside admin | Clerk Organization roles + custom permissions |

A `platformRole` holder bypasses per-vertical Clerk org membership —
their org IS the platform. A salesperson sees pipeline across every
vertical without joining each one's Clerk org as a member.

### Platform roles (≤ 6, by design)

| Role | Access |
|---|---|
| `superadmin` | Everything. Treasury, contract upgrades, tenant impersonation. |
| `sales` | Pipeline, all-orgs read, tenants read. |
| `eng` | Agents, infra, logs, health. |
| `support` | Tenants read+act, impersonate (read-only Phase 7.7). |
| `finance` | Billing, invoices, payouts, MRR dashboards. |

More than 6 = you're really designing custom permissions, not roles.
Push those to org-level Clerk custom permissions instead.

### Source of truth + fast path

- **Canonical key: `publicMetadata.platformRoles` (array).** A user can
  hold multiple roles simultaneously (`["superadmin", "eng"]`,
  `["finance", "sales"]`). Real life: you'll be `superadmin + eng`,
  the CFO is `finance + sales`.
- Legacy keys honored for migration: `platformRole` (single string,
  Phase 7.2-intermediate) → `role` (Phase 7.0). The intent of *any*
  shape with `superadmin` in it is preserved.
- Email is **defense-in-depth only** — never load-bearing.
- **Fast path:** Clerk Sessions → Customize session token configured with
  ```json
  {
    "metadata": "{{user.public_metadata}}",
    "email":    "{{user.primary_email_address}}"
  }
  ```
  Roles ride every authenticated request via
  `auth().sessionClaims.metadata.platformRoles` — zero extra Clerk REST
  round-trips.
- **Single source for route → roles:** `apps/admin/lib/access.ts::PLATFORM_ROUTES`.
  Adding a new admin surface = add a route entry there. Never scatter
  role checks across pages.
- **`superadmin` godmode short-circuit:** if `superadmin` ∈ user's
  roles, every check passes. Listed explicitly in `PLATFORM_ROUTES`
  for readability — but `requirePlatformRole(['eng'])` also passes
  for a superadmin without listing it.

### Defense in depth (CVE-2025-29927)

Middleware alone is **not sufficient**. CVE-2025-29927 (CVSS 9.1,
fixed in Next 12.3.5 / 13.5.9 / 14.2.25 / 15.2.3+) demonstrated a
single HTTP header could bypass middleware authorization. Every page
in `/dashboard/*` re-checks via `requirePlatformRole([...])` from
`lib/access` BEFORE reading sensitive data. Middleware just enforces
"signed in + has any platformRole".

### Bootstrap (one-time, per Sendero teammate)

Dashboard path:
  1. Add the user to Clerk.
  2. Clerk dashboard → Users → <them> → Public metadata:
     ```json
     { "platformRoles": ["superadmin", "eng"] }
     ```
  3. They sign out + back in so the new claims ride the JWT.

Programmatic (handy for a future bootstrap script):
  ```ts
  import { clerkClient } from '@clerk/nextjs/server';
  await (await clerkClient()).users.updateUserMetadata(userId, {
    publicMetadata: { platformRoles: ['superadmin', 'eng'] },
  });
  ```

**Migration from Phase 7.0.** The original bootstrap used
`{ "role": "superadmin" }`. `lib/access.ts::parseRoles` honors that
key as a fallback so existing setup keeps working — no urgent action.
When convenient, rename the Clerk publicMetadata key to
`platformRoles` (array) so adding more roles to the same user is
trivial.

**JWT staleness.** Roles are baked into the JWT at sign-in. After
changing `publicMetadata`, sign out + back in to refresh. The
`/unauthorized` page already documents this.

**Don't put org-scoped roles here.** `platformRoles` is *only*
Sendero-internal cross-org godmode. Per-vertical roles still go
through Clerk Organizations + `auth().has({ permission })`.

**Cap the platform-role enum at ~6.** If you find yourself wanting
`eng_lead`, `eng_oncall`, `eng_intern` — that's a permissions
taxonomy, not a roles taxonomy. Push to Clerk custom permissions or
a separate `publicMetadata.platformPermissions: string[]` field
instead.

The metadata-not-whitelist convention means rotating in/out a
platform role is a Clerk dashboard action, not a code deploy. Audit
trail lives in Clerk's own logs.

## Surfaces

Phased rollout. This spec captures the full target; Phase 7.0 ships
auth + treasury page stub only.

| # | Surface | Purpose |
|---|---|---|
| 1 | `/dashboard/treasury` | **Landing.** Two cards: Solana (Squads V4 multisig) + Arc (Circle Modular Wallets MSCA). Each shows provisioning state, balance, signers, threshold. Provision/sign/execute actions in-app. |
| 2 | `/dashboard/contracts` | Anchor program upgrade orchestration (set-upgrade-authority, deploy new versions through multisig). Solidity proxy upgrades on Arc same shape. |
| 3 | `/dashboard/payouts` | Duffel balance management — top up, drain, reconcile against `Booking.settlements`. |
| 4 | `/dashboard/tenants` | Tenant lookup + impersonation (read-only) + plan tier overrides. |
| 5 | `/dashboard/agents` | Sendero canonical agent NFT (Arc, agentId 2286) + Solana mirror state. ERC-8004 reputation diagnostics. |
| 6 | `/dashboard/health` | Cross-service health: Vercel deploys, Cloudflare worker, Kapso phone health, MoonPay webhook freshness, Phoenix indexer, Langfuse evaluator state. |

## Multisig topology

- **Solana** — Squads V4 multisig at a `vault PDA`. Threshold 2-of-3
  to start (founders + alt). Holds:
  - All future Anchor program upgrade authority (`agentic_commerce`,
    `sendero_guest_escrow`, plus Phase 4 `sendero_attestation`).
  - Sendero canonical Solana treasury USDC (when minted).
  - Sendero agent NFT custody on Solana (Phase 5 mirror).
- **Arc** — Circle Modular Wallets MSCA with module-based threshold.
  Holds:
  - UUPS proxy admin role for `SenderoGuestEscrow` (existing) +
    Sendero-deployed `AgenticCommerce` (when self-deployed) +
    `SenderoStamps` (existing).
  - Arc treasury USDC (currently single-key
    `TREASURY_VIEM_ADDRESS` — migrate via on-chain transferOwnership).
  - Sendero canonical agent NFT (Arc ERC-8004, agentId 2286)
    custody.

Both treasuries serve the *same logical role*: receive platform fees,
fund payouts, authorize upgrades. Choice of multisig per chain is
driven by what's idiomatic on that chain — Squads on Solana, Modular
Wallets on EVM. Sendero never tries to bridge a multisig.

## Phased rollout

### Phase 7.0 — Foundation ✅

- `apps/admin/` Next.js app in monorepo (Clerk + Tailwind v4, no shadcn yet).
- `proxy.ts` with `clerkMiddleware` matching repo convention.
- `/sign-in/[[...sign-in]]`, `/unauthorized`, root redirect.
- `/dashboard/treasury` placeholder — two empty cards.
- Originally shipped a single-role `lib/superadmin.ts`; superseded by
  Phase 7.2's `lib/access.ts`.

### Phase 7.2 — RBAC + platform roles

- `apps/admin/types/globals.d.ts` augments `CustomJwtSessionClaims`
  with `metadata.platformRole` + `email`.
- `apps/admin/lib/access.ts` — `PLATFORM_ROUTES` matrix
  (route → `PlatformRole[]`), `getPlatformRole()`,
  `canAccessPlatformRoute(pathname)`,
  `requirePlatformRole(allowed[])`. Single source of truth; never
  scatter role checks across pages.
- `proxy.ts` middleware does the broad gate (signed-in +
  has-any-platform-role for `/dashboard/*`); per-page guards do
  defense-in-depth (CVE-2025-29927).
- Sidebar nav items filtered by role using `PLATFORM_ROUTES`.
- Root `/` redirects to role-specific home (superadmin →
  `/dashboard/treasury`, finance → `/dashboard/billing`, sales →
  `/dashboard/pipeline`, support → `/dashboard/tenants`, eng →
  `/dashboard/agents`).

### Phase 7.3 — UI port from template

`/Users/criptopoeta/Downloads/next-shadcn-dashboard-starter-main/`
provides the shell (sidebar, header, kbar, themes). Port:
- `src/components/layout/*` — `<AppSidebar />`, `<Header />`,
  breadcrumbs, kbar.
- `src/components/ui/*` — shadcn primitives.
- Strip example dashboard pages (kanban, forms, products).

### Phase 7.4 — Solana multisig (Squads V4)

Skill: `/squads-protocol`. Provision a Squads vault, surface in
`/dashboard/treasury`. Three actions: Provision, Sign, Execute.
Page-level guard: `requirePlatformRole(['superadmin'])`.

### Phase 7.5 — Arc multisig (Circle Modular Wallets)

Skill: `/use-modular-wallets`. Same surface, EVM/Arc side.

### Phase 7.6 — Contract upgrade orchestration

`solana program set-upgrade-authority <program> <squads-vault-pda>`
runs through the admin app, not the deployer's local CLI. Same
surface for Solidity UUPS proxy admin role rotations.

### Phase 7.7 — Tenant + billing + payouts surfaces

Lift after multisigs are wired. `/dashboard/pipeline` (sales),
`/dashboard/tenants` (sales+support), `/dashboard/billing` +
`/dashboard/payouts` (finance), `/dashboard/agents` +
`/dashboard/health` (eng) all become real screens.

## Non-goals (explicit)

- **Not a tenant impersonation panel.** Phase 4 has read-only tenant
  lookup; never write-as-tenant. Use Slack-Sendero-internal handoff
  for that.
- **Not a billing dashboard for tenants.** Tenants see their own
  billing inside `apps/app/dashboard/billing`. Admin dashboard
  surfaces aggregate revenue + per-tenant tier overrides only.
- **Not a Kapso editor.** Kapso has its own UI; admin app links out.

## File layout

```
apps/admin/
├── app/
│   ├── dashboard/
│   │   ├── layout.tsx                   # superadmin guard + shell
│   │   └── treasury/
│   │       └── page.tsx                 # landing
│   ├── sign-in/
│   │   └── [[...sign-in]]/page.tsx
│   ├── unauthorized/page.tsx
│   ├── globals.css
│   ├── layout.tsx                       # ClerkProvider root
│   └── page.tsx                         # root → /dashboard/treasury
├── lib/
│   └── superadmin.ts                    # `requireSuperadmin()`
├── proxy.ts                             # clerkMiddleware
├── next.config.mjs
├── tsconfig.json
├── tailwind.config.ts
├── postcss.config.mjs
├── package.json
└── env.example
```

## Vercel project layout

Separate Vercel project (`sendero-admin-web`), not a route under
`sendero-arc-web`. Same monorepo, separate `vercel.json`. Deploy hook
fires on push to `main` only when `apps/admin/**` changed (turbo-ignore).
