---
name: slack-monitor
description: Arm a live `Monitor` against Slack agent turns so a dogfood session surfaces every inbound + outbound to chat in real time. Use when the user says "/slack-monitor", "monitor slack", "watch slack agent", "tail slack turns", or wants a live event stream while testing a real Slack agent flow. Polls Postgres `meter_events` filtered by `metadata->>'channel'='slack'` (every Slack agent turn writes one), tails dev-server stdout for `[slack/events]` + `[slack.agent]` log prefixes, plus optionally Langfuse traces for full tool sequence. Picks the right tap per question.
---

# Slack / Agent Monitor

## Why this exists

Sendero's Slack flow now has a durable audit path that mirrors the WhatsApp/Kapso operator posture. Use the database audit tables first, then fall back to dev stdout or Langfuse when you need lower-level runtime detail.

| Signal | Source | Granularity |
|---|---|---|
| **Webhook delivery row** | `slack_webhook_events` | Every Slack Events API delivery: dispatch/skipped/duplicate/busy/revoked/error |
| **Agent/tool timeline row** | `slack_agent_events` | Turn lifecycle + tool start/finish/failure/slow + outbound post status |
| **Per-turn meter row** | `meter_events` rows where `metadata->>'channel' = 'slack'` | One row per agent turn (`chat_reply`) |
| **Webhook router logs** | dev-server stdout, prefix `[slack/events]` | Every inbound event ack/dedup decision |
| **Agent turn logs** | dev-server stdout, prefix `[slack.agent]` | Placeholder post, step update, fallback, gateway retries |
| **Langfuse trace** | `agentType=sendero-slack` | **Full tool sequence + step-by-step latency + errors** — richest source |
| **Slack DB tables** | `slack_installs`, `slack_user_bindings` | Install status, user → Sendero binding cache |

**Default trap #1:** `meter_events.metadata` for Slack is **minimal** (`turnId`, `channel`, `idempotencyKey` only). It does NOT contain the tool trail. Use `slack_agent_events` for tool sequence.

**Default trap #2:** Slack still does not have a separate `slack_outbound_messages` table. Outbound success/failure is synthesized inside `slack_agent_events` (`outbound_posted`, `outbound_failed`, `placeholder_failed`, `step_update`).

**Default trap #3:** Slack's webhook ack must respond in ≤3s, so the heavy work runs after `after()`. A delivery row with `dispatch_status='dispatched'` but no matching `slack_agent_events` means the failure happened after the 200 ack and before/inside `runSlackAgentTurn`.

## System requirements (pre-flight)

```bash
# 1. psql
ls /opt/homebrew/opt/libpq/bin/psql 2>/dev/null \
  || command -v psql >/dev/null \
  || echo "MISSING psql -> brew install libpq"

# 2. DATABASE_URL set
grep -c '^DATABASE_URL=' /Users/criptopoeta/coding-dojo/sendero/.env.local

# 3. Dev server running on :3010 (or wherever apps/app is)
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3010/api/health --max-time 5

# 4. SLACK_BOT_TOKEN + SLACK_SIGNING_SECRET in env
grep -cE '^(SLACK_BOT_TOKEN|SLACK_SIGNING_SECRET|SLACK_CHANNEL_ID)=' /Users/criptopoeta/coding-dojo/sendero/.env.local

# 5. ngrok / public webhook URL — Slack must reach Sendero from the internet.
#    Sendero's stable tunnel is sendero-dev-bufi.ngrok.app on inspector :4041.
curl -s http://127.0.0.1:4041/api/tunnels 2>/dev/null \
  | jq -r '.tunnels[]?.public_url' 2>/dev/null
# expected: https://sendero-dev-bufi.ngrok.app
```

If any of 1–5 fails, **tell the user the exact one-liner fix** and stop. Slack webhook delivery requires a public URL; a missing ngrok = silent inbound.

## Slack-specific pre-flight

