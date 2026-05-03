# Sendero WhatsApp Flows

Meta-registered native WhatsApp Flows the agent triggers via Kapso's
`send_flow_message` builtin instead of free-text prose.

## passenger-intake.json

Single-screen form: full name (passport-format), DOB, passport number,
expiry, nationality, email. Submission lands at the Kapso agent as an
`interactive.nfm_reply` payload; the agent passes the structured JSON
straight into `call_sendero({ toolName: 'create_passenger', input: {…} })`
followed by `check_travel_eligibility`. No data endpoint — fully static
flow with `complete` action.

### Deploy (one-shot per phone number)

Requires the tenant WABA to have **Flows encryption enabled** (Kapso
Settings → WhatsApp/Phone configuration → "Enable encryption"). The
sandbox phone returns 500 on `create_flow` until encryption is turned
on.

```bash
cd ~/.claude/skills/integrate-whatsapp
KAPSO_API_BASE_URL=https://api.kapso.ai \
KAPSO_API_KEY=$(grep KAPSO_API_KEY /Users/criptopoeta/coding-dojo/sendero/.env.local | cut -d= -f2) \
  node scripts/create-flow.js \
    --phone-number-id <tenant_phone_number_id> \
    --name passenger_intake
# Capture the returned flow_id, then:
node scripts/update-flow-json.js \
  --flow-id <flow_id> \
  --json-file /Users/criptopoeta/coding-dojo/sendero/apps/app/lib/whatsapp-flows/passenger-intake.json
node scripts/publish-flow.js --flow-id <flow_id>
```

After publish, edit the Kapso workflow graph to enable
`send_flow_message` in `enabled_default_tools` and tell the agent in
the system prompt:

```
For passenger details (name / DOB / passport / expiry / nationality)
on a booking, call `send_flow_message` with `flow_id=<flow_id>` and
relay any submitted JSON via `call_sendero({ toolName:
'create_passenger', input: <submission> })`.
```
