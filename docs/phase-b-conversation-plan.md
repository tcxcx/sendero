# Phase B — @conversation + @stage split (locked plan)

Reviewed via `/plan-eng-review` on 2026-05-08. Architecture decisions
locked below before any code touches `MetaInboxLive`.

## Decisions locked

| # | Question | Choice | Why |
|---|---|---|---|
| D1 | Where does `useChat` live? | Headless `ConsoleChatHost` mounted in console layout | Zustand is already the cross-island bus (Stage + WorkflowLog already read from it). No Provider tree. No per-token re-renders to consumers. |
| D2 | Atomic or incremental? | Atomic single PR | One QA pass, no flag debt. Inbox/[tripId] route untouched (uses MetaInboxLive directly with embedRail=true). |
| D3 | Where does WorkflowLog go? | Inside @stage with conditional render on `useSendero(s => s.showWorkflow)` | Both Stage and WorkflowLog are workspace-scoped chat output. One slot, three columns total. |
| D4 | Where does CustomerPanel go? | Fold into @context drawer | Both are trip-scoped, same data fetch. No new I/O. Customer-panel toggle becomes the existing lg-breakpoint aside hide rule. |

## Final layout

```
┌─────────────────────────────────────────────────────────────────┐
│                            @kpis                                │
├──────────┬──────────────────┬───────────────────┬───────────────┤
│ @threads │  @conversation   │      @stage       │   @context    │
│  (rail)  │  (chat + comp.)  │ (Stage + WL when  │ (trip drawer  │
│          │                  │  showWorkflow)    │ + cust. panel)│
└──────────┴──────────────────┴───────────────────┴───────────────┘
                              ▲
                              │ all consumers read
                              │ from useSendero zustand
                              │
                  ┌───────────┴────────────┐
                  │  ConsoleChatHost       │  (mounted in layout.tsx,
                  │  ─────────────────────  │   renders null)
                  │  • useChat({transport})│
                  │  • useChatStoreSync    │
                  │  • registerChatBridge  │
                  │  • registerChatNote    │
                  │  • EventSource(/api/   │
                  │    inbox/<tripId>/...) │
                  │  • resume effect (?cs=)│
                  └────────────────────────┘
```

## Implementation map

### New files (8)

| File | Purpose | LOC est. |
|---|---|---|
| `apps/app/components/console/console-chat-host.tsx` | Headless host. `useChat` + sync + bridge + EventSource + resume. Reads `?tripId` and `?cs` via nuqs. Returns `null`. | ~180 |
| `apps/app/app/(app)/dashboard/console/@conversation/page.tsx` | Server-fetches focused-trip events. Mounts `<ConsoleConversation />`. | ~30 |
| `apps/app/app/(app)/dashboard/console/@conversation/loading.tsx` | Conversation skeleton (channel header + 3 message stubs + composer placeholder). | ~50 |
| `apps/app/app/(app)/dashboard/console/@conversation/default.tsx` | Returns null (soft-nav fallback). | ~5 |
| `apps/app/components/console/console-conversation.tsx` | Client component. Composer mode, optimistic posts, presence focus, demo trip, handleSubmit. Reads `messages/status/error/sendMessage` from chat-bridge actions + zustand selectors. | ~280 |
| `apps/app/app/(app)/dashboard/console/@stage/page.tsx` | Renders `<Stage />` + conditional `<WorkflowLog />`. Server component (no fetch — Stage reads zustand client-side). | ~25 |
| `apps/app/app/(app)/dashboard/console/@stage/loading.tsx` | Stage placeholder card. | ~30 |
| `apps/app/app/(app)/dashboard/console/@stage/default.tsx` | Returns null. | ~5 |

### Modified files (4)

