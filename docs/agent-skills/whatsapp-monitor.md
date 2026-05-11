---
name: whatsapp-monitor
description: Arm a live `Monitor` against agent-turn signals so a dogfood session surfaces every inbound + outbound to chat in real time. Use when the user says "/whatsapp-monitor", "monitor the agent", "watch the dogfood", "tail the agent turns", or wants a live event stream while testing a real WhatsApp / operator-chat / Slack agent flow. Polls Postgres `meter_events` (every agent turn writes one), `chat_messages` (operator surface), `kapso whatsapp messages list` (WhatsApp surface), and ngrok's request inspector (every webhook hit). Picks the right tap per question — many dogfood sessions need 2–4 monitors at once.
---

# WhatsApp / Agent Monitor

## Why this exists

Sendero has **three agent surfaces** and **four signal sources** for live monitoring. The wrong choice gives you a silent monitor while the user thinks the channel is broken.

| Surface | Real-time signal | Notes |
|---|---|---|
| **Operator agent-chat** (`/dashboard/agent-chat`) | `chat_messages` row insert + `meter_events` `chat_reply` row | Both fire per turn. Either works. |
| **WhatsApp via Kapso AI Node** (hybrid runtime) | Kapso CLI `whatsapp messages list` + ngrok request stream when Kapso calls back into Sendero | Sendero's DB only fires when Kapso invokes a canonical tool. Pure chat replies stay inside Kapso. |
| **Slack / Sendero-direct WhatsApp** (legacy / direct) | `whatsapp_webhook_events` + `whatsapp_outbound_messages` | Pre-Kapso direct path; mostly idle today. |

**Default trap #1:** polling `whatsapp_webhook_events` looks correct (table name suggests it) but is empty for current Kapso-routed traffic. Confirm by `SELECT max(received_at) FROM whatsapp_webhook_events` — if it's days stale, the audit hook isn't firing for the surface the user is actually testing.

**Default trap #2:** `meter_events` only fires when the agent **completes** a turn that writes to Sendero. WhatsApp turns where Kapso replies entirely from inside its AI Node never write to Sendero. Greetings rendered by the UI as a hardcoded `_initialMessage` likewise never write to `chat_messages`.

**Default trap #3:** ngrok's default web inspector is `127.0.0.1:4040`, but Sendero's `bun webhook:ngrok` uses **`127.0.0.1:4041`** (so it doesn't collide with developers' personal ngrok). Always probe both ports.

**Default trap #4 — sandbox number doesn't resolve by display number.** The Sendero sandbox WhatsApp number (`+56 9 2040 3095`) lives in the BUFI Kapso project as the *secondary* entry where Kapso never set the `display_phone_number` field — `kapso whatsapp numbers list` shows it as `display=- name=-`. CLI lookups by `--phone-number "+56 9 2040 3095"` return `WhatsApp number not found`. **You must query by `--phone-number-id 597907523413541`.** That ID is also exposed as `KAPSO_SANDBOX_PHONE_NUMBER_ID` in env, and the active sandbox tenant binding lives in `whatsapp_installs WHERE status='active' AND business_account_id='2102230076919824'`.

## System requirements (pre-flight)

Run all checks at start. If anything is missing, **tell the user the exact command to fix it** before arming monitors. Do not silently fall back — silence on a misconfigured prerequisite looks identical to "no traffic".

