# Tech Debt Notes — 2026-05-02

Items observed while shipping the `/me` traveler portal + Gateway-deposit traveler wallets. Open atomically, none are ship-blockers.

### A. `/me` routes lack the dashboard's display-grade header pattern
`/dashboard/reputation/page.tsx` uses a tight, branded header pattern that none of the `/me/*` routes adopt yet:
```tsx
<header className="flex flex-col gap-1">
  <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Sendero × Arc</p>
  <h1 className="font-display text-3xl">Your reputation</h1>
  <p className="text-sm text-muted-foreground">…subhead with one sentence on what this surface shows.</p>
</header>
<section className="grid grid-cols-2 gap-4 sm:grid-cols-4">
  <Stat label="Stars" value={…} />
  …
</section>
```
The Stat-grid + dashed empty-state cards (`rounded-2xl border border-dashed`) read as a deliberate visual system. `/me`, `/me/wallet`, `/me/stamps`, `/me/passport` should reuse the exact same shell:
- "Sendero · me" eyebrow → "Sendero × Arc" rhythm match
- `font-display text-3xl` for the H1
- One-sentence subhead under each H1
- Stat grid at top of `/me/wallet` (chains × balance summary) and `/me/stamps` (collection size, latest mint)
- Dashed empty-state cards instead of plain `<p>` for "no trips / no stamps / passport not uploaded"

Atomic commit: extract `<TravelerSurfaceHeader>` + `<Stat>` into `apps/app/components/traveler/` and replace the four pages.

### B. Circle SCA wallets index only one chain per wallet set
`circle_wallets` rows store `(tenantId, kind, chain)` but a Circle wallet set produces the **same address on every supported chain** (each as its own SCA contract). When operator onboarding registers the treasury for `MATIC-AMOY`, the matching Arc/Avax/Arb/etc. SCAs are silently created in Circle but never persisted in our DB. Any USDC sent to the address on those "ghost" chains becomes unfindable from Sendero queries — only discoverable by enumerating the wallet set via `listWallets`.

Concrete loss: $500 USDC testnet stranded for ~10 days at `0xfa5c635c1db7472a604d042355a184ef11af3204` on Arc Testnet (recovered via wallet-set enumeration on 2026-05-02, drain hash `0x6491af34…b7515e`).

Fix: in the tenant-wallet provisioning path, after the Circle wallet set is created, walk every `wallets[]` entry from `listWallets({ walletSetId })` and persist one `circle_wallets` row per `(address, blockchain)` pair. Backfill cron: `scripts/backfill-circle-wallet-chains.ts` running once per existing tenant.

Acceptance: querying `circle_wallets` for any tenant returns one row per (kind, chain) where Circle has a wallet, not just the chain we manually registered.

### D. UserGatewaySigner ciphertext rebound across merges silently auth-failed (FIXED 2026-05-03)
The phone-anchored and token-bound traveler merges (`apps/app/lib/traveler-merge.ts`, `apps/app/app/api/whatsapp/link-clerk/route.ts`) used to rewrite `UserGatewaySigner.userId` from the placeholder id to the Clerk user id without re-encrypting the private key. The encrypt path uses `(purpose, contextId, kekVersion)` to derive the AES-GCM DEK with `contextId = userId`, so post-merge `decryptSigner({ contextId: clerkUserId })` derived a different DEK than the one used at encrypt time. AES-GCM `final()` then threw on the auth-tag check, surfacing as `decrypt: authentication failed (tampered ciphertext or wrong context)` and rendering `/me/wallet` unloadable.

**Symptom:** every traveler who completed phone-OTP sign-in (token-less or expired-token path) saw the runtime error on first `/me/wallet` load. Their Gateway depositor address was unrecoverable from the existing row — only fix was deleting the row and letting `ensureTravelerWallet` mint fresh on next inbound (which loses any USDC at the prior address — zero impact in practice today, real cost later).

