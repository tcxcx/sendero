# Phase C — Trip-scoped Liveblocks + Cross-channel Notifications

Status: REVIEWED via adversarial codex (gpt-5.5 high-effort, 3.4M tokens, 2026-05-08). Decisions revised below. Implementation pending user approval.

## Two feature areas, one plan

### Area 1 — Trip-scoped Liveblocks restoration (the B-δ deferral)

Phase B-δ redirected `/dashboard/inbox/[tripId]` → `/dashboard/console?tripId=…`, which removed the route that mounted `TripLiveblocks` + `TripComments`. The console route currently has only the workspace-scoped Liveblocks room (`WorkspaceLiveblocks` in `dashboard/layout.tsx`). Lost surfaces:

| Surface | Today | Owner |
|---|---|---|
| Trip-room presence (cursor, focus, identity) | gone | `TripLiveblocks` + `TripPresenceFocusProvider` |
| `TripCollaborators` bottom-right aside | gone | `TripLiveblocks` inner component |
| `TripComments` (threaded comments aside) | gone | `TripComments` |
| `useTripPresenceFocus` calls in `ConsoleConversation` | no-op (context unprovided) | `presence-focus.tsx:60-66` |

### Area 2 — Cross-channel notifications

Today: each notification surface is wired ad-hoc by the call site that fires it. Inventory of what fans out where:

| Source | Channels | Files |
|---|---|---|
| Operator handoff request | Liveblocks bell + Slack default channel + Sendero web handoff record | `liveblocks-notify-operators.ts`, `liveblocks-webhook-fanout.ts`, `channel-dispatch.ts` |
| Booking confirmed | Email via Resend (`Notifier`), traveler WhatsApp/Slack via `channel-routing` | `notifier.sendBookingConfirmed`, `channel-routing.ts::sendShareOnTrip`, `duffel-dispatcher.ts` |
| Hold approval | Email + Slack approval card (Bolt) | `notifier.sendHoldApproval`, `slack-stay-actions.ts` |
| OTP / claim lockout | Email + WhatsApp via `selectOtpChannel` | `otp.ts`, `security-alerts.ts` |
| Platform wallet low-balance | Slack only | `platform-wallet-alerts.ts` |
| Deposit landed | Slack + Liveblocks bell | `deposit-notifications.ts` |
| Security alerts (SSO etc.) | Email + Slack | `security-alert-senders.ts` |
| Share cards (post-tool render) | Slack + WhatsApp + email + web | `channel-render/`, `channel-send/`, `agent-share-cards.ts` |

There is no single seam that says "for event X, fan out to channels Y per recipient prefs Z and audit at W." The closest unified piece is `channel-render/` (canonical `ChannelMessage` + per-channel renderers — covered in CLAUDE.md), but it's a render layer, not a notification dispatcher.

**Symptoms a cross-channel notifications layer would fix:**

1. **Duplicate fanout** — two different surfaces firing on the same logical event (e.g., handoff fires Liveblocks bell AND Slack AND web record from three different lib files, no shared idempotency).
2. **Missing channel coverage** — platform-wallet alerts only go to Slack; if Slack is down or not configured, no email fallback.
3. **No recipient-preference layer** — operators can't say "send me mentions in Slack but not email," tenants can't say "no Slack, only email + WhatsApp."
4. **Inconsistent audit** — some events log to Trip.events, some to MeterEvent, some to operator inbox, some nowhere.
5. **Webhook fanout duplication** — `liveblocks-webhook-fanout.ts` listens to Liveblocks events AND Sendero's own audit events; not consolidated.

## Locked decisions (post-codex review)

Codex round-2 (gpt-5.5 high effort, 3.4M tokens, 2026-05-08) attacked the draft and the current code. The seven fixes it recommended are absorbed below. Each row notes what the draft said vs what the lock now says, with codex finding numbers in parens.

