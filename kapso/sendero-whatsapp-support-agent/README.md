# Sendero WhatsApp Support Agent

Local Kapso workflow fork for Sendero platform support over WhatsApp.

## Local loop

```bash
bun install
bun run validate
bun run build
kapso login
kapso link
kapso push --dry-run
kapso push
```

For a new checkout, start from the example env file:

```bash
cp .env.example .env.local
```

Set the required values in `.env.local`:

- `KAPSO_API_KEY`: Kapso Platform API key used by scripts and the Slack resume function.
- `WHATSAPP_PHONE_NUMBER_ID`: Kapso WhatsApp phone number ID that should trigger this workflow. Production Sendero Customer Support is `1133326556530962` (`+1 201-471-6461`).
- `PROVIDER_MODEL_NAME`: Agent model name, defaults to `gpt-5-mini`.
- `SLACK_BOT_TOKEN`: Bot token for the Slack app installed in the support workspace.
- `SLACK_CHANNEL_ID`: Channel that receives support escalations, for example `C...` or `G...`.
- `SLACK_SIGNING_SECRET`: Slack app signing secret for request verification.
- `KAPSO_WEBHOOK_BASE_URL`: Sendero app origin for support context tools, for example `https://app.sendero.travel`.
- `KAPSO_WEBHOOK_SECRET`: Shared secret accepted by `/api/internal/support/tools`.
- `SENDERO_SUPPORT_TRIP_INTAKE_FLOW_ID`: Optional Kapso/Meta Flow id for live-testing structured trip intake on the support number.
- `SENDERO_SUPPORT_REQUEST_FLOW_ID`: Optional Kapso/Meta Flow id for live-testing structured support/refund/setup intake on the support number.
- `SENDERO_SUPPORT_LOGIN_SIGNUP_FLOW_ID`: Optional Flow id for traveler login/signup and wallet consent.
- `SENDERO_SUPPORT_QUOTE_APPROVAL_FLOW_ID`: Optional Flow id for quote decision capture.
- `SENDERO_SUPPORT_ANCILLARIES_FLOW_ID`: Optional Flow id for bags, seats, insurance, lounge, meal, and priority requests.
- `SENDERO_SUPPORT_DISRUPTION_HELP_FLOW_ID`: Optional Flow id for delay/cancellation/rebooking support.
- `SENDERO_SUPPORT_PREFUND_CLAIM_FLOW_ID`: Optional Flow id for prefunded trip claim guidance.
- `SENDERO_SUPPORT_BOOKING_CHANGE_FLOW_ID`: Optional Flow id for change/cancel/rebook intake.
- `SENDERO_SUPPORT_ACCOMMODATION_FLOW_ID`: Optional Flow id for hotel/stay requests.
- `SENDERO_SUPPORT_CAR_TRANSFER_FLOW_ID`: Optional Flow id for transfers and car rentals.
- `SENDERO_SUPPORT_RESTAURANT_EXPERIENCE_FLOW_ID`: Optional Flow id for local recommendations.
- `SENDERO_SUPPORT_NFT_TRIP_GALLERY_FLOW_ID`: Optional Flow id for gallery/stamp requests.
- `SENDERO_SUPPORT_REFUND_ESCROW_FLOW_ID`: Optional Flow id for refund, escrow, settlement, and validation intake.
- `SENDERO_WHATSAPP_FLOW_MODE`: Optional `draft` while testing unpublished Flows.

The workflow source is `workflows/sendero-whatsapp-support-agent/workflow.ts`.
It uses a Kapso agent node with the built-in WhatsApp context tools, a Slack
escalation function, and optional GitHub sandbox context for Sendero docs/code.

Shared WhatsApp Flow JSON lives in `../shared-whatsapp-flows`. The support agent
is the live-test harness for the canonical Flow contract before the same Flow
keys are enabled for tenant-owned WhatsApp numbers. Kapso plan phone-number
slots are Sendero-owned platform inventory for support, sandbox, and ops; tenant
customers connect their own dedicated WhatsApp Business numbers through the app's
BYO Kapso onboarding.

Every support tool and Flow submission that reaches Sendero goes through
`/api/internal/support/tools`, which emits a Langfuse trace via `@sendero/langfuse`,
scores tool success and latency, returns `traceId`, and echoes
`x-sendero-trace-id`. Use that trace id when debugging a Slack/WhatsApp/web
handoff across Kapso execution logs, Sendero support tickets, and Langfuse.

Kapso function entrypoints intentionally stay as plain uploaded Worker files:

```js
async function handler(request, env) {
  return new Response('ok');
}
```

Do not add `export default`, `module.exports`, imports, or a TypeScript build
step to `functions/*/index.js`. Compatibility with Sendero's canonical MCP
surface lives at the schema/payload boundary: the workflow function-tool schemas
are JSON Schema, and the Worker handlers accept/return plain JSON so the same
contracts can be mirrored by the shared `@sendero/tools` registry.

## E2E shape

