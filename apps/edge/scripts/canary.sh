#!/usr/bin/env bash
# canary.sh — thin wrapper around `wrangler versions {upload,deploy}` for
# Sendero edge worker gradual rollouts. Invoked by the package.json scripts:
#
#   bun run --cwd apps/edge deploy:canary -- --pct 10
#   bun run --cwd apps/edge deploy:promote
#   bun run --cwd apps/edge deploy:rollback
#
# Wrangler v4 syntax (verified against v4.85.0, 2026-04):
#
#   # Upload code as a new version, no traffic routed:
#   wrangler versions upload --message "<msg>"
#       → prints "Worker Version ID: <uuid>"
#
#   # Split traffic between two versions (non-interactive needs --yes):
#   wrangler versions deploy <new>@10% <prev>@90% --yes --message "<msg>"
#
#   # Promote a single version to 100%:
#   wrangler versions deploy <id>@100% --yes --message "<msg>"
#
#   # List versions newest-first as JSON (used here to find the previous
#   # active version for rollback):
#   wrangler versions list --json
#
#   # Show the current deployment + version split as JSON:
#   wrangler deployments list --json
#
# Refs:
#   https://developers.cloudflare.com/workers/configuration/versions-and-deployments/gradual-deployments/
#   https://developers.cloudflare.com/workers/wrangler/commands/workers/
#
# These flags drift across wrangler releases. If a CI run fails with an
# "interactive prompt" error, bump wrangler and re-verify --yes works
# for `versions deploy` (cloudflare/workers-sdk#5709 is the historical bug).

set -euo pipefail

cmd="${1:-}"
shift || true

# Default canary percentage; override with --pct N.
pct=10
msg=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --pct)
      pct="$2"
      shift 2
      ;;
    --message)
      msg="$2"
      shift 2
      ;;
    *)
      echo "[canary] unknown flag: $1" >&2
      exit 2
      ;;
  esac
done

if [[ "$pct" -lt 1 || "$pct" -gt 99 ]]; then
  echo "[canary] --pct must be 1..99 (got $pct). Use deploy:promote for 100%." >&2
  exit 2
fi

# Use the locally-resolved wrangler so package.json controls the version.
WRANGLER="bunx wrangler"

# `wrangler versions list --json` returns versions newest-first. Each entry
# has at least { id, number, metadata: { ... } }. We grab the first id
# that's currently routing traffic (i.e., shows up in `deployments list`).
current_active_version() {
  $WRANGLER deployments list --json 2>/dev/null \
    | bun -e '
      const raw = require("fs").readFileSync(0, "utf8");
      try {
        const data = JSON.parse(raw);
        // deployments list returns an array; latest deployment is index 0.
        // Each deployment has versions: [{ version_id, percentage }].
        const latest = Array.isArray(data) ? data[0] : data;
        const versions = latest?.versions ?? [];
        // Pick the version with the highest percentage as "active".
        const top = versions.sort((a, b) => (b.percentage ?? 0) - (a.percentage ?? 0))[0];
        if (top?.version_id) console.log(top.version_id);
      } catch (_) {
        // Fall through — caller handles empty stdout.
      }
    '
}

# Pull the second-most-recent version_id from the deployments list. That's
# the rollback target: the version that was active before the current canary.
previous_active_version() {
  $WRANGLER deployments list --json 2>/dev/null \
    | bun -e '
      const raw = require("fs").readFileSync(0, "utf8");
      try {
        const data = JSON.parse(raw);
        if (!Array.isArray(data) || data.length < 2) return;
        // data[0] = current deployment, data[1] = previous deployment.
        const prev = data[1];
        const versions = prev?.versions ?? [];
        const top = versions.sort((a, b) => (b.percentage ?? 0) - (a.percentage ?? 0))[0];
        if (top?.version_id) console.log(top.version_id);
      } catch (_) {}
    '
}

