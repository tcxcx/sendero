# Sendero Tenant Travel Agent

Kapso workflow for tenant-owned WhatsApp travel operations. This is separate from the Sendero customer support agent.

## Runtime contract

- Kapso owns WhatsApp inbound workflow orchestration and WhatsApp UX.
- Sendero owns tenant auth, canonical tools, MCP, billing, wallets, escrow, trip state, web handoff, Slack, and audit.
- Function entrypoints are plain uploaded Worker files:

```js
async function handler(request, env) {
  return new Response('ok');
}
```

Do not add `export default`, `module.exports`, imports, or a TypeScript build step to function entrypoints.

## Required environment

- `KAPSO_API_KEY`: Kapso project API key for build/push and trigger management.
- `SENDERO_APP_ORIGIN`: Sendero app origin, for example `https://app.sendero.travel`.
- `SUPPORT_TOOLS_SECRET` or `KAPSO_WEBHOOK_SECRET`: Shared secret used by Kapso functions when calling `/api/internal/support/tools`.

## Sendero app environment

- `KAPSO_TENANT_WORKFLOW_ID`: Kapso workflow id for this tenant travel agent. The Kapso provisioning webhook uses it to attach an inbound trigger for each paid tenant phone number.
## Handoff behavior

Every escalation creates a durable Sendero internal web handoff first. Slack and WhatsApp operator fanout are optional tenant configuration. The same handoff record stores WhatsApp conversation, workflow execution, Slack thread, and trip id when available.

## Free workspace behavior

Free tenants do not get a shared live WhatsApp sandbox number. The Sendero-owned sandbox number is reserved for Sendero customer support. Tenant WhatsApp operations require a paid plan and a dedicated WhatsApp Business number connected through Kapso.

The included Kapso phone-number slots are Sendero-owned platform inventory for support, sandbox, and ops. Do not assign those numbers to tenant customers; use the `WhatsAppInstall` BYO onboarding flow instead.

## Local validation

```bash
bun install
bun run validate
```

## Deploy

```bash
kapso login
kapso link && kapso pull
kapso push
```

The base workflow intentionally has no static WhatsApp phone trigger. Sendero attaches or replaces inbound triggers after paid tenant phone provisioning, using `KAPSO_TENANT_WORKFLOW_ID`.

Kapso CLI `0.15.x` does not expose a function-secret command. If the project does not already provide `SENDERO_APP_ORIGIN` and `SUPPORT_TOOLS_SECRET`/`KAPSO_WEBHOOK_SECRET` to function runtimes, set them in Kapso before activating tenant traffic.
