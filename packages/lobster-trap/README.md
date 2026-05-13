# @sendero/lobster-trap

Sendero's enterprise trust-layer package for Veea Lobster Trap. This is the product-facing fork overlay: Lobster Trap remains the inline DPI proxy, while this package adds the Sendero policy pack, typed `_lobstertrap` metadata, audit-safe summaries, and red-team fixtures for our agentic travel, KYC, x402, Slack, and WhatsApp workflows.

## What This Owns

- `policies/sendero_enterprise_policy.yaml`: the enterprise policy pack for prompt injection, exfiltration, credential leakage, sensitive path access, dangerous commands, role impersonation, and PII egress.
- `src/metadata.ts`: injects declared intent, tenant, hashed subject, turn, trip, auth mode, and x402 context into OpenAI-compatible requests.
- `src/audit.ts`: reduces Lobster Trap reports into regulator-readable, prompt-free security alert payloads.
- `src/redteam.ts`: canonical adversarial fixtures for CI and hackathon sponsor evidence.
- `scripts/run-redteam.ts`: runs those fixtures against a local Lobster Trap binary.

## Local Proxy

```bash
git clone https://github.com/veeainc/lobstertrap.git .context/lobstertrap-upstream
make -C .context/lobstertrap-upstream build

.context/lobstertrap-upstream/lobstertrap serve \
  --policy packages/lobster-trap/policies/sendero_enterprise_policy.yaml \
  --backend http://localhost:11434 \
  --audit-log .context/lobstertrap-audit.jsonl
```

Then run Sendero with:

```bash
LOBSTERTRAP_BASE_URL=http://localhost:8080 \
LOBSTERTRAP_MODEL=llama3.2 \
bun run dev
```

## Enterprise Deployment Shape

Lobster Trap sits between Sendero's agent gateway and any OpenAI-compatible model backend. The app keeps its existing scopes, KYC policy hashes, Self verification sessions, x402 metering, and tool caps. This package makes that inspection layer portable across:

- `/api/agent/dispatch` for WhatsApp, Slack, MCP, and hosted agent turns.
- Self-gated car rental and future ancillary workflows.
- x402 paid agent access where declared intent, auth mode, and payment context are carried into audit rows for downstream enforcement.
- Operator dashboards that need audit rows without raw prompts, passport data, credentials, or model output.

Non-`ALLOW` reports become `SecurityAlert` rows with request id, verdict, matched rule, risk scores, detected intent, mismatch count, hashed user id, tenant, channel, turn, trip, auth mode, and x402 status.

## Red-Team Evidence

```bash
bun run --cwd packages/lobster-trap redteam
```

The fixtures cover benign KYC travel flow, prompt injection, passport vault exfiltration, wallet/API credential leakage, and compliance-policy override attempts. These are intentionally small and inspectable so an enterprise security reviewer can understand what was blocked and why.
