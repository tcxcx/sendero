# Slack Setup

End-to-end checklist for installing Sendero into a Slack workspace, wiring the Events API, and shipping thread continuity. Run through this once per environment (dev / preview / prod). Captures every tripwire we hit on the first install so you don't hit them again.

App ID for the production Slack app (Sendero Demo): `A0AVA8ZER8S`.
All admin URLs below assume this app — swap the ID for staging/dev Slack apps.

---

## 1. Create the Slack app (one-time per environment)

1. https://api.slack.com/apps → **Create New App** → **From scratch**.
2. Name + workspace.
3. Note the **App ID** (top of Basic Information). It goes in every URL below.

---

## 2. Display Information (Basic Information page)

https://api.slack.com/apps/A0AVA8ZER8S/general

Use the canonical copy:

| Field | Value |
|---|---|
| App name | `Sendero (Demo)` |
| Short description | `Sendero AI Travel Agent Corporate Assistance` |
| Background color | `#e65632` (Sendero vermillion) |
| App icon | `apps/app/public/brand/logo-masters/clean/sendero_icon_vermilion_clean_2048.png` |

**Long description** (paste into the Long description field):

> Sendero is an AI travel agent built for corporate travel teams. Mention `@Sendero` in any channel where the bot is a member, or DM it directly, and ask for what you need.
>
> What it does in Slack:
> - Books real flights and stays through first-party suppliers. Replies inside the thread with confirmation, PNR, and a settlement card.
> - Routes spend through your travel policy, with cap warnings posted to the channel before approvals are needed.
> - Handles full trip lifecycle in one thread: change a date, cancel, refund, send the traveler an invoice — same conversation, no context handoff.
> - Posts settlement events when a booking moves on-chain. Optional: configurable per-channel routing for trip events, settlements, escalations, and cap warnings.
> - Speaks the traveler's language. The bot replies in whatever language the user writes in.
>
> Built on Sendero's tool registry (90+ canonical tools: search, book, hold, settle, refund, escrow, treasury). Every tool call is metered as a nanopayment so finance can audit per-call spend without a separate billing surface.
>
> Sendero installs the bot only with the scopes it actually needs and never reads channels it isn't a member of. See https://app.sendero.travel/docs/security for the full trust boundary.

Save changes.

---

## 3. OAuth & Permissions (scopes)

https://api.slack.com/apps/A0AVA8ZER8S/oauth-permissions

Under **Bot Token Scopes**, add:

```
app_mentions:read
chat:write
chat:write.public
commands
im:history
im:read
im:write
groups:history
groups:read
channels:history
channels:read
channels:join
users:read
users:read.email
reactions:write
files:read
```

These match `DEFAULT_BOT_SCOPES` in `packages/slack/src/oauth.ts`. If any are missing the corresponding feature breaks silently — `app_mentions:read` is the one that bit us first (no scope → Slack drops `app_mention` events on the floor with no error).

**Redirect URLs** (under the same page):

| Environment | Redirect URL |
|---|---|
| Production | `https://app.sendero.travel/api/webhooks/slack/oauth-callback` |
| Preview | branch alias, e.g. `https://sendero-arc-web-git-<branch>-tcxcxs-projects.vercel.app/api/webhooks/slack/oauth-callback` |
| Development | `http://localhost:3010/api/webhooks/slack/oauth-callback` (only useful for local OAuth dev) |

Save URLs.

---

## 4. Event Subscriptions

https://api.slack.com/apps/A0AVA8ZER8S/event-subscriptions

**Enable Events** → ON.

**Request URL**:

```
https://app.sendero.travel/api/webhooks/slack/events
```

Hit save. Slack POSTs a signed `url_verification` challenge — your endpoint replies with the challenge string and Slack flips the box to a green check. If it stays red:

- **DNS NXDOMAIN** ("Your URL didn't respond") → wrong domain. The canonical TLD is `.travel`, so it's `app.sendero.travel`, not `app.travel.sendero`. We typo'd this once.
- **HTTP 503 from a real domain** → `SLACK_SIGNING_SECRET` is unset in the deployed env. Push it via Vercel CLI (see §7) and redeploy.
- **HTTP 401** → signing secret is set but doesn't match what Slack signed with. Most likely cause: env was added but the deploy hasn't propagated yet. Wait 60s and retry.

**Subscribe to bot events** — add all three:

