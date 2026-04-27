# Slack Public Install URL — End-to-End Test Checklist

Walk through this exact sequence to verify Stage 1 of the multi-tenant channel platform using **your existing workspace** (no throwaway needed). The flow is: disconnect existing install → reinstall via the public URL → confirm round-trip → exercise per-channel disconnect/reconnect.

**Pre-reqs:**
- Be signed into Sendero in your normal browser, with admin access to your tenant org
- The Slack workspace where Sendero is currently installed
- Access to the email inbox of your Sendero org's primary admin (for the install-confirmation email check)
- ~10 minutes

---

## Phase 0 — Snapshot before anything changes

Confirm the current state so you have a baseline.

- [ ] **0.1** Open `https://app.sendero.travel/dashboard/channels/slack`
- [ ] **0.2** Note: which workspace is connected, how many channels are routed, which channels they are. Screenshot if you want a visual diff.
- [ ] **0.3** In your Slack workspace, confirm `@Sendero hello` in any joined channel — bot replies. (This is your "before" proof.)

---

## Phase 1 — Workspace disconnect

You're going to fully disconnect the bot from Slack so you can reinstall via the public URL.

- [ ] **1.1** On `/dashboard/channels/slack`, scroll to the connected panel (below the "Public install URL" share card). Find the **"Disconnect workspace"** button at the top-right of the panel header.
- [ ] **1.2** Click **"Disconnect workspace"** — a vermillion confirm bar appears: *"Uninstall Sendero from [workspace]?"*
- [ ] **1.3** Click **Confirm**. Within ~2 seconds the panel disappears and the page shows the disconnected state with the install card still visible at top.
- [ ] **1.4** **Verify Slack-side**: open Slack → workspace settings → **Manage apps**. Sendero should no longer appear in the installed apps list. (If it does, click into it and use Slack's "Remove app" button — `auth.revoke` should have done this; manual cleanup is the fallback.)
- [ ] **1.5** In any channel where the bot was a member, type `@Sendero` — Slack autocomplete will not find it any more. The token is dead.

---

## Phase 2 — Reinstall via the public URL (operator side)

You're now going to reinstall Sendero into the same workspace, but through the public install URL flow — proving the URL works end-to-end with a real install.

- [ ] **2.1** On `/dashboard/channels/slack`, the **"Public install URL"** card is at the top. Click **Preview ↗** to open `/install/slack?tenant=<your-slug>` in a new tab.
- [ ] **2.2** Verify the install page renders with: Sendero icon, "Add Sendero to your Slack" headline, "Operated for your team by **[Your tenant]**" attribution, scope-preview list, 3-step "What happens next" preview, big purple "Add to Slack" button.

---

## Phase 3 — OAuth + reinstall (Persona C side, simulated as you)

Stay on the install page tab.

- [ ] **3.1** Click **"Add to Slack"** — Slack OAuth screen loads.
- [ ] **3.2** Pick the SAME workspace you disconnected from in Phase 1.
- [ ] **3.3** Slack shows the scope-grant screen. Click **Allow**.
- [ ] **3.4** Land on `/install/slack/success?tenant=<your-slug>&team=<workspace>` — green ✓, "Sendero is installed in [workspace]", tenant attribution, "Try it now" steps.
- [ ] **3.5** **Within ~30 seconds**, the install confirmation email lands in your tenant admin inbox. Subject: *"New Slack install: [workspace]"*. Check spam if it's not in inbox.

---

## Phase 4 — Confirm Slack-side reinstall

- [ ] **4.1** In Slack, **Manage apps** → Sendero appears again under installed.
- [ ] **4.2** In any channel, type `@Sendero` — autocomplete finds it now.
- [ ] **4.3** If the channel doesn't have the bot yet, run `/invite @Sendero`.
- [ ] **4.4** Type `@Sendero hello` — bot replies in the thread within 30s.

---

## Phase 5 — Dashboard reflects the reinstall

- [ ] **5.1** Return to `/dashboard/channels/slack`. **Refresh.**
- [ ] **5.2** The connected panel now shows your reinstalled workspace, fresh `installedAt`, fresh routing (empty until you add channels via the wizard).
- [ ] **5.3** Confirm the **Public install URL** card is unchanged (URL stays the same, tenant slug doesn't rotate).

---

## Phase 6 — Per-channel disconnect

You'll exercise the per-channel leave flow so you know channel-level state can be managed.

- [ ] **6.1** First, get a channel routed: open the wizard via **Add channel** (top right of connected panel) OR run the existing `/dashboard/channels/slack/connect` flow if you haven't yet. Add at least one channel to routing.
- [ ] **6.2** Back on `/dashboard/channels/slack`, in the connected panel header find **"Manage individual channels ▾"** (under the Disconnect workspace button). Click to expand.
- [ ] **6.3** Each routed channel shows a row with the channel ID + a **Leave** button.
- [ ] **6.4** Click **Leave** on a test channel. Within ~2 seconds: button shows "Leaving…", then the row disappears.
- [ ] **6.5** **Verify Slack-side**: in the channel, the bot is no longer a member (Slack shows "[Sendero] left #channel"). Type `@Sendero` — autocomplete still finds the bot (it's in the workspace, just not the channel).
- [ ] **6.6** **Verify routing-side**: refresh the dashboard. The routing table no longer lists that channel.

---

## Phase 7 — Per-channel reconnect

- [ ] **7.1** In the Slack channel you left in Phase 6, run `/invite @Sendero`. Bot rejoins.
- [ ] **7.2** On the dashboard, click **Add channel** (top right of connected panel). The wizard launches.
- [ ] **7.3** Walk through the wizard — pick the same channel + a routing mode, save.
- [ ] **7.4** Back on the dashboard, refresh — the channel reappears in the routing table.
- [ ] **7.5** In Slack, `@Sendero hello` in that channel — bot replies. Round-trip closed.

---

## Phase 8 — Cleanup (optional)

If you want to leave your workspace in the same state as Phase 0:

- [ ] **8.1** If routing differs from your snapshot in step 0.2, walk the wizard to restore.
- [ ] **8.2** No need to disconnect/reconnect again — Phase 4 left you with a fresh, fully working install.

---

## If something breaks

Paste the failing step + this output:

```bash
vercel logs https://app.sendero.travel --follow -j 2>&1 \
  | grep -E "slack/oauth|slack-install-email|install/slack|disconnect|conversations" \
  | head -20
```

### Common failures and fixes

| Failing step | Likely cause | Fix |
|---|---|---|
| **1.2** (no Disconnect button visible) | Deploy lag; old SlackConnectedPanel still serving | `curl -sI https://app.sendero.travel/dashboard/channels/slack` and check `x-vercel-id` header references the latest deploy from `vercel ls --prod` |
| **1.3** (Disconnect fails) | Slack token expired or `auth.revoke` rate-limited | Endpoint is best-effort — if Slack-side errored but DB row was deleted, manual remove via Slack workspace settings → Manage apps |
| **2.1** (install URL card missing) | Tenant slug missing or page bug | Open `/dashboard/settings/org`; confirm tenant has a slug. If missing, set one in Clerk org settings |
| **3.4** (success page 500/JSON error) | OAuth state HMAC verify failed (env mismatch) | `vercel env ls production | grep SLACK_STATE_SECRET` — must match `.env.local` |
| **3.5** (no email) | `RESEND_API_KEY` or `SENDERO_EMAIL_FROM` unset | `vercel env ls production | grep -E "RESEND|SENDERO_EMAIL"` |
| **4.4** (no @-reply) | Scope or event subscription issue | See `docs/slack.md` § "Common failures & fixes" |
| **6.4** (Leave returns error) | Private channel — Slack doesn't let bots `conversations.leave` private channels they were invited to | Workaround: kick the bot from inside Slack via the channel's member list |
| **6.4** (Leave succeeds but channel still appears) | `router.refresh()` didn't fire client-side | Hard refresh the page (Cmd+Shift+R) |

---

## What this exercise proves

- ✅ **Workspace reinstall via public URL** — same workspace, fresh OAuth, all current scopes granted
- ✅ **Tenant attribution preserved** — install bound to your tenant via state HMAC, even though Persona C flow is unauthenticated
- ✅ **Channel-level lifecycle** — bot membership and routing JSON stay in sync; UI never lies about which channels are connected
- ✅ **Email loop closes** — operator gets notified on every install (your own reinstall counts; in production this is the new-customer signal)

---

## Deferred (flag if you want them)

- "Reconnect channel" inline button (currently you re-add via the wizard — fast, but two clicks instead of one)
- Bulk-disconnect / bulk-leave for tenants managing 50+ channels
- Soft-delete on disconnect (`SlackInstall.disconnectedAt` column) so audit history survives reinstall — Stage 2 schema migration
- Per-channel routing-mode toggle (route ↔ silent ↔ filter) without leaving the panel — currently lives in the wizard only
- Notification when a customer-side admin removes the bot from THEIR end (Slack `app_uninstalled` webhook → mark our row stale)

Run the 8 phases. Tell me which step fails.