| File | Change |
|---|---|
| `apps/app/app/(app)/dashboard/console/layout.tsx` | Add `conversation` and `stage` slots. Mount `<ConsoleChatHost />` once. New flex grid: `@kpis` top; row: `@threads` \| `@conversation` \| `@stage` \| `@context`. |
| `apps/app/app/(app)/dashboard/console/page.tsx` | Returns `null`. **MUST NOT be deleted** — Next.js requires page.tsx for the segment to match a URL; deletion → 404. |
| `apps/app/app/(app)/dashboard/console/@context/page.tsx` | Inline customer-panel content (trip metadata + actions) below the existing trip-context section. Same data already in scope. |
| `apps/app/components/chat-bridge.ts` | Add `getChatStatus()`, `registerChatStatus(getter, key)`, `unregisterChatBridge(key)`, `unregisterChatNote(key)`, `unregisterChatStatus(key)`. Effect-scoped registration with cleanup — closes the StrictMode/HMR holes Codex flagged. `sendViaChat`/`noteToChat` returning `false` (no registrant) MUST surface a user-visible toast, not silently drop. NO `registerChatActions` multi-method surface. |
| `apps/app/components/store.ts` | Add `hostReady: boolean` derived from bridge registration epoch. Host registers via effect → `setHostReady(true)`; effect cleanup → `setHostReady(false)`. Composer disables while false. **Codex's finding #1:** `hostReady` is NOT a one-way flag — it MUST be lifecycle-bound to bridge presence so StrictMode unmount/remount cycles don't leave it stale. **Codex's finding #2:** if `sendViaChat` returns false (HMR module epoch mismatch where bridge cleared but store didn't), surface toast "Chat unavailable, refresh page" instead of silent drop. |

### Files NOT touched

- `apps/app/components/console/meta-inbox.tsx` — still rendered by `/dashboard/inbox/[tripId]` with `embedRail=true`. Untouched.
- `apps/app/components/console/meta-inbox-live.tsx` — same. Untouched. The console route stops importing it but the component stays as-is for the inbox detail route.
- `apps/app/components/chat-col.tsx` — `/` shell. Already updated to pass `'chat-col'` as bridge key. No change.
- All Stage / WorkflowLog / CustomerPanel internals — they already read from zustand.

## State graph

```
URL state (nuqs, shared across all slots):
  ?tripId=…    → drives @conversation server fetch + EventSource subscription
                 in host; rail active row in @threads; trip data in @context
  ?cs=…        → drives chatSessionId in host's transport;
                 forces composerMode=internal in @conversation

Module singletons (already in place):
  useSendero (zustand)        → Stage, WorkflowLog, conversation persona,
                                 footer rail, treasury balances. Adds
                                 hostReady boolean (lifecycle-bound, see below).
  chat-bridge (module)        → registerChatBridge('chat-col' or 'console')
                                 + registerChatNote('chat-col' or 'console')
                                 + getChatStatus()  — single new helper for the
                                 demo runner. Plus unregisterChatBridge(key)
                                 + unregisterChatNote(key) for effect cleanup.
                                 NO registerChatActions — earlier draft proposed
                                 it as a multi-method surface; outside-voice
                                 review rejected as YAGNI. Channel mode never
                                 touches useChat; it POSTs to /api/inbox/<id>/
                                 reply directly.

Conversation-local client state (in @conversation):
  composerMode                → useState. Derived initial from URL.
  optimistic posts            → useState. Channel-mode bubbles.
  demoActive / demoMessages   → useState. /demo trip runner.
  useTripPresenceFocus        → Liveblocks presence. Section per composerMode.
```

## Failure modes (per new codepath)

| Path | Failure | Test? | Error handling? | User sees? |
|---|---|---|---|---|
| Host useChat transport rebuild on tripId change | Stale message after URL switch | Manual QA | useChat resets messages | Brief flicker, then new context |
| Host EventSource on /api/inbox/<tripId>/events/stream | Network drop | Existing reconnect (auto) | Existing console.warn | Silent — events resume on reconnect |
| Host resume from ?cs=<id> | /api/chats/<id> 404 | Manual QA | console.warn, no fallback | Empty conversation. **Gap** |
| @conversation handleSubmit channel mode → POST /api/inbox/<id>/reply | 500 from server | Manual QA | optimistic stays; res.ok branch skipped | Pending bubble never resolves. **Gap** |
| @stage Stage rendering tool-card during search/hold/pay | Tool result shape changes | Existing tool-cards have fallback | Existing | Generic JSON dump |
| @context customer-panel render | Trip data null | Add type guard | Existing skeleton | Skeleton stays |
| chat-bridge registerChatActions cross-route | Two routes both call register | Bridge dedup is key-based | Last-write-wins | Wrong route's sendMessage called. **Risk** |

**Critical gaps (in-house review):**
1. Resume effect failure → empty conversation with no error message. Add toast.
2. Channel reply 500 → optimistic bubble stuck pending. Add timeout + retry button.