| Event | Required scope | Why |
|---|---|---|
| `app_mention` | `app_mentions:read` | Direct @-mentions in any channel where the bot is a member. |
| `message.im` | `im:history` | DMs to the bot. |
| `message.channels` | `channels:history` | Thread continuity — follow-ups in a thread the bot is engaged in, without re-mention. |

Save Changes.

If a yellow banner appears (*"You've changed the permission scopes your app uses. Please reinstall…"*), go to §6.

---

## 5. App Home / Slash Commands (optional but nice)

https://api.slack.com/apps/A0AVA8ZER8S/app-home

- **Messages Tab** → ON, **Allow users to send Slash commands and messages** → ON.
- (Optional) Add a `/sendero` slash command that opens the App Home tab.

---

## 6. Install / reinstall to workspace

https://api.slack.com/apps/A0AVA8ZER8S/install-on-team

- **Install to Workspace** (first time) → approve scopes → Slack returns OAuth code → our `apps/app/app/api/webhooks/slack/oauth-callback/route.ts` writes the `SlackInstall` row.
- **Reinstall to Workspace** (after adding scopes) → required whenever Bot Token Scopes change. Existing channel memberships and history persist; only the bot token rotates. New scopes take effect immediately.

---

## 7. Vercel environment variables

Five envs must exist in every environment the bot runs against (Production at minimum):

```
SLACK_SIGNING_SECRET     # Basic Information → Signing Secret
SLACK_CLIENT_ID          # Basic Information → Client ID
SLACK_CLIENT_SECRET      # Basic Information → Client Secret
SLACK_STATE_SECRET       # Random 32-byte hex; falls back to CLERK_SECRET_KEY if unset
SLACK_REDIRECT_URI       # Must exactly match the URL in §3, including trailing path
```

CLI push (run from repo root, project linked to `sendero-arc-web`):

```bash
for KEY in SLACK_SIGNING_SECRET SLACK_CLIENT_ID SLACK_CLIENT_SECRET SLACK_STATE_SECRET SLACK_REDIRECT_URI; do
  VAL=$(grep "^${KEY}=" .env.local | head -1 | cut -d'=' -f2-)
  printf '%s' "$VAL" | vercel env add "$KEY" production --force
done
```

Then redeploy so the new envs take effect (Vercel does NOT hot-reload env on existing deployments):

```bash
vercel --prod --yes
```

⚠️ `SLACK_REDIRECT_URI` in `.env.local` is set to `localhost:3010` for local dev. Overwrite the production copy to the prod URL after the bulk push:

```bash
printf '%s' "https://app.sendero.travel/api/webhooks/slack/oauth-callback" \
  | vercel env add SLACK_REDIRECT_URI production --force
```

---

## 8. Verify the wiring end-to-end

```bash
# 1. URL verification round-trip with a properly-signed request.
SECRET=$(grep "^SLACK_SIGNING_SECRET=" .env.local | head -1 | cut -d'=' -f2-)
TS=$(date +%s)
BODY='{"type":"url_verification","challenge":"setup-probe","token":"x"}'
SIG="v0=$(printf 'v0:%s:%s' "$TS" "$BODY" | openssl dgst -sha256 -hmac "$SECRET" | sed 's/^.* //')"
curl -sS -w "\nHTTP %{http_code}\n" \
  -H "content-type: application/json" \
  -H "x-slack-request-timestamp: $TS" \
  -H "x-slack-signature: $SIG" \
  -d "$BODY" \
  https://app.sendero.travel/api/webhooks/slack/events
# Expect: {"challenge":"setup-probe"}  HTTP 200

# 2. Mention the bot in a channel it's a member of: `@Sendero are you there?`
# Bot replies inside the thread within ~30s. If silent:

# 3. Tail prod logs for diagnosis
vercel logs https://app.sendero.travel --follow -j 2>&1 \
  | grep -E "slack/events|inbound|skip non-agent|fallback"
```

---

## 9. Add the bot to channels

The setup wizard at `/dashboard/channels/slack/connect` runs `slack_invite_bot_to_channels` for each routed channel. It uses `conversations.join` (works on public channels with `channels:join` scope, no human required). For **private channels**, Slack does not let bots add themselves — a human member of the channel must run `/invite @Sendero` from inside it.

When the wizard surfaces "manual /invite" status next to a private channel:

- Click **Open** to deep-link into Slack desktop, OR
- Click **Copy /invite** and paste it into the channel.

---

## 10. Common failures & fixes