**Fix:** both merge paths now decrypt the placeholder's ciphertext under `contextId = placeholderUserId`, re-encrypt under `contextId = clerkUserId`, and write `userId + encryptedPrivateKey + kekVersion` together inside the same `prisma.$transaction([...])`. A crash mid-merge can't leave the row in the broken state because the row write is atomic. `invalidateUserGatewaySignerCache` is called for both ids post-transaction so the in-memory cache doesn't serve stale decrypts.

**Lesson:** anywhere we move encrypted-at-rest data across `contextId` boundaries (User merges, tenant merges, KEK rotation), the merge MUST decrypt + re-encrypt before rewriting the foreign key. Add a lint rule (or at least a code-review checklist) for any future call to `*.updateMany({ data: { userId: ... }})` against tables that contain `encryptedPrivateKey` columns.

### C. User DCWs can't drain when balance ≤ Circle Gas Station fee floor
`createTransaction` returns `155258 / insufficient_value` when the user DCW's USDC balance equals the requested amount because the gas-station fee is taken in USDC and exceeds the leftover. Surfaced during the rescue drain at $0.095684 — Circle wanted "> 0.095684176" native tokens.

Fix: in `wallets.transferUSDC`, compute `amount = balance - feeEstimate` instead of passing the raw balance. Or call `estimateContractExecution` before the `createTransaction` and subtract.

---

# Tech Debt Audit — 2026-04-23

Branch: `feat/phase-11-invoicing`
Scope: what the last month of shipping left behind, ranked by pain.

Purpose: a single honest punchlist. Ship-blockers at the top, paint-polish at the bottom. Each item is one atomic commit.

## P0 — shipping blockers

### 1. Two pending Prisma migrations not yet deployed
- `20260423_phase_11d_duffel_identity` — adds `User.duffelCustomerUserId`, `User.metadata`, `Tenant.duffelCustomerUserGroupId`.
- `20260423_phase_11e_airline_credits` — adds `airline_credits` cache table.

If either is shipped without the migration, `ensure_duffel_customer` + `list_airline_credits` crash at first call. Run `bun prisma migrate deploy` from `packages/database/` before anything else lands.

### 2. Duffel webhook endpoint never registered
`scripts/register-duffel-webhook.ts` exists but has not been pointed at production. Until it runs, `cancellation_recovery` never fires, `service.refunded` never populates the airline-credit cache, and lifecycle is one-way (we write, Duffel never talks back).

Single command:
```
DUFFEL_API_TOKEN=... bun run scripts/register-duffel-webhook.ts \
  --url https://www.sendero.travel/api/webhooks/duffel
```

### 3. No live smoke against Duffel wire types
`scripts/smoke-duffel-advanced.ts` exists. Never run. Until a human runs it against a test token, every hand-authored wire type in `packages/duffel/src/types.ts` is theoretical. Low effort, high signal.

### 4. `/app/console` marketing-page fallback is closed but the edge path isn't
`ClerkSenderoApp` wraps `SenderoApp` with `gate='bypass'` and that works for Clerk-authed operators. BUT: the route still hard-depends on `NEXT_PUBLIC_SENDERO_EDGE_URL`; when the edge worker is down the console/ops surfaces emit `ERR_CONNECTION_REFUSED` in DevTools. The prior QA flagged it; still unfixed.

Fix: `use-meter.ts:39` — gate the default on `NODE_ENV === 'development'`; production must set the env var explicitly. Add a degraded-state banner.

## P1 — quality / correctness

### 5. `searchFlights` offers mapping still uses `any`
`packages/duffel/src/index.ts:183` — `offers.map((o: any): FlightOfferSummary => ...)`. The wire types cover offer requests but not offers yet. Replace with `DuffelOfferMinimalWire`. 20 min.

### 6. `bookFlight`'s Duffel Balance currency assumption
`payFromBalance()` uses the order's `total_currency`. If the balance is GBP and the order is USD, we fail at payment time with a cryptic error. Add an `fxDrift` check before calling pay — matches the spec's fx-drift edge case.

