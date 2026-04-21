#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOCAL_CONFIG="$ROOT/ngrok-sendero.yml"
GLOBAL_CONFIG="${NGROK_GLOBAL_CONFIG:-$HOME/Library/Application Support/ngrok/ngrok.yml}"

if ! command -v ngrok >/dev/null 2>&1; then
  echo "ngrok is not installed. Install it from https://ngrok.com/download"
  exit 1
fi

if [ ! -f "$GLOBAL_CONFIG" ]; then
  echo "Global ngrok config not found at: $GLOBAL_CONFIG"
  echo "Run: ngrok config add-authtoken <token>"
  exit 1
fi

if [ ! -f "$LOCAL_CONFIG" ]; then
  echo "Sendero ngrok config not found at: $LOCAL_CONFIG"
  exit 1
fi

echo "Starting Sendero ngrok tunnel on local port 3010."
echo "This uses tunnel name 'sendero-app' and does not touch Desk's app/shiva/admin tunnels."
echo "After it starts, run: bun run webhooks:urls"
echo

ngrok start --config="$GLOBAL_CONFIG" --config="$LOCAL_CONFIG" sendero-app