**Critical gaps (outside-voice round 1 — Claude subagent fallback, 2026-05-08):**
3. **Cold-load race:** sibling `@conversation` slot may render + accept input BEFORE the layout-level `ConsoleChatHost` mounts and registers with the chat-bridge. `sendViaChat` returns `false` silently → user-typed message lost. **Fix:** add `hostReady: boolean` to Zustand. Refined further by round-2 (#7).
4. **Demo runner status access:** `runDemoTripScript` polls `statusRef.current` from `MetaInboxLive`. After the split, statusRef lives in host but demo loop lives in `@conversation`. **Fix:** add `getChatStatus()` to chat-bridge; host registers it; demo reads it.
5. **`page.tsx` deletion footgun:** Next.js requires `page.tsx` at the segment. **Fix:** keep, return `null`, never delete.
6. **Re-render claim is overstated:** verified — WorkflowLog re-renders on every `logEvent` regardless of split. Stage already gates correctly. JS-execution savings are real but not user-perceivable. Maintainability framing is what justifies the work — but see #10.

**Critical gaps (outside-voice round 2 — real Codex CLI gpt-5.5 high-effort, 2026-05-08):**
7. **`hostReady` is not a real readiness proof.** Codex #1: a one-way boolean does not solve StrictMode dev double-mount. Mount→register→hostReady=true; unmount leaves bridge map + Zustand flag both stale; remount races. **Fix:** registration MUST be effect-scoped with cleanup (`return () => unregisterChatBridge('console')`); `hostReady` MUST be lifecycle-bound to bridge presence (set true in same effect that registers, set false in cleanup). Don't keep them as independent state.
8. **HMR module-state mismatch.** Codex #2: Turbopack can hot-replace `chat-bridge.ts` (clearing module map) while Zustand store survives (still says `hostReady=true`). Composer enabled but `sendViaChat()` returns `false` silently. **Fix:** `sendViaChat()` and `noteToChat()` failures MUST surface a toast ("Chat unavailable, refresh page") instead of silent return `false`. Better signal than swallowed bug.
9. **Plan internal contradiction.** Codex #3: state graph said `registerChatActions(...)` while implementation order forbade it. **Fix:** state graph and implementation order MUST agree. Done in this revision.
10. **Maintainability claim is weak — duplication, not split.** Codex #4: the prior plan kept `MetaInboxLive` AND `MetaInbox` for `/dashboard/inbox/[tripId]` while adding `@conversation` and `@stage` slots. **Net LOC went UP by ~600.** Two parallel implementations of the same fragile behavior (transport, resume, bridge, EventSource, demo, channel reply). **Fix (scope-up):** Phase B-δ migrates `/dashboard/inbox/[tripId]` to the new slot architecture and DELETES `MetaInboxLive` + `MetaInbox`. See Next actions for the two-PR sequence.
11. **Resume race needs explicit AbortController / cancellation guard.** Codex #5: current `meta-inbox-live.tsx:217-230,236-238` uses a `cancelled` boolean before `setMessages`. The plan MUST require this pattern in `ConsoleChatHost` (or upgrade to AbortController). Not just "resume effect."
12. **EventSource cleanup is an acceptance criterion.** Codex #6: current code closes the stream on dependency change/unmount (`meta-inbox-live.tsx:296-318`). Plan MUST explicitly require the same in `ConsoleChatHost`. Add to acceptance criteria.

## Browser QA matrix (atomic ship requirement)

Run all 14 before merge. Each must produce a screenshot.

1. **Internal-mode chat** — composer → useChat stream → AI Elements render
2. **Channel-mode reply** — `?tripId` set, optimistic bubble, EventSource refresh
3. **Composer mode toggle** — scoped trip, flip internal↔channel, message routes correctly
4. **`/demo trip` slash command** — multi-turn autonomous run; demo banner shows; tool cards land in Stage
5. **Resume from `?cs=<id>` URL** — page reload restores messages; no flicker
6. **Stage tool-card rendering** — search → hold → pay flow; cards land in @stage
7. **WorkflowLog ticking** — `showWorkflow=true`; tool events appear under Stage
8. **HoldCard / FundCard noteToChat** — synthetic system message lands in conversation
9. **Liveblocks presence focus** — toggling composer mode updates presence section
10. **5xx during streaming** — error UI + stop button still works (status from store)
11. **Reload during in-flight tool** — page restores; in-flight tool either completes or errors gracefully
12. **Cmd+K palette** — opens over the new layout; no Radix DialogTitle warnings (already fixed in 0fb8c34c)
13. **Cross-route bridge** — open `/` and `/dashboard/console` in two tabs; no duplicate-registration warnings
14. **`/dashboard/inbox/[tripId]` regression** — still uses MetaInboxLive with embedded rail; full Stage + customer panel + WorkflowLog inside MetaInbox grid

## NOT in scope

- Refactoring `MetaInbox` itself. Inbox/[tripId] route keeps the embedded grid.
- Refactoring `chat-col.tsx` on `/`. Different surface, different needs.
- New Stage / WorkflowLog / CustomerPanel features. Lift only.
- Test infrastructure beyond playwright E2Es for the 14 QA flows.

## What already exists (no rebuild needed)

- `useSendero` zustand store — already global, already feeds Stage/WorkflowLog.
- `useChatStoreSync` — already the bridge from useChat → store. Just relocate.
- `chat-bridge` — already module-singleton with key-based dedup (commit `0fb8c34c`).
- Three working parallel-routes slots (`@kpis`, `@threads`, `@context`) as templates.
- `loadConsoleData` — splits into `loadConsoleTrips` (already done) + `loadFocusedTrip` (extract from console-data.ts as part of @conversation/page.tsx).

## Worktree parallelization

Sequential implementation, no parallelization opportunity. Single lane: host → conversation → stage → layout. The host must land before the slots can read its actions.

## Confidence calibration on findings

| Finding | Confidence | Source |
|---|---|---|
| ConsoleChatHost (headless) > Provider for this codebase | 9/10 | Observed: useSendero already global; Stage/WorkflowLog already subscribe |
| Atomic ship is fine because /dashboard/inbox/[tripId] is the production fallback | 9/10 | Verified: that route uses `embedRail=true` default |
| WorkflowLog belongs in @stage not @context | 9/10 | Observed: workspace-scoped vs trip-scoped |
| chat-bridge cross-route warning is benign | 7/10 | Pattern match on the 0fb8c34c fix |
| Resume + channel-reply error UX gaps are real | 8/10 | Observed in code (no toast, no retry) |

## Completion summary

- Step 0: Scope Challenge — scope accepted as-is (8 new files, 4 modified, 4 untouched)
- Architecture Review: 4 issues raised, 4 decisions locked
- Code Quality Review: handled inline (chat-bridge surface extension; no new abstractions)
- Test Review: 14-flow E2E matrix locked; 2 critical UX gaps (resume + channel-reply errors) flagged for fix
- Performance Review: net win — Stage/WorkflowLog re-render less often than today (zustand selectors vs full island re-renders); Layout doesn't re-render on URL change
- NOT in scope: MetaInbox itself, chat-col, new features
- What already exists: zustand bus, chat-bridge, useChatStoreSync, three slot templates, loadConsoleData
- Failure modes: 2 critical gaps flagged
- Outside voice: deferred (skill offers it; lock decisions first)
- Parallelization: sequential, single lane
- Lake Score: 4/4 decisions chose complete option (no shortcuts)

## Next actions

**Two-PR sequence** (Codex #4 forced scope-up: net LOC reduction + monolith deletion is the actual maintainability win).

### Phase B-γ — `/dashboard/console` split (this PR)

1. **Add `hostReady` to Zustand** — `store.ts`: derived boolean. Set true in same effect that registers with bridge; set false in cleanup (Codex #1, #2).
2. **Extend chat-bridge with cleanup** — `chat-bridge.ts`: add `getChatStatus()`, `registerChatStatus(getter, key)`, `unregisterChatBridge(key)`, `unregisterChatNote(key)`, `unregisterChatStatus(key)`. `sendViaChat`/`noteToChat` failures surface a toast ("Chat unavailable, refresh page") instead of silent return false (Codex #2 HMR fix).
3. **Build `ConsoleChatHost`** — headless client component. `useEffect` that registers + sets hostReady=true, with cleanup that unregisters + sets hostReady=false. Owns `useChat` + `useChatStoreSync` + EventSource(scoped, with explicit cleanup per Codex #6) + resume effect (with `cancelled` boolean OR AbortController per Codex #5). Reads `?tripId` and `?cs` via nuqs.
4. **Build `@stage/{page,loading,default}.tsx`** — `<Stage />` + conditional `<WorkflowLog />`.
5. **Build `@conversation/{page,loading,default}.tsx`** + `console-conversation.tsx` — composer disabled until `hostReady`. Channel mode POSTs to `/api/inbox/<id>/reply` directly. Internal mode calls `sendViaChat()`. Demo runner uses `getChatStatus()`.
6. **Reshape `console/layout.tsx`** — mount `<ConsoleChatHost />` + add `conversation` and `stage` slot props.
7. **Inline customer-panel into `@context/page.tsx`**.
8. **`console/page.tsx` returns `null`** — DO NOT DELETE.
9. **Toast for resume-failure + channel-reply retry** (in-house gaps #1, #2). Toast for `sendViaChat` returning false (Codex #2).
10. **Run 14-flow QA matrix via `/qa`**.

End state of B-γ: /dashboard/console uses new slot architecture. /dashboard/inbox/[tripId] still uses MetaInboxLive. Two implementations live in parallel for ~hours (acceptable transient duplication). Net LOC at this point is +~600.

### Phase B-δ — inbox migration + monolith delete (immediate follow-up PR)

11. **Migrate `/dashboard/inbox/[tripId]`** — convert to redirect: `redirect('/dashboard/console?tripId=' + tripId)`. Move `<TripLiveblocks>` mounting + `<TripComments>` aside into the console layout's tripId-scoped path. Verify Liveblocks room transitions cleanly.
12. **Delete `MetaInboxLive`** (`apps/app/components/console/meta-inbox-live.tsx`, 754 lines) and **`MetaInbox`** (`apps/app/components/console/meta-inbox.tsx`, 941 lines). Delete the `embedRail` prop machinery, the responsive CSS rules scoped to `data-embed-rail`, and the customer-panel inline render path.
13. **Delete `loadConsoleData`** (`apps/app/lib/console-data.ts`) — replaced by `loadConsoleTrips` (already shipped) + `loadFocusedTrip` (extracted in B-γ for `@conversation/page.tsx`).
14. **Run 14-flow QA matrix again** — same flows now exercise the new slot architecture for the scoped-trip route too.

End state of B-δ: ONE conversation implementation (the new slot-based one). Net LOC change vs pre-B-γ: -~1500 LOC (MetaInboxLive 754 + MetaInbox 941 - new slots ~600 = -1095 net) plus removal of console-data, embedRail machinery, etc.

### Acceptance criteria (both PRs)

- StrictMode dev double-mount: composer never enabled with stale bridge (Codex #1).
- HMR reload of `chat-bridge.ts`: `sendViaChat` failure shows toast, never silently drops a message (Codex #2).
- Resume effect: must use `cancelled` guard or AbortController (Codex #5).
- EventSource: must close on tripId change AND on host unmount (Codex #6).
- 14-flow QA matrix passes for both `/dashboard/console` (B-γ + B-δ) and `/dashboard/inbox/[tripId]` (B-δ).

Outside-voice round 1's "freeze + ship pricing benchmark" path was considered and rejected (2026-05-08). Outside-voice round 2's "duplication-not-split" critique forced the scope-up to B-δ — without monolith deletion, the maintainability framing collapses. With B-δ, net LOC reduction is the actual win.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | not run |
| Codex Review | `/codex consult` | Independent 2nd opinion | 2 | issues_found → fixes applied | Round 1 (Claude subagent fallback, codex CLI 0.93.0 was broken): REJECT verdict, 8 attacks, 4 technical fixes applied. Round 2 (real Codex CLI 0.129.0, gpt-5.5 high-effort, 806k tokens): SHIP-WITH-FIXES, 6 deeper findings — `hostReady` lifecycle binding (#1), HMR module-state mismatch (#2), state-graph-vs-impl-order contradiction (#3), duplication-not-split critique forced scope-up (#4), AbortController on resume (#5), EventSource cleanup acceptance criterion (#6). All 6 absorbed into plan; #4 expanded scope to a two-PR sequence (B-γ split, then B-δ migrate inbox/[tripId] + delete MetaInbox/MetaInboxLive). Net LOC ends at -1095 instead of +600. |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | CLEAR (PLAN) | 4 architecture decisions locked; 2 in-house critical UX gaps flagged for fix |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | not run |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | not run |

**CODEX:** two adversarial rounds. Round 2 (real CLI) found `hostReady` was a broken one-way flag, HMR can desync bridge from store, plan internally contradicted itself on bridge API, and the maintainability claim was undermined by NOT deleting the monolith. All four absorbed. Round 2 forced the two-PR scope (B-γ + B-δ) so the maintainability framing actually delivers (-1095 net LOC + monolith deletion).

**CROSS-MODEL:** Claude subagent (round 1) and Codex (round 2) overlapped on cold-load race + bridge surface YAGNI. Codex went deeper on lifecycle binding, HMR, plan internal consistency, and duplication framing. Both agreed the refactor is technically sound; both initially questioned strategic value. Strategic value is now grounded in net LOC reduction + single-implementation maintainability, not user-visible streaming.

**UNRESOLVED:** 0
**VERDICT:** ENG + OUTSIDE VOICE (TWO ROUNDS) CLEARED — ready to implement two-PR sequence (B-γ split, B-δ migrate-and-delete) with all 12 critical fixes applied across the plan.
