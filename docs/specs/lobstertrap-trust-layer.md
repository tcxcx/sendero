# Lobster Trap Trust Layer

Sendero can route the production agent through Veea Lobster Trap as a deep prompt inspection proxy.
This sits between `runAgentTurn` and the OpenAI-compatible backend, while the existing Sendero
scope filters, x402 signing, KYC policy hashes, and tool caps remain in place.

## Enable Locally

```bash
git clone https://github.com/veeainc/lobstertrap.git .context/lobstertrap
cd .context/lobstertrap
make build
./lobstertrap serve \
  --policy ../../packages/lobster-trap/policies/sendero_enterprise_policy.yaml \
  --backend http://localhost:11434 \
  --audit-log ../../.context/lobstertrap-audit.jsonl
```

Then run the app with:

```bash
LOBSTERTRAP_BASE_URL=http://localhost:8080 \
LOBSTERTRAP_MODEL=llama3.2 \
bun run dev
```

When `LOBSTERTRAP_BASE_URL` is present, `/api/agent/dispatch` routes agent inference through
Lobster Trap. The route adds `_lobstertrap` metadata declaring:

- agent id (`sendero-whatsapp`, `sendero-slack`, `sendero-mcp`, etc.)
- declared intent (`production_agent_x402`, `external_agent`, or `travel_concierge`)
- tenant id, hashed user id, turn id, trip id
- whether the request is API-key/x402 traffic

The current policy pack enforces on Lobster Trap's detected risk fields and actions. Declared intent,
tenant, trip, and x402 metadata are emitted for audit, downstream policy expansion, and operator review.

## Enterprise Audit Behavior

Lobster Trap returns `_lobstertrap` response metadata. Sendero reads that metadata and:

- emits `x-sendero-lobstertrap-verdict` on `/api/agent/dispatch` responses
- persists non-`ALLOW` verdicts into `SecurityAlert` as `lobstertrap_policy_violation`
- stores only safe fields: verdict, actions, risk scores, detected intents, matched rule, mismatch count, hashed user id
- never stores raw prompts, passport data, documents, credentials, or model output in the alert payload

## Policy Pack

The canonical Sendero policy pack is [packages/lobster-trap/policies/sendero_enterprise_policy.yaml](/Users/criptopoeta/conductor/workspaces/sendero/cancun/packages/lobster-trap/policies/sendero_enterprise_policy.yaml). The app-level copy at `configs/lobstertrap/sendero_enterprise_policy.yaml` is kept for deployment scripts that expect config files under `configs/`.

It blocks or reviews:

- prompt injection
- exfiltration
- credentials and seed phrases
- sensitive filesystem paths
- dangerous shell/network commands
- role impersonation
- high-risk undeclared intent
- output PII or credential leakage

The pack is intentionally strict for production agent traffic. It is designed as the
hackathon trust layer an enterprise security team can inspect: Lobster Trap is the proxy floor,
Sendero adds tenant auth, scopes, KYC policy hashes, x402 metering metadata, signed responses, and audit rows.

## Sendero Package

The reusable fork overlay lives in [packages/lobster-trap](/Users/criptopoeta/conductor/workspaces/sendero/cancun/packages/lobster-trap/README.md). It owns:

- typed `_lobstertrap` metadata injection
- audit-safe report summaries and alert payloads
- the enterprise policy pack
- sponsor-ready red-team fixtures and `bun run --cwd packages/lobster-trap redteam`