1. A message arrives on `WHATSAPP_PHONE_NUMBER_ID`.
2. Kapso starts `sendero-whatsapp-support-agent`.
3. The agent answers directly when it can.
4. If it needs internal help, it calls `sendero_ask_team_question`, posts a Slack
   thread assigned to the configured support owner, tells the WhatsApp user it
   is checking, and calls `enter_waiting`.
5. A teammate replies in the Slack thread and sends `done`.
6. The public Slack events function resumes the waiting Kapso execution.
7. The agent treats the Slack answer as internal input, replies to the user, then
   calls `complete_task`.

## Sendero support tools

The agent has dedicated function tools for live Sendero context:

- `get_tenant_context`: tenant, billing tier, subscription, channel counts, WhatsApp install, recent tickets.
- `get_whatsapp_setup_status`: setup link, phone number, WABA, Kapso connection, recent webhook/API/outbound diagnostics.
- `get_recent_channel_events`: recent WhatsApp webhook deliveries, API calls, outbound message delivery, and identities.
- `get_trip_context`: trip, traveler, policy, bookings, settlements, and chat/session context.
- `get_billing_context`: subscription, meter events, invoices, and spend caps.
- `get_escrow_context`: settlements, transfer attempts, Circle wallets, Gateway logs, and validation checks.
- `search_sendero_docs`: docs/runbook/template search through the Sendero repo.
- `create_support_ticket`: creates a durable Sendero support ticket.
- `update_support_ticket`: updates durable ticket status or summary.

All tools call the Sendero app endpoint:

```text
POST /api/internal/support/tools
```

Authentication uses `x-sendero-support-secret`. The app accepts
`SUPPORT_TOOLS_SECRET` when set, otherwise `KAPSO_WEBHOOK_SECRET`. The Kapso
Worker functions use `SUPPORT_TOOLS_SECRET` when set, otherwise
`KAPSO_WEBHOOK_SECRET`.

Durable tickets are stored in `support_tickets`; apply the database migration
before relying on ticket creation in a new environment:

```bash
bun run --cwd packages/database db:migrate:deploy
```

## Human escalation owner

Configure the default support ticket owner with:

- `SLACK_ESCALATION_ASSIGNEE_ID=U...`
- `SUPPORT_ESCALATION_ASSIGNEE_NAME=Support Owner`
- `SUPPORT_ESCALATION_ASSIGNEE_EMAIL=support.owner@example.com`

`SLACK_ESCALATION_ASSIGNEE_ID` is the only value required for a direct Slack
notification because the escalation message uses `<@U...>`. The name and email
are stored on the ticket metadata and are used as readable fallback text when a
Slack user ID is not configured.

To assign a different person:

1. Invite that person to the `SLACK_CHANNEL_ID` support channel.
2. Find their Slack user ID:
   - Open their Slack profile.
   - Click the three-dot menu.
   - Choose **Copy member ID**.
   - It should look like `U...`.
3. Update `.env.local`:

```bash
SLACK_ESCALATION_ASSIGNEE_ID=U_NEW_OWNER
SUPPORT_ESCALATION_ASSIGNEE_NAME="New Owner"
SUPPORT_ESCALATION_ASSIGNEE_EMAIL=new.owner@example.com
```

4. Sync the Kapso function secrets:

```bash
bun run sync:secrets
```

5. Push the workflow/functions if code changed:

```bash
bun run validate
bun test
kapso push
```

The `sendero_ask_team_question` tool also accepts `assignee_name`,
`assignee_email`, and `assignee_slack_user_id` in its input schema. Use those
only for per-escalation overrides; the env-backed values above are the default
owner for normal support tickets.

## Slack app setup

The Slack app needs these bot token scopes:

- `chat:write`
- `channels:history`
- `channels:read`
- `groups:history`
- `groups:read`

Recommended optional scopes:

- `users:read`
- `users:read.email`

The optional user scopes allow scripts or operators to look up an assignee by
email. Without them, use Slack's **Copy member ID** UI and set
`SLACK_ESCALATION_ASSIGNEE_ID` manually.

Set Slack's event request URL to the public Kapso function URL printed by:

```bash
bun run sync:secrets
```

The current function URL shape is:

```text
https://api.kapso.ai/platform/v1/functions/<function-id>/invoke
```

Subscribe the Slack app to message events for the support channel:

- `message.channels`
- `message.groups`

When the team has answered a support thread, reply in the Slack thread and send
`done`. The Slack events function aggregates the thread replies, resumes the
waiting Kapso workflow, and the agent sends the final answer back to WhatsApp.

## Sandbox repo context

Set these optional values when the agent should be able to inspect Sendero code
or docs from Kapso's remote sandbox:

```bash
AGENT_SANDBOX_GITHUB_REPO_URL=https://github.com/tcxcx/sendero
AGENT_SANDBOX_GITHUB_REPO_BRANCH=whatsapp-e2e
AGENT_SANDBOX_GITHUB_PAT=github_pat_...
AGENT_SANDBOX_NETWORK_MODE=allow_list
AGENT_SANDBOX_ALLOWED_OUTBOUND_HOSTS=api.kapso.ai,docs.kapso.ai,app.travel.sendero,docs.sendero.travel
```

The GitHub PAT should be fine-grained and read-only with Contents access to the
Sendero repository.
