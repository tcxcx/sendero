# ISSUE-001 — chat bridge duplicate registration warnings

Files:
- `apps/app/components/console/meta-inbox-live.tsx`
- `apps/app/components/chat-col.tsx`

What broke:
`registerChatBridge` and `registerChatNote` used the hook callback identity as the dedupe key. On `/dashboard/console`, `useChat` can replace `sendMessage` across lifecycle edges, so normal same-surface renders looked like competing chat surfaces and re-emitted the dev warnings.

Change:
Use stable mounted-surface keys: `meta-inbox-live` for the console client island and `chat-col` for the app shell chat surface. The bridge still replaces the current closure every render, but warnings now only fire when two different surfaces compete.

Why:
This preserves the original safety signal for true duplicate mounts while removing false-positive warnings during normal console renders.

Verification:
- `/browse` authenticated load of `/dashboard/console`
- Screenshot: `.qa-phase-b/screenshots/D2-chat-bridge-fix-verify.png`
- Console no longer contains `[chat-bridge] sendMessage already registered` or `[chat-bridge] noteToChat already registered`
