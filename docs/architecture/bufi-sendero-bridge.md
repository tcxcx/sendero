# BUFI ↔ Sendero bridge — architecture & meta-strategy

**Status:** planning
**Owner:** tomas@sendero.travel
**Date:** 2026-05-04

---

## 0. Meta-strategy (the why)

**BUFI = horizontal financial ERP.** Borderless wallets, invoicing, accounting, tax, cards, on/off-ramps, transfers. Sells to global teams and to *other* SaaS that need a financial backbone.

**Sendero = first vertical AI agent on top of BUFI.** Travel ops via WhatsApp + Slack + web. Travel-specific tools (search/book/hold/settle), tenant model = travel agencies + corporate travel offices, traveler model = end customer reached through the tenant.

**The recipe:**
1. BUFI ships the financial primitives (wallet, invoice, card, transfer, tax) once, well, as a horizontal ERP.
2. Each vertical AI agent (Sendero for travel, future verticals for real-estate / healthcare / legal / freelance ops / etc.) reuses the same ERP via the OAuth bridge documented below.
3. Distribution stays uniform across verticals: WhatsApp + Slack + MCP + web. The *vertical* changes; the *channel* + *financial substrate* doesn't.
4. GTM doubles up: each vertical sells itself on its domain wedge, AND every vertical sale pulls BUFI through as the ERP underneath.

**Why this works:**
- Vertical AI is the wedge a16z + YC are funding right now (RFS: AI-Native Service Companies, AI OS for Companies).
- ERP is the moat. Agents are interchangeable; ERP state isn't.
- WhatsApp + Slack distribution sidesteps the "yet another dashboard" problem. The agent IS the UI.
- One auth bridge built once unlocks all future verticals.

**Anti-patterns to avoid:**
- ❌ Sendero forking into fintech (cards, ramps, FX) — that's BUFI territory, brand drift, regulatory cost.
- ❌ BUFI shipping vertical features (a "travel module") — kills the horizontal-ERP positioning.
- ❌ Frankenstein co-branding (`Sendero × BUFI Cards`). Use "Sendero, powered by BUFI" or no badge at all.
- ❌ Building per-partner OAuth shims. The bridge is generic from day one.

---

## 1. Identity model

### 1.1 Two products, two identity systems
- **Sendero** — Clerk (orgs = tenant agencies, users = agency staff + travelers in some flows).
- **BUFI** — Supabase Auth (teams = workspace, users = team members).

### 1.2 Mapping table (Sendero side)

```prisma
model TenantPartnerLink {
  id              String   @id @default(cuid())
  tenantId        String
  tenant          Tenant   @relation(fields: [tenantId], references: [id])
  partner         String   // 'bufi' | 'reap' | 'faye' | future verticals
  partnerWorkspaceId String  // BUFI teamId
  partnerWorkspaceName String?
  oauthAccessTokenEnc  String  // encrypted-at-rest
  oauthRefreshTokenEnc String  // encrypted-at-rest
  oauthExpiresAt    DateTime
  scopes            String[] // granted scopes snapshot
  installedByUserId String   // who linked (Sendero user)
  status            PartnerLinkStatus @default(active) // active | revoked | expired
  metadata          Json?
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
  revokedAt         DateTime?

  @@unique([tenantId, partner])
  @@index([partnerWorkspaceId])
}

enum PartnerLinkStatus { active revoked expired }
```

### 1.3 Mapping table (BUFI side)

```sql
create table team_partner_link (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id),
  partner text not null,                     -- 'sendero' | future verticals
  partner_org_id text not null,              -- Sendero clerkOrgId
  partner_org_name text,
  oauth_access_token_enc text not null,
  oauth_refresh_token_enc text not null,
  oauth_expires_at timestamptz not null,
  scopes text[] not null,
  installed_by_user_id uuid not null references users(id),
  status text not null default 'active',
  metadata jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique (team_id, partner)
);

create index team_partner_link_partner_org_id_idx on team_partner_link (partner_org_id);
```

