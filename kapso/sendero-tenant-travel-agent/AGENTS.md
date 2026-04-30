# Sendero Tenant Travel Agent

- Kapso function entrypoints are plain Worker files. Do not add imports, exports, CommonJS, or a TypeScript build step.
- Sendero remains the source of truth. Kapso functions call the internal Sendero tool endpoint with `SUPPORT_TOOLS_SECRET`.
- Web internal handoff is mandatory and primary. Slack and WhatsApp operator fanout are optional tenant configuration.
- Free workspaces do not get a shared live WhatsApp test number. Tenants must upgrade and connect a dedicated WhatsApp Business number before the tenant travel agent can run on WhatsApp.
- Paid tenant context resolves from the active Kapso/WhatsApp phone number id. Never trust tenant ids supplied in free text.