```bash
# Active Slack installs for this DB
psql "$DATABASE_URL" -At -F'|' -c "SELECT \"tenantId\", \"teamId\", \"botUserId\", \"appId\", coalesce(revoked_at::text,'-') FROM slack_installs WHERE revoked_at IS NULL;"

# Bindings cache size — empty cache = first inbound is slow
psql "$DATABASE_URL" -At -c "SELECT count(*) FROM slack_user_bindings;"

# Latest 5 Slack turns (any tenant)
psql "$DATABASE_URL" -At -F'|' -c "
SELECT to_char(at,'MM-DD HH24:MI:SS'), coalesce(metadata->>'turnId','-'), status, \"tenantId\"
FROM meter_events
WHERE metadata->>'channel' = 'slack'
ORDER BY at DESC LIMIT 5;"
```

If installs is **empty** → no tenant has Slack wired. Run `bun scripts/register-slack-app.ts` or have a tenant complete the OAuth flow.

If `revoked_at IS NOT NULL` for the tenant under test → Slack uninstalled the app. Reinstall via `/install/slack?tenant=<slug>`.

## Monitors

Most dogfood sessions need 2–3 of these armed simultaneously.

### Monitor 1 — canonical Slack audit stream

Primary live monitor. This shows inbound routing and the agent/tool timeline with a shared `trace_id`.

```bash
export PATH="/opt/homebrew/opt/libpq/bin:$PATH"
DATABASE_URL=$(grep -E '^DATABASE_URL=' /Users/criptopoeta/coding-dojo/sendero/.env.local | head -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//')
[ -z "$DATABASE_URL" ] && { echo "ERR: DATABASE_URL missing"; exit 1; }
SINCE=$(date -u +%Y-%m-%dT%H:%M:%S)
echo "ARMED slack audit>=$SINCE"
while true; do
  WEBHOOKS=$(psql "$DATABASE_URL" -At -F '|' -c "
    SELECT to_char(received_at AT TIME ZONE 'UTC','HH24:MI:SS'),
           coalesce(trace_id,'-'),
           dispatch_status,
           coalesce(event_type,'-'),
           coalesce(channel_id,'-'),
           coalesce(thread_ts,'-'),
           left(coalesce(dispatch_error,'-'),120)
      FROM slack_webhook_events
     WHERE received_at > '${SINCE}'::timestamptz
     ORDER BY received_at ASC LIMIT 50;" 2>/dev/null || true)
  [ -n "$WEBHOOKS" ] && while IFS='|' read -r t trace status type channel thread err; do
    [ -z "$t" ] && continue
    echo "$t  webhook trace=${trace:0:12} status=$status type=$type channel=$channel thread=$thread err=$err"
  done <<< "$WEBHOOKS"

  AGENT=$(psql "$DATABASE_URL" -At -F '|' -c "
    SELECT to_char(created_at AT TIME ZONE 'UTC','HH24:MI:SS'),
           coalesce(trace_id,'-'),
           sequence,
           kind,
           coalesce(tool_name,'-'),
           coalesce(ok::text,'-'),
           coalesce(duration_ms::text,'-'),
           left(coalesce(status_text,error_message,'-'),160)
      FROM slack_agent_events
     WHERE created_at > '${SINCE}'::timestamptz
     ORDER BY created_at ASC, sequence ASC LIMIT 100;" 2>/dev/null || true)
  [ -n "$AGENT" ] && while IFS='|' read -r t trace seq kind tool ok ms status; do
    [ -z "$t" ] && continue
    echo "$t  agent trace=${trace:0:12} #$seq kind=$kind tool=$tool ok=$ok ms=$ms $status"
  done <<< "$AGENT"

  [ -n "$WEBHOOKS$AGENT" ] && SINCE=$(date -u +%Y-%m-%dT%H:%M:%S)
  sleep 2
done
```

### Monitor 2 — `meter_events` filtered by `channel=slack`

One row per completed Slack turn. Tells you *that* a turn happened, not *what* tools ran.