### 1.4 Person/Org canonical IDs

Cross-product references always carry the canonical ID + the partner namespace. Never assume a UUID is local.

```
{ partner: 'bufi', kind: 'team', id: '01HXY…' }
{ partner: 'sendero', kind: 'tenant', id: 'org_2abc…' }
{ partner: 'sendero', kind: 'trip', id: 'trp_7xyz…' }
```

---

## 2. OAuth 2.1 bridge spec

### 2.1 Reusable abstractions

Two packages, mirror images:

- **`@sendero/oauth-bridge`** — implements `PartnerOAuthClient` (consume tokens from BUFI) AND `PartnerOAuthProvider` (issue tokens TO BUFI/others).
- **`@bu/oauth-bridge`** — same shape, opposite direction.

```ts
export interface PartnerOAuthProvider {
  readonly partnerSlug: string;
  authorizeUrl(args: AuthorizeArgs): string;
  exchangeCode(args: ExchangeArgs): Promise<TokenSet>;
  refresh(args: RefreshArgs): Promise<TokenSet>;
  revoke(token: string): Promise<void>;
  introspect(token: string): Promise<Introspection>;
  jwks(): Promise<JwksResponse>;
}

export interface PartnerOAuthClient {
  readonly partnerSlug: string;
  beginInstall(args: { tenantId: string; userId: string; redirectUri: string; scopes: Scope[] }): Promise<{ url: string; state: string }>;
  completeInstall(args: { code: string; state: string }): Promise<TenantPartnerLink>;
  getAccessToken(args: { tenantId: string }): Promise<string>; // auto-refreshes
  revoke(args: { tenantId: string }): Promise<void>;
}
```

### 2.2 Token shape (JWT, RS256)

```jsonc
{
  "iss": "https://auth.bufi.io",            // or sendero.travel
  "sub": "team_01HXY…",                     // BUFI teamId
  "aud": "sendero",                          // partner slug receiving the token
  "client_id": "sendero",                    // OAuth client = the OTHER product
  "scope": "wallet:read transfer:write card:issue invoice:create",
  "actor": {
    "type": "user",
    "id": "usr_01HZ…",                      // who initiated install
    "email": "ops@acme-travel.com"
  },
  "tenant_link": {
    "partner": "sendero",
    "partner_org_id": "org_2abc…"          // Sendero tenantId / clerkOrgId
  },
  "iat": 1714800000,
  "exp": 1714803600,                         // 1h access tokens
  "jti": "tok_…"
}
```

- **Access token:** 1h, JWT, signed RS256, JWKS at `/.well-known/jwks.json`.
- **Refresh token:** 90d, opaque random 256-bit, stored hashed (sha256), single-use rotation.
- **Token endpoint:** PKCE required (no client secret in confidential clients yet — we treat both products as confidential because each runs its own backend, but PKCE adds defence-in-depth).

### 2.3 Scopes catalog

Vertical-agnostic scopes, named after capabilities not endpoints:

| Scope | Grants |
|---|---|
| `wallet:read` | List balances, transactions |
| `wallet:write` | Create wallets (e.g. per-trip sub-wallet) |
| `transfer:read` | Read transfers |
| `transfer:write` | Initiate fiat / crypto transfers |
| `card:read` | List cards, balances, transactions |
| `card:issue` | Issue new card (requires HITL approval flow) |
| `card:freeze` | Freeze/unfreeze |
| `invoice:read` | List + read invoices |
| `invoice:create` | Draft + send invoices |
| `bill:pay` | Pay bills (requires HITL on >$X) |
| `accounting:read` | Read GL entries, reports |
| `accounting:write` | Post journal entries |
| `tax:read` | Read tax events |
| `customer:read` / `customer:write` | CRM-side |
| `contractor:read` / `contractor:write` | Contractor mgmt |
| `webhook:subscribe` | Register webhook URLs |

Reverse direction (BUFI consuming Sendero scopes for travel-as-widget):

