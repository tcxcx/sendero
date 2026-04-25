#!/usr/bin/env bash
# scripts/check-wrangler-sync.sh
#
# Verifies the root stopgap wrangler.toml stays in sync with the canonical
# apps/edge/wrangler.toml on every push that touches either file. The two
# configs MUST agree on name, compatibility_date, compatibility_flags,
# workers_dev, preview_urls, and [vars]. The only allowed difference is
# `main`, which is path-rewritten relative to the repo root.
#
# Exit 0 = in sync. Exit 1 = drift, push blocked.
#
# Once the CF Workers Builds preview deploy command is updated to
# `bun run deploy:edge:preview`, delete the root wrangler.toml AND this
# script, and remove the lefthook hook that calls it.

set -euo pipefail

ROOT="wrangler.toml"
EDGE="apps/edge/wrangler.toml"

if [ ! -f "$ROOT" ]; then
  echo "✓ no root wrangler.toml — stopgap removed; nothing to verify."
  exit 0
fi

if [ ! -f "$EDGE" ]; then
  echo "✘ apps/edge/wrangler.toml is missing — repo is in a bad state."
  exit 1
fi

# Extract everything except the `main` line and comments/blank lines.
canonicalize() {
  grep -vE '^\s*(#|main\s*=)' "$1" | grep -vE '^\s*$' | sort
}

# Apps/edge has `main = "src/index.ts"`. Root has `main = "apps/edge/src/index.ts"`.
# Both should resolve to the same file from their own cwd. Verify.
# Use awk for portability — macOS sed doesn't grok \s in ERE.
edge_main=$(awk -F'"' '/^main[[:space:]]*=/ { print $2; exit }' "$EDGE")
root_main=$(awk -F'"' '/^main[[:space:]]*=/ { print $2; exit }' "$ROOT")

if [ "$root_main" != "apps/edge/$edge_main" ]; then
  echo "✘ wrangler.toml main mismatch:"
  echo "    root:      main = \"$root_main\""
  echo "    expected:  main = \"apps/edge/$edge_main\""
  echo "    apps/edge: main = \"$edge_main\""
  exit 1
fi

if ! diff -u <(canonicalize "$EDGE") <(canonicalize "$ROOT") >/dev/null; then
  echo "✘ root wrangler.toml has drifted from apps/edge/wrangler.toml:"
  diff -u <(canonicalize "$EDGE") <(canonicalize "$ROOT") | sed 's/^/    /'
  echo ""
  echo "  Fix: copy the relevant fields (name, compatibility_*, workers_dev,"
  echo "  preview_urls, [vars]) from apps/edge/wrangler.toml into root"
  echo "  wrangler.toml. Only \`main\` should differ."
  exit 1
fi

echo "✓ wrangler.toml configs in sync."
