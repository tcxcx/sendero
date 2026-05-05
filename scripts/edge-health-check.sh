#!/usr/bin/env bash
# Edge worker health probe.
#
# Hits HEALTH_URL (default: production arc-edge), validates HTTP
# status + body shape + latency SLO, emits a JSONL line to stdout, and
# (when GITHUB_TOKEN is set) opens / appends to / closes a labeled
# incident issue.
#
# Exit codes: 0 = healthy, 1 = unhealthy.
#
# Local usage:
#   bash scripts/edge-health-check.sh
#   HEALTH_URL=http://localhost:3021/health bash scripts/edge-health-check.sh
#   HEALTH_URL=https://example.com/404      bash scripts/edge-health-check.sh
#
# Dependencies: curl, jq. (gh only when GITHUB_TOKEN is set.)

set -u
# Don't `set -e` — we want to handle curl/jq failures explicitly so we
# can still emit a JSONL line and a structured exit.

HEALTH_URL="${HEALTH_URL:-https://sendero-arc-edge.tomas-cordero-esp.workers.dev/health}"
LABEL="edge-health-incident"
ISSUE_TITLE="🚨 Edge worker health probe failure"

# SLO thresholds (ms). Warn at 1500, fail at 2000.
LATENCY_WARN_MS=1500
LATENCY_FAIL_MS=2000

# --- Probe ----------------------------------------------------------------

ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
start_ns="$(date +%s%N 2>/dev/null || echo 0)"

# `--max-time 10` is a hard ceiling; the worker should respond in <500ms.
# Use a tmpfile for the body so we can validate shape after the fact.
body_file="$(mktemp)"
trap 'rm -f "$body_file"' EXIT

http_code="$(curl -sS \
  --max-time 10 \
  --connect-timeout 5 \
  -o "$body_file" \
  -w "%{http_code}" \
  -H "Accept: application/json" \
  -H "User-Agent: sendero-edge-health-probe/1.0" \
  "$HEALTH_URL" 2>/dev/null || echo "000")"

end_ns="$(date +%s%N 2>/dev/null || echo 0)"

# nanosecond math — both BSD (macOS) and GNU date support %N.
if [ "$start_ns" != "0" ] && [ "$end_ns" != "0" ]; then
  latency_ms=$(( (end_ns - start_ns) / 1000000 ))
else
  latency_ms=-1
fi

# --- Gates ----------------------------------------------------------------

failure_reason=""

if [ "$http_code" != "200" ]; then
  failure_reason="http_status=${http_code}"
fi

if [ -z "$failure_reason" ]; then
  if ! jq -e '.ok == true and .timestamp != null' "$body_file" >/dev/null 2>&1; then
    body_preview="$(head -c 200 "$body_file" 2>/dev/null | tr '\n' ' ')"
    failure_reason="body_shape_invalid: ${body_preview}"
  fi
fi

if [ -z "$failure_reason" ] && [ "$latency_ms" -gt 0 ] && [ "$latency_ms" -ge "$LATENCY_FAIL_MS" ]; then
  failure_reason="latency_slo_breach=${latency_ms}ms (limit=${LATENCY_FAIL_MS}ms)"
fi

# --- JSONL emit -----------------------------------------------------------

if [ -n "$failure_reason" ]; then
  ok_value="false"
else
  ok_value="true"
fi

# Emit one structured line for log retention / alerting downstream.
jq -nc \
  --arg timestamp "$ts" \
  --arg url "$HEALTH_URL" \
  --argjson status_code "${http_code:-0}" \
  --argjson latency_ms "$latency_ms" \
  --argjson ok "$ok_value" \
  --arg reason "$failure_reason" \
  '{timestamp: $timestamp, url: $url, status_code: $status_code, latency_ms: $latency_ms, ok: $ok, reason: ($reason | select(length > 0))}' \
  || echo "{\"timestamp\":\"$ts\",\"url\":\"$HEALTH_URL\",\"status_code\":$http_code,\"latency_ms\":$latency_ms,\"ok\":$ok_value}"

# Latency warn (non-fatal).
if [ -z "$failure_reason" ] && [ "$latency_ms" -gt 0 ] && [ "$latency_ms" -ge "$LATENCY_WARN_MS" ]; then
  echo "::warning::edge-health latency=${latency_ms}ms exceeds warn threshold ${LATENCY_WARN_MS}ms" >&2
fi

# --- GitHub side effects --------------------------------------------------

# Only act on issues when we have a token AND the gh CLI. Local runs
# (no GITHUB_TOKEN) just emit JSONL and exit.
have_gh=0
if [ -n "${GITHUB_TOKEN:-}" ] && command -v gh >/dev/null 2>&1; then
  have_gh=1
fi

if [ "$have_gh" = "1" ]; then
  # Find any open incident issue.
  open_issue_number="$(gh issue list \
    --label "$LABEL" \
    --state open \
    --json number \
    --jq '.[0].number // empty' 2>/dev/null || echo "")"

  if [ -n "$failure_reason" ]; then
    # FAILURE PATH: open or append.
    body=$(cat <<EOF
**Probe failure detected**

- Timestamp: \`$ts\`
- URL: \`$HEALTH_URL\`
- HTTP status: \`$http_code\`
- Latency: \`${latency_ms}ms\`
- Reason: \`$failure_reason\`
- Run: ${GH_RUN_URL:-(local run)}

This issue auto-closes when the next probe succeeds. To pause probing,
set repository variable \`EDGE_HEALTH_PAUSE=1\`.
EOF
)
    if [ -z "$open_issue_number" ]; then
      # Ensure label exists (idempotent — ignore failure if already there).
      gh label create "$LABEL" --color "B60205" --description "Edge worker health probe failure" >/dev/null 2>&1 || true
      gh issue create \
        --title "$ISSUE_TITLE" \
        --label "$LABEL" \
        --body "$body" >/dev/null \
        || echo "::error::failed to create incident issue" >&2
    else
      gh issue comment "$open_issue_number" --body "$body" >/dev/null \
        || echo "::error::failed to comment on incident issue #$open_issue_number" >&2
    fi
  else
    # HEALTHY PATH: close any open incident.
    if [ -n "$open_issue_number" ]; then
      recovery_body=$(cat <<EOF
✅ Recovery detected at \`$ts\`

- URL: \`$HEALTH_URL\`
- Latency: \`${latency_ms}ms\`
- Run: ${GH_RUN_URL:-(local run)}

Closing.
EOF
)
      gh issue comment "$open_issue_number" --body "$recovery_body" >/dev/null \
        || echo "::warning::failed to comment recovery on #$open_issue_number" >&2
      gh issue close "$open_issue_number" >/dev/null \
        || echo "::warning::failed to close #$open_issue_number" >&2
    fi
  fi
fi

# --- Exit -----------------------------------------------------------------

if [ -n "$failure_reason" ]; then
  echo "::error::edge-health failed: $failure_reason" >&2
  exit 1
fi

exit 0