```bash
export PATH="/opt/homebrew/opt/libpq/bin:$PATH"
DATABASE_URL=$(grep -E '^DATABASE_URL=' /Users/criptopoeta/coding-dojo/sendero/.env.local | head -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//')
[ -z "$DATABASE_URL" ] && { echo "ERR: DATABASE_URL missing"; exit 1; }
SINCE=$(date -u +%Y-%m-%dT%H:%M:%S)
echo "ARMED slack meter_events>=$SINCE"
while true; do
  ROWS=$(psql "$DATABASE_URL" -At -F '|' -c "
    SELECT to_char(at AT TIME ZONE 'UTC','HH24:MI:SS'),
           coalesce(metadata->>'turnId','-'),
           \"toolName\",
           status,
           left(coalesce(\"tenantId\",'-'),12)
      FROM meter_events
     WHERE at > '${SINCE}'::timestamp
       AND metadata->>'channel' = 'slack'
     ORDER BY at ASC LIMIT 50;" 2>/dev/null || true)
  if [ -n "$ROWS" ]; then
    while IFS='|' read -r t turn tool stat tenant; do
      [ -z "$t" ] && continue
      echo "$t  turn=${turn}  tool=${tool}  status=${stat}  tenant=${tenant:0:12}"
    done <<< "$ROWS"
    SINCE=$(date -u +%Y-%m-%dT%H:%M:%S)
  fi
  sleep 3
done
```

### Monitor 3 — dev-server stdout

Tails the apps/app dev process for Slack-related log prefixes. **You CANNOT tail another terminal's stdout from here.** Two options:

**Option A — restart the dev server with stdout redirect (clean but disruptive):**
```bash
# Ask the user to do this, OR (with explicit permission):
pkill -f "next dev -p 3010"
cd /Users/criptopoeta/coding-dojo/sendero/apps/app
nohup bun run dev > /tmp/sendero-app-dev.log 2>&1 &
# Then: tail -f /tmp/sendero-app-dev.log | grep -E '\[slack' …
```

**Option B — instrument via SQL by reading what Sendero already logs to its own tables.** Sendero does NOT yet write Slack inbound to a table; option A is the only stdout source. If the user is unwilling to restart the dev server, fall back to Monitor 1 + Monitor 3.

```bash
# Filtered tail — only Slack lines, line-buffered for monitor delivery
tail -F /tmp/sendero-app-dev.log 2>/dev/null \
  | grep --line-buffered -E "\[slack/events\]|\[slack\.agent\]|\[slack-dedup-lock\]|runSlackAgentTurn|Insufficient SOL|Bolt"
```

**Failure signatures to watch for:**
- `[slack/events] runSlackAgentTurn failed` — top-level turn crash
- `[slack/events] fallback post failed` — agent text reply couldn't reach Slack
- `[slack.agent] placeholder post failed` — initial "Working on it…" placeholder couldn't post
- `[slack.agent] chat.update on placeholder failed` — step-streaming edit was rejected (Slack rate limit, retracted message, or scope issue)
- `[slack.agent] share-card render failed` — share image build threw
- `[slack.agent] gateway failed; retrying direct provider` — AI gateway hiccup; retry kicks in
- `[slack-dedup-lock] dedup check failed, failing open` — Redis dedup down; expect double-fires

### Monitor 4 — Langfuse traces (richest by far if available)

Every Slack agent turn wraps in `traceAgent('sendero-slack', metadata, fn)` and writes to Langfuse. Tools, latency, and errors are all there.

```bash
# If LANGFUSE_MCP_AUTH is set, the Langfuse MCP server (registered in .mcp.json)
# exposes trace search. From this skill, link the user to:
#   https://us.cloud.langfuse.com/project/<project-id>/traces?filters=name%3Dsendero-slack
# Filter by trace.name = "sendero-slack" and sort by createdAt desc.
#
# For a stuck turn: search by turnId in the metadata. Look at:
#   - input → output total latency (≥ 90s = the dispatch hit timeout)
#   - tool spans — which one took the most? did any throw?
#   - the final agent_message span — was it written to the message buffer?
```

There's no clean polling pattern here yet — Langfuse needs API credentials and the trace API is heavier than meter_events. Use this surface for **post-mortem** on a specific stuck turn, not real-time tailing.

### Monitor 5 — `chat.postMessage` outbound success (synthesized)