| Scope | Grants |
|---|---|
| `trip:read` | List + read trips, bookings |
| `trip:create` | Create trip on behalf of traveler |
| `booking:search` | Search flights/stays/eSIM |
| `booking:create` | Issue booking (requires HITL above plan limit) |
| `traveler:read` / `traveler:write` | Manage traveler records |

### 2.4 Refresh strategy

- Access token TTL = 1h.
- Refresh token TTL = 90d, **rotated on every use** (single-use).
- `getAccessToken()` checks `oauthExpiresAt - 60s skew`; if expired, calls `refresh()`, atomically swaps both tokens in DB inside a transaction, returns new access.
- Refresh rotation failure (invalid_grant) → mark link `expired`, surface "reconnect BUFI" UI in Sendero settings, fail tools that need it with structured error `partner_link_expired`.
- Concurrency: refresh wrapped in advisory lock keyed `(tenantId, partner)` to avoid two refresh races invalidating each other.

### 2.5 Encrypted storage at rest

- Token columns are `*_enc` — encrypted via AES-256-GCM with a per-environment KEK (`PARTNER_TOKEN_KEK_BASE64`).
- KEK rotation: tokens stored as `{kekVersion}.{iv}.{ciphertext}.{authTag}`; old KEK retained as `PARTNER_TOKEN_KEK_V1_BASE64` for read-only decrypt.
- Helper: `packages/auth/src/partner-token-crypto.ts` — `encryptToken(plaintext)` / `decryptToken(ciphertext)`.
- Never log plaintext tokens. Audit log records first 8 chars + last 4 chars of access token only.

### 2.6 Audit trail (end-to-end correlation)

Every cross-product call carries `x-correlation-id`. Both products log to their own audit table; humans correlate via the shared ID.

```prisma
model PartnerAuditEvent {
  id              String   @id @default(cuid())
  tenantId        String
  partner         String
  correlationId   String   // shared across both products
  direction       String   // 'outbound' | 'inbound'
  toolName        String?  // 'bufi_topup' etc.
  scopesUsed      String[]
  actor           Json     // { kind: 'user'|'agent', id, email? }
  request         Json     // redacted body
  response        Json?    // redacted
  status          Int      // HTTP code
  durationMs      Int
  errorCode       String?
  createdAt       DateTime @default(now())

  @@index([tenantId, partner, createdAt])
  @@index([correlationId])
}
```

- Sendero agent writes its row pre-call with `direction='outbound'`, then patches with response.
- BUFI MCP writes mirror row with `direction='inbound'`.
- Same `correlationId` (request header) → end-to-end timeline in either dashboard.

### 2.7 Webhook handshake

When tenant installs a partner, both sides register webhook URLs:

- Sendero registers `POST https://sendero.travel/api/webhooks/partners/bufi` with BUFI for events: `wallet.balance_updated`, `transfer.completed`, `card.transaction`, `invoice.paid`, `link.revoked`.
- BUFI registers `POST https://api.bufi.io/webhooks/partners/sendero` for: `trip.created`, `booking.confirmed`, `booking.cancelled`, `traveler.updated`.
- Webhook auth: HMAC-SHA256 over `{timestamp}.{body}`, secret = per-link generated at install time (`partner_link.webhook_secret_enc`). Header: `x-partner-signature: t=<ts>,v1=<hex>`. Replay window: 5min.
- Failed deliveries: exponential backoff (1m, 5m, 15m, 1h, 6h, 24h), then mark link degraded.

### 2.8 Per-tenant binding (server-side enforcement)

