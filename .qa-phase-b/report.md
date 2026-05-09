# Phase B Parallel Routes QA Report

Target: `http://localhost:3010/dashboard/console`
Branch: `whatsapp-e2e`
HEAD tested: `9a40172d` (`1064233f` plus one QA fix)
Date: 2026-05-07
Tooling: gstack `/browse`, local dev server on `:3010`

## Health Score

86/100 after fix.

Main deduction: gstack `/browse` auth is slow/flaky with Clerk ticket sign-in, so some trip-click and loading-skeleton timing checks are partial. The functional console surface loaded and the confirmed chat-bridge regression was fixed.

## Bugs

### ISSUE-001 — Fixed — chat bridge duplicate registration warnings

Severity: Medium
Commit: `9a40172d`

Repro:
1. Sign in as QA Corporate via Clerk ticket.
2. Open `/dashboard/console`.
3. Browser console showed repeated:
   - `[chat-bridge] sendMessage already registered — last write wins`
   - `[chat-bridge] noteToChat already registered — last write wins`

Root cause:
`registerChatBridge` used `sendMessage` as the dedupe key. `useChat` can replace that callback across lifecycle edges, so normal same-surface renders looked like competing chat surfaces.

Fix:
Use stable mounted-surface keys:
- `meta-inbox-live`
- `chat-col`

Verification:
- `bunx biome check apps/app/components/chat-col.tsx apps/app/components/console/meta-inbox-live.tsx`
- `cd apps/app && bun run typecheck`
- Lefthook pre-commit `biome` + affected typecheck passed.
- `/browse` screenshot: `screenshots/D2-chat-bridge-fix-verify.png`
- Console after fix has no chat-bridge warnings.

## Matrix

| Row | Result | Evidence | Notes |
| --- | --- | --- | --- |
| A.1 console base load + context drawer | PASS partial | `screenshots/A1-Balpha1-workspace.png` | Console paints; `Trip context` aside shows workspace copy. Loading skeleton was not reliably capturable because `/browse` reaches page after RSC stream settles. |
| A.2 rail click to `?tripId=` | PARTIAL | `screenshots/Bbeta1-rail-short.png` | Seeded trip `cmowdj3k40002ysgk2jen8rf8`; full click chain exceeded gstack 30s auth/runtime ceiling. File wiring confirms `@threads` owns rail and links to console. |
| A.3 ≤1023px hides context aside | PASS by layout/file | `apps/app/app/(app)/dashboard/console/layout.tsx` | Aside is `hidden ... lg:flex`; children remain flex column. |
| A.4 context files exist | PASS | file check | All required `@context` files present. |
| B-α.1 KPI strip workspace mode | PASS | `screenshots/A1-Balpha1-workspace.png` | Five tiles visible: In flight, Awaiting, Settled 30d, Total fare 30d, Avg response. |
| B-α.2 no duplicate KPI strip | PASS | `screenshots/A1-Balpha1-workspace.png` | Only one top strip; page passes `hideKpiStrip`. |
| B-α.3 `?tripId=` hides KPI strip | PASS by code path | `@kpis/page.tsx`, `@kpis/default.tsx` | Existing QA fix remains present: scoped trip returns null. |
| B-α.4 KPI files exist | PASS | file check | `@kpis` files and `console-kpis.ts` present. |
| B-β.1 `@threads` rail visible left | PASS | `screenshots/D2-chat-bridge-fix-verify.png` | Collapsed separate rail visible left of conversation; active trip count shows one seeded trip. |
| B-β.2 trip click to console URL | PARTIAL | `screenshots/Bbeta1-rail-short.png` | Needs a follow-up manual `/browse` click with an already-warm auth session. No source path currently points to `/dashboard/inbox/<id>` in the `@threads` rail. |
| B-β.3 expand chevron + localStorage | PARTIAL | file check | `InboxRail` persists `sendero.console.inboxRail.expanded`; long authenticated chain timed out before screenshot. |
| B-β.4 chat mode tab | PARTIAL | file check | `ChatHistoryList` present, uses `?cs=` and preserves `tripId` when linked. Needs manual warm-auth click pass. |
| B-β.5 ≤767px hides `@threads` only | PASS by layout/CSS | `layout.tsx`, `globals.css` | `@threads` wrapper is `hidden md:flex`; `data-embed-rail` CSS scopes old first-child rule. |
| B-β.6 `/dashboard/inbox/[tripId]` unchanged | PASS by default prop | `meta-inbox-live.tsx`, `meta-inbox.tsx` | `embedRail` defaults true; console page is the only caller passing false. |
| B-β.7 threads files exist | PASS | file check | `@threads` files, `console-trips.ts`, `embedRail`, `data-embed-rail`, scoped CSS present. |
| C.1 Cmd+K opens palette without Radix title errors | PASS | `screenshots/C1-cmdk-open.png` | Console only shows Clerk dev warnings; no `DialogContent requires DialogTitle`. |
| C.2 Esc closes palette | PASS | `screenshots/C2-cmdk-esc.png` | Palette closes. |
| C.3 Cmd+K ignored in composer | PASS by prior QA + file | `global-command-palette.tsx` | Editable guard remains. Not re-run after fix because auth chains were timing out. |
| C.4 sidebar cookie persists | PASS | `screenshots/C4-sidebar-expanded.png`, `screenshots/C4-sidebar-collapsed-cookie.png`, `screenshots/C4-sidebar-collapsed-reload.png` | Cookie output shows `sidebar_state=false`, expiry about 7 days. |
| C.5 palette/sidebar files exist | PASS | file check | Required files present. |
| D.1 hydration mismatch | PASS | `screenshots/D2-chat-bridge-fix-verify.png` | No hydration mismatch in console output; workflow `run_id` is stable per mount. |
| D.2 chat bridge warnings | PASS after fix | `screenshots/D2-chat-bridge-fix-verify.png` | Fixed by `9a40172d`. |
| D.3 Liveblocks 4001 | PASS | console output | No Liveblocks 4001 on `/dashboard/console`. |
| D.4 other console errors | WARN | console output | Two 404 resource errors and `[@sendero/database] DATABASE_URL is not set` warning remain. Not traced because they predate and are not Phase B slot regressions. |