case "$cmd" in
  canary)
    upload_msg="${msg:-canary upload (will route ${pct}%)}"
    echo "[canary] uploading new version (no traffic) ..."
    upload_out=$($WRANGLER versions upload --message "$upload_msg" 2>&1 | tee /dev/stderr)
    new_id=$(printf '%s\n' "$upload_out" | grep -oE 'Worker Version ID:[[:space:]]*[a-f0-9-]+' | tail -1 | awk '{print $NF}')
    if [[ -z "$new_id" ]]; then
      echo "[canary] could not parse new version id from upload output" >&2
      exit 1
    fi
    prev_id=$(current_active_version)
    if [[ -z "$prev_id" ]]; then
      echo "[canary] no current active version found — cannot split traffic." >&2
      echo "[canary] run \`wrangler versions deploy ${new_id}@100%\` to bootstrap." >&2
      exit 1
    fi
    rest=$((100 - pct))
    deploy_msg="${msg:-canary ${pct}% — new=${new_id} prev=${prev_id}}"
    echo "[canary] new=${new_id} prev=${prev_id} → splitting ${pct}/${rest}"
    $WRANGLER versions deploy \
      "${new_id}@${pct}%" \
      "${prev_id}@${rest}%" \
      --yes \
      --message "$deploy_msg"
    echo "[canary] OK — ${pct}% traffic on ${new_id}, ${rest}% on ${prev_id}"
    # Emit machine-readable line for CI consumers (parsed by the workflow).
    echo "CANARY_NEW_VERSION_ID=${new_id}"
    echo "CANARY_PREV_VERSION_ID=${prev_id}"
    ;;

  promote)
    # The "canary" version is whichever version currently has <100% traffic.
    # If a single version is already at 100%, this is a no-op (idempotent).
    canary_id=$($WRANGLER deployments list --json 2>/dev/null \
      | bun -e '
        const raw = require("fs").readFileSync(0, "utf8");
        try {
          const data = JSON.parse(raw);
          const latest = Array.isArray(data) ? data[0] : data;
          const versions = latest?.versions ?? [];
          if (versions.length === 1 && (versions[0].percentage ?? 100) === 100) return;
          // Promote the version with the lowest percentage — that is the
          // newest canary that still needs to take 100%.
          const sorted = [...versions].sort((a, b) => (a.percentage ?? 0) - (b.percentage ?? 0));
          if (sorted[0]?.version_id) console.log(sorted[0].version_id);
        } catch (_) {}
      ')
    if [[ -z "$canary_id" ]]; then
      echo "[canary] no active canary found — already at 100%, nothing to promote." >&2
      exit 0
    fi
    promote_msg="${msg:-promote ${canary_id} to 100%}"
    echo "[canary] promoting ${canary_id} to 100% ..."
    $WRANGLER versions deploy "${canary_id}@100%" --yes --message "$promote_msg"
    echo "[canary] OK — 100% traffic on ${canary_id}"
    echo "CANARY_PROMOTED_VERSION_ID=${canary_id}"
    ;;

  rollback)
    # Route 100% back to the version that was active before the current canary.
    target_id=$(previous_active_version)
    if [[ -z "$target_id" ]]; then
      echo "[canary] no previous deployment found — cannot rollback automatically." >&2
      echo "[canary] use \`wrangler rollback <version-id>\` manually." >&2
      exit 1
    fi
    rb_msg="${msg:-rollback to ${target_id}}"
    echo "[canary] rolling back: 100% traffic → ${target_id}"
    $WRANGLER versions deploy "${target_id}@100%" --yes --message "$rb_msg"
    echo "[canary] OK — rolled back to ${target_id}"
    echo "CANARY_ROLLBACK_VERSION_ID=${target_id}"
    ;;

  *)
    echo "usage: $0 {canary|promote|rollback} [--pct N] [--message MSG]" >&2
    exit 2
    ;;
esac
