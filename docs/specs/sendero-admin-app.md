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

## Auth model

**Single source of truth: Clerk `user.publicMetadata.role`.**

- Superadmin = `publicMetadata.role === 'superadmin'`.
- Email is **defense-in-depth only** — never load-bearing.
- **Fast path: session-token claim.** Clerk Sessions → Customize
  session token is configured with:
  ```json
  { "metadata": "{{user.public_metadata}}" }
  ```
  so the role lands on every authenticated request as
  `auth().sessionClaims.metadata.role` — zero extra Clerk REST
  round-trips. The gate (`lib/superadmin.ts::requireSuperadmin`) reads
  there first; falls back to `currentUser()` only when claims are
  absent (older session JWTs).
- Bootstrap (one-time, already done for tomas.cordero.esp@gmail.com):
  1. Superadmin signs in at `/sign-in`.
  2. Clerk dashboard → Users → <them> → Public metadata:
     ```json
     { "role": "superadmin" }
     ```
  3. Re-sign-in once so the new claims ride the JWT.
- Adding more superadmins later: same flow; no code change.

The metadata-not-whitelist convention means rotating in/out a
superadmin is a Clerk dashboard action, not a code deploy. Audit trail
lives in Clerk's own logs.

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

### Phase 7.0 — Foundation (THIS COMMIT)

- `apps/admin/` Next.js app in monorepo (Clerk + Tailwind v4, no shadcn yet).
- `proxy.ts` with `clerkMiddleware` matching repo convention.
- `lib/superadmin.ts` server gate (`requireSuperadmin`,
  `assertSuperadminOrRedirect`) — Clerk publicMetadata role check.
- `/sign-in/[[...sign-in]]`, `/unauthorized`, root redirect to
  `/dashboard/treasury`.
- `/dashboard/treasury` placeholder — two empty cards labeling the
  two multisigs. Phase 7.1 wires UI, Phase 7.2-3 wires the actual
  multisig SDKs.

### Phase 7.1 — UI port from template

`/Users/criptopoeta/Downloads/next-shadcn-dashboard-starter-main/`
provides the shell (sidebar, header, kbar, themes). Port:
- `src/components/layout/*` — `<AppSidebar />`, `<Header />`,
  breadcrumbs, kbar.
- `src/components/ui/*` — shadcn primitives we need.
- Strip example dashboard pages (kanban, forms, products) — those are
  template noise.

### Phase 7.2 — Solana multisig (Squads V4)

Skill: `/squads-protocol`. Provision a Squads multisig vault, surface
in `/dashboard/treasury`. Three actions: `Provision multisig` (initial
vault create), `Sign proposal` (when vault has pending tx), `Execute
proposal` (after threshold).

### Phase 7.3 — Arc multisig (Circle Modular Wallets)

Skill: `/use-modular-wallets`. Same surface, EVM/Arc side. Use Circle
Modular Wallets MSCA with the safe-multisig module.

### Phase 7.4 — Contract upgrade orchestration

Hook into Phase 1 + Phase 2 Anchor program lifecycle. After each
deploy, `solana program set-upgrade-authority <program> <squads-vault-pda>`
runs through the admin app rather than the deployer's local CLI.

### Phase 7.5 — Duffel payouts + tenant ops

Lower-priority surfaces. Lift after multisigs are wired.

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