| # | Question | DRAFT said | LOCKED choice (post-codex) | Why |
|---|---|---|---|---|
| C1 | How does trip-room mount on `/dashboard/console?tripId=X`? | Client bridge in console layout, reads `?tripId` via nuqs, conditionally mounts `<TripLiveblocks>`. | **Server slot wrapper**: `@conversation/page.tsx` (already a server component that DOES receive `searchParams`) computes `roomId`, `initialPresence`, calls `ensureRoom()` via `after()`, and wraps its content in `<TripLiveblocks>` when `?tripId` is set. Client-bridge approach rejected. (codex #4) | Layout can't see searchParams; the slot already does. The three server-only inputs `TripLiveblocks` needs (`roomId`, `initialPresence`, `ensureRoom`) are computable in the slot's existing path. No client roundtrip, no API endpoint to fetch room data. |
| C2 | Where does `<TripComments>` render? | `@context` slot below the trip-event drawer. | **Same** — `@context/page.tsx`, gated on `?tripId`. **But**: TripComments must be inside the TripRoomProvider tree from C1. Solution: the `<TripLiveblocks>` from C1 wraps both `@conversation` AND `@context` rendering, OR each slot mounts its own `TripRoomProvider` with the same room id. Open: which is cleaner — two providers for one room (allowed by Liveblocks SDK?) or pass children across slots? **Resolution**: each slot mounts its own `<TripRoomProvider roomId={roomIdForTrip(tenantId, tripId)}>`. Liveblocks dedupes per-room connections in the client SDK; two providers for the same room id share state. Verified by codex review of `client.tsx` provider impl. | Avoids cross-slot wrapping. |
| C3 | Notification dispatcher shape | "Delete the three handoff call sites and replace with one dispatcher." | **Reframe: "unify downstream side effects, not call sites."** The three handoff paths are NOT duplicates (codex #1): (a) `request_human_handoff` tool — fires when an agent escalates; creates `ChannelHandoff`, appends `Trip.events`, nudges Liveblocks + Slack inline. (b) `liveblocks-webhook-fanout` — fires on Liveblocks events (e.g., comment created); emits legacy `agent:customer-support` notification for downstream. (c) `channel-dispatch` — traveler-side one-channel routing, not operator handoff. **Plan v1 keeps all three sources alive** but routes their downstream Slack + Liveblocks bell + email + audit through one new `dispatch(event)` helper instead of inline `chat.postMessage` + `triggerInboxNotification` + `prisma.event.create` calls. Each source still owns its INPUT; the dispatcher only owns the OUTPUT fan-out. (codex #1) | The original framing would have lost real callers (the legacy support-agent notification path is not vestigial; it carries Liveblocks-webhook compatibility). |
| C4 | Recipient preference model | Clerk metadata + Tenant metadata. | **Prisma `UserNotificationPref` table** (new): `(userId, tenantId, eventKind, channels: text[])`. Tenant defaults in `Tenant.metadata` (already in use). Snapshot prefs onto the `NotificationDispatch` correlation row at send time so a mid-flight pref toggle doesn't cause already-dispatched-and-in-flight sends to behave inconsistently. Race semantics documented in dispatcher contract. (codex #3) | Clerk metadata invalidation is fragile (no proven pattern in this repo for prefs-shaped data). Prisma row + snapshot is explicit and debuggable. |
| C5 | Idempotency | New `NotificationDelivery` table keyed on `(eventKind, dedupKey, recipientId, channelKind)`. | **Source-owned dedup keys + envelope-only correlation table.** New `NotificationDispatch` table holds: `(id, sourceKind, sourceId, eventKind, dedupKey, recipients, snapshotPrefs, dispatchedAt)`. Per-channel attempts STILL write to existing tables (`WhatsAppOutboundMessage`, `MeterEvent`, `SecurityAlert`, `Trip.events` for trip-scoped). The new table is **correlation only**, not the source of truth for delivery status. Source code at the call site MUST set `dedupKey = sha256(eventKind + sourceId + recipientId)`. (codex #2, #5) | Codex flagged: "NotificationDelivery risks becoming a third audit seam." Existing tables already track per-channel delivery. New table only correlates a logical event across channels. |
| C6 | Audit | "Single auditable seam: `dispatch()` always records `Trip.events` + `MeterEvent` + `NotificationDelivery`." | **Treat existing tables as authoritative; new dispatch table is correlation only.** When call site fires `dispatch()`, the dispatcher (a) snapshots prefs, (b) writes one `NotificationDispatch` row keyed on `dedupKey`, (c) for each resolved channel, calls the existing per-channel sender (which writes its own audit row in its existing table). The dispatcher never duplicates `Trip.events` writes — the source call site STILL writes them like today. (codex #2) | One source of truth per channel; the dispatcher just enables joining across them via `dedupKey`. |
| C7 | Migration order | Handoff first, then booking confirmed, then security alerts. | **v1 scope reduced to handoff + booking-confirmed only.** Security alerts, platform-wallet alerts, OTP, deposit alerts stay direct in v1 — they're each working today, low fanout, and migrating them creates double-fire risk during cutover (codex #8). v2 (separate phase) revisits them after v1's dispatcher proves itself. (codex #7, #9) | Ship narrower; expand only if v1 actually delivers the maintainability win it promises. |
| C8 | WhatsApp routing | (NEW) | **Preserve per-tenant Meta-direct vs Kapso-proxy routing.** Dispatcher's WhatsApp adapter delegates to existing `channel-dispatch.ts` resolution (`env.whatsappAccessToken() ?? env.kapsoApiKey()`). Free tenants without a WhatsApp number stay no-send, no-error. (codex #6) | Codex called out: dispatcher must NOT centralize this — it's per-tenant install state. |
| C9 | Interface forward-compat | "Push/SMS not in scope." | **Channel kind enum allows `sms` and `push` from v1 even though no adapters exist.** OTP path already models `sms` as a delivery channel (`packages/notifications/src/otp.ts:81`). Adding adapters in v2 should be additive, not require schema migrations. (codex #10) | YAGNI for adapters; not for enum extensibility. |
| C10 | Liveblocks identity race | (NEW finding) | **Lookup `operatorUserIds` MUST gate the Liveblocks bell.** Codex #5 identified: if `operatorUserIds` lookup fails, only the legacy `agent:customer-support` notification fires; no human bell rings. The dispatcher's Liveblocks adapter MUST log a warning AND surface a Slack fallback when the operator-IDs lookup yields zero results. | Otherwise: silent dropped bells on operator-onboarding edge cases. |

## Architecture sketch

```
┌──────────────────────────────────────────────────────────────┐
│  Application call site (tool, webhook handler, user action)  │
│                                                              │
│   dispatch({                                                 │
│     kind: 'booking.confirmed',                               │
│     tripId, bookingId, dedupKey,                             │
│     recipients: [{ kind:'traveler', id }, { kind:'operator' }],│
│     payload: { ... }                                         │
│   })                                                         │
└──────────────┬───────────────────────────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────────────────────────┐
│  @sendero/notifications/dispatch                             │
│  • resolve recipient prefs (Clerk + Tenant + event default)  │
│  • dedup against NotificationDelivery (dedupKey + recipient) │
│  • fan out to per-channel adapters                           │
│  • write Trip.events + MeterEvent + NotificationDelivery     │
└────┬─────────┬─────────────────┬────────────────┬────────────┘
     │         │                 │                │
     ▼         ▼                 ▼                ▼
  Email    Liveblocks        Slack            WhatsApp
 (Resend)  triggerInbox    chat.post...    Kapso/Meta send
                            Notification
```

## What's NOT in scope (Phase C)

- Push notifications (web push / mobile)
- SMS via Twilio
- Per-recipient quiet hours / DND
- Cross-tenant notifications (the dispatcher stays tenant-scoped)
- Replacing `channel-render/` — the render layer stays as-is, the dispatcher CALLS the renderers

## Open questions for codex

1. The current handoff fanout fires from THREE places (`liveblocks-notify-operators.ts`, `liveblocks-webhook-fanout.ts`, `channel-dispatch.ts`). Are they actually duplicates, or do they handle different inputs that converge at the same operator inbox? If duplicates, what's broken today (double bells, missed events on race)?

2. `Notifier` (`packages/notifications/src/index.ts`) is email-only. Adding a unified dispatcher means either (a) extending Notifier into a multi-channel surface or (b) leaving Notifier as the email backend and building a higher-level Dispatcher around it. Which is cleaner?

3. The Liveblocks `triggerInboxNotification` server call (`packages/collaboration/src/server.ts:198`) takes a tenant + user ID. The proposed dispatcher would resolve recipients by `(tenantId, userId)`. Is there a race between Liveblocks user identity and Clerk identity that could cause the bell to ring for the wrong user?

4. WhatsApp delivery has a separate audit seam (`WhatsAppOutboundMessage` table, populated by hook in `WhatsAppClient`). Slack outbound has nothing similar. Should the new `NotificationDelivery` table replace these channel-specific audit tables, or augment them?

5. Should the trip-Liveblocks restoration (Area 1) ship before the notifications layer (Area 2)? Or together so trip-scoped comments can fire `mention.received` notifications from the start? Two PRs vs one.

6. The current `loadConsoleData` was deleted in B-δ but several places now bypass the trip-channel-bindings lookup (`channel-routing.ts::resolveChannelForTrip`). Did B-δ regress anything in the channel-routing path?

7. Liveblocks Comments has its own notification mechanism (`@mention` in a thread). Does our dispatcher need to OVERRIDE it (so a mention also routes to Slack/WhatsApp per prefs) or layer on top (so the Liveblocks bell stays in addition to the dispatcher's fanout)?

## Reviewers required before implementation

- [ ] Codex adversarial challenge on this draft + current code (PENDING)
- [ ] /plan-eng-review for architecture lock
- [ ] User decision on C7 (one PR vs incremental)

## Implementation order (post-codex lock)

Two sub-phases, two PRs. **C-1 ships independently from C-2**; the user can stop after C-1 if the trip-room restoration is enough value.

### Phase C-1 — Trip-scoped Liveblocks restoration (small PR)

1. **`@conversation/page.tsx`** (server component) — when `?tripId` is set:
   - Compute `roomId = roomIdForTrip(tenant.id, tripId)`
   - Call `buildInitialPresence({ userId, focusedSection: 'handoff', tripId })`
   - Call `after(() => ensureRoom({ tenantId: tenant.id, tripId }))`
   - Wrap `<ConsoleConversation />` in `<TripLiveblocks roomId initialPresence tripId>`
2. **`@context/page.tsx`** — when `?tripId` is set:
   - Mount its own `<TripRoomProvider roomId>` (same room id; Liveblocks dedupes per-room state in the SDK)
   - Render `<TripComments tripId={tripId} />` below the existing trip-event drawer
3. **Verify**: `useTripPresenceFocus` calls in `console-conversation.tsx` now actually update presence (today they're no-ops because `TripPresenceFocusContext` is unprovided).
4. **Verify**: `<TripCollaborators>` floating aside renders when 2+ operators view the same trip.
5. **No new tables, no dispatcher, no notifications work.** Pure restoration of a B-δ deferral.

### Phase C-2 — Cross-channel notifications dispatcher (larger PR)

1. **Schema migration**: add `NotificationDispatch` (correlation, envelope-only) + `UserNotificationPref` tables. Migration uses `CONCURRENTLY` per `lefthook.yml::migration-lint`.
2. **`@sendero/notifications` package extension**: new `dispatch(event, recipients)` server-only entry point. `NotificationEvent` discriminated union starts with `kind: 'handoff.requested' | 'booking.confirmed'` only.
3. **Adapters**: each adapter is a thin function delegating to existing senders. `slack.ts`/`whatsapp.ts`/`liveblocks-bell.ts`/`email.ts` (the last just calls existing `notifier()`). No adapter rewrites the per-channel logic.
4. **Wire `handoff.requested`**: `request_human_handoff` tool (`packages/tools/src/request-human-handoff.ts`) replaces its inline Liveblocks + Slack calls with a single `dispatch()` invocation. Inputs unchanged. Existing audit (Trip.events, ChannelHandoff) stays untouched.
5. **Wire `booking.confirmed`**: `duffel-dispatcher.ts` replaces inline `notifier.sendBookingConfirmed` + traveler-channel send with `dispatch()`. Inputs unchanged.
6. **Verify migration safety**: dual-fire window during cutover. Each migration commit (a) lands the dispatcher path, (b) smokes both old and new paths via `/qa`, (c) deletes the old direct calls in a follow-up commit (NOT the same PR — codex #8).
7. **Add `UserNotificationPref` UI**: `/dashboard/settings/notifications` (or similar). Tenant defaults via existing `Tenant.metadata` flag.
8. **Defer to v2**: security alerts, platform-wallet alerts, OTP, deposit alerts. They stay direct in v1.

### What's NOT in scope (preserved from draft, sharpened by codex)

- **Webhook fanout consolidation** — codex #7: "do not force all webhooks through notification dispatch." Liveblocks webhook fanout, Duffel booking webhook, Circle deposit webhook all do their own thing today; that's correct.
- Push notifications (web push / mobile)
- SMS via Twilio (the enum admits it; no adapter)
- Per-recipient quiet hours / DND
- Cross-tenant notifications

## Verdict (post-codex)

**SHIP-WITH-FIXES**. All seven of codex's recommended fixes are absorbed above. The original strategic question (codex #9: "is the abstraction worth it?") resolved by **reducing v1 scope to two events** — if the dispatcher proves its value on `handoff` + `booking.confirmed`, expand in v2.

## Eng review architecture locks (2026-05-08)

Run via `/plan-eng-review` after the codex round. Eight architecture claims pressure-tested. Locked decisions:

| # | Claim | Locked decision |
|---|---|---|
| E1 | Trip-room mount strategy | **One RoomProvider in layout client bridge.** Console layout renders a client component that reads `?tripId` via nuqs, fetches `{ roomId, initialPresence }` via a new `/api/trip-room-bootstrap` endpoint, mounts `<TripRoomProvider>` wrapping all slot children. The two-providers-refcount-shared option was viable but had an `initialPresence` first-wins gotcha; layout bridge is canonical. |
| E2 | `ensureRoom()` cost on rapid `?tripId` switching | Verified: `getOrCreateRoom` is idempotent server-side. Fire-and-forget via `after()` in the bootstrap route. No caching needed v1; revisit if measurements show >100 background calls/op-session. **Title/url updates require separate `updateRoom` call** (not in v1 scope). |
| E3 | `UserNotificationPref` schema shape | **`text[]` array per `(userId, tenantId, eventKind)`.** Atomic update, simpler than junction table. Junction table revisited only if we need fast queries on "all users who disabled X." |
| E4 | `NotificationDispatch` schema | **JSON for both `recipients` and `snapshotPrefs`.** Envelope/correlation semantics. Schema-migration-friendly. FK-to-versioned-prefs deferred (no historical query need yet). |
| E5 | Migration cutover pattern | **Parallel-fire with shared `dedupKey`.** Commit 1: dispatcher path lands AND old direct calls retrofitted to compute the same `dedupKey = sha256(eventKind + sourceId + recipientId)`. `NotificationDispatch` has `UNIQUE (tenantId, dedupKey, channelKind)` from day one. Commit 2 (separate PR): delete old direct calls. Codex's draft pattern, accepted. |
| E6 | Where does the dispatcher run? | **Explicit `context: { tenantId, triggeredBy }`.** Caller passes `triggeredBy: 'user_xxx' | 'system' | 'webhook:duffel'`. Works in API handlers, workflow steps, webhook handlers. `tenantId` is mandatory; the dispatcher fails closed if absent (Responsible AI ship gate). |
| E7 | Liveblocks identity gate fallback chain terminal state | **Sendero customer-support Slack** (existing `SLACK_CHANNEL_ID` env, same channel `platform-wallet-alerts.ts` uses). Throttled per-tenant 1-alert-per-30-min. Chain: bell → tenant Slack → tenant admin email → Sendero customer-support Slack. The `NotificationDispatch.status` field carries `'failed_all_channels'` when terminal fires. |
| E8 | TripComments `@mention` event scope | **Ship `mention.received` in C-2 v1.** Three events total: `handoff.requested` + `booking.confirmed` + `mention.received`. The existing `liveblocks-webhook-fanout.ts` routes Liveblocks `comments.thread.commented` through dispatcher with `kind: 'mention.received'`. Recipient = the @-mentioned operator only. |

## Implementation map (locked)

### Phase C-1 — Trip-room restoration (small PR)

New files:
- `apps/app/app/api/trip-room-bootstrap/route.ts` — server route. POST `{tripId}` → `{roomId, initialPresence}`. Auth via `requireCurrentTenant`. Calls `roomIdForTrip` + `buildInitialPresence` + `after(() => ensureRoom(...))`. Returns 404 on tripId not in tenant, 401 on no session.
- `apps/app/components/collaboration/console-trip-room-bridge.tsx` — client component. Reads `?tripId` via nuqs. When set: fetches bootstrap endpoint, mounts `<TripRoomProvider>` wrapping `children`. When unset: passes children through unchanged.

Modified files:
- `apps/app/app/(app)/dashboard/console/layout.tsx` — wraps the slot row in `<ConsoleTripRoomBridge>` so all slot children share one TripRoomProvider when `?tripId` is set.
- `apps/app/components/console/console-conversation.tsx` — `useTripPresenceFocus` calls now actually fire (`TripPresenceFocusContext` provided via the bridge).
- `apps/app/app/(app)/dashboard/console/@context/page.tsx` — when `?tripId` set, renders `<TripComments tripId={tripId} />` below the existing trip-event drawer.

Deletions: none.

### Phase C-2 — Cross-channel dispatcher (larger PR)

Schema (`packages/database/prisma/schema.prisma`):
```prisma
model NotificationDispatch {
  id             String   @id @default(cuid())
  tenantId       String
  sourceKind     String   // 'agent_tool' | 'webhook' | 'workflow' | 'manual'
  sourceId       String
  eventKind      String   // 'handoff.requested' | 'booking.confirmed' | 'mention.received'
  dedupKey       String   // sha256(eventKind + sourceId + recipientId + channelKind)
  channelKind    String   // 'slack' | 'whatsapp' | 'liveblocks_bell' | 'email' | 'sms' | 'push'
  recipients     Json     // [{userId, channels: string[], reason?: string}]
  snapshotPrefs  Json     // frozen prefs at dispatch time
  status         String   // 'sent' | 'skipped_dupe' | 'skipped_pref' | 'failed' | 'failed_all_channels'
  triggeredBy    String   // 'user_xxx' | 'system' | 'webhook:duffel'
  dispatchedAt   DateTime @default(now())

  @@unique([tenantId, dedupKey, channelKind])
  @@index([tenantId, eventKind, dispatchedAt])
}

model UserNotificationPref {
  id        String   @id @default(cuid())
  userId    String
  tenantId  String
  eventKind String
  channels  String[] // ['slack','email'] etc; empty = "no notifications for this event"
  updatedAt DateTime @updatedAt

  @@unique([userId, tenantId, eventKind])
}
```

Migration uses `CREATE INDEX CONCURRENTLY` per `lefthook.yml::migration-lint` (both indexes).

New files:
- `packages/notifications/src/dispatch.ts` — `dispatch(event, recipients, context)` server-only entry. Resolves prefs, snapshots, dedups, fans out to adapters, writes NotificationDispatch row.
- `packages/notifications/src/event-kinds.ts` — `NotificationEvent` discriminated union (3 kinds in v1; enum allows `sms`/`push` adapters in v2).
- `packages/notifications/src/adapters/{slack,whatsapp,liveblocks-bell,email}.ts` — thin delegations to existing senders.
- `packages/notifications/src/fallback-chain.ts` — Liveblocks identity gate; terminal Sendero customer-support Slack post (throttled, reuses platform-wallet-alerts pattern).
- `apps/app/app/(app)/dashboard/settings/notifications/page.tsx` — UI for `UserNotificationPref` toggles.

Modified files (Commit 1, parallel-fire):
- `packages/tools/src/request-human-handoff.ts` — emits dispatcher invocation with `kind: 'handoff.requested'`. Existing inline Liveblocks + Slack calls retrofitted to use the same dedupKey format. Both fire; dedup catches the second.
- `apps/app/lib/duffel-dispatcher.ts` — emits dispatcher invocation with `kind: 'booking.confirmed'`. Existing inline `notifier.sendBookingConfirmed` + traveler-channel send retrofitted with same dedupKey.
- `apps/app/lib/liveblocks-webhook-fanout.ts` — emits dispatcher invocation with `kind: 'mention.received'` for `comments.thread.commented` events. Existing legacy `agent:customer-support` notification path retrofitted with same dedupKey.

Modified files (Commit 2, after smoke, separate PR):
- Same three files: delete the old direct-call paths. Only dispatcher remains.

## Test plan

```
CODE PATHS                                                          USER FLOWS

[+] /api/trip-room-bootstrap (NEW)
  ├── 200 — happy path                  [GAP] [→E2E]                [+] Operator opens scoped trip
  ├── 401 — no session                  [GAP] [→UNIT]                 ├── [GAP] [→E2E] Presence visible to 2nd op
  ├── 403 — wrong tenant                [GAP] [→UNIT]                 ├── [GAP] [→E2E] @mention via TripComments
  ├── 404 — trip not in tenant          [GAP] [→UNIT]                 │      → bell + Slack DM (after C-2)
  └── ensureRoom() Liveblocks misconfig [GAP] [→UNIT]                 └── [GAP]        Rapid trip switching
                                                                              (no leaked WS, presence cleans)
[+] ConsoleTripRoomBridge (NEW client)
  ├── tripId unset — passthrough         [GAP] [→UNIT]
  ├── tripId set — fetch + mount         [GAP] [→E2E]               [+] Notification dispatch (C-2)
  └── fetch error — render children only [GAP] [→UNIT]                ├── [GAP] [→UNIT] handoff.requested
                                                                              → 3 operators get bell+Slack
[+] dispatch() (C-2 NEW)                                                   each, dedup catches retry
  ├── prefs resolution                   [GAP] [→UNIT]                ├── [GAP] [→UNIT] booking.confirmed
  │   ├── User pref present → use it                                          → traveler email + WhatsApp
  │   ├── Tenant default → fall back                                          per channel-routing
  │   └── Per-event override (security always email) [GAP]            ├── [GAP] [→UNIT] mention.received
  ├── dedup check                        [GAP] [→UNIT]                          → only @mentioned op gets DM
  │   ├── First fire: insert+send                                     ├── [GAP] [→E2E] Migration double-fire
  │   ├── Second fire: skip via UNIQUE constraint                              → 2 paths fire, dedup yields 1
  │   └── Race: 2 dispatchers same key, only 1 wins                   └── [GAP] [→E2E] Fallback chain
  ├── adapter dispatch                   [GAP] [→UNIT]                          → 0 ops → tenant Slack →
  │   ├── slack ok / 5xx / not-installed                                          admin email → SLACK_CHANNEL_ID
  │   ├── whatsapp ok / not-paid-tenant
  │   ├── liveblocks-bell ok / userId not in room
  │   └── email ok / Resend skipped
  └── fallback chain                     [GAP] [→UNIT]
      ├── 0 op IDs → tenant Slack
      ├── no Slack → tenant admin email
      ├── no admin → SLACK_CHANNEL_ID throttled (1/30min)
      └── all-failed → status='failed_all_channels'

REGRESSION CRITICAL (codex #5):
  [+] Liveblocks identity gate
      ├── operatorUserIds lookup yields 0 → falls back NOT silent  [GAP] [→UNIT]
      └── Test must assert: SLACK_CHANNEL_ID receives the throttled alert

COVERAGE: 0/22 (0%) — all C-1 + C-2 paths are NEW
GAPS: 22 (8 E2E, 14 unit)
QUALITY: ★★★ targets: dispatch dedup + fallback chain + handoff retrofitted call site
```

Test files to create:
- `apps/app/app/api/trip-room-bootstrap/route.test.ts` — 4 cases (auth + tenant + tripId).
- `apps/app/components/collaboration/__tests__/console-trip-room-bridge.test.tsx` — 3 cases (unset / set / fetch-fail).
- `packages/notifications/src/__tests__/dispatch.test.ts` — 12+ cases covering prefs, dedup, adapters, fallback.
- `packages/notifications/src/__tests__/fallback-chain.test.ts` — 4 cases (each chain link).
- `apps/app/e2e/phase-c-trip-room.spec.ts` — Playwright E2E for trip-room mount + 2nd-op presence + @mention dispatch.
- `packages/tools/src/__tests__/request-human-handoff-dispatch.test.ts` — regression: retrofitted dedupKey matches dispatcher's dedupKey, double-fire window yields exactly 1 notification per channel per recipient.

## Failure modes (per new codepath)

| Path | Failure | Test? | Error handling? | User sees? |
|---|---|---|---|---|
| Bootstrap endpoint Liveblocks misconfig | `LIVEBLOCKS_SECRET_KEY` unset → `getClient()` returns null → ensureRoom no-op | UNIT | Existing skip-quiet pattern in server.ts | Trip-room features disabled silently in dev |
| Bridge fetch fails (network) | `/api/trip-room-bootstrap` 5xx | UNIT | Render children without TripRoomProvider; log warning | Comments aside doesn't render; presence focus is no-op (today's behavior) |
| Bridge fetch races trip change | User clicks 5 trips in 3s | E2E | nuqs debounce or AbortController per request | Possibly stale presence; Liveblocks SDK handles room transitions |
| Dispatcher dedup race | Two dispatcher invocations same dedupKey, simultaneously | UNIT | UNIQUE constraint on (tenantId, dedupKey, channelKind); only first inserts | Recipient gets exactly 1 notification |
| Channel adapter fails partial | Slack 5xx during fanout, WhatsApp ok | UNIT | Per-channel `status='failed'` row; other channels still fire | Some recipients get notification, dashboard shows partial |
| Fallback chain reaches terminal | All upstream channels down | UNIT | Sendero ops gets throttled Slack post | Tenant ops sees nothing immediately; Sendero ops contacts manually |
| Migration double-fire bug | dedupKey computation differs between old + new code paths | E2E | Test asserts equality of dedupKey strings | Recipients get TWO notifications during cutover window |

**Critical gaps (no test + no error handling + silent):** zero. All identified failure modes have a path.

## NOT in scope (preserved)

- Webhook fanout consolidation across Circle/Duffel/Clerk (codex #7)
- Push notifications + SMS adapters (enum allows; no implementations)
- Per-recipient quiet hours / DND
- Cross-tenant notifications
- Replacing `channel-render/` (the dispatcher CALLS the renderers; render layer stays)
- Title/url updates in `ensureRoom` (would need separate updateRoom call; v2)
- Migration of security alerts, platform-wallet alerts, OTP, deposit alerts (v2; codex #7, #9)

## What already exists (reused, not rebuilt)

- `Notifier` (Resend, email-only) — wrapped by email adapter, NOT replaced
- `channel-render/` canonical render layer — adapters call into it
- `channel-routing.ts::resolveChannelForTrip` — preserved per codex #6 for tenant Meta-vs-Kapso WhatsApp routing
- `roomIdForTrip` + `buildInitialPresence` — used by trip-room-bootstrap endpoint
- `ensureRoom` (Liveblocks server) — called from bootstrap; idempotent
- `notifyOperatorHandoff` — still fires; dispatcher's Liveblocks adapter delegates to it
- `WhatsAppOutboundMessage` + `MeterEvent` + `SecurityAlert` + `Trip.events` — still authoritative for per-channel audit (codex #2)
- `SLACK_CHANNEL_ID` + `SLACK_BOT_TOKEN` — terminal-state fallback channel
- `chat-bridge.ts` (added in Phase B-γ) — unchanged; this work doesn't touch it
- `platform-wallet-alerts::notifyPlatformWalletLow` throttle pattern (1/30min per address) — replicated for fallback-chain throttle

## Worktree parallelization

| Lane | Steps | Modules |
|---|---|---|
| A (sequential) | C-1 bootstrap endpoint → C-1 client bridge → C-1 layout integration | `apps/app/app/api/trip-room-bootstrap/`, `apps/app/components/collaboration/`, `apps/app/app/(app)/dashboard/console/` |
| B (parallel with A) | C-2 schema migration + dispatch.ts shell + adapters | `packages/database/`, `packages/notifications/` |
| C (sequential after A+B) | C-2 retrofit at 3 call sites + Commit 2 deletion | `packages/tools/`, `apps/app/lib/` |

Lane A and B can be developed in parallel worktrees and merged in either order. Lane C requires both upstream lanes merged. Commit 2 (delete old direct calls) is a separate PR after smoke.

## Completion summary

- Step 0: Scope Challenge — accepted as-is; codex round-2 already reduced v1 scope (3 events, dispatcher only)
- Architecture Review: 2 substantive forks resolved (E1 mount, E5 cutover), 6 technical defaults locked
- Code Quality Review: handled inline; thin adapters delegate to existing senders, no new abstractions
- Test Review: 22 new code paths identified, 22 GAPS to fill (8 E2E + 14 unit). One CRITICAL regression test pinned for fallback-chain.
- Performance Review: ensureRoom idempotent + fire-and-forget; dispatch dedup via UNIQUE index; no N+1 risks identified
- NOT in scope: webhook fanout consolidation, SMS/push adapters, cross-tenant
- What already exists: Notifier (email), channel-render, channel-routing (Meta-vs-Kapso), roomIdForTrip, ensureRoom, throttle pattern
- Failure modes: 7 paths, 0 critical gaps (all have test + error handling)
- Outside voice: codex round-2 ran (3.4M tokens, 7/7 fixes absorbed); eng review (this) is the architecture lock
- Parallelization: 2 parallel lanes (A: trip-room, B: dispatcher infra), then sequential lane C (retrofit)
- Lake Score: 8/8 decisions chose explicit-over-clever / complete-over-shortcut

## Reviewers required before implementation

- [x] Codex adversarial challenge on draft + current code (DONE — 7/7 absorbed)
- [x] /plan-eng-review for architecture lock (DONE — 8 forks resolved)
- [ ] User decision on C-1 vs C-1+C-2 sequencing (pending)

## Reviewers required before implementation

- [x] Codex adversarial challenge on draft + current code (DONE — 10 findings, 7 fixes locked above)
- [ ] /plan-eng-review for architecture lock (pending)
- [ ] User decision on C-1 vs C-1+C-2 sequencing

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| Codex Review | `/codex consult` | Adversarial 2nd opinion on draft + current code | 1 | issues_found → 7/7 fixes applied | gpt-5.5 high effort, 3.4M tokens. 10 findings (handoff-not-duplicate, NotificationDelivery-3rd-seam, Clerk-prefs-race, C1-handwave, Liveblocks-identity-split, WhatsApp-Kapso-vs-direct, webhook-overbroad, migration-double-fire, abstraction-not-yet-justified, SMS/push-enum-extensibility). All absorbed. |
| Eng Review | `/plan-eng-review` | Architecture & tests | 1 | CLEAR (PLAN) | 8 architecture claims pressure-tested. 2 substantive forks resolved (E1 mount: layout client bridge; E5 cutover: parallel-fire+dedupKey). 6 technical defaults locked (text[] prefs, JSON envelope, explicit context, fallback to SLACK_CHANNEL_ID, mention.received in v1, JSON snapshotPrefs). 22 test gaps identified, 1 critical regression pinned (fallback-chain). |
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | not run (codex #9 already pushed scope-reduce) |
| Design Review | `/plan-design-review` | UI/UX | 0 | — | not run (notifications settings page is the only UI scope; trivial) |

**CODEX:** SHIP-WITH-FIXES, 7/7 absorbed. Strategic question (#9) resolved by scope reduction (v1 = 3 events).

**ENG:** SHIP. 8/8 forks locked. C-1 = layout client bridge + bootstrap endpoint. C-2 = parallel-fire+dedupKey migration. Three v1 events: handoff.requested + booking.confirmed + mention.received.

**CROSS-MODEL:** codex and eng review agree on C-2 scope. Eng review tightened C-1 mount strategy beyond what codex challenged (codex flagged C1 as handwaved; eng review locked it to layout client bridge with explicit data flow).

**UNRESOLVED:** 1 — user decision on C-1 standalone vs C-1+C-2 bundle.

**VERDICT:** ENG + CODEX CLEARED — ready to implement after user picks sequencing.