```bash
# 1. psql (libpq via Homebrew)
ls /opt/homebrew/opt/libpq/bin/psql 2>/dev/null \
  || command -v psql >/dev/null \
  || echo "MISSING psql -> brew install libpq && brew link --force libpq"

# 2. DATABASE_URL in .env.local
grep -c '^DATABASE_URL=' /Users/criptopoeta/coding-dojo/sendero/.env.local

# 3. jq (JSON parsing)
command -v jq >/dev/null || echo "MISSING jq -> brew install jq"

# 4. Kapso CLI authenticated (project + numbers visible)
kapso status 2>&1 | head -10
# expected: "Authentication: authenticated", "Project: BUFI"
# missing → ask user: "kapso login"

# 4b. Resolve which WhatsApp surface the user is testing.
#     Always confirm the active sandbox install BEFORE assuming +54 / BUFI.
psql "$DATABASE_URL" -At -F'|' -c "SELECT \"tenantId\", \"phoneNumberId\", \"displayPhoneNumber\" FROM whatsapp_installs WHERE status='active' ORDER BY \"updatedAt\" DESC LIMIT 5;"
# Expected — for sandbox flow, one row like:
#   cmor8ach40002cj4045uin14j|597907523413541|+56 9 2040 3095
# That phoneNumberId is the sandbox; the displayPhoneNumber column is the
# only place "+56 9 2040 3095" appears. Kapso CLI itself shows display="-"
# for this number, so always use --phone-number-id, never --phone-number.

# 5. ngrok binary
command -v ngrok >/dev/null || echo "MISSING ngrok -> brew install ngrok"

# 6. ngrok tunnel running on Sendero's stable URL (sendero-dev-bufi.ngrok.app)
#    This is the public webhook target Kapso must hit.
curl -s http://127.0.0.1:4041/api/tunnels 2>/dev/null \
  | jq -r '.tunnels[]?.public_url' 2>/dev/null
# expected: "https://sendero-dev-bufi.ngrok.app"
# missing → ask user: "open a terminal and run: bun webhook:ngrok"
# (do NOT start your own ngrok — it will collide with the stable named tunnel)

# 7. apps/app dev server reachable on :3010
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3010/ 2>&1
# expected: 200
# missing → ask user: "bun dev"

# 8. observe-whatsapp scripts deps installed (only needed for fallback path)
ls ~/.claude/skills/observe-whatsapp/node_modules >/dev/null 2>&1 \
  || echo "OPTIONAL: cd ~/.claude/skills/observe-whatsapp && npm i"

# 9. Kapso API env (for fallback scripts only)
grep -cE '^(KAPSO_API_KEY|KAPSO_API_BASE_URL)=' /Users/criptopoeta/coding-dojo/sendero/.env.local
# expected: 2
```

If any of 1–7 fail, **stop and tell the user exactly what to run** (one-line message; one command per missing piece). Resume once they confirm. 8–9 are only needed if the user wants webhook-deliveries / api-logs drill-down.

## Health pre-flight (Kapso side)

Before arming any monitor, run these. They surface why a channel is silent BEFORE you start polling.

```bash
# A. Kapso project + customer count (smoke test)
kapso status

# B. BUFI number health — surfaces LIMITED / degraded states.
#    "Messaging Health: LIMITED" = Meta is throttling outbound (24h tier hit
#    or quality dropped). Silence is expected; not a bug in your monitor.
kapso whatsapp numbers health --phone-number "+54 9 11 7900-0320" --output human

# C. Webhook deliveries (24h). EMPTY = Kapso isn't firing webhooks at Sendero
#    at all. The inbound pipe is dead regardless of monitor setup. Likely
#    causes: webhook URL not pointed at the active ngrok tunnel, or no
#    webhook registered at the project level.
cd /Users/criptopoeta/coding-dojo/sendero && set -a && source .env.local && set +a
node ~/.claude/skills/observe-whatsapp/scripts/webhook-deliveries.js --period 24h --per-page 10

# D. Outbound errors (24h). Surfaces Meta-side delivery failures.
node ~/.claude/skills/observe-whatsapp/scripts/errors.js --period 24h --per-page 5

# E. Fresh messages on the BUFI number (ground truth for "did anything land?")
kapso whatsapp messages list --phone-number "+54 9 11 7900-0320" --limit 5 --output json \
  | jq -r '.data[] | "\(.timestamp) \(.kapso.direction//"-") \(.type) \((.text.body//.body//.kapso.content//"-")|tostring|.[0:120])"'
```

Report A–E findings to the user as a short table BEFORE arming monitors. Only proceed once anomalies (LIMITED, empty webhook deliveries, stale messages, outbound failures) are surfaced and acknowledged.

## Pick the right monitors

Most dogfood sessions need 2–3 of these armed simultaneously.

### Monitor 1 — `meter_events` (every Sendero turn)

Use when watching operator agent-chat OR Kapso-tool callbacks. One row per completed turn.