### 7. `createHoldOrder` hardcodes `title: 'mr'` + `gender: 'm'`
The existing handler in `book-flight.ts` defaults every passenger to male. For corporate policy compliance + cross-border fare rules this matters (some airlines reject orders where gender doesn't match ID). Plumb through from the traveler's `User.metadata.salutation` when present.

### 8. Channel adapter render discipline
WA + Slack rendering is spread across three places: `apps/app/app/api/webhooks/whatsapp/route.ts`, `slack/events/route.ts`, and inline inside tool handlers. Centralize into `packages/whatsapp/src/render-share.ts` + `packages/slack/src/render-share.ts` per the spec. Anything sharing a `share` shape should render through one function per channel.

### 9. Inbox layout — nested SidebarProvider patched via inline styles
`apps/app/components/inbox/trip-list-column.tsx` + `trip-thread-workspace.tsx` use inline `style={{ width: '20rem' }}` because Tailwind's `md:flex` wasn't in the compiled CSS mid-session. That was a dev-server cache issue that resolves on restart — but the inline workaround is still in the code. Remove once the Tailwind content scan is sane; verified at 1440px + 375px.

### 10. Trip-thread `/api/inbox/[tripId]/reply` persists to `Trip.events` JSON
MVP move. The proper model is a `TripMessage` table so inbox queries don't have to parse a growing JSON blob. Spec calls this out. Until the model lands, JSON is load-bearing — keep it capped and document the eventual migration path.

### 11. Clerk test users — `QA Individual B` + `C` still blocked at choose-organization
Not a code fix — data fix. Either attach a `sendero-individuals` org, or update middleware to let org-less users through. Blocking QA of individual personas.

### 12. Workflow runner — resume token format not specified
Every spec pause says "carries `resumeToken`" but the runner doesn't yet emit one. Need: a signed token `hmac(runId + stepId + secret)` that maps 1:1 to `(tenantId, runId, stepId)`. Add to `@sendero/workflows/src/runner.ts` + expose via `/api/workflows/runs/[token]/resume`.

### 13. Duffel webhook dispatcher — no dedicated `order.airline_initiated_change_detected` handler
Widened webhook schema accepts it (maps to `schedule_changed` status) but the dispatcher doesn't route it anywhere useful. For a ticketed order with a schedule change, we should auto-kick a `sendero.cancellation_recovery` run with `kind: 'schedule_changed'` so the traveler sees the new times and decides. Currently: silent.

## P2 — polish / readability

### 14. `chat-col.tsx` is 752 lines
It's been taking on every tool renderer over three commits. `ToolPreview`, `MessageView`, event-log side effects, and `ChatCol` itself all live in one file. Split into `apps/app/components/chat/{tool-preview,message-view,event-logger,index}.tsx`. Zero behavior change — readability + reviewability.

### 15. AI Elements `Canvas` usage — only in `workflow-graph.tsx`
The product has 4+ places that would benefit from a graph view (booking workflow, delay recovery branches, approval flow, handoff timeline). Workflow-graph is the only one using it today. Low-priority, but the Canvas primitive is already paid-for; we should reuse it.

### 16. Pricing catalog → 49 entries, no per-tier grouping
`packages/tools/src/pricing.ts` is a flat dict. At 49 tools, it's becoming hard to scan "what's the concierge tier look like?" vs "what's the composed tier?". Refactor into `TIERS` const + derived dict with pricing (no behavior change; tests already cover coverage).

### 17. `@duffel/api` cast escape hatches
Even after the types pass, `as unknown as Parameters<typeof duffel.orders.create>[0]` appears 3 times in the wrapper because the SDK type lags. Consider a single type-bridge module `packages/duffel/src/sdk-bridge.ts` where these casts live — keeps the happy path clean.

### 18. Unused imports / variables leftover from refactors
`chat-col.tsx` imports from `./ui` that no longer applies. `trip-tool-cards.tsx` has an unused `ReactElement` import. Fixable by `bunx biome lint --apply` but needs a sanity check on the diff.

### 19. Emoji policy in email templates
`invoice-email.ts` uses emoji in one subject line — brand policy says no. Audit all outgoing email subjects.

### 20. `docs/tools/overview.mdx` rows out of alphabetical/price order
Tools added in the last 3 sessions are appended, not inserted in order. Re-sort by category → price ascending. Readability only.

### 21. `.gstack/qa-reports/` has 3 historical reports
Historical reports in the repo make the current one harder to find. Move to `.gstack/qa-reports/archive/` or compress into a single `history.md`.

### 22. `TODO_TOOLS.md` + `TODO.md` drift
Two TODO files at repo root, partially overlapping. Merge into one `TODO.md` with the canonical trip-assistance backlog + tech-debt pointer.

## P3 — strategic

### 23. Single-tenant WhatsApp phone-number → tenant mapping
`env.whatsappDefaultTenantId()` is the only mapping today. Multi-tenant WhatsApp onboarding needs a `WhatsAppInstall` table mirroring `SlackInstall`. Phase 12 candidate — not blocking the phase 11 ship.

### 24. No cross-model prompt benchmark for the agent
`/api/chat` auto-fallbacks Gemini → OpenAI → Anthropic. Token cost + latency per tier is never benchmarked. The `/benchmark-models` skill exists — run it once against a representative booking prompt, write the results to `.gstack/benchmarks/`.

### 25. Duffel Travel Support Assistant isn't actually wired into `/api/chat`
`ensure_duffel_customer` populates `user_id` on orders, which unlocks TSA on the Duffel side — but the web chat transport doesn't surface Duffel's TSA responses. For now, the chat is Sendero's agent invoking Duffel tools; Duffel's own TSA chat is only reachable via the Duffel dashboard. This is the ceiling on "support in chat" until Duffel exposes a TSA-as-a-service endpoint.

### 26. On-chain receipts still show raw tx hashes in some surfaces
Spec: "show the proof, don't make the traveler parse it." Reality: `/app/trips/[id]` surfaces the tx hash directly. Wrap every tx hash display in a `<TxProofChip>` component that shows a short hash + "Verified on Arc" badge linking out. Invoice email already does this well; port the pattern.

### 27. `/app/inbox/[tripId]` uses `useChat` context but doesn't persist operator messages
Human replies via `/api/inbox/[tripId]/reply` land in `Trip.events`. Agent replies via `/api/chat` stream to the browser and evaporate. The agent-mode turns aren't persisted — operator refresh loses the conversation. Needs a server-side message store hooked to `useChat.onFinish`.

## By area (quick grep)

| Area | P0 count | P1 count | P2 count | P3 count | Total |
|---|---|---|---|---|---|
| Ops / deploy | 2 | 1 | 0 | 0 | 3 |
| Duffel | 1 | 4 | 1 | 0 | 6 |
| Workflows | 0 | 1 | 0 | 0 | 1 |
| Types | 0 | 1 | 1 | 0 | 2 |
| UI | 0 | 1 | 3 | 1 | 5 |
| Inbox | 0 | 2 | 0 | 1 | 3 |
| Docs | 0 | 0 | 3 | 0 | 3 |
| Data / multi-tenant | 0 | 1 | 0 | 1 | 2 |

## Recommended order

1. Ship the two pending migrations (P0 #1).
2. Register the Duffel webhook (P0 #2).
3. Run the smoke script (P0 #3).
4. Fix the meter fallback (P0 #4).
5. Tighten `searchFlights` typing (P1 #5).
6. Centralize channel adapters (P1 #8).
7. Ship the resume-token format (P1 #12) — unblocks every cross-channel UX.
8. Everything else is parallelizable.

Each numbered item above = one commit. None require a design review. All under 100 lines of change except #14 (chat-col.tsx split).