| Symptom | Root cause | Fix |
|---|---|---|
| Bot installs but never replies to `@Sendero` | `app_mentions:read` not in granted scope | Add scope to dashboard, save events, reinstall. |
| Bot replies to mentions but not thread follow-ups | `message.channels` not subscribed OR thread-engagement filter not deployed | Add `message.channels` event in §4; verify route filter logic. |
| URL verification fails with "Your URL didn't respond" | DNS — wrong domain | Use `app.sendero.travel` (TLD is `.travel`). |
| URL verification fails with HTTP 503 in logs | `SLACK_SIGNING_SECRET` unset in env | Push via §7 + redeploy. |
| URL verification 401 right after env push | Signing secret correct, deploy still propagating | Wait 60s, click Retry on the dashboard. |
| Bot replies once then silently drops | Agent turn timing out (>60s) on a heavy tool call | Increase `maxDuration` in the events route, or check Duffel/policy gateway latency. |
| `@-mention` works but the wizard shows "Bot has not joined any channels" | `slack_invite_bot_to_channels` didn't run, OR `conversations.join` returned `is_private` for every target | Run wizard step 4 again; for private channels run `/invite @Sendero` manually. |
| Slack interactions (block-kit buttons) fail with 401 | Signing secret rotated in Slack but not pushed to Vercel | Re-pull from Slack → push via §7 → redeploy. |

---

## 11. Architecture references

- Events route: `apps/app/app/api/webhooks/slack/events/route.ts`
- Interactions route: `apps/app/app/api/webhooks/slack/interactions/route.ts`
- OAuth callback: `apps/app/app/api/webhooks/slack/oauth-callback/route.ts`
- Agent loop: `apps/app/lib/slack-agent.ts`
- OAuth helpers + scopes: `packages/slack/src/oauth.ts`
- Channel-provisioning tools: `packages/tools/src/slack-channel.ts`
- Setup wizard panes: `apps/app/components/channels/setup-wizard/slack-panes.tsx`
- Connected dashboard panel: `apps/app/components/channels/slack-connected-panel.tsx`
- User mapping (Slack user → Sendero User): `apps/app/lib/slack-user-mapping.ts`

CLAUDE.md sections that cover deeper invariants:
- Slack OAuth state HMAC contract
- Slack webhook routes & after() defer
- Slack user mapping + auto-provision

---

## 12. AI-first install (MCP)

Some clients run their travel ops inside Claude Desktop, Claude Code, Codex, or
Cursor rather than Slack. Sendero's tool surface is exposed as an MCP server at
`/api/mcp`. Every call requires `Authorization: Bearer ak_…` — mint a production
API key at `/dashboard/settings/api-keys` first, then paste it into your client's
MCP config.

Public origin: `https://app.sendero.travel`. MCP endpoint: `https://app.sendero.travel/api/mcp`.

**Claude Code:**

```sh
claude mcp add sendero \
  --transport http \
  --url https://app.sendero.travel/api/mcp \
  --header "Authorization: Bearer ak_..."
```

Then in chat: `Use Sendero to search flights from BUE to SFO on May 15.`

**Codex CLI** — `~/.codex/config.toml`:

```toml
[mcp_servers.sendero]
url = "https://app.sendero.travel/api/mcp"
headers = { Authorization = "Bearer ak_..." }
```

**Cursor / Windsurf / IDE** — `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "sendero": {
      "url": "https://app.sendero.travel/api/mcp",
      "headers": {
        "Authorization": "Bearer ak_..."
      }
    }
  }
}
```

**Claude Desktop** — `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "sendero": {
      "type": "http",
      "url": "https://app.sendero.travel/api/mcp",
      "headers": { "Authorization": "Bearer ak_..." }
    }
  }
}
```

The dashboard renders the same snippets with one-click copy buttons in two places:
`/dashboard/channels/slack` (Share install URL tab) and `/dashboard/integrations/mcp`
(operator self-setup).

---

## 13. Future work (tracked in TODO.md P2)

- Bot avatar from Slack app config (multi-tenant: `users.profile:write` scope + `users.setPhoto` on install).
- Slack connected panel — Activity tab with recent events, scope/membership banners, and dev-mode raw-payload drill-down. See `~/.gstack/projects/tcxcx-sendero/ship-2026-04-24-platform-release-channel-activity-panel-plan-*.md` for the full plan.
- Generalized approval card for `needsApproval`-gated Slack tools (today's approval flow is trip/booking-shaped only).