```bash
export PATH="/opt/homebrew/opt/libpq/bin:$PATH"
DATABASE_URL=$(grep -E '^DATABASE_URL=' /Users/criptopoeta/coding-dojo/sendero/.env.local | head -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//')
[ -z "$DATABASE_URL" ] && { echo "ERR: DATABASE_URL missing"; exit 1; }
SINCE=$(date -u +%Y-%m-%dT%H:%M:%S)
echo "ARMED meter_events>=$SINCE"
while true; do
  ROWS=$(psql "$DATABASE_URL" -At -F '|' -c "
    SELECT to_char(at AT TIME ZONE 'UTC','HH24:MI:SS'),
           coalesce(metadata->>'surface', metadata->>'channelKind','-'),
           \"toolName\",
           status,
           coalesce(metadata->>'turnId','-'),
           left(coalesce(\"tenantId\",'-'),12)
      FROM meter_events
     WHERE at > '${SINCE}'::timestamp
     ORDER BY at ASC LIMIT 50;" 2>/dev/null || true)
  if [ -n "$ROWS" ]; then
    while IFS='|' read -r t surf tool stat turn tenant; do
      [ -z "$t" ] && continue
      echo "$t  surface=${surf}  tool=${tool}  status=${stat}  turn=${turn:0:14}  tenant=${tenant:0:12}"
    done <<< "$ROWS"
    SINCE=$(date -u +%Y-%m-%dT%H:%M:%S)
  fi
  sleep 3
done
```

Output: `19:20:46  surface=web_console_chat  tool=chat_reply  status=paid  turn=chat_moufzu1z  tenant=cmo9g3ido…`

`metadata->>'surface'` is more discriminating than `channelKind` — values include `web_console_chat`, plus tool calls (`search_flights`, `book_flight`, etc.) when the user adds `WHERE "toolName" <> 'chat_reply'`.

### Monitor 2 — `chat_messages` (operator chat, all roles)

Streams the actual conversation (user → tool → assistant) for the operator surface.

```bash
export PATH="/opt/homebrew/opt/libpq/bin:$PATH"
DATABASE_URL=$(grep -E '^DATABASE_URL=' /Users/criptopoeta/coding-dojo/sendero/.env.local | head -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//')
SINCE=$(date -u +%Y-%m-%dT%H:%M:%S)
echo "ARMED chat_messages>=$SINCE"
while true; do
  ROWS=$(psql "$DATABASE_URL" -At -F '|' -c "
    SELECT to_char(\"createdAt\" AT TIME ZONE 'UTC','HH24:MI:SS'),
           role,
           replace(replace(left(coalesce(content,''),200),E'\n',' '),E'\r',' '),
           left(\"chatSessionId\",10)
      FROM chat_messages
     WHERE \"createdAt\" > '${SINCE}'::timestamp
     ORDER BY \"createdAt\" ASC LIMIT 30;" 2>/dev/null || true)
  if [ -n "$ROWS" ]; then
    while IFS='|' read -r t role body sess; do
      [ -z "$t" ] && continue
      echo "$t  [$role]  ${body:0:180}  sess=$sess"
    done <<< "$ROWS"
    SINCE=$(date -u +%Y-%m-%dT%H:%M:%S)
  fi
  sleep 2
done
```

### Monitor 3 — ngrok request stream (every webhook hit)

This is the **canonical webhook-level tap**. Every HTTP request to the local dev server through the public tunnel becomes one event. Use when watching Kapso → Sendero callbacks, Meta → Sendero direct webhooks, or Stripe/Circle/Clerk webhook flows.

```bash
SEEN=$(mktemp)
INSPECTOR="http://127.0.0.1:4041/api/requests/http"   # Sendero's ngrok inspector
echo "ARMED ngrok stream (sendero-dev-bufi.ngrok.app -> :3010 via inspector :4041)"
while true; do
  curl -s "${INSPECTOR}?limit=30" 2>/dev/null \
    | jq -r '.requests[]? | "\(.id)\t\(.start)\t\(.request.method)\t\(.response.status_code)\t\(.duration)\t\(.request.uri)"' 2>/dev/null \
    | tac | while IFS=$'\t' read -r rid ts method scode dur uri; do
        [ -z "$rid" ] && continue
        if ! grep -qxF "$rid" "$SEEN"; then
          echo "$rid" >> "$SEEN"
          T=$(echo "$ts" | cut -d'T' -f2 | cut -c1-8)
          DURMS=$((dur / 1000000))
          echo "$T  $method $scode (${DURMS}ms)  $uri"
        fi
      done
  sleep 1
done
```

