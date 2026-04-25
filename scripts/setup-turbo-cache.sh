#!/usr/bin/env bash
# scripts/setup-turbo-cache.sh
#
# One-time setup for Turborepo Remote Cache (Vercel-backed, free for OSS).
# After this runs, every `bunx turbo` invocation reads/writes the shared
# Vercel cache, so CI + every developer's pre-push hook hit the same cache.
#
# Pre-push build today: ~120s on cache miss because every dev starts cold.
# Post-setup: ~10s on cache hit, since the same artifact a teammate (or CI)
# already built gets re-used.
#
# Run once per machine. Run again only if `~/.turbo/config.json` is wiped.
#
# What it does:
#   1. `npx turbo login`  — opens a browser, authenticates against Vercel.
#   2. `npx turbo link`   — picks the Vercel team/scope this monorepo lives
#                           under and writes `.turbo/config.json`.
#   3. Reminds the user to add TURBO_TOKEN + TURBO_TEAM as GitHub Actions
#      secrets so PR check workflows benefit from the same cache.
#
# Idempotent: re-running after success is a no-op.

set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

LINK_FILE=".turbo/config.json"

echo "→ Turborepo Remote Cache setup"
echo

if [ -f "$LINK_FILE" ]; then
  echo "✓ already linked — $LINK_FILE exists."
  echo
  echo "  team: $(grep -oE '"teamslug"[[:space:]]*:[[:space:]]*"[^"]*"' "$LINK_FILE" | sed 's/.*"\([^"]*\)"$/\1/' || echo '<unknown>')"
  echo "  proj: $(grep -oE '"projectId"[[:space:]]*:[[:space:]]*"[^"]*"' "$LINK_FILE" | sed 's/.*"\([^"]*\)"$/\1/' || echo '<unknown>')"
  echo
  echo "  To re-link (e.g. after switching Vercel teams):"
  echo "    rm $LINK_FILE && bash scripts/setup-turbo-cache.sh"
  exit 0
fi

# Step 1 — auth
echo "1/3  Authenticating with Vercel (opens browser)..."
if ! npx turbo login; then
  echo "✘ login failed. Re-run when you're ready."
  exit 1
fi

# Step 2 — link to a team/project
echo
echo "2/3  Linking this repo to a Vercel team/scope..."
if ! npx turbo link; then
  echo "✘ link failed. Re-run when you're ready."
  exit 1
fi

if [ ! -f "$LINK_FILE" ]; then
  echo "✘ $LINK_FILE was not created. Something went wrong with link."
  exit 1
fi

# Step 3 — surface CI integration steps
echo
echo "3/3  ✓ Local cache linked."
echo
echo "    Verify with:  bunx turbo run typecheck --filter=@sendero/edge"
echo "    On second run you should see: '>>> FULL TURBO' (cache hit)."
echo
echo "──── Next: wire CI to the same cache ────"
echo
echo "GitHub Actions:"
echo "  1. Vercel Dashboard → Account Settings → Tokens → Create Token"
echo "       Scope: this team. Name: 'sendero-ci-turbo-remote-cache'."
echo "  2. GitHub repo → Settings → Secrets and variables → Actions:"
echo "       TURBO_TOKEN = <the token>"
echo "       TURBO_TEAM  = <team slug, e.g. tcxcxs-projects>"
echo "  3. .github/workflows/pr.yml already has a TODO marker for these"
echo "     env vars — uncomment the two 'env:' lines under 'turbo run'."
echo
echo "Cloudflare Workers Builds (optional, biggest CF speedup):"
echo "  Dashboard → sendero-arc-edge → Settings → Build → Variables and Secrets:"
echo "    TURBO_TOKEN = <the token>"
echo "    TURBO_TEAM  = <team slug>"
echo "  Next CF build will read from the cache instead of running typecheck cold."
echo
echo "Done. The .turbo/config.json file is gitignored — each dev re-runs this."
