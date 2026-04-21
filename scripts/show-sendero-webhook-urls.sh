#!/usr/bin/env bash
set -euo pipefail

API_URL="${NGROK_API_URL:-http://127.0.0.1:4040/api/tunnels}"
json="$(curl --max-time 2 -fsS "$API_URL" 2>/dev/null || true)"

if [ -z "$json" ]; then
  echo "No local ngrok API is responding at $API_URL."
  echo "Start Sendero ngrok first: bun run webhooks:ngrok"
  exit 1
fi

public_url="$(
  JSON="$json" node - <<'EOF'
const data = JSON.parse(process.env.JSON || '{}');
const tunnel = (data.tunnels || []).find(t => {
  const cfg = t.config || {};
  return t.name === 'sendero-app' || String(cfg.addr || '').endsWith(':3010');
});
if (tunnel?.public_url) process.stdout.write(tunnel.public_url);
EOF
)"

if [ -z "$public_url" ]; then
  echo "No Sendero tunnel found. Existing ngrok tunnels do not point at port 3010."
  exit 1
fi

cat <<EOF
Sendero ngrok URL:
  $public_url

Configure provider webhooks:
  Clerk:  $public_url/api/webhooks/clerk
  Duffel: $public_url/api/webhooks/duffel
  Resend: $public_url/api/webhooks/resend

Keep NEXT_PUBLIC_APP_URL on http://localhost:3010 for local passkey QA unless
you also add the ngrok domain to Circle Modular Wallet passkey domains.
EOF