Variable-name gotcha: zsh treats `$status` as read-only. The script uses `$scode` instead. Don't rename it back to `$status` or the Monitor exits with `read-only variable: status`.

### Monitor 4 — Kapso WhatsApp messages (sandbox or BUFI)

Polls Kapso directly. Catches Kapso-AI-Node-only turns that never reach Sendero's DB.

**Pick the right ID:**
- Sandbox (`+56 9 2040 3095`) → `PNID="597907523413541"` (Kapso CLI cannot resolve the display number; must use `--phone-number-id`)
- BUFI (`+54 9 11 7900-0320`) → `PNID="1093550410512138"` (display lookup works too)

```bash
PNID="597907523413541"   # sandbox; swap to BUFI id if needed
SEEN=$(mktemp)
# Seed with most recent message id so historical traffic doesn't replay
kapso whatsapp messages list --phone-number-id "$PNID" --limit 1 --output json 2>/dev/null \
  | tr -d '\000-\010\013\014\016-\037' \
  | jq -r '.data[0]?.id // empty' >> "$SEEN"
echo "ARMED kapso monitor (phoneNumberId=$PNID)"
while true; do
  OUT=$(kapso whatsapp messages list --phone-number-id "$PNID" --limit 10 --output json 2>/dev/null)
  if [ -n "$OUT" ]; then
    # Sanitize control chars before jq — Kapso payloads sometimes contain raw \n inside body strings
    echo "$OUT" \
      | tr -d '\000-\010\013\014\016-\037' \
      | jq -r '.data[]? | "\(.id)\t\(.timestamp)\t\(.kapso.direction//"-")\t\(.type//"-")\t\(.kapso.status//"-")\t\((.text.body//.body//.kapso.content//"-")|tostring|gsub("[\\n\\r]";" ")|.[0:160])"' 2>/dev/null \
      | tac | while IFS=$'\t' read -r mid ts dir typ st body; do
          [ -z "$mid" ] && continue
          if ! grep -qxF "$mid" "$SEEN"; then
            echo "$mid" >> "$SEEN"
            T=$(date -u -r "$ts" +%H:%M:%S 2>/dev/null || echo "$ts")
            echo "$T  dir=$dir  type=$typ  status=$st  $body"
          fi
        done
  fi
  sleep 3
done
```

JSON sanitization (`tr -d '\000-\010...'`) is required — Kapso occasionally returns payloads with raw control characters that crash `jq` with `Invalid string: control characters from U+0000 through U+001F must be escaped`.

### Combinations

| Goal | Arm |
|---|---|
| Operator chat dogfood | Monitor 1 + Monitor 2 |
| WhatsApp Kapso flow | Monitor 3 + Monitor 4 (+ Monitor 1 if user expects tool callbacks) |
| Full-stack (everything) | All four |
| Watching a specific webhook receiver | Monitor 3 alone, filter `uri` for `/api/webhooks/...` |

## Common patterns surfaced

These are bug families this skill has caught repeatedly. Check them before deep diving.