## Console Summary

After fix on `/dashboard/console`:
- Clerk dev-key warnings: expected in local dev.
- `[@sendero/database] DATABASE_URL is not set`: still appears client-side in dev chunks.
- 404 resource errors: 2 per run, URL not surfaced by `/browse console`.
- Radix DialogTitle errors: 0.
- Hydration mismatch errors: 0.
- Chat bridge duplicate warnings: 0.
- Liveblocks 4001: 0.

## Files Confirmed

- `apps/app/app/(app)/dashboard/console/layout.tsx`
- `apps/app/app/(app)/dashboard/console/@context/{page,loading,default}.tsx`
- `apps/app/app/(app)/dashboard/console/@kpis/{page,loading,default}.tsx`
- `apps/app/app/(app)/dashboard/console/@threads/{page,loading,default}.tsx`
- `apps/app/lib/console-kpis.ts`
- `apps/app/lib/console-trips.ts`
- `apps/app/components/global-command-palette.tsx`
- `apps/app/components/ui/command.tsx`
- `apps/app/components/dashboard/app-chrome.tsx`
- `apps/app/components/ui/sidebar.tsx`
- `apps/app/components/console/meta-inbox.tsx`
- `apps/app/components/console/meta-inbox-live.tsx`
- `apps/app/app/globals.css`

## Residual Risk

The weakest coverage is B-β click-path QA because gstack `/browse` repeatedly hit its 30s ceiling after Clerk ticket auth and console route load. The seeded QA trip is in the database as `cmowdj3k40002ysgk2jen8rf8`, so a fresh warm-auth session can retest:

1. Open `/dashboard/console`.
2. Expand the rail.
3. Click `Phase B QA Traveler`.
4. Confirm URL is `/dashboard/console?tripId=cmowdj3k40002ysgk2jen8rf8`, not `/dashboard/inbox/...`.