Every BUFI-side handler MUST:
1. Resolve `UserContext` from JWT (BUFI's existing `auth.ts`).
2. Read `tenant_link.partner_org_id` from claim → cross-check against `team_partner_link.partner_org_id`.
3. Refuse if `claim.team_id !== link.team_id` — prevents stolen-token cross-tenant abuse.
4. All DB queries scoped `where team_id = link.team_id`.

Mirror enforcement on Sendero side for inbound BUFI-originated calls.

### 2.9 Rotation policy

- KEK: rotate annually OR on credential leak.
- OAuth client secret: rotate annually; both products support `kid`-based key versioning.
- Refresh tokens: rotate on every use (built-in).
- JWKS keys: rotate quarterly; signed JWTs include `kid`; consumers cache JWKS for 1h max.

### 2.10 Clerk OIDC + Supabase Auth Hooks config

**Sendero (Clerk side, acts as OAuth client when consuming BUFI):**
- No special config — Sendero backend stores tokens in `TenantPartnerLink` and presents them as Bearer to BUFI MCP.

**Sendero (Clerk side, acts as OAuth provider when BUFI consumes Sendero):**
- Enable Clerk's OAuth provider feature; register `bufi` as OAuth app.
- Custom claims: include `tenant_link.partner_org_id` = `org.id`, `actor.id` = `user.id`, `scope` from install consent.
- Issuer: `https://clerk.sendero.travel`. JWKS auto-published.

**BUFI (Supabase side, acts as OAuth provider when Sendero consumes BUFI):**
- Supabase Auth supports custom OAuth via Auth Hooks (Edge Functions on access-token-issued).
- Add `client_id`, `tenant_link`, `scope` claims via `supabase/functions/access-token/index.ts` hook.
- Existing `@bu/mcp-server/auth.ts` already reads `client_id` claim (see `authenticateOAuthToken` in `desk-v1/packages/mcp-server/src/auth.ts:37`).

---

## 3. BUFI codebase walk → first wave of MCP tools

### 3.1 What BUFI already exposes

`@bu/mcp-server` already runs as a Cloudflare Worker with OAuth 2.1 (see `desk-v1/packages/mcp-server/src/auth.ts`). Tools are codegen'd from API specs (see `tools/generated.ts`). Confirmed surface:

| Tool category | Existing endpoints (auto-generated) |
|---|---|
| Wallets | `get_wallets`, `post_wallets`, `post_wallets_user`, `get_wallets_individual_balance`, `get_wallets_team_balance` |
| Transfers | `get_transfers_status`, `post_transfers` |
| Cards | `get_cards`, `patch_cards`, `post_cards_users_cards`, `post_cards_applications`, `post_cards_users_withdrawals`, `post_cards_companies`, `post_cards_companies_users`, `get_cards_users_balances`, `get_cards_users_contracts`, `get_cards_transactions`, `get_cards_secrets`, `get_cards_users_signatures_withdrawals` |
| Invoices/Bills | `get_invoices`, `post_invoices_send`, `post_invoices_accept`, `get_invoices_pending-invites`, `get_bills`, `post_bills_pay`, `post_bills_create-from-invoice` |
| Transactions | `get_transactions`, `get_transactions_individual` |
| Customers/Contractors | `get_customers`, `get_contractors` |

Plus three hand-written tool modules: `data-moat-tools.ts`, `knowledge-tools.ts`, `memory-tools.ts`.

Backing packages worth knowing about:
- `@bu/transfer-fiat` — Bridge.xyz integration, fiat in/out (LatAm corridors via Alfred Pay, see `packages/types/src/alfred.ts`).
- `@bu/private-transfer-core` — multisig (current branch: `private-multisig`).
- `@bu/invoice` — invoice templates + Satori PDF rendering.
- `@bu/accounting`, `@bu/tax` — GL + tax events.
- `@bu/circle`, `@bu/circle-kit` — Circle wallet primitives (overlap with Sendero — opportunity to share, see §3.4).
- `@bu/wallets`, `@bu/alchemy-wallets` — multi-provider wallet abstraction.

### 3.2 First-wave MCP tools (Sendero agent calls)

Wrap the existing endpoints under a Sendero-friendly facade. Each tool maps to one BUFI API call but with Sendero context (trip ID, traveler ID) passed through and stored in BUFI metadata for cross-reference.

**Wallet / on-ramp / off-ramp**

| Sendero tool | Wraps | Purpose |
|---|---|---|
| `bufi_wallet_balance` | `get_wallets_team_balance` | Show tenant's BUFI wallet balance in agent UX |
| `bufi_topup_create` | new endpoint or `post_transfers` (Bridge fiat-on-ramp) | LatAm/EU traveler funds USDC via local rails |
| `bufi_offramp_create` | `post_transfers` (Bridge fiat-off-ramp) | Convert USDC back to local fiat |
| `bufi_transfer_status` | `get_transfers_status` | Poll transfer state |

**Cards (per-trip / per-traveler)**

| Sendero tool | Wraps | Purpose |
|---|---|---|
| `bufi_card_issue` | `post_cards_users_cards` | Issue per-trip card with policy (limit, MCC allowlist, expiry = trip end) |
| `bufi_card_freeze` | `patch_cards` (status=frozen) | Freeze on trip end / suspicion |
| `bufi_card_balance` | `get_cards_users_balances` | Show card balance in WhatsApp |
| `bufi_card_transactions` | `get_cards_transactions` | Trip expense reconciliation |
| `bufi_card_topup` | `post_cards_users_withdrawals` (inverse direction TBD) | Add funds to issued card from tenant treasury |

**Invoicing (B2B agency → corporate client)**

| Sendero tool | Wraps | Purpose |
|---|---|---|
| `bufi_invoice_create` | (new endpoint composing draft + send) | Auto-generate invoice for a trip's confirmed bookings |
| `bufi_invoice_send` | `post_invoices_send` | Send to corporate client email |
| `bufi_invoice_status` | `get_invoices` (filter by external_ref) | Track payment status |

**Accounting / tax (auto-attach)**

| Sendero tool | Wraps | Purpose |
|---|---|---|
| `bufi_accounting_entry_post` | new (BUFI accounting package) | Post booking as journal entry (revenue/COGS split for tenant) |
| `bufi_tax_event_record` | new (BUFI tax package) | Record VAT/sales tax event for confirmed booking |

**Customers (link agency clients)**

| Sendero tool | Wraps | Purpose |
|---|---|---|
| `bufi_customer_upsert` | `get_customers` + new POST | Sync Sendero traveler → BUFI customer record (for invoicing) |

### 3.3 First-wave tool sequencing (P1 → P3)

**P1 — Money primitives (week 1-2):**
- `bufi_wallet_balance`, `bufi_topup_create`, `bufi_offramp_create`, `bufi_transfer_status`.
- Replaces Sendero's MoonPay default with BUFI/AlfredPay for LatAm tenants.
- Unblocks: traveler-funded wallets in markets MoonPay can't serve well.

**P2 — Cards (week 3-4):**
- `bufi_card_issue`, `bufi_card_freeze`, `bufi_card_balance`, `bufi_card_transactions`.
- Per-trip card auto-provisioned at trip creation, frozen at trip end + 7d.
- Card policy lives in BUFI (`CardPolicy` model — limit, MCC allowlist, expiry); Sendero just calls `bufi_card_issue` with `policyId` and trip metadata.

**P3 — Invoicing + accounting (week 5-6):**
- `bufi_invoice_create`, `bufi_invoice_send`, `bufi_accounting_entry_post`, `bufi_tax_event_record`.
- Triggered automatically by `confirm_booking` hook.
- Surfaces in BUFI dashboard as "Travel" row in P&L.

### 3.4 Reverse direction (BUFI consumes Sendero MCP)

For travel-as-widget inside BUFI app. BUFI registers as OAuth client of Sendero. Tools BUFI agent calls:

| BUFI tool | Wraps | Purpose |
|---|---|---|
| `sendero_search_flights` | `/api/mcp` → `search_flights` | Inline flight search in BUFI UI |
| `sendero_search_stays` | → `search_stays` | Inline hotel search |
| `sendero_book_flight` | → `book_flight` | Initiate booking, settle from BUFI wallet |
| `sendero_trip_list` | → `list_trips` | "Travel" tab in BUFI |
| `sendero_trip_get` | → `get_trip` | Trip detail with bookings |

Reuses Sendero's tool catalogue verbatim — just exposed via OAuth-scoped MCP instead of direct API key.

### 3.5 Shared infrastructure consolidation candidates

Both products run Circle wallets. Today: parallel implementations. Worth consolidating once OAuth bridge stable:

- `@bu/circle` + `@sendero/circle` → publish one as canonical, other consumes.
- Likely path: BUFI's Circle Kit becomes the lower-level package, Sendero's becomes a thin wrapper. Reduces two teams maintaining the same Gas Station / unified-gateway / sweep code.

Defer until P3 — not blocking, and forced consolidation while OAuth bridge is unstable doubles the rewrite cost.

---

## 4. Three concrete cross-product flows

### 4.1 Sendero traveler tops up via BUFI (LatAm rails)

```
Traveler (WhatsApp)
  → Sendero agent: "I need to add $500 to my wallet"
  → Sendero `topup` tool checks tenant.country
  → If country in LATAM_BUFI_CORRIDORS:
      → Sendero calls `bufi_topup_create({ amount, currency: 'USD', destination: traveler.dcw, method: 'alfred_pix' })`
      → BUFI returns hosted checkout URL
      → Sendero sends WhatsApp message with link
      → Traveler pays via Pix; BUFI webhook → Sendero → wallet sync
  → Else: fall back to MoonPay (current default)
```

### 4.2 Agency issues per-trip card

```
Agency operator (Slack): "/sendero card for trip TRP-1234, $5000 limit, hotels+flights+meals only"
  → Sendero agent resolves trip
  → Calls `bufi_card_issue({ tripId, holderUserId, policy: { limitCents, mccAllowlist, expiry: trip.endDate + 7d } })`
  → BUFI mints virtual card via existing card pipeline
  → Returns last4 + reveal URL
  → Sendero stores card_ref in Trip.metadata.bufiCardId
  → Notifies traveler via WhatsApp with reveal link (BUFI-hosted, no PAN through Sendero)
On trip end + 7d: cron triggers `bufi_card_freeze`. Transactions auto-reconciled via webhook → posted to Sendero as Trip.expenses.
```

### 4.3 Travel-as-widget inside BUFI

```
BUFI user (web app): clicks "Book travel" tab
  → BUFI calls Sendero MCP with team's OAuth token (scope: trip:read trip:create booking:search booking:create)
  → Renders Sendero's existing UI in iframe OR consumes raw search results
  → Booking confirmed → settlement charges BUFI team's USDC wallet (no double-rail)
  → Trip + booking show under BUFI "Travel" tab AND under Sendero (same canonical IDs both sides)
```

---

## 5. Capability ownership matrix

The bridge only works if each entity has ONE authoritative product. Avoid distributed-state hell by drawing the line clearly:

| Entity | Authority | Other side has |
|---|---|---|
| Trip | Sendero | Cached reference + audit |
| Booking | Sendero | Reference (for invoice/accounting) |
| Traveler | Sendero | Reference (synced as customer) |
| Wallet (USDC operating) | BUFI | Reference + balance display |
| Card | BUFI | Reference + policy spec |
| Invoice | BUFI | Reference (link in trip detail) |
| Transfer (fiat ramp) | BUFI | Reference |
| TaxEvent / GL entry | BUFI | None (BUFI internal) |
| Tenant (agency) | Sendero | Reference (as customer) |
| Workspace (BUFI team) | BUFI | Reference (as partner_workspace) |
| Tenant agency markup | Sendero | Reference (read by invoice tool) |
| OAuth link | Both (mirrored) | — |

Webhooks keep cached references fresh. Source-of-truth side never reads the other.

---

## 6. Three shared concerns

### 6.1 OIDC identity (P0)

- Phase 1: OAuth 2.1 bridge as specced above (workspace ↔ tenant link, no individual SSO).
- Phase 2 (later): user-level OIDC so a BUFI user can sign into Sendero with their BUFI account if their team has linked. Out of scope for v1.

### 6.2 Webhooks (P0)

- Spec covered §2.7. HMAC-SHA256 + replay window + retry policy.
- Both sides expose `/webhooks/partners/<partner>`.
- Each event includes `x-correlation-id` echoed from upstream OR generated fresh.

### 6.3 Audit trail with correlation_id (P0)

- `PartnerAuditEvent` model on both sides (§2.6).
- Every outbound call generates `correlation_id = ulid()`, threaded as `x-correlation-id` header.
- Inbound handler accepts incoming `x-correlation-id` if present, else mints one.
- Both rows queryable: "show me everything that happened from this Sendero booking" → joins Sendero `Booking` → `PartnerAuditEvent` → BUFI mirror.

---

## 7. Six-phase sequencing

| Phase | Scope | Duration | Gates |
|---|---|---|---|
| 1 | OAuth bridge MVP — install/uninstall flow, token storage, refresh, encrypted-at-rest, audit table | week 1-2 | Internal install only; only `bufi_wallet_balance` exposed |
| 2 | BUFI on-ramp replaces MoonPay for LatAm tenants — `bufi_topup_create`, `bufi_offramp_create`, `bufi_transfer_status` | week 2-3 | Live with 1 friendly tenant; webhook handshake working |
| 3 | Per-trip card — `bufi_card_issue`, `bufi_card_freeze`, `bufi_card_balance`, `bufi_card_transactions` | week 3-4 | HITL approval flow on issue; freeze cron live |
| 4 | Invoice + accounting auto-attach — `bufi_invoice_create`, `bufi_accounting_entry_post`, `bufi_tax_event_record` | week 4-5 | First end-to-end booking → invoice → GL trace |
| 5 | Travel-as-widget — BUFI consumes Sendero MCP via OAuth | week 5-6 | One BUFI design partner using inline flight booking |
| 6 | Reusable partner pattern — `@sendero/oauth-bridge` + `@bu/oauth-bridge` extracted, second partner (Reap or Faye) ships through same path in <1 week | week 6+ | Bridge has zero partner-specific code in the bridge package itself |

Total: ~5 weeks for steady state. Phase 1 unblocks all else.

---

## 8. The replication recipe (vertical AI agents on BUFI)

Each new vertical follows the same shape:

1. **Pick a vertical with an agent wedge.** Apply the a16z six-precondition test (fragmented supply, offline suppliers, opaque pricing, frequent purchases, different SKUs, commoditizable). Travel scored 5.5/6 (see CLAUDE.md "Wedge findings"). Real estate, healthcare booking, legal services, freelance/contractor ops are next-best candidates.
2. **Build the vertical agent's tool catalogue.** Domain-specific (search/book for travel; intake/match for legal; etc.).
3. **Distribution = WhatsApp + Slack + MCP + web.** Same channel-render layer Sendero uses (`apps/app/lib/channel-render/`). Refactor it into `@sendero/channel-kit` once we have the second vertical proving the pattern.
4. **ERP backbone = BUFI via OAuth bridge.** Same `@bu/oauth-bridge` install flow. Day one money primitives: wallet, topup, transfer. As vertical matures, add invoicing, cards, accounting, tax.
5. **Tenant model = professional services intermediary.** Travel agencies for travel; brokerages for real estate; clinics for healthcare; firms for legal. End consumer reaches the agent through the tenant.
6. **Pricing = same three-leg shape.** Wholesale (supplier) + tenant markup + Sendero/vertical-co protocol fee. Implemented in `TenantPricingPolicy.markupConfig`.
7. **Brand = "<Vertical-co>, powered by BUFI"** OR no badge. Never co-branded SKUs.

**GTM lever:**
- Each vertical sells on its domain wedge (agencies want a travel agent; clinics want a healthcare booking agent).
- Every vertical sale pulls BUFI through silently (the wallet/card/invoice underneath).
- BUFI direct sales target horizontal-ERP buyers (CFOs of global teams). Those buyers see the vertical agent ecosystem as evidence of BUFI's robustness.

**Why the WhatsApp+Slack model:**
- Bypasses the "yet another dashboard" problem in vertical SaaS.
- Cross-tenant continuity built-in via `runAgentTurn` shared infrastructure.
- Replicates with minimal ops: Kapso for WhatsApp orchestration, existing Slack OAuth for Slack, MCP for AI clients, web traveler portal. Same four surfaces every time.

---

## 9. Brand discipline + monetization clarity

- Sendero never sells cards/ramps/FX. It composes BUFI's cards/ramps/FX.
- BUFI never ships travel features. It composes Sendero's travel.
- The OAuth bridge is the mechanism that lets each side stay pure.
- Pricing transparency: tenant sees Sendero take + BUFI take separately on every transaction. No hidden bundling. Every fee on its own line item in audit + invoice.
- Co-marketing OK ("Sendero, powered by BUFI for financial ops"). Co-branded SKUs not OK ("Sendero × BUFI Cards").

---

## 10. Open questions / future work

- **Second vertical pilot.** Which one ships first after Sendero proves the recipe? Real estate has highest revenue/transaction; legal has tightest agent fit; freelance ops has fastest GTM. Decide once Sendero hits 10 paying tenants.
- **Shared `@channel-kit` extraction.** Wait until 2 verticals to avoid wrong abstraction; refactor mid-Phase 6.
- **OIDC user-level SSO.** Defer past Phase 6.
- **Circle infra consolidation.** Defer past Phase 6.
- **Edge case: BUFI tenant linked to multiple Sendero verticals** (e.g. travel + future). `team_partner_link` unique on `(team_id, partner)`; if "partner" can be `sendero-travel` AND `sendero-real-estate`, schema already supports it. Consent UI needs to handle multi-link.
- **Compliance: who owns KYC?** BUFI owns wallet/card KYC. Sendero owns traveler PII. When BUFI issues a per-trip card to a Sendero traveler, KYC must be passed cleanly across the bridge. Spec a `kyc:share` scope + signed claim format in Phase 3.

---

## Appendix A — File map (planned)

```
sendero/
  packages/
    oauth-bridge/                  # NEW
      src/
        client.ts                  # PartnerOAuthClient impl
        provider.ts                # PartnerOAuthProvider impl
        types.ts
        token-crypto.ts            # AES-256-GCM helpers
        webhook-verify.ts          # HMAC-SHA256 helpers
    database/prisma/schema.prisma  # ADD TenantPartnerLink, PartnerAuditEvent
  apps/app/
    app/api/partners/bufi/
      install/route.ts             # OAuth begin
      callback/route.ts            # OAuth complete
      revoke/route.ts
    app/api/webhooks/partners/bufi/route.ts
    lib/partners/bufi-tools.ts     # Sendero-side wrappers around BUFI MCP
  docs/architecture/
    bufi-sendero-bridge.md         # this file

desk-v1/
  packages/
    oauth-bridge/                  # NEW (mirror)
    mcp-server/src/
      auth.ts                      # already accepts client_id; extend for tenant_link claim
      tools/
        sendero-bridge-tools.ts    # NEW (BUFI-side tools that call Sendero MCP)
  apps/api/
    routes/partners/sendero/
      install.ts
      callback.ts
      webhooks.ts
```

## Appendix B — Reference docs

- BUFI MCP server auth: `desk-v1/packages/mcp-server/src/auth.ts`
- BUFI auto-generated tools list: `desk-v1/packages/mcp-server/src/tools/generated.ts`
- Sendero MCP route: `apps/app/app/api/mcp/`
- Sendero billing/pricing source of truth: `packages/billing/src/plans.ts`
- a16z + YC wedge analysis: project `CLAUDE.md` "Wedge findings" section
- Channel-render layer (replication target): `apps/app/lib/channel-render/`