- **Localhost media URLs in outbound** — `errors --period 24h` shows code `131053 "Media upload error"` with image `link` containing `localhost:3010`. Meta fetches images server-side and can't reach localhost. Fix: pin `NEXT_PUBLIC_APP_URL` (or the share-card builder's base) to the ngrok stable URL during dev. See `apps/app/lib/og/share-url.ts`.
- **Wrong `phone_number_id` on outbound** — Sendero sends via the secondary number (`597907523413541`) instead of BUFI (`1093550410512138`). `errors` payload has `kapso.phone_number_id` per failure; cross-reference with `kapso whatsapp numbers list`.
- **`Messaging Health: LIMITED`** — Meta-side throttle. Outbound silence is expected. Check `kapso whatsapp numbers health` first; LIMITED won't recover until quality bounces back or 24h tier resets.
- **Empty `webhook-deliveries`** — Kapso has no webhook registered at the project scope, OR the registered URL is stale. Sendero registers via `bun scripts/register-kapso-webhook.ts`. Also confirm `KAPSO_GLOBAL_WEBHOOK_SECRET` is set in `.env.local`.
- **Hardcoded UI greeting masquerading as agent reply** — operator chat sometimes renders a static `_initialMessage` ("Hey Tomas! 👋 ¿En qué te ayudo? ✈️") that never POSTs to `/api/agent/chat`. Confirm by checking `chat_messages` for that text — absent = pure UI render.
- **Stale Kapso messages list (days old)** — either the user is on a different number, the BUFI number has zero recent traffic, or messaging is LIMITED. Re-confirm via `kapso whatsapp numbers resolve --phone-number "..." --output json`.
- **`send_interactive_*` 500 with leaked "service unstable" message to user** — two stacking causes. (1) Outbound media URL is `localhost:3010/api/og/share?...` instead of ngrok → Meta returns `131053 Media upload error` ("localhost resolved address 127.0.0.1 is private"). Fix: confirm `NEXT_PUBLIC_APP_URL=https://sendero-dev-bufi.ngrok.app` in `.env.local` AND **restart the apps/app dev server** (Next.js does not hot-reload env). (2) Recipient is outside the active 24h WhatsApp session → Kapso returns `403 "Active sandbox session required to send messages"`. The agent's persona currently has a faucet-menu guardrail in `packages/tools/src/whatsapp-interactive.ts:339` but no generic catch — the agent leaks the failure as "service unstable". Fix at the persona layer: add "if any `send_interactive_*` tool throws, fall back to plain text + the moonpay_topup `checkoutUrl`, do NOT explain the failure to the user."
- **Dev server hangs under concurrent dispatch load** — Next.js dev with turbopack hot-reload + 30+ concurrent `/api/agent/dispatch` calls can deadlock the worker (observed: 213% CPU, 6 GB RAM, port 3010 stops responding mid-sweep). Recovery: `kill <next-server PID>` and let the parent (`bun run dev`) re-fork. For long sweeps, rate-limit the driver with `await new Promise(r => setTimeout(r, 1500))` between calls and add 3-attempt retry on connection-refused. Reproducible via `.qa-phase-b/run-dogfood.ts`.

## When monitors stop firing

- **Empty results, even though the user says they're sending traffic** → check `SELECT max(at) FROM meter_events` to confirm the table is receiving writes globally. If yes but your filter is silent, the surface isn't writing to that table — switch to a different monitor (see "default traps").
- **ngrok stream silent** → confirm tunnel still up: `curl -s 127.0.0.1:4041/api/tunnels`. The user's `bun webhook:ngrok` may have crashed.
- **Monitor task disappears between turns** → persistent monitors don't always survive context boundaries. Re-arm with the same body. The `SINCE` resets to "now" so historical traffic won't replay.
- **`psql: command not found`** → `export PATH="/opt/homebrew/opt/libpq/bin:$PATH"` (PATH override in the command body, not just at shell prompt — the Monitor runs in a fresh subshell).
- **`read-only variable: status`** → zsh built-in collision. Rename loop var to `$scode` (or anything but `status`).
- **`jq: Invalid string: control characters`** → Kapso payload has raw control chars. Pipe through `tr -d '\000-\010\013\014\016-\037'` before `jq`.

## Output formatting tips

- One line per event — multiple lines per stdout flush get batched into one notification anyway, but readability degrades.
- Truncate previews to ≤ 180 chars so the notification stays scannable.
- Sanitize newlines in agent replies before truncation: `replace(content, E'\n', ' ')` in psql, `gsub("[\\n\\r]"; " ")` in jq.
- `${var:0:N}` shell substring slicing keeps tenant ids and turn ids short.

## Cleanup

`TaskStop <task-id>` ends a persistent monitor. Useful when swapping a broken monitor for a fixed one (e.g., the jq-control-char crash). They also auto-die at session boundary; re-arm next session.

## Related

- `observe-whatsapp` — full ops diagnostics (message delivery debugging, error triage, webhook deliveries) via Kapso CLI / fallback scripts. **Always run its `webhook-deliveries` and `errors` scripts as part of pre-flight** — they explain silent channels in seconds.
- `automate-whatsapp` — Kapso workflow editing (whitelist, AI Node prompts, function deploys).
- `raj-demand-driven-context` — the dogfood loop that frames why you're monitoring at all (gap-board → fix → retest).