Sendero doesn't have a dedicated Slack outbound table. Start with `slack_agent_events` (`outbound_posted` / `outbound_failed`). If the timeline is ambiguous, approximate by polling Slack's API directly for the latest message in the channel under test, OR ask the user to hit the channel and confirm the bot reply landed.

For paranoid debugging, add temporary logging in `apps/app/lib/slack-agent.ts` around the `chat.update` / `chat.postMessage` calls. Remove before commit.

## Common patterns surfaced

These are the bug families this skill has caught repeatedly. Check them before deep diving.

- **Turn writes meter row but Slack channel shows no reply.** Outbound `chat.postMessage` failed silently after the turn billed. Search dev stdout for `[slack.agent] placeholder post failed` OR `fallback post failed`. Common causes: bot kicked from channel (`channel_not_found`), workspace token revoked between turns (`token_revoked`), Slack rate limit (`ratelimited`).
- **"🔎 Searching flights…" placeholder, then silence.** Check `slack_agent_events` for the same `trace_id`. If the last row is `tool_started`, the tool or provider hung/failed. If the last row is `step_update` with no final `outbound_posted`, the final Slack update/post likely failed. Then inspect dev stdout for `chat.update on placeholder failed`.
- **Approval gate hung.** Booking flows insert a `Booking` row with `status='pending_approval'` and emit a Slack interactive button. If the operator never taps Approve/Reject, the agent waits forever. Check `bookings WHERE status='pending_approval' AND tenantId=...`. Cancel manually if needed: `UPDATE bookings SET status='cancelled' WHERE id=...`.
- **First-inbound slow (>10s).** Empty `slack_user_bindings` cache forces `slack.users.info` calls + email lookup. Subsequent turns are fast. Not a bug; expected on cold tenant.
- **Duplicate replies.** Redis dedup is down (`[slack-dedup-lock] dedup check failed`). Slack retries every event 3x. Bring Redis back up.
- **Webhook signature failures.** `[slack/events]` returns 401 silently. Slack treats 401 as a retry trigger → 3 retries + give up. Check `SLACK_SIGNING_SECRET` env matches the value in Slack app's "Basic Information → App Credentials".

## When monitors stop firing

- **Empty Slack monitor results** → confirm Slack is actually reaching Sendero. Send a test message in the channel; if no inbound row in `slack_webhook_events`, the webhook URL is wrong/unreachable or the running app does not include the Slack audit migration/code. Check `kapso whatsapp webhooks list` is NOT applicable for Slack — Slack uses raw `events_api` URL configured in the Slack app dashboard, NOT Kapso. The URL must be `https://sendero-dev-bufi.ngrok.app/api/webhooks/slack/events`.
- **`[slack/events] inbound` shows but no agent reply** → `runSlackAgentTurn` is throwing. Tail `[slack.agent]` lines for the exception.
- **Mid-conversation freeze ("🔎 Searching flights…" stays forever)** → step-update failed. Check Slack rate limit headers. Worst case, the placeholder message ts is wrong and `chat.update` is editing the wrong message.

## Output formatting tips

- One line per event.
- Truncate previews to ≤180 chars.
- Use `${var:0:N}` shell substring slicing for ids.
- For Langfuse trace links, include the `trace_id` so the user can paste it.

## Cleanup

`TaskStop <task-id>` ends a persistent monitor. Auto-dies at session boundary; re-arm next session.

## Related

- `whatsapp-monitor` — sibling skill for WhatsApp surface. Same pre-flight + Monitor 1 pattern; Monitor 4 is `kapso whatsapp messages list` because WhatsApp HAS audit tables Slack doesn't.
- `observe-whatsapp` — WhatsApp ops diagnostics. **No Slack analog exists.** Building one (slack-deliveries query, slack-errors triage) would close the audit gap; track in `docs/agent-gaps/board.md` if needed.
- `automate-whatsapp` — Kapso workflow editing for WhatsApp. Slack flows live in Sendero source code (no Kapso analog). Persona changes are in the Slack agent's hardcoded prompt (`apps/app/lib/agent-persona.ts::buildSlackPersonaWithContext`).
- `raj-demand-driven-context` — dogfood loop framing.
