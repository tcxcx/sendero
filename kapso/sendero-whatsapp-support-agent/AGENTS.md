# Sendero WhatsApp Support Agent

This package is the local Kapso workflow for the Sendero WhatsApp support channel. Keep it deployable with `kapso push`, but treat `workflows/sendero-whatsapp-support-agent/workflow.ts` and the function directories as the source of truth.

## Local Workflow Rules

- Generated `definition.json` and `workflow.yaml` files are build outputs and stay ignored.
- `WHATSAPP_PHONE_NUMBER_ID` is required for local builds because the workflow trigger binds to a specific Kapso WhatsApp phone number.
- `AGENT_SANDBOX_GITHUB_REPO_URL` and `AGENT_SANDBOX_GITHUB_REPO_BRANCH` mount product context into the agent sandbox. Leave `AGENT_SANDBOX_ENABLED=false` only for local tests that should not mount a repository.
- Functions are plain uploaded Worker files. Keep `async function handler(request, env) { ... }` in `index.js`; do not add `export default`, `module.exports`, `import`, `require`, or a TypeScript build step.
- Reuse Sendero's canonical MCP contracts at the boundary: function-tool `inputSchema` should stay JSON Schema compatible with MCP `tools/list`, and function responses should be JSON payloads that can be mirrored by the shared `@sendero/tools` registry later.
- Slack handoff is stateful: the ask-team function creates or reuses a pending question, Slack Events resumes the workflow after a human replies in the thread and sends `done`.
- A Kapso resume response of `404` or `422` means the execution may already be complete or no longer waiting. The Slack answer is still persisted to prevent duplicate handoff threads.

## Operational Loop

1. `bun install`
2. `bun run validate`
3. `WHATSAPP_PHONE_NUMBER_ID=<phone_number_id> bun run build`
4. `bun run sync:secrets -- --dry-run` before pushing new env values
5. `kapso push`

## Implementation Notes Learned From Kapso's Sample

- Keep Slack Events public but verify Slack signatures before processing event callbacks.
- Store the Slack thread-to-question mapping and the open execution-to-question mapping in KV so retries are idempotent.
- Use `enter_waiting` in the agent prompt when the customer needs to respond, and `complete_task` only when the support turn is actually finished.
- Preserve the full WhatsApp context in function payload handling. Phone, profile name, conversation id, workflow id, and flow step id are useful for human escalation and for future Sendero workspace support analytics.
